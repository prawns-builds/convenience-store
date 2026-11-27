import * as THREE from 'three';
import { FSPass, fsMaterial, makeRT } from '../render/FSPass.js';

// -----------------------------------------------------------------------------------------
// LightBaker
// Progressive GPU baker. For every static light it renders jittered cube distance maps
// (soft area shadows emerge from averaging the jittered light positions) and accumulates
// irradiance into:
//   - atlas lightmap   (all lightmapped charts, rasterised in UV space)
//   - ground lightmap  (planar XZ mapping of the lot / road / interior floor at y = 0)
//   - point texture    (one texel per vertex of vertex-lit meshes, per instance, per probe)
// Each target has: [0] static RGB irradiance, [1] group channels (R,G,B switchable light
// groups, A = sky visibility irradiance), [2] dominant light direction (for normal maps).
// -----------------------------------------------------------------------------------------

const TAPS = [
  [0, 0], [0.7, 0.2], [-0.3, 0.65], [-0.6, -0.4], [0.25, -0.7],
];

const DIST_VERT = /* glsl */ `
varying vec3 vWorld;
#ifdef ALPHA_TEST
varying vec2 vUv;
#endif
void main() {
  vec4 wp = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
  #endif
  wp = modelMatrix * wp;
  vWorld = wp.xyz;
  #ifdef ALPHA_TEST
  vUv = uv;
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const DIST_FRAG = /* glsl */ `
uniform vec3 uLightPos;
uniform vec3 uSkyDir;
uniform float uSkyMode;
varying vec3 vWorld;
#ifdef ALPHA_TEST
uniform sampler2D uAlphaMap;
varying vec2 vUv;
#endif
void main() {
  #ifdef ALPHA_TEST
  if (texture2D(uAlphaMap, vUv).a < 0.5) discard;
  #endif
  float d = uSkyMode > 0.5 ? dot(vWorld, uSkyDir) : length(vWorld - uLightPos);
  gl_FragColor = vec4(d, d, d, 1.0);
}`;

const BAKE_VERT = /* glsl */ `
#ifdef POINTS
attribute vec2 aTexel;
uniform vec2 uPointsSize;
#else
attribute vec2 uv1;
#endif
varying vec3 vWorld;
varying vec3 vNrm;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNrm = normalize(mat3(modelMatrix) * normal);
  #ifdef POINTS
  gl_Position = vec4((aTexel + 0.5) / uPointsSize * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  #else
  gl_Position = vec4(uv1 * 2.0 - 1.0, 0.0, 1.0);
  #endif
}`;

const BAKE_FRAG = /* glsl */ `
precision highp float;
layout(location = 0) out vec4 oStatic;
layout(location = 1) out vec4 oGroups;
#ifndef POINTS
layout(location = 2) out vec4 oDir;
#endif
uniform float uMode;          // 0 light, 1 sky
uniform vec3 uLightPos;
uniform vec3 uColor;          // already divided by sample count
uniform float uIsStatic;
uniform vec4 uGroupMask;
uniform vec3 uAxis;
uniform float uLambert;
uniform vec2 uCone;
uniform float uRadius2;
uniform float uRange;
uniform samplerCube uCube;
uniform float uCubeTexel;
uniform sampler2D uSkyMap;
uniform mat4 uSkyVP;
uniform vec3 uSkyDir;
uniform float uSkyWeight;
uniform float uSkyTexel;
uniform float uNormalOffset;
varying vec3 vWorld;
varying vec3 vNrm;

const vec2 TAPS[5] = vec2[5](vec2(0.0), vec2(0.7, 0.2), vec2(-0.3, 0.65), vec2(-0.6, -0.4), vec2(0.25, -0.7));

float shadowCube(vec3 wp, float dist, vec3 dn) {
  vec3 up = abs(dn.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(dn, up));
  vec3 b = cross(dn, t);
  float r = uCubeTexel * 1.5;
  float bias = 0.025 + dist * 0.012;
  float vis = 0.0;
  for (int i = 0; i < 5; i++) {
    vec3 dd = dn + (t * TAPS[i].x + b * TAPS[i].y) * r;
    float occ = texture(uCube, dd).r;
    vis += step(dist - bias, occ);
  }
  return vis * 0.2;
}

void main() {
  vec3 n = normalize(vNrm);
  vec3 wp = vWorld + n * uNormalOffset;
  vec3 contrib = vec3(0.0);
  vec3 L = vec3(0.0, 1.0, 0.0);
  if (uMode < 0.5) {
    vec3 toL = uLightPos - wp;
    float d2 = dot(toL, toL);
    float d = sqrt(d2);
    L = toL / max(d, 1e-4);
    float ndl = dot(n, L);
    if (ndl > 0.0 && d < uRange) {
      float c = dot(-L, uAxis);
      float e = mix(1.0, max(c, 0.0), uLambert) * smoothstep(uCone.x, uCone.y, c);
      float x = d / uRange;
      float win = clamp(1.0 - x * x * x * x, 0.0, 1.0); win *= win;
      float E = ndl * e * win / (d2 + uRadius2);
      if (E > 1e-7) E *= shadowCube(wp, d, -L);
      contrib = uColor * E;
    }
  } else {
    float ndl = dot(n, uSkyDir);
    if (ndl > 0.0) {
      vec4 cp = uSkyVP * vec4(wp, 1.0);
      vec2 suv = cp.xy / cp.w * 0.5 + 0.5;
      float vis = 1.0;
      if (suv.x > 0.0 && suv.y > 0.0 && suv.x < 1.0 && suv.y < 1.0) {
        float h = dot(wp, uSkyDir);
        vis = 0.0;
        for (int i = 0; i < 5; i++) {
          float top = texture(uSkyMap, suv + TAPS[i] * uSkyTexel * 1.5).r;
          vis += step(top - 0.06, h);
        }
        vis *= 0.2;
      }
      contrib = vec3(ndl * vis * uSkyWeight);
    }
  }
  float lum = dot(contrib, vec3(0.2126, 0.7152, 0.0722));
  oStatic = vec4(contrib * uIsStatic, 1.0);
  oGroups = (uMode > 0.5) ? vec4(0.0, 0.0, 0.0, contrib.r) : uGroupMask * lum;
  #ifndef POINTS
  oDir = (uMode > 0.5) ? vec4(0.0) : vec4(L * lum, lum);
  #endif
}`;

const DILATE_FRAG = /* glsl */ `
precision highp float;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
uniform sampler2D t0;
uniform sampler2D t1;
uniform sampler2D t2;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec4 a = texture(t0, vUv);
  if (a.a > 0.0) { o0 = vec4(a.rgb, 1.0); o1 = texture(t1, vUv); o2 = texture(t2, vUv); return; }
  vec4 s0 = vec4(0.0), s1 = vec4(0.0), s2 = vec4(0.0); float w = 0.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    if (x == 0 && y == 0) continue;
    vec2 uv = vUv + vec2(float(x), float(y)) * uTexel;
    vec4 n0 = texture(t0, uv);
    if (n0.a > 0.0) { s0 += vec4(n0.rgb, 1.0); s1 += texture(t1, uv); s2 += texture(t2, uv); w += 1.0; }
  }
  if (w > 0.0) { o0 = vec4(s0.rgb / w, 1.0); o1 = s1 / w; o2 = s2 / w; }
  else { o0 = vec4(0.0); o1 = vec4(0.0); o2 = vec4(0.0); }
}`;

function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

// Merge geometries keeping only the listed attributes (indexed, 32-bit indices).
function mergeAttributes(geos, names) {
  let vcount = 0, icount = 0;
  for (const g of geos) { vcount += g.attributes.position.count; icount += g.index ? g.index.count : g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  const arrays = {};
  for (const n of names) {
    const size = geos.find((g) => g.attributes[n])?.attributes[n].itemSize ?? 3;
    arrays[n] = { a: new Float32Array(vcount * size), size };
  }
  const idx = new Uint32Array(icount);
  let vo = 0, io = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    for (const name of names) {
      const src = g.attributes[name];
      if (src) arrays[name].a.set(src.array.subarray(0, n * src.itemSize), vo * arrays[name].size);
    }
    if (g.index) { const ix = g.index.array; for (let i = 0; i < ix.length; i++) idx[io++] = ix[i] + vo; }
    else for (let i = 0; i < n; i++) idx[io++] = i + vo;
    vo += n;
  }
  for (const n of names) out.setAttribute(n, new THREE.BufferAttribute(arrays[n].a, arrays[n].size));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

export class LightBaker {
  constructor(renderer, opts) {
    this.renderer = renderer;
    this.opts = opts;
    // half-float accumulation keeps VRAM modest (precision is ample for <100 samples/texel);
    // cube/sky depth maps use float where available for distance precision.
    const canFloat = renderer.extensions.has('EXT_color_buffer_float');
    this.accType = THREE.HalfFloatType;
    this.depthType = canFloat ? THREE.FloatType : THREE.HalfFloatType;
    this.samples = opts.samples ?? 8;
    this.skyDirs = opts.skyDirs ?? 32;
    this.cubeSize = opts.cubeSize ?? 256;
    this.skyMapSize = opts.skyMapSize ?? 1024;
    this.round = 0;
    this.jobIndex = 0;
    this.jobs = [];
    this.done = false;
    this.finalTextures = null;
    this.onRound = null;

    // shared uniforms for caster materials
    this.distUniforms = { uLightPos: { value: new THREE.Vector3() }, uSkyDir: { value: new THREE.Vector3(0, 1, 0) }, uSkyMode: { value: 0 } };

    this.cubeRT = new THREE.WebGLCubeRenderTarget(this.cubeSize, { type: this.depthType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: true });
    this.cubeCam = new THREE.CubeCamera(0.03, 50, this.cubeRT);
    this.skyRT = new THREE.WebGLRenderTarget(this.skyMapSize, this.skyMapSize, { type: this.depthType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    this.skyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);

    this.bakeUniforms = {
      uMode: { value: 0 }, uLightPos: { value: new THREE.Vector3() }, uColor: { value: new THREE.Vector3() },
      uIsStatic: { value: 1 }, uGroupMask: { value: new THREE.Vector4() }, uAxis: { value: new THREE.Vector3(0, -1, 0) },
      uLambert: { value: 0 }, uCone: { value: new THREE.Vector2(-2, -1) }, uRadius2: { value: 0.01 }, uRange: { value: 20 },
      uCube: { value: this.cubeRT.texture }, uCubeTexel: { value: 2 / this.cubeSize },
      uSkyMap: { value: this.skyRT.texture }, uSkyVP: { value: new THREE.Matrix4() }, uSkyDir: { value: new THREE.Vector3(0, 1, 0) },
      uSkyWeight: { value: 0 }, uSkyTexel: { value: 1 / this.skyMapSize }, uNormalOffset: { value: 0.035 },
      uPointsSize: { value: new THREE.Vector2(1, 1) },
    };
    const mk = (points) => {
      const m = new THREE.ShaderMaterial({
        uniforms: this.bakeUniforms, vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG,
        defines: points ? { POINTS: '' } : {},
        side: THREE.DoubleSide, depthTest: false, depthWrite: false,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
      });
      m.glslVersion = THREE.GLSL3;
      return m;
    };
    this.bakeMat = mk(false);
    this.bakePointsMat = mk(true);
    this.dummyCam = new THREE.Camera();
  }

  distanceMaterial(alphaMap = null) {
    const m = new THREE.ShaderMaterial({
      uniforms: { ...this.distUniforms, uAlphaMap: { value: alphaMap } },
      vertexShader: DIST_VERT, fragmentShader: DIST_FRAG,
      defines: alphaMap ? { ALPHA_TEST: '' } : {},
      side: THREE.DoubleSide,
    });
    return m;
  }

  // ---------------------------------------------------------------------------------------
  // setup
  //  lmMeshes: [{ geometry (with uv1) }]
  //  ground:   { x0, z0, x1, z1, width, height }
  //  pointSets:[{ positions: Float32Array, normals: Float32Array }]  -> returns base texel per set
  //  casters:  [{ geometry, matrix?, instanced?: InstancedMesh, alphaMap? }]
  //  lights:   [{ kind, group, color, intensity, pos, a, b, size, u, v, radius, axis, lambert, cone, range }]
  // ---------------------------------------------------------------------------------------
  setup({ lmMeshes, atlasW, atlasH, ground, pointSets, casters, lights, skyBounds }) {
    const R = this.renderer;
    // --- targets
    const acc = (w, h, count) => makeRT(w, h, { type: this.accType, count, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const fin = (w, h) => makeRT(w, h, { type: THREE.HalfFloatType, count: 3, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.atlasW = atlasW; this.atlasH = atlasH;
    this.atlasAcc = acc(atlasW, atlasH, 3);
    this.atlasFin = [fin(atlasW, atlasH), fin(atlasW, atlasH)];
    this.ground = ground;
    this.groundAcc = acc(ground.width, ground.height, 3);
    this.groundFin = [fin(ground.width, ground.height), fin(ground.width, ground.height)];

    // --- bake scenes (all lightmapped geometry merged into a single draw)
    this.atlasScene = new THREE.Scene();
    {
      const merged = mergeAttributes(lmMeshes.map((m) => m.geometry), ['position', 'normal', 'uv1']);
      const mesh = new THREE.Mesh(merged, this.bakeMat);
      mesh.frustumCulled = false;
      this.atlasScene.add(mesh);
      this._atlasGeo = merged;
    }
    this.groundScene = new THREE.Scene();
    {
      const g = new THREE.BufferGeometry();
      const { x0, z0, x1, z1 } = ground;
      g.setAttribute('position', new THREE.Float32BufferAttribute([x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1], 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      g.setAttribute('uv1', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      g.setIndex([0, 2, 1, 0, 3, 2]);
      const mesh = new THREE.Mesh(g, this.bakeMat);
      mesh.frustumCulled = false;
      this.groundScene.add(mesh);
    }

    // --- points
    let total = 0;
    const bases = [];
    for (const s of pointSets) { bases.push(total); total += s.positions.length / 3; }
    const PW = 1024;
    const PH = Math.max(1, Math.ceil(total / PW));
    this.pointsW = PW; this.pointsH = PH; this.pointsTotal = total;
    this.pointsAcc = makeRT(PW, PH, { type: this.depthType, count: 2, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.bakeUniforms.uPointsSize.value.set(PW, PH);
    if (total > 0) {
      const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), tex = new Float32Array(total * 2);
      let o = 0;
      for (const s of pointSets) { pos.set(s.positions, o * 3); nrm.set(s.normals, o * 3); o += s.positions.length / 3; }
      for (let i = 0; i < total; i++) { tex[i * 2] = i % PW; tex[i * 2 + 1] = Math.floor(i / PW); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      g.setAttribute('aTexel', new THREE.BufferAttribute(tex, 2));
      const pts = new THREE.Points(g, this.bakePointsMat);
      pts.frustumCulled = false;
      this.pointsScene = new THREE.Scene();
      this.pointsScene.add(pts);
    }
    this.pointBases = bases;

    // --- caster scene (distance materials). Static non-instanced casters are merged into
    // one position-only mesh so every cube face is a handful of draw calls.
    this.casterScene = new THREE.Scene();
    const plainDist = this.distanceMaterial();
    const plain = casters.filter((c) => !c.instanced && !c.alphaMap && !c.matrix);
    if (plain.length) {
      const merged = mergeAttributes(plain.map((c) => c.geometry), ['position']);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, plainDist);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      this.casterScene.add(mesh);
      this._casterGeo = merged;
    }
    for (const c of casters) {
      if (plain.includes(c)) continue;
      let obj;
      if (c.instanced) {
        obj = new THREE.InstancedMesh(c.geometry, c.alphaMap ? this.distanceMaterial(c.alphaMap) : plainDist, c.instanced.count);
        obj.instanceMatrix = c.instanced.instanceMatrix;
        obj.matrixAutoUpdate = false;
        obj.matrix.copy(c.instanced.matrixWorld);
        obj.matrixWorld.copy(c.instanced.matrixWorld);
        obj.computeBoundingSphere();
      } else {
        obj = new THREE.Mesh(c.geometry, c.alphaMap ? this.distanceMaterial(c.alphaMap) : plainDist);
        obj.matrixAutoUpdate = false;
        if (c.matrix) { obj.matrix.copy(c.matrix); obj.matrixWorld.copy(c.matrix); }
      }
      obj.frustumCulled = true;
      this.casterScene.add(obj);
    }
    this.casterScene.matrixWorldAutoUpdate = false;

    // --- sky bounds
    this.skyCenter = skyBounds.center.clone();
    this.skyRadius = skyBounds.radius;

    // --- jobs
    this.lights = lights;
    const S = this.samples;
    const K = this.skyDirs;
    this.skyDirList = [];
    for (let i = 0; i < K; i++) {
      // stratified hemisphere (uniform), biased away from horizon
      const u = (i + 0.5) / K;
      const y = 0.08 + 0.92 * u;
      const phi = i * 2.399963 + 0.7;
      const r = Math.sqrt(1 - y * y);
      this.skyDirList.push(new THREE.Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r));
    }
    this.jobs = [];
    for (let r = 0; r < S; r++) {
      for (let li = 0; li < lights.length; li++) this.jobs.push({ type: 'light', li, s: r, round: r });
      const k0 = Math.floor((r * K) / S), k1 = Math.floor(((r + 1) * K) / S);
      for (let k = k0; k < k1; k++) this.jobs.push({ type: 'sky', k, round: r });
    }
    this.jobIndex = 0;
    this.roundsDone = 0;
    this.done = false;

    // clear accumulators
    const prevClear = R.getClearColor(new THREE.Color()); const prevAlpha = R.getClearAlpha();
    R.setClearColor(0x000000, 0);
    for (const rt of [this.atlasAcc, this.groundAcc, this.pointsAcc]) { R.setRenderTarget(rt); R.clear(true, false, false); }
    R.setRenderTarget(null);
    R.setClearColor(prevClear, prevAlpha);

    this.dilatePass = new FSPass(fsMaterial({
      uniforms: { t0: { value: null }, t1: { value: null }, t2: { value: null }, uTexel: { value: new THREE.Vector2() } },
      fragmentShader: DILATE_FRAG,
      glslVersion: THREE.GLSL3,
    }));
    return { pointBases: bases, pointsW: PW, pointsH: PH };
  }

  get progress() { return this.jobs.length ? this.jobIndex / this.jobs.length : 1; }
  // normalization factor so partially-complete bakes display at correct brightness
  get scale() { return this.samples / Math.max(1, this.roundsDone); }

  _samplePos(L, s) {
    const S = this.samples;
    const j1 = (s + hash(s * 3.1 + L.seed)) / S;
    const j2 = hash(s * 7.7 + L.seed * 1.3);
    const j3 = hash(s * 1.9 + L.seed * 2.7);
    const p = new THREE.Vector3();
    if (L.kind === 'tube') {
      p.copy(L.a).lerp(L.b, j1);
    } else if (L.kind === 'rect') {
      p.copy(L.pos).addScaledVector(L.u, (j1 - 0.5) * L.size[0]).addScaledVector(L.v, (j2 - 0.5) * L.size[1]);
    } else {
      // sphere
      const z = 2 * j1 - 1, ph = j2 * Math.PI * 2, rr = Math.sqrt(1 - z * z) * Math.cbrt(j3);
      p.set(L.pos.x + Math.cos(ph) * rr * L.radius, L.pos.y + z * Math.cbrt(j3) * L.radius, L.pos.z + Math.sin(ph) * rr * L.radius);
    }
    return p;
  }

  _runJob(job) {
    const R = this.renderer;
    const U = this.bakeUniforms;
    if (job.type === 'light') {
      const L = this.lights[job.li];
      if (L.seed === undefined) L.seed = job.li * 13.37 + 1;
      const p = this._samplePos(L, job.s);
      // shadow cube
      this.distUniforms.uLightPos.value.copy(p);
      this.distUniforms.uSkyMode.value = 0;
      for (const cam of this.cubeCam.children) { cam.far = L.range; cam.near = 0.02; cam.updateProjectionMatrix(); }
      this.cubeCam.position.copy(p);
      this.cubeCam.updateMatrixWorld(true);
      R.setClearColor(new THREE.Color(1e6, 1e6, 1e6), 1);
      this.cubeCam.update(R, this.casterScene);
      // bake uniforms
      U.uMode.value = 0;
      U.uLightPos.value.copy(p);
      const k = L.intensity / this.samples;
      U.uColor.value.set(L.color.r * k, L.color.g * k, L.color.b * k);
      U.uIsStatic.value = L.group < 0 ? 1 : 0;
      U.uGroupMask.value.set(L.group === 0 ? 1 : 0, L.group === 1 ? 1 : 0, L.group === 2 ? 1 : 0, 0);
      if (L.group >= 0) U.uColor.value.set(k, k, k);
      U.uAxis.value.copy(L.axis ?? new THREE.Vector3(0, -1, 0));
      U.uLambert.value = L.lambert ?? 0;
      U.uCone.value.set(L.cone?.[0] ?? -2, L.cone?.[1] ?? -1);
      U.uRadius2.value = (L.soft ?? 0.15) ** 2;
      U.uRange.value = L.range;
    } else {
      const dir = this.skyDirList[job.k];
      this.distUniforms.uSkyMode.value = 1;
      this.distUniforms.uSkyDir.value.copy(dir);
      const c = this.skyCenter, r = this.skyRadius;
      const cam = this.skyCam;
      cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 0.1; cam.far = r * 2 + 200;
      cam.position.copy(c).addScaledVector(dir, r + 100);
      cam.up.set(0, 1, 0);
      if (Math.abs(dir.y) > 0.99) cam.up.set(0, 0, 1);
      cam.lookAt(c);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      R.setRenderTarget(this.skyRT);
      R.setClearColor(new THREE.Color(-1e6, -1e6, -1e6), 1);
      R.clear(true, true, false);
      R.render(this.casterScene, cam);
      U.uMode.value = 1;
      U.uSkyVP.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      U.uSkyDir.value.copy(dir);
      U.uSkyWeight.value = 2 / this.skyDirs;
      U.uSkyTexel.value = 1 / this.skyMapSize;
    }
    R.setClearColor(0x000000, 0);
    const prevAuto = R.autoClear;
    R.autoClear = false;
    R.setRenderTarget(this.atlasAcc); R.render(this.atlasScene, this.dummyCam);
    R.setRenderTarget(this.groundAcc); R.render(this.groundScene, this.dummyCam);
    if (this.pointsScene) { R.setRenderTarget(this.pointsAcc); R.render(this.pointsScene, this.dummyCam); }
    R.autoClear = prevAuto;
    R.setRenderTarget(null);
  }

  _dilate(accRT, finPair, w, h, iterations = 4) {
    const R = this.renderer;
    const P = this.dilatePass;
    P.uniforms.uTexel.value.set(1 / w, 1 / h);
    let src = accRT.textures;
    let dst = 0;
    for (let i = 0; i < iterations; i++) {
      P.uniforms.t0.value = src[0]; P.uniforms.t1.value = src[1]; P.uniforms.t2.value = src[2];
      P.render(R, finPair[dst]);
      src = finPair[dst].textures;
      dst = 1 - dst;
    }
    return finPair[1 - dst];
  }

  _publish() {
    const atlas = this._dilate(this.atlasAcc, this.atlasFin, this.atlasW, this.atlasH, 4);
    const ground = this._dilate(this.groundAcc, this.groundFin, this.ground.width, this.ground.height, 3);
    this.finalTextures = {
      atlas: atlas.textures,
      ground: ground.textures,
      points: this.pointsAcc.textures,
    };
    if (this.onRound) this.onRound(this);
  }

  // Run jobs for up to budgetMs (wall time). Returns true when complete.
  step(budgetMs = 8, maxJobs = Infinity) {
    if (this.done) return true;
    const R = this.renderer;
    const prevClear = R.getClearColor(new THREE.Color()); const prevAlpha = R.getClearAlpha();
    const t0 = performance.now();
    let n = 0;
    while (this.jobIndex < this.jobs.length) {
      const job = this.jobs[this.jobIndex];
      this._runJob(job);
      this.jobIndex++;
      n++;
      const next = this.jobs[this.jobIndex];
      if (!next || next.round !== job.round) {
        this.roundsDone = job.round + 1;
        this._publish();
      }
      if (performance.now() - t0 > budgetMs || n >= maxJobs) break;
    }
    R.setClearColor(prevClear, prevAlpha);
    if (this.jobIndex >= this.jobs.length) this.done = true;
    return this.done;
  }

  // Read back a range of the points texture (static + groups) as Float32 arrays.
  readPoints(base, count) {
    const R = this.renderer;
    const W = this.pointsW;
    const y0 = Math.floor(base / W), y1 = Math.floor((base + count - 1) / W);
    const rows = y1 - y0 + 1;
    const isFloat = this.depthType === THREE.FloatType;
    const read = (idx) => {
      const buf = isFloat ? new Float32Array(W * rows * 4) : new Uint16Array(W * rows * 4);
      R.readRenderTargetPixels(this.pointsAcc, 0, y0, W, rows, buf, undefined, idx);
      const out = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        const t = base + i - y0 * W;
        for (let c = 0; c < 4; c++) out[i * 4 + c] = isFloat ? buf[t * 4 + c] : THREE.DataUtils.fromHalfFloat(buf[t * 4 + c]);
      }
      return out;
    };
    return { stat: read(0), groups: read(1) };
  }

  disposeAccumulators() {
    this._atlasGeo?.dispose();
    this._casterGeo?.dispose();
    this.cubeRT.dispose();
    this.skyRT.dispose();
    this.atlasAcc.dispose();
    this.groundAcc.dispose();
    // keep pointsAcc (used at runtime)
  }
}
