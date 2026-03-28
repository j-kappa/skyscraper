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

export function createScene(
  canvas: HTMLCanvasElement,
  pageWidth: number,
  pageHeight: number,
  screenshot: HTMLCanvasElement,
): SceneContext {
  const sceneW = pageWidth * SCALE;
  const sceneH = pageHeight * SCALE;

  const scene = new THREE.Scene();
  scene.background = samplePageBackground(screenshot);

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
    40,
    window.innerWidth / window.innerHeight,
    0.5,
    2000,
  );
  const diag = Math.sqrt(sceneW * sceneW + sceneH * sceneH);
  const viewHeight = diag * 0.85;
  camera.position.set(sceneW * 0.5, viewHeight, sceneH * 0.5 + viewHeight * 0.3);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(sceneW * 0.5, 0, sceneH * 0.5);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = Math.PI / 2.1;
  controls.minPolarAngle = 0;
  controls.minDistance = 5;
  controls.maxDistance = viewHeight * 3;
  controls.update();

  // Lighting — neutral white to preserve screenshot colors
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xcccccc, 0.15);
  scene.add(hemiLight);

  const sunLight = createFixedLight(sceneW, sceneH);
  scene.add(sunLight);
  scene.add(sunLight.target);
  configureShadowFrustum(sceneW, sceneH);

  // Ground plane = the full page screenshot
  const groundTexture = new THREE.CanvasTexture(screenshot);
  groundTexture.minFilter = THREE.LinearFilter;
  groundTexture.magFilter = THREE.LinearFilter;
  groundTexture.colorSpace = THREE.SRGBColorSpace;

  const groundGeo = new THREE.PlaneGeometry(sceneW, sceneH);
  const groundMat = new THREE.MeshBasicMaterial({
    map: groundTexture,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(sceneW * 0.5, -0.01, sceneH * 0.5);
  ground.receiveShadow = true;
  scene.add(ground);

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

function samplePageBackground(screenshot: HTMLCanvasElement): THREE.Color {
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.canvas.width = screenshot.width;
  ctx.canvas.height = screenshot.height;
  ctx.drawImage(screenshot, 0, 0);

  let r = 0, g = 0, b = 0, n = 0;
  const w = screenshot.width;
  const h = screenshot.height;

  const points = [
    [2, 2], [w - 3, 2],
    [2, h - 3], [w - 3, h - 3],
    [Math.floor(w / 2), 2],
    [2, Math.floor(h / 2)],
    [w - 3, Math.floor(h / 2)],
  ];

  for (const [px, py] of points) {
    const d = ctx.getImageData(px, py, 1, 1).data;
    r += d[0]; g += d[1]; b += d[2];
    n++;
  }

  return new THREE.Color(r / n / 255, g / n / 255, b / n / 255);
}
