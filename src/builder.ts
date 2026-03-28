import * as THREE from 'three';
import type { ElementBlock } from './types';

const SCALE = 0.1;
const MAX_ELEVATION = 1.5;
const MIN_HEIGHT = 0.05;
const MEDIA_LIFT = 0.3;
const MEDIA_TAGS = new Set(['IMG', 'VIDEO', 'CANVAS', 'PICTURE', 'SVG']);
const SIDE_DARKEN = 0.65;
const RADIUS_SCALE = SCALE;
const MIN_RADIUS_PX = 4;
const CORNER_SEGMENTS = 5;

export function buildCity(
  blocks: ElementBlock[],
  screenshot: HTMLCanvasElement,
  group: THREE.Group,
  screenshotScale = 1,
  cardTopY = 0,
) {
  clearGroup(group);

  const pw = screenshot.width;
  const ph = screenshot.height;
  const ss = screenshotScale;

  const scratchCanvas = document.createElement('canvas');
  const scratchCtx = scratchCanvas.getContext('2d', { willReadFrequently: true })!;

  const maxDepth = blocks.reduce((m, b) => Math.max(m, b.depth), 1);
  const depthScale = MAX_ELEVATION / maxDepth;
  const boundaryLift = 0.15;
  const pageWidthPx = pw / ss;

  for (const block of blocks) {
    const w3d = block.width * SCALE;
    const h3d = block.height * SCALE;
    if (w3d < 0.04 || h3d < 0.04) continue;

    const widthRatio = block.width / pageWidthPx;
    const dampen = 1 - Math.pow(widthRatio, 1.5) * 0.85;
    const isMedia = MEDIA_TAGS.has(block.tagName);
    const elevation = Math.max(
      (block.depth * depthScale + (block.hasBoundary ? boundaryLift : 0)) * dampen
        + (isMedia ? MEDIA_LIFT : 0),
      block.hasBoundary ? 0.1 : MIN_HEIGHT,
    );

    const cropX = Math.round(block.x * ss);
    const cropY = Math.round(block.y * ss);
    const cropW = Math.round(Math.min(block.width * ss, pw - cropX));
    const cropH = Math.round(Math.min(block.height * ss, ph - cropY));
    if (cropW < 1 || cropH < 1) continue;

    scratchCanvas.width = cropW;
    scratchCanvas.height = cropH;
    scratchCtx.drawImage(screenshot, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    const topTexture = new THREE.CanvasTexture(copyCanvas(scratchCanvas, cropW, cropH));
    topTexture.minFilter = THREE.LinearFilter;
    topTexture.magFilter = THREE.LinearFilter;
    topTexture.colorSpace = THREE.SRGBColorSpace;

    let sideColor: THREE.Color;
    try {
      sideColor = deriveSideColor(block, scratchCtx, cropW, cropH);
    } catch {
      const fallback = block.bgColor ? parseCSSColor(block.bgColor) : null;
      sideColor = (fallback ?? new THREE.Color(0.85, 0.85, 0.85)).multiplyScalar(SIDE_DARKEN);
    }

    const depthBias = -(block.depth + (isMedia ? 10 : 0)) * 0.5;
    const topMat = new THREE.MeshBasicMaterial({
      map: topTexture,
      polygonOffset: true,
      polygonOffsetFactor: depthBias,
      polygonOffsetUnits: depthBias * 4,
    });
    const sideMat = new THREE.MeshStandardMaterial({
      color: sideColor,
      roughness: 0.8,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: depthBias,
      polygonOffsetUnits: depthBias * 4,
    });

    const hasRadius = block.borderRadius > MIN_RADIUS_PX;
    const radius3d = hasRadius
      ? Math.min(block.borderRadius * RADIUS_SCALE, w3d * 0.5, h3d * 0.5)
      : 0;

    let mesh: THREE.Mesh;

    if (hasRadius && radius3d > 0.01) {
      const geo = createRoundedExtrudeGeo(w3d, h3d, elevation, radius3d);
      assignMaterialGroupsByNormal(geo);
      remapTopFaceUVs(geo, w3d, h3d);
      mesh = new THREE.Mesh(geo, [sideMat, topMat, sideMat]);
    } else {
      const geo = new THREE.BoxGeometry(w3d, elevation, h3d);
      remapBoxTopUVs(geo);
      mesh = new THREE.Mesh(geo, [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
    }

    mesh.position.set(
      block.x * SCALE + w3d * 0.5,
      cardTopY + elevation * 0.5,
      block.y * SCALE + h3d * 0.5,
    );
    mesh.castShadow = elevation > 0.1;
    mesh.receiveShadow = true;
    mesh.renderOrder = block.depth + (isMedia ? 100 : 0);
    group.add(mesh);
  }
}

function createRoundedExtrudeGeo(
  w: number,
  h: number,
  height: number,
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
    depth: height,
    bevelEnabled: false,
    curveSegments: CORNER_SEGMENTS,
  });

  // Extrudes along +Z; rotate so it goes along +Y
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -height / 2, 0);
  geo.computeVertexNormals();

  return geo;
}

/**
 * Remap UVs on top-facing triangles of an ExtrudeGeometry so the
 * screenshot texture maps 0→1 across the face, with correct orientation.
 * After rotation, top face vertices have X in [-w/2, w/2] and Z in [-h/2, h/2].
 */
function remapTopFaceUVs(geo: THREE.BufferGeometry, w: number, h: number) {
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const nrm = geo.getAttribute('normal');
  if (!pos || !uv || !nrm) return;

  const hw = w / 2;
  const hh = h / 2;

  for (let i = 0; i < pos.count; i++) {
    const ny = nrm.getY(i);
    if (ny > 0.5) {
      // Top face: map X → U (0 to 1, left to right), Z → V (0 to 1, top to bottom inverted)
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const u = (x + hw) / w;
      const v = 1 - (z + hh) / h;
      uv.setXY(i, u, v);
    }
  }
  uv.needsUpdate = true;
}

/**
 * Remap UVs on the top face (group index 2, +Y face) of a BoxGeometry
 * to ensure the screenshot texture is correctly oriented.
 * BoxGeometry top face: vertices have X in [-w/2, w/2] and Z in [-h/2, h/2].
 * Default UVs map X→U and Z→V but Z needs to be flipped for correct image orientation.
 */
function remapBoxTopUVs(geo: THREE.BoxGeometry) {
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const nrm = geo.getAttribute('normal');
  if (!pos || !uv || !nrm) return;

  // Find the bounding box of top-face vertices
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  const topVerts: number[] = [];

  for (let i = 0; i < pos.count; i++) {
    if (nrm.getY(i) > 0.9) {
      topVerts.push(i);
      const x = pos.getX(i);
      const z = pos.getZ(i);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }

  const rangeX = maxX - minX || 1;
  const rangeZ = maxZ - minZ || 1;

  for (const i of topVerts) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const u = (x - minX) / rangeX;
    const v = 1 - (z - minZ) / rangeZ;
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}

function assignMaterialGroupsByNormal(geo: THREE.BufferGeometry) {
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
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const i0 = idx.getX(t * 3);
    const i1 = idx.getX(t * 3 + 1);
    const i2 = idx.getX(t * 3 + 2);

    vA.fromBufferAttribute(pos, i0);
    vB.fromBufferAttribute(pos, i1);
    vC.fromBufferAttribute(pos, i2);

    edge1.subVectors(vB, vA);
    edge2.subVectors(vC, vA);
    faceNormal.crossVectors(edge1, edge2).normalize();

    if (faceNormal.y > 0.5) {
      topTris.push(t);
    } else if (faceNormal.y < -0.5) {
      bottomTris.push(t);
    } else {
      sideTris.push(t);
    }
  }

  const newIndex: number[] = [];
  geo.clearGroups();

  const addGroup = (tris: number[], matIdx: number) => {
    const start = newIndex.length;
    for (const t of tris) {
      newIndex.push(idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2));
    }
    if (tris.length > 0) {
      geo.addGroup(start, tris.length * 3, matIdx);
    }
  };

  addGroup(sideTris, 0);
  addGroup(topTris, 1);
  addGroup(bottomTris, 2);

  geo.setIndex(newIndex);
}

function deriveSideColor(
  block: ElementBlock,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): THREE.Color {
  if (block.bgColor) {
    const parsed = parseCSSColor(block.bgColor);
    if (parsed) return parsed.multiplyScalar(SIDE_DARKEN);
  }
  return sampleEdgeColor(ctx, w, h).multiplyScalar(SIDE_DARKEN);
}

function parseCSSColor(css: string): THREE.Color | null {
  const rgbMatch = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return new THREE.Color(
      parseInt(rgbMatch[1]) / 255,
      parseInt(rgbMatch[2]) / 255,
      parseInt(rgbMatch[3]) / 255,
    );
  }
  try {
    return new THREE.Color(css);
  } catch {
    return null;
  }
}

function sampleEdgeColor(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): THREE.Color {
  let r = 0, g = 0, b = 0, count = 0;

  const step = Math.max(1, Math.floor(Math.min(w, h) / 8));
  for (let px = 0; px < w; px += step) {
    addSample(px, 0);
    addSample(px, h - 1);
  }
  for (let py = 0; py < h; py += step) {
    addSample(0, py);
    addSample(w - 1, py);
  }

  function addSample(px: number, py: number) {
    if (px < 0 || py < 0 || px >= w || py >= h) return;
    const data = ctx.getImageData(px, py, 1, 1).data;
    if (data[3] < 20) return;
    r += data[0]; g += data[1]; b += data[2];
    count++;
  }

  if (count === 0) return new THREE.Color(0.3, 0.3, 0.35);
  return new THREE.Color(r / count / 255, g / count / 255, b / count / 255);
}

function copyCanvas(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

function clearGroup(group: THREE.Group) {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        if ('map' in m && (m as any).map) (m as any).map.dispose();
        m.dispose();
      }
    } else if (child instanceof THREE.LineSegments) {
      child.geometry.dispose();
    }
  }
}
