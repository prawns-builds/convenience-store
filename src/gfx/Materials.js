import * as THREE from 'three';
import { NOISE_GLSL } from './glsl/noise.js';

// ------------------------------------------------------------------------------------------
// Global uniforms shared by every patched material.
// ------------------------------------------------------------------------------------------
export const G = {
  uTime: { value: 0 },
  uLmScale: { value: 1 },
  uGroupColor: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
  uSkyColor: { value: new THREE.Vector3(0.033, 0.035, 0.040) },
  uSpecOcc: { value: 2.0 },
  uWetness: { value: 1.0 },
  // lightmaps
  uAtlasS: { value: null }, uAtlasG: { value: null }, uAtlasD: { value: null },
  uGroundS: { value: null }, uGroundG: { value: null }, uGroundD: { value: null },
  uGrRegion: { value: new THREE.Vector4(0, 0, 1, 1) },
  uPtStatic: { value: null }, uPtGroups: { value: null }, uPtWidth: { value: 1024 },
  // reflection pass + fog
  uReflPass: { value: 0 },
  uReflCamPos: { value: new THREE.Vector3() },
  // reflection-pass fog (set every frame from Pipeline.params)
  uFogColor: { value: new THREE.Vector3(0.0074, 0.0078, 0.0080) },
  uFogDensity: { value: 0.016 },
  uFogStart: { value: 16 },
  uStoreMin: { value: new THREE.Vector2(-10.3, -7.3) },
  uStoreMax: { value: new THREE.Vector2(0.3, 15.3) },
  // planar reflection
  uRefl0: { value: null }, uRefl1: { value: null }, uRefl2: { value: null },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uNoiseTex: { value: null },
  // street lights (analytic, ground only)
  uStreetZ0: { value: 8 }, uStreetSpacing: { value: 32 }, uStreetX: { value: 25.2 }, uStreetH: { value: 8.6 },
  uStreetColor: { value: new THREE.Vector3(1.0, 0.62, 0.32) }, uStreetI: { value: 110 },
  uStreetSkipA: { value: 0 }, uStreetSkipB: { value: -1 },
  uRain: { value: 1 },
  uLightning: { value: 0 },
  uDebugView: { value: 0 },
  uPlanarOn: { value: 1 },
};

// Pre-main declarations shared by all patched materials (fragment)
const FRAG_PRE = /* glsl */ `
varying vec3 vWorldX;
uniform float uTime;
uniform float uLmScale;
uniform vec3 uGroupColor[4];
uniform vec3 uSkyColor;
uniform float uSpecOcc;
uniform float uReflPass;
uniform vec3 uReflCamPos;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogStart;
uniform vec2 uStoreMin;
uniform vec2 uStoreMax;
uniform int uDebugView;
vec3 dbgIrr = vec3(0.0);
#if defined(BAKE_ATLAS) || defined(BAKE_GROUND)
  varying vec2 vLmUv;
  uniform sampler2D uLmS;
  uniform sampler2D uLmG;
  uniform sampler2D uLmD;
#endif
#if defined(BAKE_POINTS) || defined(BAKE_INST)
  varying vec4 vBkStatic;
  varying vec4 vBkGroups;
#endif
#ifdef BAKE_NONE
  uniform vec3 uProbeStatic;
  uniform float uProbeSky;
#endif
uniform float uWetness;
uniform float uWetOn;
uniform float uPorosity;
uniform float uWetRough;
uniform vec3 uPaintColor;
uniform float uPaintOn;
uniform float uPaintCover;
uniform sampler2D uNoiseTex;
uniform float uGrime;
uniform float uStreakOn;
uniform float uPacked;
uniform float uBoxOn;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uProbePos;
vec3 boxProject(vec3 wp, vec3 dir) {
  if (uBoxOn < 0.5 || any(lessThan(wp, uBoxMin)) || any(greaterThan(wp, uBoxMax))) return dir;
  vec3 sd = mix(dir, vec3(1e-4), lessThan(abs(dir), vec3(1e-4)));
  vec3 t1 = (uBoxMax - wp) / sd;
  vec3 t2 = (uBoxMin - wp) / sd;
  vec3 tf = max(t1, t2);
  float d = min(min(tf.x, tf.y), tf.z);
  return normalize(wp + dir * d - uProbePos);
}
#ifdef EMISSIVE_PULSE
  uniform float uEmissiveLevel;
#endif
`;

const VERT_PRE = /* glsl */ `
varying vec3 vWorldX;
#if defined(BAKE_ATLAS)
  attribute vec2 uv1;
  varying vec2 vLmUv;
#elif defined(BAKE_GROUND)
  uniform vec4 uGrRegion;
  varying vec2 vLmUv;
#elif defined(BAKE_POINTS) || defined(BAKE_INST)
  uniform sampler2D uPtStatic;
  uniform sampler2D uPtGroups;
  uniform int uPtBase;
  uniform int uPtWidth;
  varying vec4 vBkStatic;
  varying vec4 vBkGroups;
#endif
`;

const VERT_MAIN = /* glsl */ `
{
  vec4 wpx = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wpx = instanceMatrix * wpx;
  #endif
  wpx = modelMatrix * wpx;
  vWorldX = wpx.xyz;
  #if defined(BAKE_ATLAS)
    vLmUv = uv1;
  #elif defined(BAKE_GROUND)
    vLmUv = (wpx.xz - uGrRegion.xy) * uGrRegion.zw;
  #elif defined(BAKE_POINTS) || defined(BAKE_INST)
    #ifdef BAKE_INST
      int bi = uPtBase + gl_InstanceID;
    #else
      int bi = uPtBase + gl_VertexID;
    #endif
    ivec2 tc = ivec2(bi % uPtWidth, bi / uPtWidth);
    vBkStatic = texelFetch(uPtStatic, tc, 0);
    vBkGroups = texelFetch(uPtGroups, tc, 0);
  #endif
}
`;

// Replaces <map_fragment>: baked fetch + packed albedo/roughness + paint/grime/wet albedo.
const FRAG_MAP = /* glsl */ `
vec3 bkStatic = vec3(0.0);
vec4 bkGroups = vec4(0.0);
vec4 bkDir = vec4(0.0);
float bkSky = 0.0;
#if defined(BAKE_ATLAS) || defined(BAKE_GROUND)
  bkStatic = texture2D(uLmS, vLmUv).rgb;
  bkGroups = texture2D(uLmG, vLmUv);
  bkDir = texture2D(uLmD, vLmUv);
  bkSky = bkDir.a;
  #ifdef BAKE_GROUND
    if (any(lessThan(vLmUv, vec2(0.0))) || any(greaterThan(vLmUv, vec2(1.0)))) { bkStatic = vec3(0.0); bkGroups = vec4(0.0); bkDir = vec4(0.0); bkSky = 1.0 / max(uLmScale, 1e-4); }
  #endif
#elif defined(BAKE_POINTS) || defined(BAKE_INST)
  bkStatic = vBkStatic.rgb;
  bkSky = vBkStatic.a;
  bkGroups = vBkGroups;
#elif defined(BAKE_NONE)
  bkStatic = uProbeStatic / max(uLmScale, 1e-4);
  bkSky = uProbeSky / max(uLmScale, 1e-4);
#endif
float skyVis = bkSky * uLmScale;
float texRough = 1.0;
float texExtra = 1.0;
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D(map, vMapUv);
  texRough = mix(1.0, sampledDiffuseColor.a, uPacked);
  diffuseColor.rgb *= sampledDiffuseColor.rgb;
  diffuseColor.a *= mix(sampledDiffuseColor.a, 1.0, uPacked);
#endif
#ifdef USE_NORMALMAP
  texExtra = mix(1.0, texture2D(normalMap, vNormalMapUv).a, uPacked);
#endif
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uPaintColor, texExtra * uPaintOn);
// paint cover: repaint chipped / rusty patches (the texture's base there is rust, not primer)
diffuseColor.rgb = mix(diffuseColor.rgb, uPaintColor * 0.8, (1.0 - texExtra) * uPaintCover * uPaintOn);
vec4 nzA = texture2D(uNoiseTex, vWorldX.xz * 0.045 + vWorldX.y * 0.021);
if (uGrime > 0.0) {
  float g = nzA.r * 0.7 + nzA.g * 0.3;
  diffuseColor.rgb *= 1.0 - uGrime * smoothstep(0.35, 0.8, g);
  // darker band near the ground (splash-back dirt)
  diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(0.0, 0.7 + 0.4 * nzA.b, vWorldX.y));
}
float wet = smoothstep(0.10, 0.42, skyVis) * uWetness * uWetOn;
if (uStreakOn > 0.5) {
  vec4 nzS = texture2D(uNoiseTex, vec2(dot(vWorldX.xz, vec2(0.7071)) * 0.11, vWorldX.y * 0.012));
  // run-off stains: strongest under the roof edge, fading down the wall
  float streak = smoothstep(0.5, 0.75, nzS.a) * mix(0.55, 1.0, smoothstep(1.2, 3.8, vWorldX.y));
  wet = max(wet, streak * 0.8 * uWetness * smoothstep(0.02, 0.15, skyVis));
  diffuseColor.rgb *= 1.0 - 0.42 * streak * smoothstep(0.02, 0.2, skyVis);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.9, 0.95, 0.88), streak * 0.6); // algae tint
}
diffuseColor.rgb *= mix(1.0, 1.0 - 0.55 * uPorosity, wet);
`;

const FRAG_ROUGH = /* glsl */ `
roughnessFactor *= texRough;
roughnessFactor = mix(roughnessFactor, min(roughnessFactor, uWetRough), wet);
`;

// Appended after <lights_fragment_maps>
const FRAG_LIGHTS = /* glsl */ `
#if defined(RE_IndirectDiffuse)
{
  vec3 bIrr = bkStatic + bkGroups.r * uGroupColor[0] + bkGroups.g * uGroupColor[1] + bkGroups.b * uGroupColor[2] + bkGroups.a * uGroupColor[3];
  bIrr *= uLmScale;
  #if defined(BAKE_ATLAS) || defined(BAKE_GROUND)
    // total baked luminance (all lights at full level) normalises the directional term
    float lumSum = dot(bkStatic, vec3(0.2126, 0.7152, 0.0722)) + bkGroups.r + bkGroups.g + bkGroups.b + bkGroups.a;
    if (lumSum > 1e-6) {
      vec3 dw = bkDir.xyz / lumSum;
      vec3 nW = transformNormalByInverseViewMatrix(normal, viewMatrix);
      vec3 gW = transformNormalByInverseViewMatrix(nonPerturbedNormal, viewMatrix);
      float a = dot(nW, dw) + 0.55;
      float b = max(dot(gW, dw) + 0.55, 0.2);
      bIrr *= clamp(a / b, 0.2, 2.5);
    }
  #endif
  vec3 skyIrr = skyVis * uSkyColor;
  irradiance += bIrr + skyIrr;
  dbgIrr = bIrr + skyIrr;
  #if defined(RE_IndirectSpecular)
    float occ = clamp(dot(bIrr + skyIrr, vec3(0.2126, 0.7152, 0.0722)) * uSpecOcc, 0.0, 1.0);
    radiance *= occ;
  #endif
}
#endif
`;

// Specular anti-aliasing (Tokuyoshi & Kaplanyan): widen the GGX lobe where the shading normal
// varies inside a pixel, so wet, normal-mapped and rippled surfaces don't sparkle in motion.
const FRAG_SPECAA = /* glsl */ `
{
  vec3 ndx = dFdx(normal), ndy = dFdy(normal);
  float nvar = 0.25 * (dot(ndx, ndx) + dot(ndy, ndy));
  float ka = min(2.0 * nvar, 0.18);
  float a = roughnessFactor * roughnessFactor;
  roughnessFactor = sqrt(sqrt(min(a * a + ka, 1.0)));
}
`;

const FRAG_FOG = /* glsl */ `
if (uReflPass > 0.5) {
  float Lr = length(vWorldX - uReflCamPos);
  float hc = max(-uReflCamPos.y, 0.01);
  float yo = max(vWorldX.y, 0.0);
  float bseg = Lr * yo / (hc + yo);
  bool inside = vWorldX.x > uStoreMin.x && vWorldX.x < uStoreMax.x && vWorldX.z > uStoreMin.y && vWorldX.z < uStoreMax.y && vWorldX.y < 4.4;
  // only the ground->object part of the bounced path, and only beyond the clear near field
  float seg = max(0.0, min(bseg, Lr - uFogStart));
  float ff = inside ? 0.0 : 1.0 - exp(-uFogDensity * seg);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, ff);
}
`;

let _patchId = 0;

// Patch a three.js material with our features.
//  cfg = { bake: 'atlas'|'ground'|'points'|'inst'|'none'|null, packed, wet, porosity, wetRough, paint, grime, streaks,
//          boxProj: {min,max,pos}, uniforms: {} (extra per-material), extraFrag: {before:..., after:...} }
export function patchMaterial(mat, cfg = {}) {
  const defines = {};
  const U = {
    uTime: G.uTime, uLmScale: G.uLmScale, uGroupColor: G.uGroupColor, uSkyColor: G.uSkyColor, uSpecOcc: G.uSpecOcc,
    uReflPass: G.uReflPass, uReflCamPos: G.uReflCamPos, uFogColor: G.uFogColor, uFogDensity: G.uFogDensity, uFogStart: G.uFogStart,
    uStoreMin: G.uStoreMin, uStoreMax: G.uStoreMax, uDebugView: G.uDebugView,
  };
  const bake = cfg.bake ?? null;
  if (bake === 'atlas') { defines.BAKE_ATLAS = ''; U.uLmS = G.uAtlasS; U.uLmG = G.uAtlasG; U.uLmD = G.uAtlasD; }
  else if (bake === 'ground') { defines.BAKE_GROUND = ''; U.uLmS = G.uGroundS; U.uLmG = G.uGroundG; U.uLmD = G.uGroundD; U.uGrRegion = G.uGrRegion; }
  else if (bake === 'points' || bake === 'inst') {
    defines[bake === 'inst' ? 'BAKE_INST' : 'BAKE_POINTS'] = '';
    U.uPtStatic = G.uPtStatic; U.uPtGroups = G.uPtGroups; U.uPtWidth = G.uPtWidth;
    U.uPtBase = { value: cfg.ptBase ?? 0 };
  } else if (bake === 'none') {
    defines.BAKE_NONE = '';
    U.uProbeStatic = { value: new THREE.Vector3(0.05, 0.05, 0.05) };
    U.uProbeSky = { value: 0.0 };
  }
  U.uWetness = G.uWetness;
  U.uWetOn = { value: cfg.wet ? 1 : 0 };
  U.uPorosity = { value: cfg.porosity ?? 0.5 };
  U.uWetRough = { value: cfg.wetRough ?? 0.2 };
  U.uPaintColor = { value: new THREE.Color(cfg.paint ?? 0xffffff) };
  U.uPaintOn = { value: cfg.paint !== undefined && cfg.paint !== null ? 1 : 0 };
  U.uPaintCover = { value: cfg.paintCover ?? 0 }; // >0 hides chipped/rusty patches
  U.uNoiseTex = G.uNoiseTex;
  U.uGrime = { value: cfg.grime ?? 0 };
  U.uStreakOn = { value: cfg.streaks ? 1 : 0 };
  U.uPacked = { value: cfg.packed ? 1 : 0 };
  U.uBoxOn = { value: cfg.boxProj ? 1 : 0 };
  U.uBoxMin = { value: cfg.boxProj ? cfg.boxProj.min.clone() : new THREE.Vector3() };
  U.uBoxMax = { value: cfg.boxProj ? cfg.boxProj.max.clone() : new THREE.Vector3() };
  U.uProbePos = { value: cfg.boxProj ? cfg.boxProj.pos.clone() : new THREE.Vector3() };
  Object.assign(U, cfg.uniforms ?? {});
  mat.userData.uniforms = U;
  mat.userData.cfg = cfg;
  const key = JSON.stringify({ d: defines, x: cfg.variant ?? '' });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.defines = Object.assign(shader.defines || {}, defines);
    let vs = shader.vertexShader;
    vs = VERT_PRE + (cfg.vertPre ?? '') + vs;
    vs = vs.replace('#include <fog_vertex>', '#include <fog_vertex>\n' + VERT_MAIN + (cfg.vertMain ?? ''));
    if (cfg.afterUvVertex) vs = vs.replace('#include <uv_vertex>', '#include <uv_vertex>\n' + cfg.afterUvVertex);
    let fs = shader.fragmentShader;
    fs = FRAG_PRE + (cfg.fragPre ?? '') + fs;
    fs = fs.replace('#include <map_fragment>', FRAG_MAP + (cfg.afterMap ?? ''));
    fs = fs.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + FRAG_ROUGH + (cfg.afterRough ?? ''));
    fs = fs.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + (cfg.afterNormal ?? '') + (cfg.noSpecAA ? '' : FRAG_SPECAA));
    fs = fs.replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + FRAG_LIGHTS + (cfg.afterLights ?? ''));
    fs = fs.replace('#include <fog_fragment>', FRAG_FOG);
    fs = fs.replace('reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );', 'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );\n reflectVec = boxProject(vWorldX, reflectVec);');
    if (cfg.output) fs = fs.replace('#include <opaque_fragment>', cfg.output);
    fs = fs.replace('#include <tonemapping_fragment>', `#include <tonemapping_fragment>
      if (uDebugView == 1) gl_FragColor = vec4(diffuseColor.rgb, 1.0);
      else if (uDebugView == 2) gl_FragColor = vec4(dbgIrr * 0.25, 1.0);
      else if (uDebugView == 3) gl_FragColor = vec4(normal * 0.5 + 0.5, 1.0);
      else if (uDebugView == 4) gl_FragColor = vec4(vec3(material.roughness), 1.0);
      else if (uDebugView == 5) gl_FragColor = vec4(vec3(skyVis), 1.0);
      else if (uDebugView == 6) gl_FragColor = vec4(texExtra, wet, 0.0, 1.0);
    `);
    if (cfg.noPremul) fs = fs.replace('#include <premultiplied_alpha_fragment>', '');
    if (cfg.beforeMain) fs = fs.replace('void main() {', cfg.beforeMain + '\nvoid main() {');
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => 'cs:' + mat.type + key;
  mat.fog = false;
  return mat;
}

// Basic (unlit/emissive) material with reflection fog support.
export function emissiveMaterial(color, intensity = 1, opts = {}) {
  const c = new THREE.Color(color);
  const m = new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(intensity), side: opts.side ?? THREE.FrontSide, map: opts.map ?? null, transparent: !!opts.transparent, depthWrite: opts.depthWrite ?? true, blending: opts.blending ?? THREE.NormalBlending });
  m.userData.baseColor = c;
  m.userData.baseIntensity = intensity;
  const U = { uReflPass: G.uReflPass, uReflCamPos: G.uReflCamPos, uFogColor: G.uFogColor, uFogDensity: G.uFogDensity, uFogStart: G.uFogStart, uStoreMin: G.uStoreMin, uStoreMax: G.uStoreMax };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = 'varying vec3 vWorldX;\n' + shader.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\n{ vec4 wpx = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n wpx = instanceMatrix * wpx;\n#endif\n wpx = modelMatrix * wpx; vWorldX = wpx.xyz; }');
    shader.fragmentShader = `varying vec3 vWorldX;\nuniform float uReflPass; uniform vec3 uReflCamPos; uniform vec3 uFogColor; uniform float uFogDensity; uniform float uFogStart; uniform vec2 uStoreMin; uniform vec2 uStoreMax;\n` + shader.fragmentShader.replace('#include <fog_fragment>', FRAG_FOG);
  };
  m.customProgramCacheKey = () => 'emis' + (opts.map ? 'm' : '') + (opts.transparent ? 't' : '');
  m.fog = false;
  m.toneMapped = false;
  m.setLevel = (lv) => { m.color.copy(m.userData.baseColor).multiplyScalar(m.userData.baseIntensity * lv); };
  return m;
}

export { NOISE_GLSL };
