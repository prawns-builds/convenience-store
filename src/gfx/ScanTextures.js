import * as THREE from 'three';
import { FSPass, fsMaterial, makeRT } from '../render/FSPass.js';
import { COMMON_GLSL } from './glsl/noise.js';

// ------------------------------------------------------------------------------------------
// Scanned CC0 PBR surfaces (ambientCG / Poly Haven, see public/assets/**/manifest.json).
//
// Each scan is repacked on the GPU into the engine's packed layout so every existing shader
// feature (paint tint, grime, wetness, puddles) keeps working:
//   albedo  = sRGB RGB + linear roughness in A
//   normal  = tangent-space normal RGB + "extra" in A (paint mask or height)
//
// Brightness is calibrated against the procedural surface the scan replaces: the scene's
// baked lighting and grade were tuned to those albedos, so `match` rescales the scan to the
// same mean linear luminance. `detail` normalises the scan to a fixed mean so the material's
// own colour stays in charge (used for surfaces that were flat-coloured before).
//
// If an image fails to load, that surface silently keeps its procedural texture.
// ------------------------------------------------------------------------------------------
const ROOT = (import.meta.env?.BASE_URL ?? '/') + 'assets/textures/';

// tile: metres per texture repeat (number or [u, v]).
// extra: 'height' | 'paint' | 'one'.  desat: 0..1 before tinting.  ao: how much AO darkens albedo.
export const SCANS = {
  // ---- exterior
  asphalt: { dir: 'exterior/road-asphalt', tile: 3.0, match: 'asphalt', extra: 'height', desat: 0.35 },
  concrete: { dir: 'exterior/concrete-slab', tile: 2.5, match: 'concrete', extra: 'height', desat: 0.3 },
  groundcover: { dir: 'exterior/dry-grass', tile: 3.0, match: 'groundcover', extra: 'height' },
  gravel: { dir: 'exterior/gravel-shoulder', tile: 2.1, match: 'asphalt', gain: 1.4, extra: 'height', desat: 0.2 },
  stucco: { dir: 'exterior/painted-block-wall', tile: 0.9, match: 'stucco', extra: 'one', desat: 1.0, normal: 1.2 },
  metal: { dir: 'exterior/painted-metal', tile: 1.0, match: 'metal', extra: 'paint', desat: 0.85 },
  roof: { dir: 'exterior/roof-tar-gravel', tile: 2.2, match: 'asphalt', extra: 'height', desat: 0.5 },
  brick: { dir: 'exterior/brick', tile: 1.4, match: 'stucco', extra: 'one', desat: 0.1 },
  bark: { dir: 'exterior/bark', tile: 2.15, match: 'wood', extra: 'one', desat: 0.6 },
  // ---- interior
  vct: { dir: 'interior/vct-checker', tile: 1.2192, match: 'vct', extra: 'one', desat: 0.6 },
  ceiling: { dir: 'interior/ceiling-tile', tile: 3.66, match: 'ceiling', extra: 'one', desat: 0.8, ao: 0.8 },
  plaster: { dir: 'interior/plaster-painted', tile: [2.0, 1.0], match: 'plaster', extra: 'one', desat: 1.0 },
  walltile: { dir: 'interior/wall-tile-glazed', tile: 1.3, match: 'plaster', extra: 'one', desat: 0.8, ao: 0.6 },
  wood: { dir: 'interior/laminate-wood', tile: 0.6, match: 'wood', extra: 'one' },
  countertop: { dir: 'interior/countertop-laminate', tile: 1.0, match: 'plaster', extra: 'one', desat: 0.8 },
  shelfpaint: { dir: 'interior/metal-painted', tile: 1.0, detail: 0.8, extra: 'one', desat: 1.0 },
  steel: { dir: 'interior/steel-brushed', tile: 1.0, detail: 0.8, extra: 'one', desat: 1.0 },
  aluminum: { dir: 'interior/aluminum-scratched', tile: 1.0, detail: 0.8, extra: 'one', desat: 1.0 },
  cardboard: { dir: 'interior/cardboard', tile: 1.0, detail: 0.8, extra: 'one', desat: 0.7 },
  fabric: { dir: 'interior/fabric', tile: 0.5, detail: 0.8, extra: 'one', desat: 1.0 },
  rubber: { dir: 'interior/rubber-mat', tile: 0.75, detail: 0.8, extra: 'one', desat: 1.0 },
};

const loader = new THREE.TextureLoader();
function loadTex(url, srgb) {
  return loader.loadAsync(url).then((t) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  });
}

const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE.needsUpdate = true;

// Start fetching every scan right away (runs in parallel with procedural generation).
export function fetchScans() {
  const out = {};
  for (const [key, s] of Object.entries(SCANS)) {
    const base = ROOT + s.dir + '/';
    out[key] = Promise.all([
      loadTex(base + 'albedo.jpg', true),
      loadTex(base + 'normal.jpg', false),
      loadTex(base + 'roughness.jpg', false),
      loadTex(base + 'ao.jpg', false).catch(() => WHITE),
    ]).then(([albedo, normal, rough, ao]) => ({ albedo, normal, rough, ao }))
      .catch((e) => { console.warn('[scan] missing', key, e?.message ?? e); return null; });
  }
  return out;
}

// Mean linear luminance of a texture (GPU downsample through the mip chain, tiny readback).
const MEAN_N = 8;
function meanLuma(renderer, tex) {
  const mat = fsMaterial({
    uniforms: { t: { value: tex } },
    fragmentShader: /* glsl */ `
      precision highp float; varying vec2 vUv; uniform sampler2D t;
      void main() { vec3 c = texture2D(t, vUv, 6.0).rgb; gl_FragColor = vec4(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), 1.0); }
    `,
  });
  const rt = makeRT(MEAN_N, MEAN_N, { type: THREE.FloatType });
  new FSPass(mat).render(renderer, rt);
  const px = new Float32Array(MEAN_N * MEAN_N * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, MEAN_N, MEAN_N, px);
  renderer.setRenderTarget(null);
  rt.dispose(); mat.dispose();
  let s = 0;
  for (let i = 0; i < MEAN_N * MEAN_N; i++) s += px[i * 4];
  return s / (MEAN_N * MEAN_N);
}

const PACK_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tA; uniform sampler2D tN; uniform sampler2D tR; uniform sampler2D tO;
  uniform float uGain; uniform float uDesat; uniform float uAo; uniform float uMeanL; uniform float uNormal;
  ${COMMON_GLSL}
  void main() {
    vec3 a = texture2D(tA, vUv).rgb;           // linear (sRGB decoded by sampler)
    float ao = texture2D(tO, vUv).r;
    float l = luma(a);
    #if MODE == 0
      a = mix(a, vec3(l), uDesat);
      a *= mix(1.0, ao, uAo);
      float r = texture2D(tR, vUv).r;
      gl_FragColor = vec4(clamp(a * uGain, 0.0, 1.0), clamp(r, 0.02, 1.0)); // sRGB target encodes
    #else
      vec3 n = texture2D(tN, vUv).rgb * 2.0 - 1.0;
      n = normalize(vec3(n.xy * uNormal, max(n.z, 1e-3)));
      float e = 1.0;
      #if EXTRA == 1
        e = clamp(0.5 + (l / max(uMeanL, 1e-3) - 1.0) * 0.3, 0.0, 1.0) * mix(1.0, ao, 0.5);
      #elif EXTRA == 2
        e = smoothstep(0.35, 0.65, l / max(uMeanL, 1e-3));
      #endif
      gl_FragColor = vec4(n * 0.5 + 0.5, e);
    #endif
  }
`;

function packPass(renderer, maps, mode, extra, uniforms, w, h, srgb, aniso) {
  const mat = fsMaterial({
    uniforms: {
      tA: { value: maps.albedo }, tN: { value: maps.normal }, tR: { value: maps.rough }, tO: { value: maps.ao },
      uGain: { value: uniforms.gain }, uDesat: { value: uniforms.desat }, uAo: { value: uniforms.ao },
      uMeanL: { value: uniforms.meanL }, uNormal: { value: uniforms.normal },
    },
    defines: { MODE: mode, EXTRA: extra },
    fragmentShader: PACK_FRAG,
  });
  const rt = makeRT(w, h, {
    type: THREE.UnsignedByteType, wrap: THREE.RepeatWrapping, minFilter: THREE.LinearMipmapLinearFilter, mipmaps: true,
    colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
  });
  rt.texture.anisotropy = aniso;
  new FSPass(mat).render(renderer, rt);
  renderer.setRenderTarget(null);
  mat.dispose();
  return rt.texture;
}

// Replace / add entries in `tex` with packed scans. Returns the list of keys that loaded.
export async function applyScans(renderer, tex, pending, maxSize) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const done = [];
  const procMean = {};
  const meanOf = (k) => {
    if (procMean[k] === undefined) procMean[k] = tex[k] ? meanLuma(renderer, tex[k].albedo) : null;
    return procMean[k];
  };
  // measure procedural references before anything gets replaced
  for (const s of Object.values(SCANS)) if (s.match) meanOf(s.match);

  for (const [key, s] of Object.entries(SCANS)) {
    const maps = await pending[key];
    if (!maps) continue;
    const img = maps.albedo.image;
    const scanL = meanLuma(renderer, maps.albedo);
    const desat = s.desat ?? 0;
    // desaturation keeps luminance, so the mean is unchanged by it
    let gain = 1;
    if (s.match && procMean[s.match]) gain = (procMean[s.match] / Math.max(scanL, 1e-4)) * (s.gain ?? 1);
    else if (s.detail) gain = s.detail / Math.max(scanL, 1e-4);
    const w = Math.min(maxSize, img.width);
    const h = Math.max(1, Math.round(w * img.height / img.width));
    const u = { gain, desat, ao: s.ao ?? 0.5, meanL: scanL, normal: s.normal ?? 1 };
    const extra = { one: 0, height: 1, paint: 2 }[s.extra ?? 'one'];
    const albedo = packPass(renderer, maps, 0, extra, u, w, h, true, aniso);
    const normal = packPass(renderer, maps, 1, extra, u, w, h, false, aniso);
    albedo.name = key + '_scan_albedo';
    normal.name = key + '_scan_normal';
    for (const t of [maps.albedo, maps.normal, maps.rough, maps.ao]) if (t !== WHITE) t.dispose();
    tex[key] = { albedo, normal, name: key, scan: true, tile: s.tile };
    done.push(key);
  }
  return done;
}

// ------------------------------------------------------------------------------------------
// CC0 decal / grime masks (public/assets/textures/decals). Packed into one RGBA texture:
//   R = cloudy dirt (large grime, puddles)   G = vertical drips (wall rain streaks)
//   B = fine grime                           A = splatter spots (gum, drips)
// plus single-purpose decals: oil smear mask, footprint strips, glass droplet normal.
// ------------------------------------------------------------------------------------------
const DROOT = ROOT + 'decals/';
export function fetchDecals() {
  const ld = (p, srgb = false) => loadTex(DROOT + p, srgb);
  return Promise.all([
    ld('grunge-masks/cloudyDirt.jpg'), ld('grunge-masks/verticalDrips.jpg'), ld('grunge-masks/fineGrime.jpg'), ld('grunge-masks/splatterSpots.jpg'),
    ld('oil-stain-smear/mask.jpg'), ld('muddy-footprints/mask.png'), ld('rain-glass-droplets/normal.jpg'), ld('rain-glass-droplets/droplet_mask.jpg'),
  ]).then(([dirt, drips, fine, spots, oil, feet, dropN, dropM]) => ({ dirt, drips, fine, spots, oil, feet, dropN, dropM }))
    .catch((e) => { console.warn('[decals] missing', e?.message ?? e); return null; });
}

export async function buildDecals(renderer, pending, size = 1024) {
  const d = await pending;
  if (!d) return null;
  const mat = fsMaterial({
    uniforms: { t0: { value: d.dirt }, t1: { value: d.drips }, t2: { value: d.fine }, t3: { value: d.spots } },
    fragmentShader: /* glsl */ `
      precision highp float; varying vec2 vUv;
      uniform sampler2D t0; uniform sampler2D t1; uniform sampler2D t2; uniform sampler2D t3;
      void main() { gl_FragColor = vec4(texture2D(t0, vUv).r, texture2D(t1, vUv).r, texture2D(t2, vUv).r, texture2D(t3, vUv).r); }
    `,
  });
  const rt = makeRT(size, size, { type: THREE.UnsignedByteType, wrap: THREE.RepeatWrapping, minFilter: THREE.LinearMipmapLinearFilter, mipmaps: true });
  rt.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  new FSPass(mat).render(renderer, rt);
  renderer.setRenderTarget(null);
  mat.dispose();
  for (const t of [d.dirt, d.drips, d.fine, d.spots]) t.dispose();
  for (const t of [d.oil, d.feet]) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
  return { masks: rt.texture, oil: d.oil, feet: d.feet, dropN: d.dropN, dropM: d.dropM };
}
