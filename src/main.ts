import './styles.css';
import { fetchHTML } from './fetcher';
import { parseHTML } from './parser';
import { createScene, type SceneContext } from './scene';
import { buildCity } from './builder';
import { getSunInfo, disposeSun } from './sun';
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
const sunInfo = document.getElementById('sun-info')!;

let ctx: SceneContext | null = null;
let sunInterval: number | null = null;

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
  setLoading(true, 'Fetching site\u2026');

  const html = await fetchHTML(url);

  const { blocks, screenshot, pageWidth, pageHeight, screenshotScale } = await parseHTML(
    html,
    url,
    (msg) => setLoading(true, msg),
  );

  if (blocks.length === 0) {
    throw new Error('No visible elements found on that page.');
  }

  setLoading(true, `Building ${blocks.length} structures\u2026`);
  await nextFrame();

  if (ctx) ctx.dispose();

  ctx = createScene(canvas, pageWidth, pageHeight, screenshot);
  buildCity(blocks, screenshot, ctx.buildingGroup, screenshotScale);

  urlLabel.textContent = url;
  sunInfo.textContent = getSunInfo();

  if (sunInterval) clearInterval(sunInterval);
  sunInterval = window.setInterval(() => {
    sunInfo.textContent = getSunInfo();
  }, 30_000);

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
  if (sunInterval) {
    clearInterval(sunInterval);
    sunInterval = null;
  }
  disposeSun();
}

function setLoading(show: boolean, text?: string) {
  loadingOverlay.hidden = !show;
  if (text) loadingText.textContent = text;
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
