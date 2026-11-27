// Procedural PBR surface definitions (GLSL) for TextureGen.
// Each defines heightFn(uv) and surface(uv, albedo, rough, extra). Albedo is linear.

// ---------------------------------------------------------------- ASPHALT (tile = 2 m)
export const ASPHALT = {
  name: 'asphalt',
  normalStrength: 6.0,
  glsl: /* glsl */ `
  float crackMask(vec2 uv, out float seal) {
    vec2 w = uv + 0.05 * vec2(pfbm(uv * 5.0, vec2(5.0), 4, 0.5), pfbm(uv * 5.0 + 7.3, vec2(5.0), 4, 0.5));
    vec2 e = pvoronoiEdge(w * 3.0, vec2(3.0), 1.0);
    float keep = smoothstep(0.1, 0.35, pfbm(uv * 3.0 + 2.1, vec2(3.0), 3, 0.5));
    float width = 0.006 + 0.01 * pvnoise(uv * 40.0, vec2(40.0));
    float c = (1.0 - smoothstep(width * 0.4, width, e.x)) * keep;
    // fine alligator cracking patches
    vec2 w2 = uv + 0.01 * vec2(pfbm(uv * 30.0, vec2(30.0), 3, 0.5), pfbm(uv * 30.0 + 3.1, vec2(30.0), 3, 0.5));
    vec2 e2 = pvoronoiEdge(w2 * 18.0, vec2(18.0), 0.9);
    float patchM = smoothstep(0.25, 0.45, pfbm(uv * 2.0 + 9.7, vec2(2.0), 3, 0.5));
    c = max(c, (1.0 - smoothstep(0.015, 0.04, e2.x)) * patchM * 0.8);
    // sealant: thick tar band along main crack network
    seal = (1.0 - smoothstep(0.03, 0.05, e.x)) * smoothstep(0.35, 0.55, pfbm(uv * 2.0 + 4.4, vec2(2.0), 2, 0.5) + 0.5) ;
    return c;
  }
  float stones(vec2 uv, out float sid) {
    vec3 v = pvoronoi(uv * 150.0, vec2(150.0), 0.95);
    sid = v.z;
    float s = smoothstep(0.48, 0.28, v.x) * step(0.25, v.z);
    vec3 v2 = pvoronoi(uv * 380.0 + 0.5, vec2(380.0), 0.95);
    s = max(s, smoothstep(0.45, 0.25, v2.x) * step(0.55, v2.z) * 0.7);
    return s;
  }
  float heightFn(vec2 uv) {
    float sid; float s = stones(uv, sid);
    float seal; float c = crackMask(uv, seal);
    float large = pfbm(uv * 3.0, vec2(3.0), 5, 0.55);
    float fine = pvnoise(uv * 700.0, vec2(700.0));
    float h = 0.45 + large * 0.35 + s * (0.18 + 0.1 * sid) + fine * 0.04;
    h = mix(h, 0.5 + large * 0.3 + 0.02, seal * 0.9);
    h -= c * 0.35 * (1.0 - seal);
    return h;
  }
  void surface(vec2 uv, out vec3 albedo, out float rough, out float extra) {
    float sid; float s = stones(uv, sid);
    float seal; float c = crackMask(uv, seal);
    float large = pfbm(uv * 3.0, vec2(3.0), 5, 0.55);
    float wear = smoothstep(-0.2, 0.5, pfbm(uv * 1.5 + 3.3, vec2(1.5), 4, 0.5));
    vec3 binder = vec3(0.032, 0.031, 0.030) * (0.85 + 0.3 * pvnoise(uv * 90.0, vec2(90.0)));
    vec3 stoneCol = mix(vec3(0.10, 0.098, 0.094), vec3(0.24, 0.22, 0.20), sid);
    stoneCol = mix(stoneCol, vec3(0.20, 0.13, 0.09), step(0.85, sid) * 0.7);
    albedo = mix(binder, stoneCol, s * (0.35 + 0.65 * wear));
    albedo *= 0.85 + 0.3 * (large * 0.5 + 0.5);
    // oil / tire stains
    float oil = smoothstep(0.25, 0.55, pfbm(uv * 2.0 + 11.1, vec2(2.0), 4, 0.55));
    albedo *= 1.0 - 0.45 * oil;
    albedo = mix(albedo, vec3(0.018), seal * 0.92);
    albedo *= 1.0 - c * 0.6 * (1.0 - seal);
    rough = mix(0.86, 0.7, s * wear);
    rough = mix(rough, 0.45, oil * 0.6);
    rough = mix(rough, 0.32, seal);
    extra = heightFn(uv);
  }
  `,
};

// ---------------------------------------------------------------- CONCRETE (tile = 4 m)
export const CONCRETE = {
  name: 'concrete',
  normalStrength: 3.0,
  glsl: /* glsl */ `
  float pores(vec2 uv) {
    vec3 v = pvoronoi(uv * 260.0, vec2(260.0), 1.0);
    return smoothstep(0.22, 0.08, v.x) * step(0.72, v.z);
  }
  float cracks(vec2 uv) {
    vec2 w = uv + 0.04 * vec2(pfbm(uv * 6.0, vec2(6.0), 4, 0.5), pfbm(uv * 6.0 + 3.0, vec2(6.0), 4, 0.5));
    vec2 e = pvoronoiEdge(w * 2.0, vec2(2.0), 1.0);
    float keep = smoothstep(0.15, 0.4, pfbm(uv * 2.0 + 5.0, vec2(2.0), 3, 0.5));
    return (1.0 - smoothstep(0.002, 0.006, e.x)) * keep;
  }
  float heightFn(vec2 uv) {
    float h = 0.5 + 0.25 * pfbm(uv * 4.0, vec2(4.0), 6, 0.55);
    h += 0.06 * pvnoise(uv * 600.0, vec2(600.0));
    h -= 0.25 * pores(uv);
    h -= 0.3 * cracks(uv);
    return h;
  }
  void surface(vec2 uv, out vec3 albedo, out float rough, out float extra) {
    float blot = pfbm(uv * 3.0, vec2(3.0), 5, 0.55);
    float mid = pfbm(uv * 14.0, vec2(14.0), 4, 0.5);
    vec3 v = pvoronoi(uv * 520.0, vec2(520.0), 1.0);
    float speck = (v.z - 0.5) * smoothstep(0.5, 0.2, v.x);
    vec3 base = vec3(0.30, 0.295, 0.28);
    albedo = base * (1.0 + 0.28 * blot + 0.1 * mid + 0.18 * speck);
    // grime patches
    float grime = smoothstep(0.1, 0.5, pfbm(uv * 2.0 + 13.0, vec2(2.0), 5, 0.6));
    albedo = mix(albedo, albedo * vec3(0.55, 0.53, 0.5), grime * 0.7);
    // rust stain
    float rust = smoothstep(0.42, 0.62, pfbm(uv * 2.0 + 31.0, vec2(2.0), 5, 0.6));
    albedo = mix(albedo, vec3(0.22, 0.13, 0.07), rust * 0.45);
    albedo *= 1.0 - 0.55 * pores(uv);
    albedo *= 1.0 - 0.6 * cracks(uv);
    rough = 0.88 + 0.08 * mid - 0.1 * grime;
    extra = heightFn(uv);
  }
  `,
};

// ---------------------------------------------------------------- EXTERIOR STUCCO / PAINTED BLOCK (tile = 3.2 m)
export const STUCCO = {
  name: 'stucco',
  normalStrength: 4.0,
  glsl: /* glsl */ `
  // running-bond block joints: blocks 0.4 x 0.2 m -> 8 x 16 per tile
  float joints(vec2 uv) {
    vec2 g = uv * vec2(8.0, 16.0);
    float row = floor(g.y);
    g.x += mod(row, 2.0) * 0.5;
    vec2 f = fract(g);
    float jx = min(f.x, 1.0 - f.x) * 0.4;
    float jy = min(f.y, 1.0 - f.y) * 0.2;
    float d = min(jx, jy);
    return 1.0 - smoothstep(0.002, 0.006, d);
  }
  float peel(vec2 uv) {
    float n = pfbm(uv * 3.0 + 1.7, vec2(3.0), 6, 0.6);
    return smoothstep(0.28, 0.33, n);
  }
  float heightFn(vec2 uv) {
    float h = 0.5 + 0.12 * pfbm(uv * 40.0, vec2(40.0), 4, 0.5);
    h += 0.05 * pvnoise(uv * 400.0, vec2(400.0));
    h -= 0.05 * joints(uv);
    h -= 0.08 * peel(uv);
    return h;
  }
  void surface(vec2 uv, out vec3 albedo, out float rough, out float extra) {
    float p = peel(uv);
    float mottle = pfbm(uv * 5.0, vec2(5.0), 6, 0.6);
    float mold = smoothstep(0.15, 0.6, pfbm(uv * 9.0 + 4.0, vec2(9.0), 5, 0.6)) * smoothstep(-0.1, 0.4, pfbm(uv * 2.0 + 8.0, vec2(2.0), 3, 0.5));
    vec3 paint = vec3(0.62, 0.60, 0.55) * (0.88 + 0.24 * mottle);
    paint = mix(paint, paint * vec3(0.52, 0.56, 0.47), mold * 0.85);
    // water marks: large soft blotches with darker tide lines
    float wm = pfbm(uv * 2.0 + 3.3, vec2(2.0), 5, 0.55);
    float blot = smoothstep(0.05, 0.3, wm);
    float tide = smoothstep(0.03, 0.0, abs(wm - 0.05)) * 0.6;
    paint *= 1.0 - 0.22 * blot - 0.18 * tide;
    vec3 under = vec3(0.30, 0.30, 0.29) * (0.9 + 0.2 * pvnoise(uv * 200.0, vec2(200.0)));
    albedo = mix(paint, under, p);
    albedo *= 1.0 - 0.1 * joints(uv);
    float dots = smoothstep(0.75, 0.95, pvnoise(uv * 150.0, vec2(150.0)));
    albedo *= 1.0 - 0.3 * dots * mold;
    rough = mix(0.9, 0.95, p);
    extra = 1.0 - p; // paint mask
  }
  `,
};

// ---------------------------------------------------------------- INTERIOR PAINTED WALL (tile = 2.5 m)
export const PLASTER = {
  name: 'plaster',
  normalStrength: 1.5,
  glsl: /* glsl */ `
  float heightFn(vec2 uv) {
    return 0.5 + 0.08 * pfbm(uv * 60.0, vec2(60.0), 3, 0.5) + 0.03 * pvnoise(uv * 500.0, vec2(500.0));
  }
  void surface(vec2 uv, out vec3 albedo, out float rough, out float extra) {
    float m = pfbm(uv * 4.0, vec2(4.0), 5, 0.55);
    float smudge = smoothstep(0.3, 0.7, pfbm(uv * 6.0 + 3.0, vec2(6.0), 5, 0.6));
    albedo = vec3(0.70) * (0.95 + 0.08 * m);
    albedo *= 1.0 - 0.18 * smudge;
    float scuff = smoothstep(0.6, 0.9, pfbm(uv * vec2(30.0, 6.0) + 1.0, vec2(30.0, 6.0), 4, 0.5));
    albedo *= 1.0 - 0.25 * scuff;
    rough = 0.8 - 0.1 * smudge;
    extra = 1.0;
  }
  `,
};

// ---------------------------------------------------------------- VCT FLOOR TILES (tile = 1.2192 m = 4 x 4 tiles)
export const VCT = {
  name: 'vct',
  normalStrength: 2.0,
  glsl: /* glsl */ `
  float seams(vec2 uv) {
    vec2 f = fract(uv * 4.0);
    float d = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    return 1.0 - smoothstep(0.003, 0.009, d);
  }
  float heightFn(vec2 uv) {
    float h = 0.5 + 0.03 * pfbm(uv * 30.0, vec2(30.0), 3, 0.5);
    h -= 0.25 * seams(uv);
    return h;
  }
  void surface(vec2 uv, out vec3 albedo, out float rough, out float extra) {
    vec2 id = floor(uv * 4.0);
    float checker = mod(id.x + id.y, 2.0);
    float lot = hash12(id + 3.7);
    vec3 cream = vec3(0.66, 0.64, 0.57);
    vec3 dark  = vec3(0.24, 0.27, 0.26);
    vec3 base = mix(cream, dark, checker) * (0.95 + 0.1 * lot);
    // vinyl flecks
    vec3 v = pvoronoi(uv * 160.0, vec2(160.0), 1.0);
    float fleck = smoothstep(0.35, 0.15, v.x) * step(0.7, v.z);
    vec3 fleckCol = mix(vec3(0.18, 0.18, 0.17), vec3(0.85, 0.83, 0.78), step(0.85, v.z));
    base = mix(base, mix(fleckCol, base, 0.35), fleck);
    // directional streaks within the tile (VCT has marbled streaks)
    float streak = pfbm(vec2(uv.x * 60.0, uv.y * 8.0) + lot * 10.0, vec2(60.0, 8.0), 4, 0.5);
    base *= 1.0 + 0.08 * streak;
    // scuffs and dirt
    float scuff = smoothstep(0.55, 0.85, pfbm(uv * vec2(14.0, 4.0) + 2.0, vec2(14.0, 4.0), 5, 0.55));
    float dirt = smoothstep(-0.1, 0.6, pfbm(uv * 2.0 + 5.0, vec2(2.0), 5, 0.55));
    albedo = base * (1.0 - 0.35 * scuff) * (1.0 - 0.25 * dirt);
    albedo *= 1.0 - 0.6 * seams(uv);
    rough = 0.3 + 0.25 * dirt + 0.25 * scuff + 0.4 * seams(uv);
    extra = checker;
  }
  `,
};

// ---------------------------------------------------------------- ACOUSTIC CEILING TILE (tile = 1.2192 m = 2 x 2 tiles)
export const CEILING = {
  name: 'ceiling',
  normalStrength: 2.5,
  glsl: /* glsl */ `
  // one texture repeat = 8 x 8 drop-ceiling tiles (4.88 m), so stains and ageing don't repeat
  // in an obvious 2x2 pattern
  const float NT = 8.0;
  float grid(vec2 uv) {
    vec2 f = fract(uv * NT);
    float d = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    return 1.0 - smoothstep(0.016, 0.02, d);
  }
  float bevel(vec2 uv) {
    vec2 f = fract(uv * NT);
    float d = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    return smoothstep(0.02, 0.045, d);
  }
  float fissure(vec2 uv) {
    float n = pridged(uv * 104.0, vec2(104.0), 3);
    float holes = smoothstep(0.82, 0.92, pvnoise(uv * 520.0, vec2(520.0)));
    return max(smoothstep(0.86, 0.95, n), holes);
  }
  float heightFn(vec2 uv) {
    float g = grid(uv);
    float h = mix(0.3 + 0.2 * bevel(uv) - 0.25 * fissure(uv) + 0.04 * pvnoise(uv * 800.0, vec2(800.0)), 0.6, g);
    return h;
  }
  void surface(vec2 uv, out vec3 albedo, out float rough, out float extra) {
    float g = grid(uv);
    vec2 id = floor(uv * NT);
    float age = hash12(id + 1.3);
    vec3 tile = vec3(0.72, 0.71, 0.66) * (0.88 + 0.12 * age);
    // a few tiles yellowed by smoke / age
    tile *= mix(vec3(1.0), vec3(0.96, 0.92, 0.82), step(0.82, hash12(id + 4.7)));
    tile *= 1.0 - 0.45 * fissure(uv);
    float sag = pfbm(uv * 16.0, vec2(16.0), 4, 0.5);
    tile *= 0.94 + 0.06 * sag;
    // irregular water stains on a few tiles: tide-line rings, size and shape vary per tile
    vec2 f = fract(uv * NT) - 0.5;
    float stainSeed = hash12(id + 9.1);
    float size = 0.16 + 0.2 * hash12(id + 3.3);
    float wob = pfbm(uv * 48.0 + id * 0.37, vec2(48.0), 4, 0.55);
    float r = length((f + (hash22(id) - 0.5) * 0.35) * vec2(1.0, 0.8 + 0.4 * hash12(id + 2.2))) + 0.09 * wob;
    float inside = smoothstep(size + 0.02, size - 0.02, r);
    float ring = smoothstep(0.045, 0.0, abs(r - size));
    float stain = (inside * 0.45 + ring * 0.8) * step(0.86, stainSeed);
    tile = mix(tile, tile * vec3(0.74, 0.62, 0.45), stain);
    vec3 bar = vec3(0.78, 0.78, 0.76);
    albedo = mix(tile, bar, g);
    rough = mix(0.95, 0.45, g);
    extra = g;
  }
  `,
};

// ---------------------------------------------------------------- PAINTED METAL WITH RUST (tile = 1 m)
export const METAL = {
  name: 'metal',
  normalStrength: 3.0,
  glsl: /* glsl */ `
  float paintMask(vec2 uv) {
    float n = pfbm(uv * 4.0, vec2(4.0), 6, 0.62);
    float chips = pfbm(uv * 22.0 + 3.0, vec2(22.0), 4, 0.6);
    float m = smoothstep(0.27, 0.31, n + 0.12 * chips);
    return 1.0 - m;
  }
  float heightFn(vec2 uv) {
    float p = paintMask(uv);
    float rustRough = pfbm(uv * 80.0, vec2(80.0), 3, 0.5);
    return 0.5 + p * 0.08 + (1.0 - p) * 0.05 * rustRough + 0.01 * pvnoise(uv * 300.0, vec2(300.0));
  }
  void surface(vec2 uv, out vec3 albedo, out float rough, out float extra) {
    float p = paintMask(uv);
    float rn = pfbm(uv * 30.0, vec2(30.0), 4, 0.55);
    vec3 rust = mix(vec3(0.07, 0.035, 0.02), vec3(0.22, 0.10, 0.04), rn * 0.5 + 0.5);
    float scratches = smoothstep(0.92, 0.98, pridged(uv * vec2(60.0, 4.0), vec2(60.0, 4.0), 2));
    float grime = smoothstep(0.0, 0.7, pfbm(uv * 3.0 + 7.0, vec2(3.0), 5, 0.6));
    vec3 paint = vec3(0.86) * (1.0 - 0.32 * grime);
    // rust bleeding into paint near chips
    float bleed = smoothstep(0.15, 0.29, pfbm(uv * 4.0, vec2(4.0), 6, 0.62) + 0.12 * pfbm(uv * 22.0 + 3.0, vec2(22.0), 4, 0.6));
    paint = mix(paint, paint * vec3(0.75, 0.6, 0.45), bleed * 0.6);
    albedo = mix(rust, paint, p);
    albedo = mix(albedo, vec3(0.45), scratches * p * 0.5);
    rough = mix(0.88, 0.5 + 0.2 * grime, p);
    extra = p;
  }
  `,
};

// ---------------------------------------------------------------- WEATHERED WOOD (tile = 1.6 m, grain along U)
export const WOOD = {
  name: 'wood',
  normalStrength: 4.0,
  glsl: /* glsl */ `
  float grain(vec2 uv) {
    vec2 q = vec2(uv.x * 3.0, uv.y * 48.0);
    q.y += 1.5 * pfbm(vec2(uv.x * 6.0, uv.y * 6.0), vec2(6.0), 4, 0.5);
    float g = pfbm(q, vec2(3.0, 48.0), 5, 0.6);
    return g;
  }
  float heightFn(vec2 uv) {
    float g = grain(uv);
    float crack = smoothstep(0.85, 0.97, pridged(vec2(uv.x * 4.0, uv.y * 30.0), vec2(4.0, 30.0), 3));
    return 0.5 + 0.15 * g - 0.3 * crack;
  }
  void surface(vec2 uv, out vec3 albedo, out float rough, out float extra) {
    float g = grain(uv);
    float crack = smoothstep(0.85, 0.97, pridged(vec2(uv.x * 4.0, uv.y * 30.0), vec2(4.0, 30.0), 3));
    vec3 a = vec3(0.32, 0.30, 0.26);
    vec3 b = vec3(0.17, 0.155, 0.13);
    albedo = mix(a, b, smoothstep(-0.3, 0.5, g));
    float lichen = smoothstep(0.35, 0.65, pfbm(uv * 5.0 + 2.0, vec2(5.0), 5, 0.6));
    albedo = mix(albedo, vec3(0.20, 0.23, 0.17), lichen * 0.5);
    albedo *= 1.0 - 0.6 * crack;
    rough = 0.82 + 0.1 * g;
    extra = 1.0;
  }
  `,
};

// ---------------------------------------------------------------- GRASS / DIRT FIELD (tile = 6 m)
export const GROUNDCOVER = {
  name: 'groundcover',
  normalStrength: 5.0,
  glsl: /* glsl */ `
  float blades(vec2 uv) {
    vec2 q = uv * vec2(260.0, 260.0);
    float n = pvnoise(q * vec2(1.0, 0.25), vec2(260.0, 65.0));
    float n2 = pvnoise(q * vec2(0.25, 1.0) + 7.0, vec2(65.0, 260.0));
    return max(n, n2);
  }
  float dirtMask(vec2 uv) {
    return smoothstep(0.05, 0.35, pfbm(uv * 3.0 + 1.0, vec2(3.0), 6, 0.6));
  }
  float heightFn(vec2 uv) {
    float d = dirtMask(uv);
    float b = blades(uv);
    return 0.5 + mix(0.3 * b, 0.05 * pvnoise(uv * 400.0, vec2(400.0)), d) + 0.1 * pfbm(uv * 12.0, vec2(12.0), 4, 0.5);
  }
  void surface(vec2 uv, out vec3 albedo, out float rough, out float extra) {
    float d = dirtMask(uv);
    float b = blades(uv);
    float hue = pfbm(uv * 5.0 + 3.0, vec2(5.0), 4, 0.5);
    vec3 grass = mix(vec3(0.045, 0.06, 0.025), vec3(0.11, 0.11, 0.05), b);
    grass = mix(grass, vec3(0.12, 0.10, 0.06), smoothstep(0.0, 0.6, hue) * 0.6); // dry patches
    vec3 dirt = vec3(0.09, 0.075, 0.055) * (0.85 + 0.3 * pvnoise(uv * 200.0, vec2(200.0)));
    albedo = mix(grass, dirt, d);
    rough = mix(0.85, 0.75, d);
    extra = d;
  }
  `,
};

// ---------------------------------------------------------------- utility noise (RGBA, tile)
export const NOISE_RAW = /* glsl */ `
vec4 raw(vec2 uv) {
  float r = pfbm(uv * 4.0, vec2(4.0), 6, 0.55) * 0.5 + 0.5;
  float g = pfbm(uv * 16.0 + 3.0, vec2(16.0), 5, 0.55) * 0.5 + 0.5;
  float b = pvnoise(uv * 64.0, vec2(64.0));
  // vertical streaks: stretched noise (A)
  float a = pfbm(vec2(uv.x * 48.0, uv.y * 3.0) + 9.0, vec2(48.0, 3.0), 5, 0.6) * 0.5 + 0.5;
  return vec4(r, g, b, a);
}
`;

// ---------------------------------------------------------------- storm clouds (R: density, G: detail)
export const CLOUDS_RAW = /* glsl */ `
vec4 raw(vec2 uv) {
  vec2 q = vec2(pfbm(uv * 3.0, vec2(3.0), 5, 0.5), pfbm(uv * 3.0 + 5.2, vec2(3.0), 5, 0.5));
  float d = pfbm(uv * 4.0 + q * 0.9, vec2(4.0), 7, 0.55);
  float det = pfbm(uv * 16.0 + q * 2.0, vec2(16.0), 5, 0.5);
  return vec4(d * 0.5 + 0.5, det * 0.5 + 0.5, pridged(uv * 6.0 + q, vec2(6.0), 5), 1.0);
}
`;

// ---------------------------------------------------------------- foliage cluster card (alpha-tested leaves)
export const LEAVES_RAW = /* glsl */ `
vec4 raw(vec2 uv) {
  vec2 c = uv - 0.5;
  float r = length(c * vec2(1.0, 1.35));
  float blob = smoothstep(0.5, 0.25, r + 0.18 * pfbm(uv * 4.0, vec2(4.0), 4, 0.5));
  vec3 v = pvoronoi(uv * 26.0, vec2(26.0), 1.0);
  float leaf = smoothstep(0.55, 0.25, v.x);
  float a = blob * leaf;
  a = step(0.35, a + 0.25 * (pvnoise(uv * 90.0, vec2(90.0)) - 0.5));
  float shade = 0.55 + 0.45 * (v.z) ;
  shade *= 0.6 + 0.4 * smoothstep(0.5, 0.0, r);
  vec3 col = mix(vec3(0.05, 0.075, 0.03), vec3(0.11, 0.13, 0.05), shade);
  return vec4(col, a);
}
`;

// ---------------------------------------------------------------- grass tuft card
export const GRASS_RAW = /* glsl */ `
vec4 raw(vec2 uv) {
  float a = 0.0; vec3 col = vec3(0.0);
  for (int i = 0; i < 22; i++) {
    float fi = float(i);
    float x0 = 0.15 + 0.7 * hash11(fi * 3.17);
    float h = 0.45 + 0.55 * hash11(fi * 7.31);
    float bend = (hash11(fi * 1.7) - 0.5) * 0.5;
    float t = uv.y / h;
    if (t > 1.0) continue;
    float x = x0 + bend * t * t;
    float w = 0.018 * (1.0 - t) + 0.002;
    float d = abs(uv.x - x);
    float m = 1.0 - smoothstep(w * 0.6, w, d);
    if (m > a) { a = m; col = mix(vec3(0.05, 0.07, 0.025), vec3(0.16, 0.16, 0.07), t * (0.5 + 0.5 * hash11(fi))); }
  }
  return vec4(col, step(0.5, a));
}
`;
