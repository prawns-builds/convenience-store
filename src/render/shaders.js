// Post-processing shader sources.
import { NOISE_GLSL } from '../gfx/glsl/noise.js';

// ------------------------------------------------------------------------------- shared
export const DEPTH_UTILS = /* glsl */ `
uniform mat4 uProjInv;
uniform mat4 uViewInv;
vec3 viewPosFromDepth(vec2 uv, float d) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 v = uProjInv * ndc;
  return v.xyz / v.w;
}
`;

// ------------------------------------------------------------------------------- reflection blur
export const DOWNSAMPLE13 = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel; // source texel
varying vec2 vUv;
void main() {
  vec2 t = uTexel;
  vec3 a = texture2D(tSrc, vUv + t * vec2(-2.0, 2.0)).rgb;
  vec3 b = texture2D(tSrc, vUv + t * vec2(0.0, 2.0)).rgb;
  vec3 c = texture2D(tSrc, vUv + t * vec2(2.0, 2.0)).rgb;
  vec3 d = texture2D(tSrc, vUv + t * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture2D(tSrc, vUv).rgb;
  vec3 f = texture2D(tSrc, vUv + t * vec2(2.0, 0.0)).rgb;
  vec3 g = texture2D(tSrc, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture2D(tSrc, vUv + t * vec2(0.0, -2.0)).rgb;
  vec3 i = texture2D(tSrc, vUv + t * vec2(2.0, -2.0)).rgb;
  vec3 j = texture2D(tSrc, vUv + t * vec2(-1.0, 1.0)).rgb;
  vec3 k = texture2D(tSrc, vUv + t * vec2(1.0, 1.0)).rgb;
  vec3 l = texture2D(tSrc, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture2D(tSrc, vUv + t * vec2(1.0, -1.0)).rgb;
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  #ifdef KARIS
    // soften fireflies on first downsample
    col = col / (1.0 + dot(col, vec3(0.2126, 0.7152, 0.0722)) * 0.0) ;
  #endif
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

export const BLUR_DIR = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uDir; // texel-scaled direction
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tSrc, vUv).rgb * 0.2270270270;
  s += texture2D(tSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  s += texture2D(tSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(s, 1.0);
}
`;

// ------------------------------------------------------------------------------- bloom upsample (tent)
export const UPSAMPLE_TENT = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uRadius;
varying vec2 vUv;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv + vec2(-t.x, 0.0)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(t.x, 0.0)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(0.0, -t.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(0.0, t.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(-t.x, -t.y)).rgb;
  s += texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb;
  s += texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb;
  s += texture2D(tSrc, vUv + vec2(t.x, t.y)).rgb;
  gl_FragColor = vec4(s / 16.0, 1.0);
}
`;

// ------------------------------------------------------------------------------- atmosphere (low res)
// Flashlight raymarch with shadows + analytic glow integrals for static lights in fog.
export const VOLUMETRIC = /* glsl */ `
precision highp float;
precision highp sampler2DShadow;
${NOISE_GLSL}
${DEPTH_UTILS}
uniform sampler2D tDepth;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uFrame;
// fog
uniform float uFogDensity;     // exterior base extinction
uniform float uFogHeight;      // height falloff
uniform float uDustDensity;    // interior haze
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
// flashlight
uniform float uFlashOn;
uniform vec3 uFlashPos;
uniform vec3 uFlashDir;
uniform vec3 uFlashColor;
uniform vec2 uFlashCone; // cos outer, cos inner
uniform sampler2DShadow tFlashShadow;
uniform mat4 uFlashShadowMatrix;
uniform sampler2D tNoise;
// glow lights
#define MAX_GLOWS 32
uniform int uGlowCount;
uniform vec4 uGlowPos[MAX_GLOWS];   // xyz, w = 1 exterior / 0 interior
uniform vec4 uGlowCol[MAX_GLOWS];   // rgb power, w = downward bias
varying vec2 vUv;

vec2 boxIntersect(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (bmin - ro) * inv;
  vec3 t1 = (bmax - ro) * inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  float tn = max(max(tmin.x, tmin.y), tmin.z);
  float tf = min(min(tmax.x, tmax.y), tmax.z);
  return vec2(tn, tf);
}
float glowSeg(vec3 q, float b, float h, float t0, float t1) {
  return (atan((t1 - b) / h) - atan((t0 - b) / h)) / h;
}
float fogDensityAt(vec3 p) {
  return uFogDensity * exp(-max(p.y, 0.0) / uFogHeight);
}

void main() {
  float d = texture2D(tDepth, vUv).r;
  vec3 vp = viewPosFromDepth(vUv, d);
  vec3 wp = (uViewInv * vec4(vp, 1.0)).xyz;
  vec3 rd = wp - uCamPos;
  float tMax = length(rd);
  rd /= tMax;
  if (d >= 0.99999) tMax = 400.0;
  vec2 bi = boxIntersect(uCamPos, rd, uBoxMin, uBoxMax);
  bool hitBox = bi.x < bi.y && bi.y > 0.0;
  float tin = max(bi.x, 0.0), tout = min(bi.y, tMax);
  bool camInside = all(greaterThan(uCamPos, uBoxMin)) && all(lessThan(uCamPos, uBoxMax));

  vec3 acc = vec3(0.0);
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy + uFrame * vec2(5.588238, 3.13), vec2(0.06711056, 0.00583715))));

  // --------------------------------------------------- flashlight beam
  if (uFlashOn > 0.5) {
    float tEnd = min(tMax, 32.0);
    const int STEPS = VOL_STEPS;
    float dt = tEnd / float(STEPS);
    float t = dt * ign;
    for (int i = 0; i < STEPS; i++) {
      vec3 p = uCamPos + rd * t;
      vec3 L = p - uFlashPos;
      float dist = length(L);
      vec3 Ld = L / max(dist, 1e-3);
      float c = dot(Ld, uFlashDir);
      if (c > uFlashCone.x) {
        bool inBox = all(greaterThan(p, uBoxMin)) && all(lessThan(p, uBoxMax));
        float dens = inBox ? uDustDensity : fogDensityAt(p);
        // drifting mist / rain sheets
        vec2 nuv = p.xz * 0.11 + vec2(uTime * 0.012, uTime * 0.02) + p.y * 0.05;
        float mist = texture2D(tNoise, nuv).r * 1.4 + texture2D(tNoise, p.xz * 0.37 - uTime * 0.03 + p.y * 0.2).g * 0.6;
        dens *= 0.35 + mist * mist;
        float cone = smoothstep(uFlashCone.x, uFlashCone.y, c);
        // cookie falloff: hot centre + wide spill
        float hot = pow(max((c - uFlashCone.x) / (1.0 - uFlashCone.x), 0.0), 3.0);
        float att = (cone * 0.55 + hot * 1.6) / (dist * dist + 0.25);
        vec4 sc = uFlashShadowMatrix * vec4(p, 1.0);
        sc.xyz /= sc.w;
        float vis = 1.0;
        if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) vis = texture(tFlashShadow, vec3(sc.xy, sc.z - 0.0008));
        // Henyey-Greenstein-ish phase, mostly isotropic with forward lobe
        float cosT = dot(-rd, -Ld);
        float g = 0.35;
        float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5) * 0.08;
        acc += uFlashColor * att * vis * dens * phase * dt;
      }
      t += dt;
    }
  }

  // --------------------------------------------------- static light glows (analytic)
  for (int i = 0; i < MAX_GLOWS; i++) {
    if (i >= uGlowCount) break;
    vec3 lp = uGlowPos[i].xyz;
    bool ext = uGlowPos[i].w > 0.5;
    vec3 q = lp - uCamPos;
    float b = dot(q, rd);
    float h = sqrt(max(dot(q, q) - b * b, 0.0025));
    float total;
    if (ext) {
      total = glowSeg(q, b, h, 0.0, tMax);
      if (hitBox && tout > tin) total -= glowSeg(q, b, h, tin, tout);
    } else {
      total = (hitBox && tout > tin) ? glowSeg(q, b, h, tin, tout) : 0.0;
    }
    total = max(total, 0.0);
    // closest point for density + downward bias (lamps emit downwards)
    vec3 cp = uCamPos + rd * clamp(b, 0.0, tMax);
    float dens = ext ? fogDensityAt(cp) : uDustDensity;
    float down = mix(1.0, smoothstep(-0.6, 0.6, (lp.y - cp.y) / max(length(cp - lp), 0.1)) * 1.6 + 0.15, uGlowCol[i].w);
    float trans = exp(-dens * clamp(b, 0.0, tMax) * 0.7);
    acc += uGlowCol[i].rgb * total * dens * down * trans * 0.08;
  }
  gl_FragColor = vec4(acc, 1.0);
}
`;

// ------------------------------------------------------------------------------- fog composite (full res)
export const COMPOSITE = /* glsl */ `
precision highp float;
${DEPTH_UTILS}
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tVol;
uniform vec2 uVolTexel;
uniform vec3 uCamPos;
uniform float uFogDensity;
uniform float uFogHeight;
uniform float uDustDensity;
uniform vec3 uFogColor;
uniform vec3 uFogColorHigh;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform float uLightning;
varying vec2 vUv;

vec2 boxIntersect(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (bmin - ro) * inv;
  vec3 t1 = (bmax - ro) * inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}
// optical depth of exponential height fog along segment
float heightFogOD(vec3 ro, vec3 rd, float t0, float t1) {
  float y0 = ro.y + rd.y * t0, y1 = ro.y + rd.y * t1;
  float L = t1 - t0;
  float H = uFogHeight;
  float dy = y1 - y0;
  float e0 = exp(-max(y0, 0.0) / H), e1 = exp(-max(y1, 0.0) / H);
  float avg = abs(dy) > 0.01 ? (e0 - e1) * H / dy : e0;
  return uFogDensity * L * max(avg, 0.0);
}
void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  float d = texture2D(tDepth, vUv).r;
  vec3 vp = viewPosFromDepth(vUv, d);
  vec3 wp = (uViewInv * vec4(vp, 1.0)).xyz;
  vec3 rd = wp - uCamPos;
  float tMax = length(rd);
  rd /= tMax;
  bool sky = d >= 0.99999;
  if (sky) tMax = 600.0;
  vec2 bi = boxIntersect(uCamPos, rd, uBoxMin, uBoxMax);
  float tin = clamp(bi.x, 0.0, tMax), tout = clamp(bi.y, 0.0, tMax);
  float od;
  if (bi.x < bi.y && tout > tin) {
    od = heightFogOD(uCamPos, rd, 0.0, tin) + heightFogOD(uCamPos, rd, tout, tMax) + uDustDensity * (tout - tin);
  } else {
    od = heightFogOD(uCamPos, rd, 0.0, tMax);
  }
  if (sky) od = max(od, 0.0) * 0.9;
  float T = exp(-od);
  vec3 fogCol = mix(uFogColor, uFogColorHigh, clamp(rd.y * 2.5 + 0.2, 0.0, 1.0));
  fogCol *= 1.0 + uLightning * 6.0;
  col = col * T + fogCol * (1.0 - T);

  // depth-aware upsample of volumetric buffer
  vec3 vol = vec3(0.0);
  float wsum = 0.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y)) * uVolTexel;
    float w = (x == 0 && y == 0) ? 2.0 : 1.0;
    vol += texture2D(tVol, vUv + o).rgb * w;
    wsum += w;
  }
  col += vol / wsum;
  gl_FragColor = vec4(col, 1.0);
}
`;

// ------------------------------------------------------------------------------- auto exposure
export const EXPOSURE = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;      // small bloom mip
uniform sampler2D tPrev;     // previous exposure (1x1)
uniform float uDt;
uniform float uKey;
uniform vec2 uRange;         // min, max exposure
uniform float uSpeedUp;
uniform float uSpeedDown;
uniform float uReset;
varying vec2 vUv;
void main() {
  float sum = 0.0, wsum = 0.0;
  for (int y = 0; y < 12; y++)
  for (int x = 0; x < 16; x++) {
    vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(16.0, 12.0);
    vec3 c = texture2D(tSrc, uv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec2 cc = uv - 0.5;
    float w = exp(-dot(cc, cc) * 5.0);
    sum += log(max(l, 1e-5)) * w;
    wsum += w;
  }
  float avg = exp(sum / wsum);
  float target = clamp(uKey / max(avg, 1e-5), uRange.x, uRange.y);
  float prev = texture2D(tPrev, vec2(0.5)).r;
  if (uReset > 0.5 || prev <= 0.0) prev = target;
  float speed = target > prev ? uSpeedUp : uSpeedDown;
  float e = prev + (target - prev) * (1.0 - exp(-uDt * speed));
  gl_FragColor = vec4(e, avg, target, 1.0);
}
`;

// ------------------------------------------------------------------------------- final bodycam pass
export const FINAL = /* glsl */ `
precision highp float;
${DEPTH_UTILS}
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform sampler2D tExposure;
uniform sampler2D tDepth;
uniform vec2 uResolution;
uniform float uTime;
uniform float uFrame;
uniform float uBloomStrength;
uniform float uDistortion;
uniform float uCA;
uniform float uVignette;
uniform float uGrain;
uniform float uExposureBias;
uniform float uSaturation;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uMotionBlur;
uniform mat4 uPrevViewProj;
uniform mat4 uViewProj;
uniform float uFlash;      // white flash (lightning overexposure)
uniform float uGlitch;     // signal glitch strength
uniform float uFade;       // fade to black
varying vec2 vUv;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

// AgX-style tone mapping (minimal fit)
vec3 agxDefaultContrastApprox(vec3 x) {
  vec3 x2 = x * x; vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 val) {
  const mat3 agx_mat = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                            0.0784335999999992, 0.878468636469772, 0.0784336,
                            0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const float min_ev = -12.47393; const float max_ev = 4.026069;
  val = agx_mat * val;
  val = clamp(log2(max(val, 1e-10)), min_ev, max_ev);
  val = (val - min_ev) / (max_ev - min_ev);
  return agxDefaultContrastApprox(val);
}
vec3 agxEotf(vec3 val) {
  const mat3 agx_mat_inv = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                                -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                                -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  val = agx_mat_inv * val;
  return pow(max(val, 0.0), vec3(2.2));
}
vec3 linearToSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

vec2 distort(vec2 uv, float k) {
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = (uv - 0.5) * aspect;
  float rmax2 = dot(0.5 * aspect, 0.5 * aspect);
  float r2 = dot(p, p) / rmax2;
  p *= (1.0 + k * r2) / (1.0 + k);
  return p / aspect + 0.5;
}

vec3 sampleScene(vec2 uv) {
  vec3 c = texture2D(tColor, uv).rgb;
  vec3 b = texture2D(tBloom, uv).rgb;
  return mix(c, b, uBloomStrength) + b * uBloomStrength * 0.35;
}

void main() {
  vec2 uv = vUv;
  // signal glitch: horizontal tearing
  if (uGlitch > 0.0) {
    float line = floor(uv.y * 90.0 + floor(uTime * 24.0) * 7.0);
    float g = step(1.0 - uGlitch * 0.35, hash12(vec2(line, floor(uTime * 30.0))));
    uv.x += g * (hash12(vec2(line * 3.1, uTime)) - 0.5) * 0.08 * uGlitch;
  }
  float k = uDistortion;
  vec2 uvG = distort(uv, k);
  vec2 uvR = distort(uv, k * (1.0 + uCA));
  vec2 uvB = distort(uv, k * (1.0 - uCA));
  vec3 col;
  col.r = sampleScene(uvR).r;
  col.g = sampleScene(uvG).g;
  col.b = sampleScene(uvB).b;

  // camera motion blur via depth reprojection
  if (uMotionBlur > 0.0) {
    float d = texture2D(tDepth, uvG).r;
    vec3 vp = viewPosFromDepth(uvG, d);
    vec4 wp = uViewInv * vec4(vp, 1.0);
    if (d >= 0.99999) wp = uViewInv * vec4(normalize(vp) * 500.0, 1.0);
    vec4 prev = uPrevViewProj * wp;
    vec2 puv = prev.xy / prev.w * 0.5 + 0.5;
    vec2 vel = (uvG - puv) * uMotionBlur;
    float vl = length(vel * uResolution);
    if (vl > 1.5) {
      vel *= min(1.0, 40.0 / vl);
      vec3 acc = col;
      float n = 1.0;
      for (int i = 1; i < 8; i++) {
        float t = float(i) / 7.0 - 0.5;
        acc += sampleScene(uvG + vel * t);
        n += 1.0;
      }
      col = acc / n;
    }
  }

  float exposure = texture2D(tExposure, vec2(0.5)).r * uExposureBias;
  col *= exposure;
  col += uFlash;

  // tone map
  col = agxEotf(agx(col));

  // grade: lift / gain, saturation, split tone (teal shadows, warm highlights)
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation);
  vec3 shadowsTint = vec3(0.92, 1.0, 1.04);
  vec3 highTint = vec3(1.05, 1.0, 0.92);
  col *= mix(shadowsTint, highTint, smoothstep(0.05, 0.6, l));
  col = col * uGain + uLift * (1.0 - col);

  // vignette (bodycam lens falloff, aspect aware)
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 vc = (vUv - 0.5) * aspect / (0.5 * aspect.x);
  float vr = dot(vc, vc);
  float vig = 1.0 - uVignette * smoothstep(0.25, 1.35, vr);
  vig *= 1.0 - 0.85 * smoothstep(0.95, 1.6, vr);
  col *= vig;

  // sensor noise: stronger in shadows, slightly chromatic
  float n1 = hash12(gl_FragCoord.xy + fract(uTime * 13.17) * 517.0) - 0.5;
  float n2 = hash12(gl_FragCoord.xy * 1.37 + fract(uTime * 7.31) * 291.0) - 0.5;
  float shadowAmt = 1.0 - smoothstep(0.0, 0.45, l);
  col += (vec3(n1) + vec3(n2, -n2, n2) * 0.35) * uGrain * (0.35 + shadowAmt);
  col *= 1.0 - uFade;

  vec3 outc = linearToSrgb(clamp(col, 0.0, 1.0));
  outc += (hash12(gl_FragCoord.xy + 0.5) - 0.5) / 255.0;
  gl_FragColor = vec4(outc, 1.0);
}
`;
