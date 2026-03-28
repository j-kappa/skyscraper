import html2canvas from 'html2canvas';
import type { ElementBlock, ParseResult } from './types';

const VIEWPORT_W = 1280;
const VIEWPORT_H = 800;
const MAX_ELEMENTS = 500;
const MAX_DEPTH = 12;
const MIN_SIZE = 8;
const OVERLAP_THRESHOLD = 0.92;

const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'HEAD', 'TITLE', 'BR', 'HR',
  'SVG', 'PATH', 'CIRCLE', 'RECT', 'LINE', 'POLYGON', 'POLYLINE', 'ELLIPSE',
  'DEFS', 'CLIPPATH', 'MASK', 'USE', 'SYMBOL', 'G', 'TEXT', 'TSPAN',
  'COLGROUP', 'COL', 'CAPTION', 'THEAD', 'TBODY', 'TFOOT',
]);

const INLINE_TEXT_TAGS = new Set([
  'SPAN', 'EM', 'STRONG', 'B', 'I', 'U', 'S', 'SMALL', 'SUB', 'SUP',
  'ABBR', 'CITE', 'CODE', 'KBD', 'MARK', 'Q', 'SAMP', 'VAR', 'TIME',
  'DATA', 'BDO', 'BDI', 'WBR', 'FONT',
]);

const ELEVATED_TAGS: Record<string, number> = {
  BUTTON: 4, INPUT: 3, SELECT: 3, TEXTAREA: 2.5,
  A: 1.5, IMG: 2, VIDEO: 2, IFRAME: 2,
  NAV: 2.5, HEADER: 1.5, FOOTER: 1,
  H1: 3, H2: 2.5, H3: 2, H4: 1.5,
  FORM: 1, SECTION: 0.5, ARTICLE: 0.5, ASIDE: 1,
  DIALOG: 5, LI: 0.3, TABLE: 0.5, LABEL: 0.5,
};

export async function parseHTML(
  html: string,
  sourceUrl: string,
  onStatus?: (msg: string) => void,
): Promise<ParseResult> {
  onStatus?.('Rendering page\u2026');

  const iframe = document.createElement('iframe');
  iframe.style.cssText = `
    position: fixed; top: -10000px; left: -10000px;
    width: ${VIEWPORT_W}px; height: ${VIEWPORT_H}px;
    border: none; z-index: -1;
  `;
  document.body.appendChild(iframe);

  const baseUrl = new URL(sourceUrl).origin + '/';
  const prepared = injectBase(html, baseUrl);

  const doc = await new Promise<Document>((resolve, reject) => {
    const timeout = setTimeout(() => {
      iframe.remove();
      reject(new Error('Timed out rendering the page.'));
    }, 30000);

    iframe.srcdoc = prepared;

    iframe.onload = () => {
      clearTimeout(timeout);
      const d = iframe.contentDocument;
      if (!d?.body) {
        iframe.remove();
        return reject(new Error('Could not access page content.'));
      }
      resolve(d);
    };

    iframe.onerror = () => {
      clearTimeout(timeout);
      iframe.remove();
      reject(new Error('Failed to render the page.'));
    };
  });

  onStatus?.('Downloading styles\u2026');
  await inlineAllStylesheets(doc, baseUrl);

  onStatus?.('Downloading images\u2026');
  await inlineAllImages(doc, baseUrl);

  onStatus?.('Preparing elements\u2026');
  replaceFormControls(doc);

  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  onStatus?.('Capturing screenshot\u2026');

  const scrollH = doc.documentElement.scrollHeight;
  const pageWidth = VIEWPORT_W;
  const pageHeight = Math.min(scrollH, VIEWPORT_H * 3);

  const origError = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('unsupported color function')) return;
    origError.apply(console, args);
  };

  let screenshot: HTMLCanvasElement;
  try {
    screenshot = await html2canvas(doc.documentElement, {
      width: pageWidth,
      height: pageHeight,
      windowWidth: VIEWPORT_W,
      windowHeight: pageHeight,
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#ffffff',
      foreignObjectRendering: false,
      imageTimeout: 15000,
      removeContainer: true,
    });
  } finally {
    console.error = origError;
  }

  onStatus?.('Extracting elements\u2026');

  const raw: ElementBlock[] = [];
  walkDOM(doc.body, 0, raw, pageWidth, pageHeight);

  const reduced = deduplicateOverlaps(raw);
  reduced.sort((a, b) => a.depth - b.depth);
  if (reduced.length > MAX_ELEMENTS) reduced.length = MAX_ELEMENTS;

  iframe.remove();

  return { blocks: reduced, screenshot, pageWidth, pageHeight, screenshotScale: 2 };
}

function injectBase(html: string, baseUrl: string): string {
  const baseTag = `<base href="${baseUrl}" />`;
  if (html.includes('<head')) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }
  return `<head>${baseTag}</head>${html}`;
}

async function inlineAllStylesheets(doc: Document, baseUrl: string) {
  const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
  const promises = links.map(async (link) => {
    let href = link.getAttribute('href');
    if (!href) return;
    href = resolveUrl(href, baseUrl);

    try {
      let cssText = await fetchText(href);
      if (!cssText) return;

      cssText = cssText.replace(/url\(\s*['"]?([^'"()]+)['"]?\s*\)/gi, (match, url) => {
        if (url.startsWith('data:')) return match;
        const resolved = resolveUrl(url, href!);
        return `url("${resolved}")`;
      });

      const style = doc.createElement('style');
      style.textContent = cssText;
      link.parentNode?.replaceChild(style, link);
    } catch (e) {
      // ignore
    }
  });

  await Promise.allSettled(promises);

  const styles = Array.from(doc.querySelectorAll('style'));
  for (const style of styles) {
    if (!style.textContent) continue;
    style.textContent = style.textContent.replace(/url\(\s*['"]?([^'"()]+)['"]?\s*\)/gi, (match, url) => {
      if (url.startsWith('data:')) return match;
      const resolved = resolveUrl(url, baseUrl);
      return `url("${resolved}")`;
    });
  }
}

// ─── Proxy helpers ───

async function fetchViaProxy(url: string): Promise<Response | null> {
  for (const makeUrl of CORS_PROXIES) {
    try {
      const res = await fetch(makeUrl(url));
      if (res.ok) return res;
    } catch { /* try next */ }
  }
  return null;
}

async function fetchText(url: string): Promise<string | null> {
  const res = await fetchViaProxy(url);
  return res ? res.text() : null;
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  const res = await fetchViaProxy(url);
  if (!res) return null;
  try {
    const blob = await res.blob();
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function resolveUrl(raw: string, base: string): string {
  try {
    return new URL(raw, base).href;
  } catch {
    return raw;
  }
}

function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && !url.startsWith('data:') && !url.startsWith('blob:');
}

async function inlineAllImages(doc: Document, baseUrl: string) {
  const dataUrlCache = new Map<string, string | null>();

  async function getDataUrl(originalUrl: string): Promise<string | null> {
    if (dataUrlCache.has(originalUrl)) return dataUrlCache.get(originalUrl)!;
    const result = await fetchAsDataUrl(originalUrl);
    dataUrlCache.set(originalUrl, result);
    return result;
  }

  // 1. Inline <img> src
  const imgs = Array.from(doc.querySelectorAll('img'));
  const imgPromises = imgs.map(async (img) => {
    img.removeAttribute('loading');
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');

    const dataSrc = img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
    if (dataSrc) {
      img.setAttribute('src', dataSrc);
    }

    let src = img.getAttribute('src');
    if (!src) return;

    src = resolveUrl(src, baseUrl);
    if (!isExternalUrl(src)) return;

    const dataUrl = await getDataUrl(src);
    if (dataUrl) {
      img.setAttribute('src', dataUrl);
    }
  });

  // 2. Inline CSS background-image URLs on all elements
  const bgPromises: Promise<void>[] = [];
  const allEls = doc.querySelectorAll('*');
  for (const el of allEls) {
    const computed = getComputedStyle(el);
    const bgImg = computed.backgroundImage;
    if (!bgImg || bgImg === 'none') continue;

    const urlMatches = [...bgImg.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)];
    if (urlMatches.length === 0) continue;

    bgPromises.push((async () => {
      let newBg = bgImg;
      for (const match of urlMatches) {
        const rawUrl = match[1].trim();
        if (!isExternalUrl(rawUrl)) continue;
        const resolved = resolveUrl(rawUrl, baseUrl);
        const dataUrl = await getDataUrl(resolved);
        if (dataUrl) {
          newBg = newBg.replace(match[0], `url("${dataUrl}")`);
        }
      }
      if (newBg !== bgImg) {
        (el as HTMLElement).style.backgroundImage = newBg;
      }
    })());
  }

  // Run all fetches in parallel with a global timeout
  const allPromises = [...imgPromises, ...bgPromises];
  if (allPromises.length > 0) {
    await Promise.race([
      Promise.allSettled(allPromises),
      new Promise<void>(r => setTimeout(r, 20000)),
    ]);
  }
}

// ─── Form control replacement ───

function replaceFormControls(doc: Document) {
  const controls = doc.querySelectorAll('input, button, textarea, select');
  for (const el of controls) {
    const tag = el.tagName;
    const computed = getComputedStyle(el);

    if (computed.display === 'none' || computed.visibility === 'hidden') continue;

    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;

    const div = doc.createElement('div');

    if (tag === 'INPUT') {
      const input = el as HTMLInputElement;
      const type = input.type;
      if (type === 'hidden') continue;
      if (type === 'checkbox' || type === 'radio') continue;
    }

    const props = [
      'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
      'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
      'border', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
      'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius',
      'borderBottomLeftRadius', 'borderBottomRightRadius',
      'backgroundColor', 'color', 'fontSize', 'fontFamily', 'fontWeight',
      'lineHeight', 'letterSpacing', 'textAlign', 'textTransform',
      'boxShadow', 'backgroundImage', 'backgroundSize', 'backgroundPosition',
      'display', 'flexDirection', 'alignItems', 'justifyContent', 'gap',
      'position', 'top', 'right', 'bottom', 'left',
      'boxSizing', 'overflow', 'cursor',
    ];

    for (const prop of props) {
      const val = computed.getPropertyValue(camelToKebab(prop));
      if (val) {
        div.style.setProperty(camelToKebab(prop), val);
      }
    }

    div.style.boxSizing = 'border-box';
    div.style.overflow = 'hidden';
    div.style.whiteSpace = 'nowrap';
    div.style.textOverflow = 'ellipsis';

    if (tag === 'INPUT') {
      const input = el as HTMLInputElement;
      const text = input.value || input.placeholder || '';
      div.textContent = text;

      if (!input.value && input.placeholder) {
        div.style.opacity = '0.5';
      }

      div.style.display = 'flex';
      div.style.alignItems = 'center';

    } else if (tag === 'BUTTON') {
      div.innerHTML = (el as HTMLButtonElement).innerHTML;
      div.style.display = 'flex';
      div.style.alignItems = 'center';
      div.style.justifyContent = 'center';

    } else if (tag === 'TEXTAREA') {
      div.textContent = (el as HTMLTextAreaElement).value || (el as HTMLTextAreaElement).placeholder || '';

    } else if (tag === 'SELECT') {
      const select = el as HTMLSelectElement;
      const selectedOption = select.options[select.selectedIndex];
      div.textContent = selectedOption ? selectedOption.textContent : '';
      div.style.display = 'flex';
      div.style.alignItems = 'center';
    }

    el.parentNode?.replaceChild(div, el);
  }
}

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
}

// ─── DOM walking ───

function walkDOM(
  el: Element,
  depth: number,
  blocks: ElementBlock[],
  maxW: number,
  maxH: number,
) {
  if (blocks.length >= MAX_ELEMENTS * 2) return;
  if (depth > MAX_DEPTH) return;

  const tag = el.tagName;
  if (SKIP_TAGS.has(tag)) return;

  const rect = el.getBoundingClientRect();
  if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) return;
  if (rect.right < 0 || rect.bottom < 0 || rect.left > maxW || rect.top > maxH) return;

  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return;

  const opacity = parseFloat(style.opacity);
  if (opacity < 0.05) return;

  const isMediaTag = tag === 'IMG' || tag === 'VIDEO' || tag === 'CANVAS' || tag === 'PICTURE';
  const boundary = isMediaTag || checkVisualBoundary(style);
  const isInlineText = INLINE_TEXT_TAGS.has(tag);

  if (isInlineText && !boundary) {
    for (const child of el.children) {
      walkDOM(child, depth, blocks, maxW, maxH);
    }
    return;
  }

  const tagBonus = ELEVATED_TAGS[tag] ?? 0;
  const zIndex = Math.max(0, parseInt(style.zIndex) || 0);
  const blockDepth = depth * 0.5 + tagBonus + zIndex * 0.4;

  const x = Math.max(0, rect.left);
  const y = Math.max(0, rect.top);
  const w = Math.min(rect.width, maxW - x);
  const h = Math.min(rect.height, maxH - y);

  if (w < MIN_SIZE || h < MIN_SIZE) return;

  const rawBg = style.backgroundColor;
  const bgColor = (rawBg && rawBg !== 'transparent' && rawBg !== 'rgba(0, 0, 0, 0)')
    ? rawBg : null;

  const borderRadius = Math.min(
    parseFloat(style.borderTopLeftRadius) || 0,
    w * 0.5,
    h * 0.5,
  );

  blocks.push({
    x, y, width: w, height: h,
    depth: blockDepth,
    opacity,
    tagName: tag,
    hasBoundary: boundary,
    bgColor,
    borderRadius,
  });

  for (const child of el.children) {
    walkDOM(child, depth + 1, blocks, maxW, maxH);
  }
}

function checkVisualBoundary(style: CSSStyleDeclaration): boolean {
  const bg = style.backgroundColor;
  if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return true;
  if (style.borderWidth && parseFloat(style.borderWidth) > 0) return true;
  if (style.boxShadow && style.boxShadow !== 'none') return true;
  if (style.backgroundImage && style.backgroundImage !== 'none') return true;
  return false;
}

function deduplicateOverlaps(blocks: ElementBlock[]): ElementBlock[] {
  if (blocks.length === 0) return blocks;

  const sorted = [...blocks].sort((a, b) => a.depth - b.depth);
  const kept: ElementBlock[] = [];

  for (const block of sorted) {
    let dominated = false;
    for (const existing of kept) {
      if (Math.abs(block.depth - existing.depth) < 0.2) {
        const overlap = overlapRatio(block, existing);
        if (overlap > OVERLAP_THRESHOLD) {
          dominated = true;
          break;
        }
      }
    }
    if (!dominated) {
      kept.push(block);
    }
  }

  return kept;
}

function overlapRatio(a: ElementBlock, b: ElementBlock): number {
  const ix = Math.max(a.x, b.x);
  const iy = Math.max(a.y, b.y);
  const iw = Math.min(a.x + a.width, b.x + b.width) - ix;
  const ih = Math.min(a.y + a.height, b.y + b.height) - iy;

  if (iw <= 0 || ih <= 0) return 0;

  const intersection = iw * ih;
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  return intersection / smallerArea;
}
