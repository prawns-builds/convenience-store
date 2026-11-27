// Shared GLSL noise / hashing library.
// All "p*" functions are periodic (tileable) given an integer period, used by the texture generator.

export const NOISE_GLSL = /* glsl */ `
float hash11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash32(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }

// ---------- periodic value noise ----------
float pvnoise(vec2 p, vec2 per) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(mod(i, per));
  float b = hash12(mod(i + vec2(1.0, 0.0), per));
  float c = hash12(mod(i + vec2(0.0, 1.0), per));
  float d = hash12(mod(i + vec2(1.0, 1.0), per));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// ---------- periodic gradient noise, ~[-1,1] ----------
vec2 pgrad(vec2 i, vec2 per) {
  float h = hash12(mod(i, per)) * 6.2831853;
  return vec2(cos(h), sin(h));
}
float pgnoise(vec2 p, vec2 per) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(pgrad(i, per), f);
  float b = dot(pgrad(i + vec2(1.0, 0.0), per), f - vec2(1.0, 0.0));
  float c = dot(pgrad(i + vec2(0.0, 1.0), per), f - vec2(0.0, 1.0));
  float d = dot(pgrad(i + vec2(1.0, 1.0), per), f - vec2(1.0, 1.0));
  return 1.41 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float pfbm(vec2 p, vec2 per, int oct, float gain) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 9; i++) {
    if (i >= oct) break;
    s += a * pgnoise(p, per); n += a;
    p *= 2.0; per *= 2.0; a *= gain;
  }
  return s / n;
}
float pridged(vec2 p, vec2 per, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    float v = 1.0 - abs(pgnoise(p, per));
    s += a * v * v; n += a;
    p *= 2.0; per *= 2.0; a *= 0.5;
  }
  return s / n;
}
// periodic voronoi: x = F1, y = F2, z = cell hash
vec3 pvoronoi(vec2 p, vec2 per, float jitter) {
  vec2 i = floor(p); vec2 f = fract(p);
  float f1 = 8.0, f2 = 8.0; float id = 0.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 cell = mod(i + g, per);
    vec2 o = hash22(cell) * jitter + 0.5 * (1.0 - jitter);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = hash12(cell + 17.3); }
    else if (d < f2) { f2 = d; }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}
// voronoi edge distance (accurate), returns (edgeDist, cellId)
vec2 pvoronoiEdge(vec2 p, vec2 per, float jitter) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 mg, mr; float md = 8.0; float id = 0.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 cell = mod(i + g, per);
    vec2 o = hash22(cell) * jitter + 0.5 * (1.0 - jitter);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; id = hash12(cell + 17.3); }
  }
  md = 8.0;
  for (int y = -2; y <= 2; y++)
  for (int x = -2; x <= 2; x++) {
    vec2 g = mg + vec2(float(x), float(y));
    vec2 cell = mod(i + g, per);
    vec2 o = hash22(cell) * jitter + 0.5 * (1.0 - jitter);
    vec2 r = g + o - f;
    if (dot(mr - r, mr - r) > 0.00001)
      md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return vec2(md, id);
}

// ---------- non-periodic 2D/3D noise for runtime shaders ----------
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1, 0, 0)), n010 = hash13(i + vec3(0, 1, 0)), n110 = hash13(i + vec3(1, 1, 0));
  float n001 = hash13(i + vec3(0, 0, 1)), n101 = hash13(i + vec3(1, 0, 1)), n011 = hash13(i + vec3(0, 1, 1)), n111 = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
`;

export const COMMON_GLSL = /* glsl */ `
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 srgbToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 linearToSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float sat(float x) { return clamp(x, 0.0, 1.0); }
float remap(float x, float a, float b) { return clamp((x - a) / (b - a), 0.0, 1.0); }
`;
