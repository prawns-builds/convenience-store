import * as THREE from 'three';
import { G, patchMaterial, emissiveMaterial } from '../gfx/Materials.js';
import { NOISE_GLSL } from '../gfx/glsl/noise.js';

// ------------------------------------------------------------------------------------------
// Material definitions. kind: std (patched MeshStandardMaterial) | emissive | glass
// ------------------------------------------------------------------------------------------
export const MATS = {
  concrete: { tex: 'concrete', color: 0xb0aca4, porosity: 0.7, wetRough: 0.2, grime: 0.25 },
  concreteDark: { tex: 'concrete', color: 0x77736c, porosity: 0.7, wetRough: 0.2, grime: 0.3 },
  curb: { tex: 'concrete', color: 0xb8b2a2, porosity: 0.6, wetRough: 0.2, grime: 0.35 },
  stuccoWall: { tex: 'stucco', paint: 0xa49c86, porosity: 0.6, wetRough: 0.3, grime: 0.35, streaks: true },
  stuccoBand: { tex: 'stucco', paint: 0x3b574b, porosity: 0.5, wetRough: 0.25, grime: 0.3, streaks: true },
  stuccoRear: { tex: 'stucco', paint: 0x8c8676, porosity: 0.6, wetRough: 0.3, grime: 0.45, streaks: true },
  pillarWhite: { tex: 'stucco', paint: 0xdedad0, porosity: 0.5, wetRough: 0.25, grime: 0.3, uvMul: 0.5 },
  pillarGreen: { tex: 'stucco', paint: 0x2c4a3e, porosity: 0.5, wetRough: 0.25, grime: 0.2, uvMul: 0.5 },
  canopyUnder: { tex: 'concrete', color: 0xd9d5cb, porosity: 0.6, wetRough: 0.3, grime: 0.32 },
  roof: { tex: 'roof', texFb: 'asphalt', color: 0x888888, porosity: 0.3, wetRough: 0.15 },
  brick: { tex: 'brick', texFb: 'stucco', color: 0x5a5a5a, paintFb: 0x5a3328, porosity: 0.6, wetRough: 0.3, grime: 0.4 },
  metalWhite: { tex: 'metal', paint: 0xe2dccb, porosity: 0.2, wetRough: 0.12 },
  metalCream: { tex: 'metal', paint: 0xd4c9a8, porosity: 0.2, wetRough: 0.12 },
  metalRed: { tex: 'metal', paint: 0x8e1d18, porosity: 0.2, wetRough: 0.12 },
  metalGreen: { tex: 'metal', paint: 0x264d42, porosity: 0.2, wetRough: 0.12 },
  metalDark: { tex: 'metal', paint: 0x34383a, porosity: 0.2, wetRough: 0.12, uvMul: 2.0 },
  metalBlue: { tex: 'metal', paint: 0x23415e, porosity: 0.2, wetRough: 0.12 },
  metalYellow: { tex: 'metal', paint: 0xb88a1c, porosity: 0.2, wetRough: 0.12 },
  metalShelf: { tex: 'shelfpaint', color: 0xc4bfae, roughness: 0.55, metalness: 0.15, grime: 0.12 },
  frame: { color: 0x1d1f20, roughness: 0.5, metalness: 0.6 },
  aluminum: { tex: 'aluminum', color: 0x8c8e8e, roughness: 0.35, metalness: 0.9 },
  steel: { tex: 'steel', color: 0x6c6d6c, roughness: 0.5, metalness: 0.85 },
  chrome: { color: 0xc8c8c8, roughness: 0.18, metalness: 1.0 },
  rubber: { tex: 'rubber', color: 0x0b0b0b, roughness: 0.82, porosity: 0.1, wetRough: 0.25 },
  plasticBlack: { color: 0x121212, roughness: 0.45 },
  plasticWhite: { color: 0xcfcdc5, roughness: 0.4 },
  plasticGrey: { color: 0x55585a, roughness: 0.5 },
  plasticRed: { color: 0x8a1410, roughness: 0.4 },
  wood: { tex: 'wood', color: 0xffffff, porosity: 0.8, wetRough: 0.3 },
  woodDark: { tex: 'wood', color: 0x7a5a40, porosity: 0.5, wetRough: 0.3 },
  laminate: { tex: 'wood', color: 0xb89a7a, roughness: 0.6 },
  counterTop: { tex: 'countertop', texFb: 'plaster', color: 0x8a8576, roughness: 0.35 },
  plaster: { tex: 'plaster', color: 0xb9b49a, grime: 0.22 },
  plasterGreen: { tex: 'plaster', color: 0x6b8677, grime: 0.2 },
  plasterBack: { tex: 'plaster', color: 0x87877f, grime: 0.35 },
  ceilingTile: { tex: 'ceiling', color: 0xffffff },
  wallTile: { tex: 'walltile', texFb: 'vct', color: 0xdcdcd2, roughness: 0.25, uvMulFb: 0.5, variant: 'wallTile', patchFb: { variant: 'wallTile', afterMap: 'diffuseColor.rgb *= mix(1.0, 2.45, texExtra); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.333))), 0.6);' } },
  cardboard: { tex: 'cardboard', color: 0x8a6a45, roughness: 0.85 },
  cardboardDark: { tex: 'cardboard', color: 0x6a5035, roughness: 0.85 },
  fabric: { tex: 'fabric', color: 0x2a2a2e, roughness: 0.95 },
  vanPaint: { tex: 'metal', paint: 0xb9b5aa, porosity: 0.1, wetRough: 0.08, roughness: 0.42, uvMul: 1.6 },
  porcelain: { color: 0xe8e6e0, roughness: 0.15 },
  mirrorDirty: { color: 0x7a7c7a, roughness: 0.25, metalness: 1.0 },
  bark: { tex: 'bark', texFb: 'wood', color: 0x5a4a3e, porosity: 0.8, wetRough: 0.3, uvMulFb: 0.4 },
  gravel: { tex: 'gravel', texFb: 'concrete', color: 0x8a8882, porosity: 0.8, wetRough: 0.3 },
};

// ------------------------------------------------------------------------------------------
export class MaterialLib {
  constructor(textures) {
    this.tex = textures; // { concrete: {albedo, normal}, ... , noise, clouds, leaves, grass }
    this.cache = new Map();
    this.all = [];
    this.envMaps = { ext: null, int: null, back: null };
    this.boxes = {
      int: { min: new THREE.Vector3(-9.7, 0, -6.7), max: new THREE.Vector3(-0.3, 3.0, 6.5), pos: new THREE.Vector3(-5, 1.6, 0) },
      back: { min: new THREE.Vector3(-9.7, 0, 6.65), max: new THREE.Vector3(-0.3, 3.0, 14.7), pos: new THREE.Vector3(-3.5, 1.5, 10.5) },
    };
    this.custom = {};
  }

  // Get (or create) a material for a part.
  get(matKey, mode, region, extra = {}) {
    const def = MATS[matKey] ?? this.custom[matKey];
    if (!def) throw new Error('Unknown material ' + matKey);
    if (def.kind === 'emissive') return def.material;
    if (def.kind === 'shared') return def.material;
    const bake = { lm: 'atlas', ground: 'ground', vtx: 'points', inst: 'inst', none: 'none' }[mode] ?? null;
    const perPart = bake === 'points' || bake === 'inst' || bake === 'none';
    const key = `${matKey}|${mode}|${region}`;
    if (!perPart && this.cache.has(key)) return this.cache.get(key);
    const m = this._create(def, bake, region, extra);
    m.name = key;
    if (!perPart) this.cache.set(key, m);
    this.all.push(m);
    return m;
  }

  _create(def, bake, region, extra) {
    const params = {
      color: new THREE.Color(def.color ?? 0xffffff),
      roughness: def.roughness ?? 1.0,
      metalness: def.metalness ?? 0.0,
      side: def.side ?? THREE.FrontSide,
    };
    if (def.map) params.map = def.map;
    if (def.normalMap && !def.tex) { params.normalMap = def.normalMap; params.normalScale = new THREE.Vector2(def.normalScale ?? 1, def.normalScale ?? 1); }
    if (def.roughnessMap) params.roughnessMap = def.roughnessMap;
    if (def.metalnessMap) params.metalnessMap = def.metalnessMap;
    let packed = false;
    // scanned texture if it loaded, else the procedural fallback (with its fallback tweaks)
    if (def.tex && !this.tex[def.tex] && def.texFb) def = { ...def, tex: def.texFb, paint: def.paintFb ?? def.paint, uvMul: def.uvMulFb ?? def.uvMul, patch: def.patchFb ?? def.patch, color: def.paintFb ? 0xffffff : def.color };
    if (def.tex && this.tex[def.tex]) {
      const t = this.tex[def.tex];
      params.map = t.albedo;
      params.normalMap = t.normal;
      params.normalScale = new THREE.Vector2(def.normalScale ?? 1, def.normalScale ?? 1);
      packed = true;
    }
    if (def.alphaMap) { params.alphaTest = 0.5; params.map = def.alphaMap; params.side = THREE.DoubleSide; }
    if (def.alphaTest) params.alphaTest = def.alphaTest;
    const m = new THREE.MeshStandardMaterial(params);
    if (def.emissive) { m.emissive = new THREE.Color(def.emissive); m.emissiveIntensity = def.emissiveIntensity ?? 1; }
    if (def.vertexColors) m.vertexColors = true;
    const ext = region === 'ext';
    const wetCapable = ext && def.porosity !== undefined;
    patchMaterial(m, {
      bake,
      packed: packed && !def.alphaMap,
      wet: wetCapable,
      porosity: def.porosity,
      wetRough: def.wetRough,
      paint: def.paint,
      grime: def.grime,
      streaks: ext && def.streaks,
      boxProj: !ext && this.boxes[region] ? this.boxes[region] : null,
      ptBase: extra.ptBase ?? 0,
      variant: def.variant,
      ...(def.patch ?? {}),
    });
    m.userData.region = region;
    m.userData.def = def;
    if (def.envIntensity !== undefined) m.envMapIntensity = def.envIntensity;
    return m;
  }

  // Assign environment maps after probe capture
  setEnvMaps(maps) {
    this.envMaps = maps;
    for (const m of this.all) {
      if (!m.isMeshStandardMaterial) continue;
      const r = m.userData.region;
      const env = maps[r] ?? maps.ext;
      if (!env) continue;
      m.envMap = env;
      if (m.userData.def?.envIntensity === undefined) m.envMapIntensity = m.userData.envIntensity ?? 1.0;
      m.needsUpdate = true;
    }
  }

  registerEmissive(key, material) { this.custom[key] = { kind: 'emissive', material }; return material; }
  registerShared(key, material) { this.custom[key] = { kind: 'shared', material }; this.all.push(material); return material; }
  define(key, def) { this.custom[key] = def; return def; }
}

// ------------------------------------------------------------------------------------------
// Planar reflection sampling shared by ground + interior floor
// ------------------------------------------------------------------------------------------
const PLANAR_GLSL = /* glsl */ `
uniform sampler2D uRefl0;
uniform sampler2D uRefl1;
uniform sampler2D uRefl2;
uniform vec2 uResolution;
uniform float uPlanarOn;
vec3 planarReflection(vec3 nW, float rough, float distortAmt) {
  if (uPlanarOn < 0.5) return vec3(0.0);
  vec2 suv = gl_FragCoord.xy / uResolution;
  suv.x = 1.0 - suv.x;
  suv += vec2(-nW.x, nW.z) * distortAmt;
  suv = clamp(suv, vec2(0.001), vec2(0.999));
  float r = clamp(rough, 0.0, 1.0);
  vec3 c0 = texture2D(uRefl0, suv).rgb;
  vec3 c1 = texture2D(uRefl1, suv).rgb;
  vec3 c2 = texture2D(uRefl2, suv).rgb;
  vec3 c = r < 0.12 ? mix(c0, c1, r / 0.12) : mix(c1, c2, clamp((r - 0.12) / 0.22, 0.0, 1.0));
  // rough surfaces lose coherent reflection
  return c * (1.0 - smoothstep(0.35, 0.75, r) * 0.85);
}
`;

const RIPPLE_GLSL = /* glsl */ `
vec2 rainRipples(vec2 p, float t) {
  vec2 n = vec2(0.0);
  for (int layer = 0; layer < 2; layer++) {
    float sc = layer == 0 ? 2.6 : 4.3;
    vec2 q = p * sc + float(layer) * 17.31;
    vec2 base = floor(q - 0.5);
    for (int j = 0; j <= 1; j++)
    for (int i = 0; i <= 1; i++) {
      vec2 c = base + vec2(float(i), float(j));
      vec2 h = hash22(c + float(layer) * 7.7);
      float period = 0.9 + 0.8 * h.x;
      float tt = fract(t / period + h.y);
      vec2 center = c + 0.15 + 0.7 * hash22(c * 1.37 + 3.1);
      vec2 d = q - center;
      float r = length(d);
      float rad = tt * 0.55;
      float w = 0.09;
      float ring = sin((r - rad) * 62.0) * smoothstep(w, 0.0, abs(r - rad)) * (1.0 - tt) * (1.0 - tt);
      n += d / max(r, 1e-3) * ring;
    }
  }
  return n * 0.22;
}
`;

// ------------------------------------------------------------------------------------------
// Ground: lot concrete, road asphalt + markings, gravel shoulders, grass field; puddles,
// ripples, wetness, planar reflections and analytic street lights for the long road.
// ------------------------------------------------------------------------------------------
const tile = (t, fb) => (t?.scan ? (Array.isArray(t.tile) ? t.tile[0] : t.tile) : fb);
const f = (x) => Number(x).toFixed(4);
export function makeGroundMaterial(tex) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const U = {
    tAsphaltA: { value: tex.asphalt.albedo }, tAsphaltN: { value: tex.asphalt.normal },
    tConcA: { value: tex.concrete.albedo }, tConcN: { value: tex.concrete.normal },
    tGrassA: { value: tex.groundcover.albedo }, tGrassN: { value: tex.groundcover.normal },
    tGravA: { value: (tex.gravel ?? tex.asphalt).albedo }, tGravN: { value: (tex.gravel ?? tex.asphalt).normal },
    uNoiseTex: G.uNoiseTex,
    uRefl0: G.uRefl0, uRefl1: G.uRefl1, uRefl2: G.uRefl2, uResolution: G.uResolution, uPlanarOn: G.uPlanarOn,
    uStreetZ0: G.uStreetZ0, uStreetSpacing: G.uStreetSpacing, uStreetX: G.uStreetX, uStreetH: G.uStreetH,
    uStreetColor: G.uStreetColor, uStreetI: G.uStreetI, uStreetSkipA: G.uStreetSkipA, uStreetSkipB: G.uStreetSkipB,
    uRain: G.uRain, uOilTex: G.uOilTex,
  };
  patchMaterial(m, {
    bake: 'ground',
    uniforms: U,
    variant: 'ground',
    fragPre: /* glsl */ `
      uniform sampler2D tAsphaltA; uniform sampler2D tAsphaltN;
      uniform sampler2D tConcA; uniform sampler2D tConcN;
      uniform sampler2D tGrassA; uniform sampler2D tGrassN;
      uniform sampler2D tGravA; uniform sampler2D tGravN;
      uniform sampler2D uOilTex;
      uniform float uStreetZ0; uniform float uStreetSpacing; uniform float uStreetX; uniform float uStreetH;
      uniform vec3 uStreetColor; uniform float uStreetI; uniform float uStreetSkipA; uniform float uStreetSkipB;
      uniform float uRain;
    `,
    beforeMain: NOISE_GLSL + PLANAR_GLSL + RIPPLE_GLSL + /* glsl */ `
      float sdBox2(vec2 p, vec2 c, vec2 h) { vec2 d = abs(p - c) - h; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
      vec3 tsToWorld(vec3 t) { return vec3(t.x, t.z, -t.y); }
    `,
    afterMap: /* glsl */ `
      vec2 P = vWorldX.xz;
      if (P.x > -10.02 && P.x < 0.02 && P.y > -7.02 && P.y < 15.02) discard;
      vec4 nzL = texture2D(uNoiseTex, P * 0.013);
      vec4 nzM = texture2D(uNoiseTex, P * 0.061 + 0.37);
      vec4 nzH = texture2D(uNoiseTex, P * 0.29 + 0.11);
      float edgeN = (nzM.g - 0.5) * 1.4 + (nzH.r - 0.5) * 0.6;
      // region distances (negative = inside)
      float dRoad = abs(P.x - 27.9) - 3.7;
      float dLot = min(sdBox2(P, vec2(10.3, 2.0), vec2(12.3, 32.0)), sdBox2(P, vec2(-5.0, 4.0), vec2(7.0, 13.0)));
      float wRoad = 1.0 - smoothstep(-0.05, 0.12, dRoad + edgeN * 0.08);
      float wLot = 1.0 - smoothstep(-0.3, 0.3, dLot + edgeN * 0.9);
      float dShoulder = abs(P.x - 27.9) - 5.6;
      float wGravel = (1.0 - smoothstep(-0.4, 0.5, dShoulder + edgeN * 0.8)) * (1.0 - wRoad);
      wLot *= (1.0 - wRoad);
      wGravel *= (1.0 - wLot);
      float wGrass = clamp(1.0 - wRoad - wLot - wGravel, 0.0, 1.0);

      vec2 uvA = vec2(P.x, -P.y) / ${f(tile(tex.asphalt, 2.0))};
      vec2 uvC = vec2(P.x, -P.y) / ${f(tile(tex.concrete, 4.0))};
      vec2 uvG = vec2(P.x, -P.y) / ${f(tile(tex.groundcover, 6.0))};
      // second, rotated + offset sample of the scans breaks up visible tiling
      vec2 uvA2 = mat2(0.8, -0.6, 0.6, 0.8) * uvA * 0.61 + 0.37;
      vec4 aA2 = texture2D(tAsphaltA, uvA2);
      vec2 uvV = vec2(P.x, -P.y) / ${f(tile(tex.gravel, 2.0))};
      vec4 aV = texture2D(tGravA, uvV); vec4 nV = texture2D(tGravN, uvV);
      vec4 aA = texture2D(tAsphaltA, uvA); vec4 nA = texture2D(tAsphaltN, uvA);
      vec4 aC = texture2D(tConcA, uvC);    vec4 nC = texture2D(tConcN, uvC);
      vec4 aG = texture2D(tGrassA, uvG);   vec4 nG = texture2D(tGrassN, uvG);
      float brk = smoothstep(0.35, 0.65, nzL.b);
      aA = mix(aA, vec4(aA2.rgb, aA.a), brk * ${tex.asphalt.scan ? '0.5' : '0.0'});
      // lot: concrete slabs with joints + asphalt patch repairs
      vec2 slab = P / 4.5;
      vec2 sf = abs(fract(slab) - 0.5);
      float joint = smoothstep(0.492, 0.498, max(sf.x, sf.y));
      vec2 sid = floor(slab);
      float slabTone = 0.82 + 0.3 * hash12(sid);
      float patchM = smoothstep(0.62, 0.66, nzL.g * 0.8 + nzM.r * 0.35) ;
      vec3 lotCol = aC.rgb * slabTone * vec3(0.4, 0.39, 0.365);
      float lotRough = aC.a;
      vec3 lotN = nC.rgb;
      lotCol = mix(lotCol, aA.rgb * 0.9, patchM);
      lotRough = mix(lotRough, aA.a, patchM);
      lotN = mix(lotN, nA.rgb, patchM);
      lotCol *= 1.0 - joint * 0.55;
      // tire/oil stains near pumps and parking
      float stain = smoothstep(0.55, 0.85, nzM.b) * smoothstep(0.3, 0.7, nzL.r);
      // scanned grime breakup (CC0 dirt mask) + gum / drip spots near the entrance
      vec4 dec = texture2D(uDecalTex, P * 0.23);
      vec4 dec2 = texture2D(uDecalTex, P * 0.71 + 0.5);
      stain = mix(stain, max(stain * 0.6, smoothstep(0.45, 0.9, dec.r) * smoothstep(0.25, 0.7, nzL.r)), uDecalOn);
      lotCol *= 1.0 - stain * 0.45;
      lotCol *= 1.0 - uDecalOn * 0.35 * smoothstep(0.55, 0.95, dec2.a) * smoothstep(9.0, 2.0, length(P - vec2(1.2, 2.6)));
      // oil smears: under pump nozzles, the van's engine bay and the parking slots
      float oil = 0.0;
      if (uDecalOn > 0.5) {
        const int NOIL = 9;
        vec4 OIL[NOIL];
        OIL[0] = vec4(10.25, -4.6, 0.4, 1.0); OIL[1] = vec4(12.15, -7.8, 2.1, 0.9); OIL[2] = vec4(10.3, 3.3, 1.2, 1.1);
        OIL[3] = vec4(12.1, 0.3, 2.7, 0.8); OIL[4] = vec4(3.35, -3.5, 0.2, 1.4); OIL[5] = vec4(6.6, 9.5, 1.7, 1.3);
        OIL[6] = vec4(6.9, -12.0, 0.9, 1.6); OIL[7] = vec4(17.5, -2.0, 2.4, 1.2); OIL[8] = vec4(8.4, -1.5, 0.6, 0.7);
        for (int i = 0; i < NOIL; i++) {
          vec2 d = P - OIL[i].xy;
          float c = cos(OIL[i].z), s = sin(OIL[i].z);
          vec2 q = vec2(c * d.x - s * d.y, s * d.x + c * d.y) / (vec2(0.9, 0.83) * OIL[i].w) + 0.5;
          if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) oil = max(oil, texture2D(uOilTex, q).r);
        }
        oil *= wLot;
      }
      lotCol *= 1.0 - oil * 0.65;
      // road asphalt + markings
      vec3 roadCol = aA.rgb * 0.75;
      float roadRough = aA.a;
      float cx = P.x - 27.9;
      float dash = step(0.0, sin(P.y * 6.2831853 / 12.0)) ;
      float yel = (1.0 - smoothstep(0.06, 0.08, abs(abs(cx) - 0.12))) * 1.0;
      float edgeL = 1.0 - smoothstep(0.06, 0.08, abs(abs(cx) - 3.45));
      float paintWear = smoothstep(0.25, 0.6, nzH.g + aA.r * 2.0);
      vec3 paintCol = vec3(0.0);
      float paintM = 0.0;
      if (yel > 0.0) { paintCol = vec3(0.55, 0.38, 0.05); paintM = yel * paintWear; }
      if (edgeL > 0.0) { paintCol = vec3(0.62, 0.62, 0.58); paintM = edgeL * paintWear; }
      roadCol = mix(roadCol, paintCol, paintM * wRoad);
      roadRough = mix(roadRough, 0.45, paintM);
      // gravel shoulder
      vec3 gravCol = ${tex.gravel ? 'mix(aV.rgb, aG.rgb, 0.2)' : 'mix(aA.rgb * 1.4, aG.rgb, 0.35) * vec3(0.75, 0.72, 0.66)'};
      // combine
      vec3 alb = lotCol * wLot + roadCol * wRoad + gravCol * wGravel + aG.rgb * wGrass;
      float rgh = lotRough * wLot + roadRough * wRoad + ${tex.gravel ? 'aV.a' : '0.9'} * wGravel + aG.a * wGrass;
      rgh = mix(rgh, 0.22, oil * 0.8);
      vec4 nGv = ${tex.gravel ? 'nV' : 'nA'};
      vec3 tN = normalize((lotN * 2.0 - 1.0) * wLot + (nA.rgb * 2.0 - 1.0) * wRoad + (nGv.rgb * 2.0 - 1.0) * wGravel + (nG.rgb * 2.0 - 1.0) * wGrass);
      float hgt = nA.a * wRoad + nGv.a * wGravel + nC.a * wLot + nG.a * wGrass;

      // ---------------- wetness & puddles
      float exposure = smoothstep(0.15, 0.6, skyVis);
      float pud = nzL.r * 0.75 + nzM.r * 0.35 + (0.5 - hgt) * 0.5 + uDecalOn * (dec.r - 0.5) * 0.12;
      pud += wLot * 0.06 + wRoad * smoothstep(1.8, 3.6, abs(cx)) * 0.12 - wGrass * 0.25;
      pud += smoothstep(0.5, -0.3, dShoulder) * 0.1;
      float puddle = smoothstep(0.73, 0.78, pud) * exposure * uRain;
      // under canopy: only damp patches from wind-blown rain / tires
      float damp = mix(0.55, 1.0, exposure);
      float wetAmt = damp * uRain;
      alb *= mix(1.0, 0.42, wetAmt * (1.0 - wGrass * 0.4));
      alb = mix(alb, alb * 0.35, puddle);
      rgh = mix(rgh, mix(0.42, 0.16, exposure), wetAmt);
      rgh = mix(rgh, 0.015, puddle);
      tN = normalize(mix(tN, vec3(0.0, 0.0, 1.0), max(puddle, wetAmt * 0.35)));
      // ripples in puddles and faint on wet ground
      if (exposure > 0.05) {
        vec2 rp = rainRipples(P, uTime);
        tN = normalize(tN + vec3(rp, 0.0) * (puddle * 1.0 + 0.15 * wetAmt) * exposure);
      }
      vec3 groundNW = tsToWorld(tN);
      diffuseColor.rgb = alb;
      texRough = rgh;
      float groundPuddle = puddle;
    `,
    afterNormal: /* glsl */ `
      normal = normalize((viewMatrix * vec4(groundNW, 0.0)).xyz);
    `,
    afterLights: /* glsl */ `
      #if defined(RE_IndirectSpecular)
        radiance += planarReflection(groundNW, material.roughness, 0.03 + groundPuddle * 0.02);
      #endif
      {
        float k0 = floor((vWorldX.z - uStreetZ0) / uStreetSpacing + 0.5);
        for (int i = -1; i <= 1; i++) {
          float k = k0 + float(i);
          if (abs(k - uStreetSkipA) < 0.5 || abs(k - uStreetSkipB) < 0.5) continue;
          vec3 lp = vec3(uStreetX, uStreetH, uStreetZ0 + k * uStreetSpacing);
          vec3 L = lp - vWorldX;
          float d2 = dot(L, L);
          vec3 Ld = L * inversesqrt(d2);
          float c = Ld.y;
          float prof = (0.35 + 0.65 * c) * smoothstep(0.3, 0.6, c);
          irradiance += uStreetColor * uStreetI * prof * max(dot(groundNW, Ld), 0.0) / (d2 + 2.0);
        }
      }
    `,
  });
  m.name = 'ground';
  return m;
}

// Interior floor (VCT tiles) with planar reflection
export function makeFloorMaterial(tex, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ map: tex.vct.albedo, normalMap: tex.vct.normal, roughness: 1, metalness: 0, color: new THREE.Color(opts.color ?? 0xffffff) });
  m.normalScale.set(0.6, 0.6);
  patchMaterial(m, {
    bake: 'ground',
    packed: true,
    uniforms: { uRefl0: G.uRefl0, uRefl1: G.uRefl1, uRefl2: G.uRefl2, uResolution: G.uResolution, uNoiseTex: G.uNoiseTex, uPlanarOn: G.uPlanarOn, uFeetTex: G.uFeetTex },
    variant: 'floor' + (opts.variant ?? ''),
    fragPre: 'uniform sampler2D uFeetTex;\n',
    beforeMain: PLANAR_GLSL + /* glsl */ `
      // CC0 footprint strip (atlas half 'col', 0.6 x 2.4 m) laid from a to b
      float footStrip(vec2 p, vec2 a, vec2 b, float col) {
        vec2 ab = b - a; float L = length(ab); vec2 t = ab / L; vec2 n = vec2(-t.y, t.x);
        vec2 d = p - a; float v = dot(d, t) / L; float u = dot(d, n) / 0.6 + 0.5;
        if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) return 0.0;
        return texture2D(uFeetTex, vec2(col * 0.5 + u * 0.5, fract(v * L / 2.4))).r * smoothstep(1.0, 0.3, v);
      }
    `,
    afterMap: /* glsl */ `
      {
        vec4 nz = texture2D(uNoiseTex, vWorldX.xz * 0.07);
        vec4 nz2 = texture2D(uNoiseTex, vWorldX.xz * 0.31 + 0.2);
        // grime collects near walls / shelf bases (cheap proxy: noise) + traffic lane wear
        diffuseColor.rgb *= 0.86 + 0.22 * nz.r;
        texRough = clamp(texRough * (0.8 + 0.5 * nz2.g), 0.08, 1.0);
        // tracked-in water near the entrance
        float nearDoor = smoothstep(4.5, 0.5, length(vWorldX.xz - vec2(-0.8, 2.6)));
        float prints = smoothstep(0.55, 0.7, nz2.r) * nearDoor;
        if (uDecalOn > 0.5) {
          // muddy tracks: in from the door toward the counter, and toward the back door
          float f = max(footStrip(vWorldX.xz, vec2(-0.6, 2.7), vec2(-4.6, 2.0), 0.0), footStrip(vWorldX.xz, vec2(-1.2, 3.1), vec2(-3.4, 6.3), 1.0) * 0.7);
          prints = max(prints * 0.5, f);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.47, 0.38), f * 0.6);
        }
        texRough = mix(texRough, 0.05, prints);
        diffuseColor.rgb *= 1.0 - 0.25 * prints;
      }
    `,
    afterLights: /* glsl */ `
      #if defined(RE_IndirectSpecular)
      {
        vec3 nWf = transformNormalByInverseViewMatrix(normal, viewMatrix);
        radiance += planarReflection(nWf, material.roughness, 0.02);
      }
      #endif
    `,
  });
  m.name = 'floor';
  return m;
}

// Glass: premultiplied output so reflections are not attenuated by opacity.
export function makeGlassMaterial(opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.color ?? 0x9fb0a8), roughness: opts.roughness ?? 0.06, metalness: 0,
    transparent: true, opacity: opts.opacity ?? 0.12, depthWrite: false, side: THREE.DoubleSide,
  });
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  patchMaterial(m, {
    bake: opts.bake ?? 'none',
    variant: 'glass' + (opts.frost ? 'f' : '') + (opts.rain ? 'r' : ''),
    uniforms: { uNoiseTex: G.uNoiseTex, uRain: G.uRain, uDropTex: G.uDropTex },
    fragPre: 'uniform float uRain;\nuniform sampler2D uDropTex;\n',
    afterMap: /* glsl */ `
      {
        vec4 nz = texture2D(uNoiseTex, vec2(dot(vWorldX.xz, vec2(0.7071)), vWorldX.y) * 0.4);
        float smudge = smoothstep(0.45, 0.8, nz.g);
        diffuseColor.a = clamp(diffuseColor.a + smudge * 0.08, 0.0, 1.0);
        texRough = 0.06 + smudge * 0.25;
        ${opts.frost ? '' : `if (uDecalOn > 0.5) {
          // CC0 droplet mask: beads of rain on the glass catch the lamps
          vec3 dpG = normalize(cross(dFdx(vWorldX), dFdy(vWorldX)));
          vec2 gu = vec2(dot(vWorldX.xz, abs(dpG.x) > abs(dpG.z) ? vec2(0.0, 1.0) : vec2(1.0, 0.0)), vWorldX.y) / 0.5;
          float drop = texture2D(uDropTex, gu).r * uRain;
          diffuseColor.a = clamp(diffuseColor.a + drop * 0.12, 0.0, 1.0);
          texRough = mix(texRough, 0.3, drop * 0.6);
        }`}
        ${opts.frost ? 'float fr = smoothstep(0.6, 0.0, vWorldX.y - 0.15 + nz.r * 0.5); diffuseColor.a += fr * 0.35; texRough += fr * 0.5; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8), fr);' : ''}
      }
    `,
    output: /* glsl */ `
      gl_FragColor = vec4(totalDiffuse * diffuseColor.a + totalSpecular + totalEmissiveRadiance, diffuseColor.a);
    `,
    noPremul: true,
  });
  m.name = 'glass';
  return m;
}

export { emissiveMaterial };
