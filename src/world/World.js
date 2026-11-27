import * as THREE from 'three';
import { TextureGen } from '../gfx/TextureGen.js';
import * as SURF from '../gfx/surfaces.js';
import { G, emissiveMaterial } from '../gfx/Materials.js';
import { GeoBuilder } from './GeoBuilder.js';
import { packAtlasAuto } from '../bake/Atlas.js';
import { LightBaker } from '../bake/LightBaker.js';
import { MaterialLib, MATS, makeGroundMaterial } from './matlib.js';
import { SITE, UV } from './site.js';
import { LAYER_NO_REFLECT } from '../render/Pipeline.js';
import { buildStore } from './content/store.js';
import { buildCanopy } from './content/canopy.js';
import { buildProps } from './content/props.js';
import { buildRoadside } from './content/roadside.js';
import { buildInterior } from './content/interior.js';
import { buildVan } from './content/van.js';
import { buildSky } from './content/sky.js';
import { createFlashlightLight } from '../player/Flashlight.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// Light groups (switchable / flickering). Channel index into the baked group texture.
export const GROUP = { BREAKER: 0, FLICKER_EXT: 1, FLICKER_INT: 2 };

class BuildContext {
  constructor(world) {
    this.world = world;
    this.b = new GeoBuilder();
    this.lights = [];
    this.glows = [];
    this.instSets = [];
    this.dynamics = [];
    this.interactables = [];
    this.mats = world.mats;
    this.tex = world.tex;
    this.scene = world.scene;
    this.extra = []; // arbitrary meshes added to scene (no bake)
  }
  light(def) {
    const L = {
      kind: def.kind ?? 'point', group: def.group ?? -1, color: new THREE.Color(def.color ?? 0xffffff), intensity: def.intensity ?? 10,
      pos: def.pos ? new THREE.Vector3(...def.pos) : null, a: def.a ? new THREE.Vector3(...def.a) : null, b: def.b ? new THREE.Vector3(...def.b) : null,
      u: def.u ? new THREE.Vector3(...def.u) : null, v: def.v ? new THREE.Vector3(...def.v) : null, size: def.size ?? null,
      radius: def.radius ?? 0.05, axis: new THREE.Vector3(...(def.axis ?? [0, -1, 0])).normalize(), lambert: def.lambert ?? 0, cone: def.cone ?? [-2, -1],
      range: def.range ?? 15, soft: def.soft ?? 0.15,
    };
    if (L.kind === 'tube' && !L.pos) L.pos = L.a.clone().add(L.b).multiplyScalar(0.5);
    this.lights.push(L);
    if (def.glow) {
      this.glows.push({ pos: (L.pos ?? L.a).clone().add(new THREE.Vector3(...(def.glow.offset ?? [0, 0, 0]))), color: new THREE.Color(def.glow.color ?? def.color ?? 0xffffff), power: def.glow.power ?? def.intensity * 0.5, exterior: def.glow.exterior ?? true, down: def.glow.down ?? 0.5, group: L.group });
    }
    return L;
  }
  // Instanced set; mode 'inst' = per-instance baked lighting
  instances(name, geometry, matKey, opts = {}) {
    const set = { name, geometry, matKey, region: opts.region ?? 'ext', mode: opts.mode ?? 'inst', matrices: [], bakePos: [], bakeNrm: [], colors: [], castShadow: opts.castShadow ?? true, alphaMap: opts.alphaMap ?? null, layer: opts.layer ?? 0, material: opts.material ?? null, receiveShadow: opts.receiveShadow ?? true };
    set.add = (matrix, bakePos, bakeNrm, color) => {
      set.matrices.push(matrix.clone());
      const p = bakePos ?? new THREE.Vector3().setFromMatrixPosition(matrix);
      set.bakePos.push(p.x, p.y, p.z);
      const n = bakeNrm ?? new THREE.Vector3(0, 1, 0);
      set.bakeNrm.push(n.x, n.y, n.z);
      if (color) set.colors.push(color);
    };
    this.instSets.push(set);
    return set;
  }
  interact(def) { this.interactables.push(def); return def; }
}

export class World {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.q = quality;
    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = true;
    this.colliders = [];
    this.groupLevels = [1, 1, 1];
    this.groupColors = [new THREE.Color(0xe8f0ff), new THREE.Color(0xdff0ff), new THREE.Color(0xd8f4e6)];
    this.groupEmissives = [[], [], []];
    this.updaters = [];
  }

  async build(progress = () => {}) {
    const R = this.renderer;
    const q = this.q;
    this._t0 = performance.now();
    progress(0.02, 'GENERATING SURFACES');
    await nextFrame();
    const gen = new TextureGen(R);
    const ts = q.texSize;
    const tex = {};
    const surfs = [SURF.ASPHALT, SURF.CONCRETE, SURF.STUCCO, SURF.PLASTER, SURF.VCT, SURF.CEILING, SURF.METAL, SURF.WOOD, SURF.GROUNDCOVER];
    for (let i = 0; i < surfs.length; i++) {
      tex[surfs[i].name] = gen.surface(surfs[i], surfs[i].name === 'asphalt' || surfs[i].name === 'concrete' ? ts : Math.min(ts, 1024));
      progress(0.02 + 0.1 * (i / surfs.length), 'GENERATING SURFACES');
      if (i % 3 === 2) await nextFrame();
    }
    tex.noise = gen.raw(SURF.NOISE_RAW, 512, { mipmaps: true });
    tex.clouds = gen.raw(SURF.CLOUDS_RAW, 1024, { mipmaps: true });
    tex.leaves = gen.raw(SURF.LEAVES_RAW, 512, { mipmaps: true, wrap: THREE.ClampToEdgeWrapping });
    tex.grass = gen.raw(SURF.GRASS_RAW, 256, { mipmaps: true, wrap: THREE.ClampToEdgeWrapping });
    G.uNoiseTex.value = tex.noise;
    this.tex = tex;
    this.mats = new MaterialLib(tex);
    this._registerEmissives();

    console.log('[world] textures', ((performance.now() - this._t0) / 1000).toFixed(2), 's');
    progress(0.15, 'BUILDING GEOMETRY');
    await nextFrame();
    const tg0 = performance.now();
    const ctx = new BuildContext(this);
    this.ctx = ctx;
    ctx.b.uvFor = (k) => {
      const d = MATS[k] ?? this.mats.custom[k];
      if (!d || !d.tex) return [1, 1];
      const s = (UV[d.tex] ?? 1) * (d.uvMul ?? 1);
      return [s, s];
    };
    buildStore(ctx);
    buildCanopy(ctx);
    buildProps(ctx);
    buildVan(ctx);
    buildRoadside(ctx);
    buildInterior(ctx);
    this.sky = buildSky(ctx);

    const parts = ctx.b.finalize();
    const packInfo = packAtlasAuto(parts, q.lmSize, { pad: 2, densityScale: q.lmDensity ?? 1 });
    const atlasW = packInfo.width, atlasH = packInfo.height;
    this.packInfo = packInfo;
    console.log('[world] parts', parts.length, 'atlas', atlasW, atlasH, packInfo, 'geometry', ((performance.now() - tg0) / 1000).toFixed(2), 's');
    this.colliders = ctx.b.colliders;

    // ---- meshes
    const meshes = [];
    const pointSets = [];
    const ptOwners = [];
    for (const part of parts) {
      const mat = this.mats.get(part.matKey, part.mode, part.region);
      const mesh = new THREE.Mesh(part.geometry, mat);
      mesh.name = part.key;
      mesh.matrixAutoUpdate = false;
      const isEmissive = mat.isMeshBasicMaterial;
      const isGlass = mat.name === 'glass' || mat.transparent;
      mesh.castShadow = !isEmissive && !isGlass;
      mesh.receiveShadow = !isEmissive;
      if (isGlass) mesh.renderOrder = 2;
      if (part.mode === 'ground') mesh.layers.set(LAYER_NO_REFLECT); // reflective floors don't render into their own reflection
      this.scene.add(mesh);
      meshes.push({ part, mesh, mat, isEmissive, isGlass });
      if (part.mode === 'vtx') {
        const pos = part.geometry.attributes.position.array, nrm = part.geometry.attributes.normal.array;
        pointSets.push({ positions: pos, normals: nrm });
        ptOwners.push((base) => { mat.userData.uniforms.uPtBase.value = base; });
      }
    }
    // instanced sets
    for (const set of ctx.instSets) {
      const mat = set.material ?? this.mats.get(set.matKey, set.mode, set.region);
      const im = new THREE.InstancedMesh(set.geometry, mat, set.matrices.length);
      set.matrices.forEach((m, i) => im.setMatrixAt(i, m));
      if (set.colors.length) set.colors.forEach((c, i) => im.setColorAt(i, c));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = set.castShadow;
      im.receiveShadow = set.receiveShadow;
      im.computeBoundingSphere();
      im.matrixAutoUpdate = false;
      if (set.layer) im.layers.set(set.layer);
      im.name = set.name;
      this.scene.add(im);
      set.mesh = im;
      if (set.mode === 'inst') {
        pointSets.push({ positions: new Float32Array(set.bakePos), normals: new Float32Array(set.bakeNrm) });
        ptOwners.push((base) => { mat.userData.uniforms.uPtBase.value = base; });
      }
    }
    // standard materials driven by light groups (troffer lenses etc.)
    for (const m of this.mats.all) {
      const gi = m.userData.def?.group;
      if (gi !== undefined && m.isMeshStandardMaterial && !m.setLevel) {
        const base = m.emissiveIntensity;
        m.setLevel = (lv) => { m.emissiveIntensity = base * lv; };
        this.groupEmissives[gi].push(m);
      }
    }
    // probe grid for dynamic objects
    this.probe = this._probeGrid();
    pointSets.push({ positions: this.probe.positions, normals: this.probe.normals });
    ptOwners.push((base) => { this.probe.base = base; });

    // ground plane
    const gr = SITE.groundRegion;
    G.uGrRegion.value.set(gr.x0, gr.z0, 1 / (gr.x1 - gr.x0), 1 / (gr.z1 - gr.z0));
    const groundGeo = new THREE.PlaneGeometry(1400, 1400, 1, 1).rotateX(-Math.PI / 2);
    groundGeo.translate(10, 0, 0);
    this.groundMat = makeGroundMaterial(tex);
    const ground = new THREE.Mesh(groundGeo, this.groundMat);
    ground.receiveShadow = true;
    ground.layers.set(LAYER_NO_REFLECT);
    ground.name = 'ground';
    ground.frustumCulled = false;
    this.scene.add(ground);
    this.mats.all.push(this.groundMat);

    for (const m of ctx.extra) this.scene.add(m);
    for (const d of ctx.dynamics) this.scene.add(d.object);

    // ---- baker
    progress(0.22, 'CALIBRATING LIGHT');
    await nextFrame();
    const baker = new LightBaker(R, { samples: q.bakeSamples, skyDirs: q.skyDirs, cubeSize: q.cubeSize, skyMapSize: q.skyMapSize });
    const casters = [];
    for (const m of meshes) if (!m.isEmissive && !m.isGlass && m.part.matKey !== 'leaves') casters.push({ geometry: m.part.geometry });
    for (const set of ctx.instSets) if (set.castShadow) casters.push({ geometry: set.geometry, instanced: set.mesh, alphaMap: set.alphaMap });
    const groundW = q.groundLm, groundH = Math.round(q.groundLm * (gr.z1 - gr.z0) / (gr.x1 - gr.x0));
    const info = baker.setup({
      lmMeshes: meshes.filter((m) => m.part.mode === 'lm').map((m) => ({ geometry: m.part.geometry })),
      atlasW, atlasH,
      ground: { ...gr, width: groundW, height: Math.max(64, groundH) },
      pointSets,
      casters,
      lights: ctx.lights,
      skyBounds: { center: new THREE.Vector3(14, 3, -4), radius: 62 },
    });
    info.pointBases.forEach((b, i) => ptOwners[i](b));
    G.uPtWidth.value = info.pointsW;
    this.baker = baker;
    const publish = () => {
      const t = baker.finalTextures;
      G.uAtlasS.value = t.atlas[0]; G.uAtlasG.value = t.atlas[1]; G.uAtlasD.value = t.atlas[2];
      G.uGroundS.value = t.ground[0]; G.uGroundG.value = t.ground[1]; G.uGroundD.value = t.ground[2];
      G.uPtStatic.value = t.points[0]; G.uPtGroups.value = t.points[1];
      G.uLmScale.value = baker.scale;
    };
    baker.onRound = publish;
    console.log('[world] lights', ctx.lights.length, 'points', baker.pointsTotal, 'jobs', baker.jobs.length);

    const tb0 = performance.now();
    // blocking preview rounds
    const preRounds = Math.min(q.preRounds ?? 1, q.bakeSamples);
    while (baker.roundsDone < preRounds) {
      baker.step(30);
      progress(0.22 + 0.68 * Math.min(1, baker.jobIndex / (baker.jobs.length * preRounds / q.bakeSamples)), 'CALIBRATING LIGHT');
      await nextFrame();
    }
    console.log('[world] preview bake', ((performance.now() - tb0) / 1000).toFixed(2), 's');
    this.lights = ctx.lights;
    this.glows = ctx.glows;
    for (const g of this.glows) if (g.group >= 0) g.level = () => this.groupLevels[g.group];
    this.interactables = ctx.interactables;
    this.dynamics = ctx.dynamics;
    this.meshes = meshes;
    progress(0.92, 'CAPTURING REFLECTIONS');
    await nextFrame();
    this.flashLight = createFlashlightLight(this.scene, q);
    this.captureProbes();
    progress(0.96, 'COMPILING SHADERS');
    await nextFrame();
    try {
      const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 900);
      cam.layers.enableAll();
      cam.position.set(9, 1.5, 28);
      if (R.compileAsync) await R.compileAsync(this.scene, cam);
    } catch (e) { console.warn('precompile', e); }
    this._readProbes();
    progress(1.0, 'READY');
  }

  _registerEmissives() {
    const M = this.mats;
    const reg = (k, color, intensity, group = -1, opts = {}) => {
      const m = M.registerEmissive(k, emissiveMaterial(color, intensity, opts));
      if (group >= 0) this.groupEmissives[group].push(m);
      return m;
    };
    reg('emTube', 0xe6f0ff, 26);
    reg('emTubeFlicker', 0xe6f0ff, 26, GROUP.FLICKER_EXT);
    reg('emTroffer', 0xf0f4ff, 9, GROUP.BREAKER);
    reg('emTrofferFlicker', 0xf0f4ff, 9, GROUP.FLICKER_INT);
    reg('emBulbWarm', 0xffb46a, 70);
    reg('emBulbDim', 0xffa050, 18);
    reg('emPendant', 0xffc58a, 30);
    reg('emStreet', 0xffb070, 95);
    reg('emCooler', 0xeaf2ff, 12);
    reg('emSignWhite', 0xfff4e0, 6);
    reg('emRed', 0xff2a1a, 14);
    reg('emGreen', 0x40ff80, 6);
    reg('emScreen', 0x9fc8ff, 2.5);
    reg('emBlack', 0x000000, 0);
  }

  // Coarse probe grid: 6 axis directions per probe (for dynamic objects / player phone)
  _probeGrid() {
    const x0 = -12, x1 = 26, z0 = -16, z1 = 36, y = 1.2, step = 1.0;
    const nx = Math.round((x1 - x0) / step) + 1, nz = Math.round((z1 - z0) / step) + 1;
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const positions = new Float32Array(nx * nz * 6 * 3), normals = new Float32Array(nx * nz * 6 * 3);
    let k = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) for (const d of dirs) {
      positions[k * 3] = x0 + i * step; positions[k * 3 + 1] = y; positions[k * 3 + 2] = z0 + j * step;
      normals[k * 3] = d[0]; normals[k * 3 + 1] = d[1]; normals[k * 3 + 2] = d[2];
      k++;
    }
    return { x0, z0, step, nx, nz, y, positions, normals, base: 0, data: null };
  }

  _readProbes() {
    const p = this.probe;
    const n = p.nx * p.nz * 6;
    const r = this.baker.readPoints(p.base, n);
    p.stat = r.stat; p.groups = r.groups;
  }

  // Sample baked irradiance (average over directions, weighted by normal if given) at world position
  sampleProbe(pos, out = new THREE.Vector3(), normal = null) {
    const p = this.probe;
    if (!p.stat) return out.set(0.05, 0.05, 0.05);
    const fx = THREE.MathUtils.clamp((pos.x - p.x0) / p.step, 0, p.nx - 1.001);
    const fz = THREE.MathUtils.clamp((pos.z - p.z0) / p.step, 0, p.nz - 1.001);
    const i0 = Math.floor(fx), j0 = Math.floor(fz), tx = fx - i0, tz = fz - j0;
    out.set(0, 0, 0);
    let sky = 0;
    const gl = this.groupLevels, gc = this.groupColors;
    const scale = this.baker.scale;
    for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
      const w = (di ? tx : 1 - tx) * (dj ? tz : 1 - tz);
      const base = ((j0 + dj) * p.nx + (i0 + di)) * 6;
      for (let d = 0; d < 6; d++) {
        let wd = 1 / 6;
        if (normal) {
          const comp = [normal.x, -normal.x, normal.y, -normal.y, normal.z, -normal.z][d];
          wd = Math.max(0, comp) ** 2;
        }
        const k = (base + d) * 4;
        const s = p.stat, g = p.groups;
        out.x += w * wd * (s[k] + g[k] * gc[0].r * gl[0] + g[k + 1] * gc[1].r * gl[1] + g[k + 2] * gc[2].r * gl[2]);
        out.y += w * wd * (s[k + 1] + g[k] * gc[0].g * gl[0] + g[k + 1] * gc[1].g * gl[1] + g[k + 2] * gc[2].g * gl[2]);
        out.z += w * wd * (s[k + 2] + g[k] * gc[0].b * gl[0] + g[k + 1] * gc[1].b * gl[1] + g[k + 2] * gc[2].b * gl[2]);
        sky += w * wd * g[k + 3];
      }
    }
    out.multiplyScalar(scale);
    out.sky = sky * scale;
    return out;
  }

  captureProbes() {
    const R = this.renderer;
    const pmrem = new THREE.PMREMGenerator(R);
    const size = this.q.envSize;
    const capture = (pos) => {
      const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
      const cam = new THREE.CubeCamera(0.05, 400, rt);
      cam.position.copy(pos);
      cam.layers.enableAll();
      this.scene.add(cam);
      cam.update(R, this.scene);
      this.scene.remove(cam);
      const env = pmrem.fromCubemap(rt.texture).texture;
      rt.dispose();
      return env;
    };
    if (this.envMaps) for (const e of Object.values(this.envMaps)) e?.dispose?.();
    const ext = capture(new THREE.Vector3(6.5, 1.7, -2.5));
    const int = capture(new THREE.Vector3(-5, 1.6, 0));
    const back = capture(new THREE.Vector3(-3.5, 1.5, 10.5));
    this.envMaps = { ext, int, back };
    this.mats.setEnvMaps(this.envMaps);
    pmrem.dispose();
  }

  setGroupLevel(i, level) {
    this.groupLevels[i] = level;
    const c = this.groupColors[i];
    G.uGroupColor.value[i].set(c.r * level, c.g * level, c.b * level);
    for (const m of this.groupEmissives[i]) m.setLevel(level);
  }

  update(dt, t) {
    for (const u of this.updaters) u(dt, t);
  }
}
