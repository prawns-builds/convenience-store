import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ------------------------------------------------------------------------------------------
// CC0 Poly Haven models (public/assets/models, see manifest.json).
//
// Models are not added as loose meshes: their geometry is fed into the same GeoBuilder /
// instancing paths as the procedural props, so they get baked lighting (per vertex or per
// instance), wetness, the flashlight shadow and planar reflections like everything else.
// A model that fails to load returns false from place()/instanced() so callers can fall
// back to the procedural prop.
// ------------------------------------------------------------------------------------------
const ROOT = (import.meta.env?.BASE_URL ?? '/') + 'assets/models/';

export const MODEL_SLUGS = [
  'oil_drum_grey', 'oil_drum_green', 'oil_drum_blue', 'metal_trash_can', 'propane_tank', 'street_bench', 'cardboard_box',
  'wet_floor_sign', 'crt_monitor', 'office_desk', 'security_camera', 'utility_cabinet',
  'milk_crate', 'old_tyre', 'jerrycan', 'trash_bag', 'monobloc_chair', 'concrete_barrier', 'aircon_unit', 'rusted_can',
  'portable_generator', 'rooibos_bush', 'roadside_weeds', 'dry_branches', 'boulder', 'rock_small',
];

// Outdoor materials get rain wetness; values follow MATS conventions.
const WET = { porosity: 0.35, wetRough: 0.15 };

export function fetchModels() {
  const loader = new GLTFLoader();
  const out = {};
  for (const slug of MODEL_SLUGS) {
    out[slug] = loader.loadAsync(`${ROOT}${slug}/${slug}.glb`).catch((e) => { console.warn('[models] missing', slug, e?.message ?? e); return null; });
  }
  return out;
}

const _m = new THREE.Matrix4();

export class Models {
  constructor(gltfs, mats) {
    this.gltfs = gltfs; // slug -> gltf | null
    this.mats = mats;
    this.cache = new Map();
  }

  static async load(pending, mats) {
    const g = {};
    for (const [k, p] of Object.entries(pending)) g[k] = await p;
    return new Models(g, mats);
  }

  has(slug) { return !!this.gltfs[slug]; }

  _matKey(slug, m, opts) {
    const key = `mdl_${slug}_${m.name || m.uuid}${opts.ext === false ? '_i' : ''}`;
    if (!this.mats.custom[key]) {
      const def = {
        color: m.color ? m.color.getHex() : 0xffffff,
        roughness: m.roughness ?? 0.8,
        metalness: m.metalness ?? 0,
        map: m.map ?? undefined,
        normalMap: m.normalMap ?? undefined,
        normalScale: m.normalScale ? m.normalScale.x : 1,
        roughnessMap: m.roughnessMap ?? undefined,
        metalnessMap: m.metalnessMap ?? undefined,
        side: m.side,
        ...(opts.ext === false ? {} : WET),
        ...(opts.matDef ?? {}),
      };
      if (m.alphaTest > 0 || m.transparent) { def.alphaTest = Math.max(0.5, m.alphaTest); def.side = THREE.DoubleSide; def.cutout = true; }
      // glass / transmission parts render as dark glossy plastic (no transmission in this pipeline)
      if (m.transmission > 0) { def.color = 0x1a1c1c; def.roughness = 0.08; def.metalness = 0; def.map = undefined; }
      this.mats.define(key, def);
    }
    return key;
  }

  // Merged, re-centred geometry per material for a model (optionally a subset of nodes).
  // Returns [{ matKey, geometry }] in model space: centred on XZ, resting on y = 0.
  parts(slug, opts = {}) {
    const gltf = this.gltfs[slug];
    if (!gltf) return null;
    const nodes = opts.nodes ?? null;
    const ck = slug + '|' + (nodes ? nodes.join(',') : '*') + '|' + (opts.ext === false ? 'i' : 'e') + '|' + (opts.recenter === false ? 'n' : 'c') + '|' + (opts.pre ? opts.pre.join(',') : '');
    if (this.cache.has(ck)) return this.cache.get(ck);
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const byMat = new Map();
    const box = new THREE.Box3();
    root.traverse((o) => {
      if (!o.isMesh) return;
      if (nodes) {
        let hit = false;
        for (let p = o; p; p = p.parent) if (nodes.includes(p.name)) { hit = true; break; }
        if (!hit) return;
      }
      let g = o.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.normal) g.computeVertexNormals();
      g.applyMatrix4(o.matrixWorld);
      if (opts.pre) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...opts.pre)));
      g.computeBoundingBox();
      box.union(g.boundingBox);
      const mk = this._matKey(slug, o.material, opts);
      if (!byMat.has(mk)) byMat.set(mk, []);
      byMat.get(mk).push(g);
    });
    const c = new THREE.Vector3(); box.getCenter(c);
    const shift = opts.recenter === false ? new THREE.Vector3() : new THREE.Vector3(-c.x, -box.min.y, -c.z);
    const out = [];
    for (const [matKey, gs] of byMat) {
      const g = mergeSimple(gs);
      g.translate(shift.x, shift.y, shift.z);
      g.computeBoundingBox(); g.computeBoundingSphere();
      out.push({ matKey, geometry: g });
    }
    const size = new THREE.Vector3(); box.getSize(size);
    out.size = size;
    this.cache.set(ck, out);
    return out;
  }

  // Static placement through the GeoBuilder (per-vertex baked light). s = number | [sx, sy, sz].
  place(b, slug, x, y, z, rotY = 0, s = 1, opts = {}) {
    const parts = this.parts(slug, opts);
    if (!parts) return false;
    const [sx, sy, sz] = Array.isArray(s) ? s : [s, s, s];
    b.pushTRS(x, y, z, rotY, sx, sy, sz);
    if (opts.tilt) b.push(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...opts.tilt)));
    for (const p of parts) b.geometry(p.matKey, p.geometry, { mode: opts.mode ?? 'vtx', region: opts.region });
    if (opts.tilt) b.pop();
    b.pop();
    const sz3 = parts.size;
    if (opts.collide === 'circle') b.circleCollider([x, y, z], Math.max(sz3.x * sx, sz3.z * sz) / 2, y, y + sz3.y * sy);
    else if (opts.collide === 'box') {
      b.pushTRS(x, y, z, rotY);
      b.boxCollider([0, sz3.y * sy / 2, 0], [sz3.x * sx, sz3.y * sy, sz3.z * sz]);
      b.pop();
    }
    return true;
  }

  // Instanced sets (per-instance baked light): returns { add(x, y, z, rotY, s) } or null.
  instanced(ctx, name, slug, opts = {}) {
    const parts = this.parts(slug, opts);
    if (!parts) return null;
    const sets = parts.map((p, i) => {
      const def = this.mats.custom[p.matKey];
      return ctx.instances(`${name}_${i}`, p.geometry, p.matKey, { mode: 'inst', region: opts.region ?? 'ext', castShadow: opts.castShadow ?? true, alphaMap: def?.cutout ? def.map : null });
    });
    const h = parts.size.y;
    return {
      size: parts.size,
      add(x, y, z, rotY = 0, s = 1, tilt = null) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt?.[0] ?? 0, rotY, tilt?.[2] ?? 0, 'YXZ'));
        const sv = Array.isArray(s) ? new THREE.Vector3(...s) : new THREE.Vector3(s, s, s);
        _m.compose(new THREE.Vector3(x, y, z), q, sv);
        const bp = new THREE.Vector3(x, y + h * sv.y * 0.6, z);
        for (const set of sets) set.add(_m, bp, new THREE.Vector3(0, 1, 0));
      },
    };
  }
}

// Merge geometries into one indexed position/normal/uv geometry (handles interleaved attributes).
function mergeSimple(gs) {
  let vc = 0, ic = 0;
  for (const g of gs) { vc += g.attributes.position.count; ic += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(vc * 3), nrm = new Float32Array(vc * 3), uv = new Float32Array(vc * 2);
  const idx = new Uint32Array(ic);
  let o = 0, io = 0;
  for (const g of gs) {
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    const n = P.count;
    for (let i = 0; i < n; i++) {
      const k = o + i;
      pos[k * 3] = P.getX(i); pos[k * 3 + 1] = P.getY(i); pos[k * 3 + 2] = P.getZ(i);
      nrm[k * 3] = N.getX(i); nrm[k * 3 + 1] = N.getY(i); nrm[k * 3 + 2] = N.getZ(i);
      if (U) { uv[k * 2] = U.getX(i); uv[k * 2 + 1] = U.getY(i); }
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + o;
    else for (let i = 0; i < n; i++) idx[io++] = o + i;
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
