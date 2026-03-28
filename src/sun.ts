import SunCalc from 'suncalc';
import * as THREE from 'three';

const DEFAULT_LAT = 40.7128;
const DEFAULT_LNG = -74.006;
const SUN_DISTANCE = 500;

interface SunState {
  light: THREE.DirectionalLight;
  lat: number;
  lng: number;
  intervalId: number | null;
}

let state: SunState | null = null;

export function createSunLight(): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(0xffffff, 0.6);
  light.castShadow = true;

  light.shadow.mapSize.width = 2048;
  light.shadow.mapSize.height = 2048;
  light.shadow.camera.near = 1;
  light.shadow.camera.far = 2000;
  light.shadow.bias = -0.0005;
  light.shadow.normalBias = 0.02;
  light.shadow.radius = 3;

  state = {
    light,
    lat: DEFAULT_LAT,
    lng: DEFAULT_LNG,
    intervalId: null,
  };

  requestGeolocation();
  updatePosition();

  state.intervalId = window.setInterval(updatePosition, 60_000);

  return light;
}

export function configureShadowFrustum(sceneWidth: number, sceneDepth: number) {
  if (!state) return;
  const half = Math.max(sceneWidth, sceneDepth) * 0.6;
  const cam = state.light.shadow.camera;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.updateProjectionMatrix();
}

export function getSunInfo(): string {
  if (!state) return '';
  const pos = SunCalc.getPosition(new Date(), state.lat, state.lng);
  const alt = ((pos.altitude * 180) / Math.PI).toFixed(1);
  const azDeg = ((pos.azimuth * 180) / Math.PI + 180).toFixed(1);

  if (pos.altitude < 0) return `Sun below horizon (${alt}\u00b0)`;
  return `Sun alt ${alt}\u00b0 \u00b7 az ${azDeg}\u00b0`;
}

export function disposeSun() {
  if (state?.intervalId) clearInterval(state.intervalId);
  state = null;
}

function updatePosition() {
  if (!state) return;
  const now = new Date();
  const pos = SunCalc.getPosition(now, state.lat, state.lng);

  const isNight = pos.altitude < 0;
  const altitude = Math.max(pos.altitude, 0.15);
  const azimuth = pos.azimuth;

  const x = SUN_DISTANCE * Math.cos(altitude) * Math.sin(azimuth);
  const y = SUN_DISTANCE * Math.sin(altitude);
  const z = SUN_DISTANCE * Math.cos(altitude) * Math.cos(azimuth);

  state.light.position.set(x, y, z);

  if (isNight) {
    state.light.color.set(0xdde4f0);
    state.light.intensity = 0.3;
  } else {
    const warmth = THREE.MathUtils.mapLinear(altitude, 0, Math.PI / 2, 0.06, 0);
    const intensity = THREE.MathUtils.mapLinear(altitude, 0.15, Math.PI / 3, 0.4, 0.7);
    const color = new THREE.Color(1.0, 1.0 - warmth * 0.15, 1.0 - warmth * 0.3);
    state.light.color.copy(color);
    state.light.intensity = THREE.MathUtils.clamp(intensity, 0.3, 0.7);
  }
}

function requestGeolocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (p) => {
      if (state) {
        state.lat = p.coords.latitude;
        state.lng = p.coords.longitude;
        updatePosition();
      }
    },
    () => {},
    { timeout: 5000 },
  );
}
