import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createFixedLight, configureShadowFrustum, disposeLight } from './sun';

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  controls: OrbitControls;
  sunLight: THREE.DirectionalLight;
  ground: THREE.Mesh;
  buildingGroup: THREE.Group;
  requestRender: () => void;
  dispose: () => void;
}

const SCALE = 0.1;
const CARD_THICKNESS = 1.5;
const CARD_BOTTOM_Y = 2.0;
export const CARD_TOP_Y = CARD_BOTTOM_Y + CARD_THICKNESS;
const CARD_RADIUS = 0.3;
const CARD_SEGMENTS = 8;

export function createScene(
  canvas: HTMLCanvasElement,
  pageWidth: number,
  pageHeight: number,
  screenshot: HTMLCanvasElement,
): SceneContext {
  const sceneW = pageWidth * SCALE;
  const sceneH = pageHeight * SCALE;

  const scene = new THREE.Scene();
  const bgColor = new THREE.Color(0xf0ede8);
  bgColor.convertSRGBToLinear();
  scene.background = bgColor.clone();

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;

  const camera = new THREE.PerspectiveCamera(
    35,
    window.innerWidth / window.innerHeight,
    0.5,
    2000,
  );
  const diag = Math.sqrt(sceneW * sceneW + sceneH * sceneH);
  const viewDist = diag * 0.9;
  const viewAngle = Math.PI / 5.5;
  camera.position.set(
    sceneW * 0.5,
    CARD_TOP_Y + viewDist * Math.sin(viewAngle),
    sceneH * 0.5 + viewDist * Math.cos(viewAngle),
  );

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(sceneW * 0.5, CARD_TOP_Y * 0.5, sceneH * 0.5);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = Math.PI / 2.1;
  controls.minPolarAngle = 0;
  controls.minDistance = 5;
  controls.maxDistance = viewDist * 3;
  controls.update();

  const ambient = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(ambient);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xcccccc, 0.05);
  scene.add(hemiLight);

  const sunLight = createFixedLight(sceneW, sceneH);
  scene.add(sunLight);
  scene.add(sunLight.target);
  configureShadowFrustum(sceneW, sceneH);

  // Card mesh — the webpage as a floating rounded-corner slab
  const groundTexture = new THREE.CanvasTexture(screenshot);
  groundTexture.minFilter = THREE.LinearFilter;
  groundTexture.magFilter = THREE.LinearFilter;
  groundTexture.colorSpace = THREE.SRGBColorSpace;

  const cardGeo = createCardGeo(sceneW, sceneH, CARD_THICKNESS, CARD_RADIUS);
  assignMaterialGroups(cardGeo);
  remapTopUVs(cardGeo, sceneW, sceneH);

  const cardTopMat = new THREE.MeshBasicMaterial({ map: groundTexture });
  const cardSideMat = new THREE.MeshStandardMaterial({
    color: 0xf5f5f5,
    roughness: 0.5,
    metalness: 0.0,
  });
  const ground = new THREE.Mesh(cardGeo, [cardSideMat, cardTopMat, cardSideMat]);
  ground.position.set(sceneW * 0.5, CARD_BOTTOM_Y + CARD_THICKNESS * 0.5, sceneH * 0.5);
  ground.castShadow = true;
  ground.receiveShadow = true;
  scene.add(ground);

  // Floor plane at Y=0
  const floorPad = Math.max(sceneW, sceneH) * 0.5;
  const floorW = sceneW + floorPad * 2;
  const floorH = sceneH + floorPad * 2;
  const floorGeo = new THREE.PlaneGeometry(floorW, floorH);
  const floorMat = new THREE.MeshBasicMaterial({ color: bgColor.clone() });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(sceneW * 0.5, 0, sceneH * 0.5);
  scene.add(floor);

  // Shadow receiver on floor
  const shadowMat = new THREE.ShadowMaterial({ opacity: 0.25 });
  const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(floorW, floorH), shadowMat);
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.set(sceneW * 0.5, 0.01, sceneH * 0.5);
  shadowPlane.receiveShadow = true;
  scene.add(shadowPlane);

  const buildingGroup = new THREE.Group();
  scene.add(buildingGroup);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass());

  // On-demand rendering
  let renderPending = false;
  let animFrameId = 0;
  let running = true;

  function requestRender() {
    if (renderPending || !running) return;
    renderPending = true;
    animFrameId = requestAnimationFrame(() => {
      renderPending = false;
      if (!running) return;
      controls.update();
      composer.render();
    });
  }

  controls.addEventListener('change', requestRender);

  function onResize() {
    const rw = window.innerWidth;
    const rh = window.innerHeight;
    camera.aspect = rw / rh;
    camera.updateProjectionMatrix();
    renderer.setSize(rw, rh);
    composer.setSize(rw, rh);
    requestRender();
  }
  window.addEventListener('resize', onResize);

  function dispose() {
    running = false;
    cancelAnimationFrame(animFrameId);
    controls.removeEventListener('change', requestRender);
    window.removeEventListener('resize', onResize);
    controls.dispose();
    composer.dispose();
    renderer.dispose();
    groundTexture.dispose();
    disposeLight();
  }

  return {
    scene,
    camera,
    renderer,
    composer,
    controls,
    sunLight,
    ground,
    buildingGroup,
    requestRender,
    dispose,
  };
}

function createCardGeo(
  w: number,
  h: number,
  thickness: number,
  radius: number,
): THREE.BufferGeometry {
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.min(radius, hw, hh);

  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hh);
  shape.lineTo(hw - r, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
  shape.lineTo(hw, hh - r);
  shape.quadraticCurveTo(hw, hh, hw - r, hh);
  shape.lineTo(-hw + r, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
  shape.lineTo(-hw, -hh + r);
  shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: CARD_SEGMENTS,
  });

  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -thickness / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

function assignMaterialGroups(geo: THREE.BufferGeometry) {
  const pos = geo.getAttribute('position');
  const idx = geo.getIndex();
  if (!pos || !idx) return;

  const triCount = idx.count / 3;
  const sideTris: number[] = [];
  const topTris: number[] = [];
  const bottomTris: number[] = [];

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const fn = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const i0 = idx.getX(t * 3);
    const i1 = idx.getX(t * 3 + 1);
    const i2 = idx.getX(t * 3 + 2);
    vA.fromBufferAttribute(pos, i0);
    vB.fromBufferAttribute(pos, i1);
    vC.fromBufferAttribute(pos, i2);
    e1.subVectors(vB, vA);
    e2.subVectors(vC, vA);
    fn.crossVectors(e1, e2).normalize();

    if (fn.y > 0.5) topTris.push(t);
    else if (fn.y < -0.5) bottomTris.push(t);
    else sideTris.push(t);
  }

  const newIndex: number[] = [];
  geo.clearGroups();

  const addGroup = (tris: number[], matIdx: number) => {
    const start = newIndex.length;
    for (const t of tris) {
      newIndex.push(idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2));
    }
    if (tris.length > 0) geo.addGroup(start, tris.length * 3, matIdx);
  };

  addGroup(sideTris, 0);
  addGroup(topTris, 1);
  addGroup(bottomTris, 2);
  geo.setIndex(newIndex);
}

function remapTopUVs(geo: THREE.BufferGeometry, w: number, h: number) {
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const nrm = geo.getAttribute('normal');
  if (!pos || !uv || !nrm) return;

  const hw = w / 2;
  const hh = h / 2;

  for (let i = 0; i < pos.count; i++) {
    if (nrm.getY(i) > 0.5) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      uv.setXY(i, (x + hw) / w, 1 - (z + hh) / h);
    }
  }
  uv.needsUpdate = true;
}
