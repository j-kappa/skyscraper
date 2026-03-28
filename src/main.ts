import './styles.css';
import { fetchHTML } from './fetcher';
import { parseHTML } from './parser';
import { createScene, type SceneContext } from './scene';
import { buildCity } from './builder';
import { disposeLight } from './sun';
import * as THREE from 'three';

const landing = document.getElementById('landing')!;
const sceneContainer = document.getElementById('scene-container')!;
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const urlForm = document.getElementById('url-form') as HTMLFormElement;
const urlInput = document.getElementById('url-input') as HTMLInputElement;
const goBtn = document.getElementById('go-btn') as HTMLButtonElement;
const errorMsg = document.getElementById('error-msg')!;
const loadingOverlay = document.getElementById('loading-overlay')!;
const loadingText = document.getElementById('loading-text')!;
const backBtn = document.getElementById('back-btn')!;
const urlLabel = document.getElementById('url-label')!;
let ctx: SceneContext | null = null;
let statusInterval: ReturnType<typeof setInterval> | null = null;

const STATUS_PHASES: Record<string, string[]> = {
  fetch: [
    'Surveying the site\u2026',
    'Scouting the location\u2026',
    'Pulling permits\u2026',
    'Reading blueprints\u2026',
    'Reviewing the plans\u2026',
  ],
  render: [
    'Pouring the foundation\u2026',
    'Laying the groundwork\u2026',
    'Setting up scaffolding\u2026',
    'Mixing the concrete\u2026',
  ],
  styles: [
    'Choosing the paint colours\u2026',
    'Picking the cladding\u2026',
    'Sourcing materials\u2026',
    'Selecting finishes\u2026',
  ],
  images: [
    'Hanging the signage\u2026',
    'Installing the windows\u2026',
    'Mounting the billboards\u2026',
    'Framing the artwork\u2026',
  ],
  prepare: [
    'Inspecting the wiring\u2026',
    'Checking the plumbing\u2026',
    'Running final inspections\u2026',
    'Tightening the bolts\u2026',
  ],
  screenshot: [
    'Photographing the skyline\u2026',
    'Taking aerial shots\u2026',
    'Capturing the view\u2026',
    'Snapping the panorama\u2026',
  ],
  build: [
    'Raising the steel\u2026',
    'Stacking the floors\u2026',
    'Craning in the beams\u2026',
    'Erecting the towers\u2026',
    'Assembling the skyline\u2026',
  ],
};

function pickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

urlInput.addEventListener('focus', () => {
  if (urlInput.value.length > 0) urlInput.select();
});

urlInput.addEventListener('input', () => {
  const v = urlInput.value;
  if (/^https?:\/\//i.test(v)) {
    urlInput.value = v.replace(/^https?:\/\//i, '');
  }
});

urlForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  let url = urlInput.value.trim();
  if (!url) return;
  if (/^https?:\/\//i.test(url)) {
    url = url.replace(/^https?:\/\//i, '');
    urlInput.value = url;
  }
  url = 'https://' + url;

  errorMsg.hidden = true;
  goBtn.disabled = true;
  goBtn.textContent = '...';

  try {
    await loadSite(url);
  } catch (err: any) {
    resetToLanding();
    errorMsg.textContent = err.message || 'Something went wrong.';
    errorMsg.hidden = false;
  } finally {
    goBtn.disabled = false;
    goBtn.textContent = 'Go';
  }
});

backBtn.addEventListener('click', () => {
  resetToLanding();
});

async function loadSite(url: string) {
  showScene();
  setLoading(true, pickRandom(STATUS_PHASES.fetch), 'fetch');

  const html = await fetchHTML(url);

  const { blocks, screenshot, pageWidth, pageHeight, screenshotScale } = await parseHTML(
    html,
    url,
    (msg) => {
      const phase = msg.includes('Rendering') ? 'render'
        : msg.includes('styles') ? 'styles'
        : msg.includes('images') ? 'images'
        : msg.includes('Preparing') ? 'prepare'
        : msg.includes('screenshot') ? 'screenshot'
        : 'render';
      setLoading(true, pickRandom(STATUS_PHASES[phase]), phase);
    },
  );

  if (blocks.length === 0) {
    throw new Error('No visible elements found on that page.');
  }

  setLoading(true, pickRandom(STATUS_PHASES.build), 'build');
  await nextFrame();

  if (ctx) ctx.dispose();

  ctx = createScene(canvas, pageWidth, pageHeight, screenshot);
  buildCity(blocks, screenshot, ctx.buildingGroup, screenshotScale);

  urlLabel.textContent = url;
  animateCameraIn(ctx);

  await wait(800);
  setLoading(false);
}

function animateCameraIn(sc: SceneContext) {
  const target = sc.controls.target.clone();
  const finalPos = sc.camera.position.clone();

  const startPos = new THREE.Vector3(
    target.x,
    finalPos.y + 60,
    target.z,
  );
  sc.camera.position.copy(startPos);

  const duration = 1400;
  const start = performance.now();

  function step(now: number) {
    const t = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);

    sc.camera.position.lerpVectors(startPos, finalPos, ease);
    sc.controls.update();
    sc.composer.render();

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      sc.requestRender();
    }
  }

  requestAnimationFrame(step);
}

function showScene() {
  landing.hidden = true;
  sceneContainer.hidden = false;
}

function resetToLanding() {
  sceneContainer.hidden = true;
  landing.hidden = false;
  if (ctx) {
    ctx.dispose();
    ctx = null;
  }
  disposeLight();
}

function setLoading(show: boolean, text?: string, phase?: string) {
  loadingOverlay.hidden = !show;
  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
  }
  if (text) loadingText.textContent = text;
  if (show && phase && STATUS_PHASES[phase]) {
    const pool = STATUS_PHASES[phase];
    statusInterval = setInterval(() => {
      loadingText.textContent = pickRandom(pool);
    }, 3000);
  }
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
