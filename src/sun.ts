import * as THREE from 'three';

const SUN_DISTANCE = 500;
const ALTITUDE = 0.5; // ~29° above horizon — soft product-photo shadows
const AZIMUTH = -0.7; // front-left

let light: THREE.DirectionalLight | null = null;

export function createFixedLight(
  sceneW: number,
  sceneH: number,
): THREE.DirectionalLight {
  const dir = new THREE.DirectionalLight(0xffffff, 0.35);
  dir.castShadow = true;

  dir.shadow.mapSize.width = 4096;
  dir.shadow.mapSize.height = 4096;
  dir.shadow.camera.near = 1;
  dir.shadow.camera.far = 2000;
  dir.shadow.bias = -0.0005;
  dir.shadow.normalBias = 0.02;

  const x = SUN_DISTANCE * Math.cos(ALTITUDE) * Math.sin(AZIMUTH);
  const y = SUN_DISTANCE * Math.sin(ALTITUDE);
  const z = SUN_DISTANCE * Math.cos(ALTITUDE) * Math.cos(AZIMUTH);

  dir.position.set(
    sceneW * 0.5 + x,
    y,
    sceneH * 0.5 + z,
  );
  dir.target.position.set(sceneW * 0.5, 0, sceneH * 0.5);

  light = dir;
  return dir;
}

export function configureShadowFrustum(sceneWidth: number, sceneDepth: number) {
  if (!light) return;
  const half = Math.max(sceneWidth, sceneDepth) * 1.2;
  const cam = light.shadow.camera;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.updateProjectionMatrix();
}

export function disposeLight() {
  light = null;
}
