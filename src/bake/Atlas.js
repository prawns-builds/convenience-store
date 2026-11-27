import * as THREE from 'three';

// Shelf-packs all lightmap charts of the given parts into a W x H atlas and writes `uv1`.
// Texel density is scaled down globally until everything fits.
export function packAtlas(parts, W, H, { pad = 2, minTexels = 3, densityScale = 1 } = {}) {
  const items = [];
  for (const part of parts) {
    if (part.mode !== 'lm') continue;
    for (const ch of part.charts) items.push({ part, ch });
  }
  let s = densityScale;
  let rects = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    rects = items.map((it) => ({
      it,
      tw: Math.max(minTexels, Math.ceil(it.ch.w * it.ch.density * s)),
      th: Math.max(minTexels, Math.ceil(it.ch.h * it.ch.density * s)),
    }));
    for (const r of rects) { r.w = r.tw + 2 * pad; r.h = r.th + 2 * pad; }
    if (shelfPack(rects, W, H)) break;
    rects = null;
    s *= 0.92;
  }
  if (!rects) throw new Error('Lightmap atlas packing failed');

  // write uv1 per part
  const uv1ByPart = new Map();
  for (const part of parts) {
    if (part.mode !== 'lm') continue;
    const n = part.geometry.attributes.position.count;
    uv1ByPart.set(part, new Float32Array(n * 2));
  }
  let used = 0;
  for (const r of rects) {
    const { part, ch } = r.it;
    const arr = uv1ByPart.get(part);
    const lm = part.lmLocal;
    for (let k = ch.start; k < ch.start + ch.count; k++) {
      const lu = lm[k * 2], lv = lm[k * 2 + 1];
      arr[k * 2] = (r.x + pad + lu * r.tw) / W;
      arr[k * 2 + 1] = (r.y + pad + lv * r.th) / H;
    }
    used += r.w * r.h;
  }
  for (const [part, arr] of uv1ByPart) part.geometry.setAttribute('uv1', new THREE.BufferAttribute(arr, 2));
  return { scale: s, fill: used / (W * H), charts: rects.length };
}

function shelfPack(rects, W, H) {
  const order = rects.slice().sort((a, b) => b.h - a.h || b.w - a.w);
  let x = 0, y = 0, rowH = 0;
  for (const r of order) {
    if (r.w > W) return false;
    if (x + r.w > W) { x = 0; y += rowH; rowH = 0; }
    if (y + r.h > H) return false;
    r.x = x; r.y = y;
    x += r.w;
    rowH = Math.max(rowH, r.h);
  }
  return true;
}
