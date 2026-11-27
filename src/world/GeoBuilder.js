import * as THREE from 'three';

// Procedural geometry builder.
//  - Accumulates primitives into "parts" keyed by material + region + lighting mode, so the
//    whole static world collapses into a few dozen draw calls.
//  - Every lightmapped face becomes a chart that is later packed into the lightmap atlas.
//  - Vertex-lit parts are subdivided so baked per-vertex lighting has enough resolution.
//  - Registers 2D colliders for the player.

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

const FACE_DEFS = {
  px: { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], su: 'd', sv: 'h', sn: 'w' },
  nx: { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], su: 'd', sv: 'h', sn: 'w' },
  py: { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], su: 'w', sv: 'd', sn: 'h' },
  ny: { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], su: 'w', sv: 'd', sn: 'h' },
  pz: { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], su: 'w', sv: 'h', sn: 'd' },
  nz: { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], su: 'w', sv: 'h', sn: 'd' },
};
const ALL_FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

class Part {
  constructor(key, matKey, region, mode) {
    this.key = key; this.matKey = matKey; this.region = region; this.mode = mode;
    this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = [];
    this.lm = []; // per-vertex chart-local coords (u,v) in [0,1]
    this.charts = []; // { w, h, density, start, count }  (vertex range)
    this.hasColor = false;
  }
  get vcount() { return this.pos.length / 3; }
}

export class GeoBuilder {
  constructor() {
    this.parts = new Map();
    this.stack = [new THREE.Matrix4()];
    this.nstack = [new THREE.Matrix3()];
    this.region = 'ext';
    this.colliders = [];
    this.defaultLm = 20; // texels per meter
    this.defaultSubdiv = 3; // vertices per meter for vertex-lit parts
    this.color = null; // optional vertex color for subsequent prims
  }

  // ------------------------------------------------------------------ transform stack
  get M() { return this.stack[this.stack.length - 1]; }
  push(m) {
    const M = this.M.clone().multiply(m);
    this.stack.push(M);
    this.nstack.push(new THREE.Matrix3().getNormalMatrix(M));
    return this;
  }
  pushTRS(x = 0, y = 0, z = 0, rotY = 0, sx = 1, sy = 1, sz = 1) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
      new THREE.Vector3(sx, sy, sz)
    );
    return this.push(m);
  }
  pushEuler(x, y, z, rx, ry, rz, order = 'YXZ') {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, order)), new THREE.Vector3(1, 1, 1));
    return this.push(m);
  }
  pop() { if (this.stack.length > 1) { this.stack.pop(); this.nstack.pop(); } return this; }

  part(matKey, mode = 'lm', region = this.region) {
    const key = `${matKey}|${region}|${mode}`;
    let p = this.parts.get(key);
    if (!p) { p = new Part(key, matKey, region, mode); this.parts.set(key, p); }
    return p;
  }

  // ------------------------------------------------------------------ low-level emit
  _emitVertex(p, lx, ly, lz, nx, ny, nz, u, v, lu, lv) {
    _v.set(lx, ly, lz).applyMatrix4(this.M);
    _n.set(nx, ny, nz).applyMatrix3(this.nstack[this.nstack.length - 1]).normalize();
    p.pos.push(_v.x, _v.y, _v.z);
    p.nrm.push(_n.x, _n.y, _n.z);
    p.uv.push(u, v);
    p.lm.push(lu, lv);
    if (this.color) { p.col.push(this.color[0], this.color[1], this.color[2]); p.hasColor = true; }
    else p.col.push(1, 1, 1);
    return p.vcount - 1;
  }

  // world-space scale factors of current matrix along local axes (for chart sizing)
  _axisScale(ax, ay, az) {
    const e = this.M.elements;
    const x = e[0] * ax + e[4] * ay + e[8] * az;
    const y = e[1] * ax + e[5] * ay + e[9] * az;
    const z = e[2] * ax + e[6] * ay + e[10] * az;
    return Math.hypot(x, y, z);
  }

  // Generic quad grid on a plane: origin c, axes U,V (unit), half sizes hu,hv, normal N.
  // opts: mode, uvScale [su,sv] meters per texture repeat, uvOffset, uvFit, lm density, subdiv, flip
  quadGrid(matKey, c, U, V, N, hu, hv, opts = {}) {
    const mode = opts.mode ?? 'lm';
    const p = this.part(matKey, mode, opts.region ?? this.region);
    const sizeU = 2 * hu, sizeV = 2 * hv;
    let nu = 1, nv = 1;
    if (mode === 'vtx') {
      const sd = opts.subdiv ?? this.defaultSubdiv;
      nu = Math.max(1, Math.min(64, Math.ceil(sizeU * this._axisScale(...U) * sd)));
      nv = Math.max(1, Math.min(64, Math.ceil(sizeV * this._axisScale(...V) * sd)));
    }
    const uvs = opts.uvScale ?? (this.uvFor ? this.uvFor(matKey) : [1, 1]);
    const su = Array.isArray(uvs) ? uvs[0] : uvs, sv = Array.isArray(uvs) ? uvs[1] : uvs;
    const off = opts.uvOffset ?? [0, 0];
    const start = p.vcount;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const a = -hu + (2 * hu * i) / nu;
        const b = -hv + (2 * hv * j) / nv;
        const x = c[0] + U[0] * a + V[0] * b;
        const y = c[1] + U[1] * a + V[1] * b;
        const z = c[2] + U[2] * a + V[2] * b;
        let tu, tv;
        if (opts.uvFit) { tu = i / nu; tv = j / nv; if (opts.uvFlipU) tu = 1 - tu; }
        else {
          // world-continuous mapping along face axes
          const pu = x * U[0] + y * U[1] + z * U[2];
          const pv = x * V[0] + y * V[1] + z * V[2];
          tu = pu / su + off[0]; tv = pv / sv + off[1];
        }
        this._emitVertex(p, x, y, z, N[0], N[1], N[2], tu, tv, i / nu, j / nv);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = start + j * (nu + 1) + i;
        const b = a + 1, c2 = a + nu + 2, d = a + nu + 1;
        if (opts.flip) p.idx.push(a, c2, b, a, d, c2);
        else p.idx.push(a, b, c2, a, c2, d);
      }
    }
    if (mode === 'lm') {
      const wu = sizeU * this._axisScale(...U);
      const wv = sizeV * this._axisScale(...V);
      p.charts.push({ w: wu, h: wv, density: opts.lm ?? this.defaultLm, start, count: (nu + 1) * (nv + 1) });
    }
    return p;
  }

  // Axis-aligned (in current frame) box. pos = center. size = [w,h,d].
  // opts.faces: array of face names to emit (default all). opts.uvScale etc. passed to quads.
  box(matKey, pos, size, opts = {}) {
    const [w, h, d] = size;
    const dims = { w, h, d };
    const faces = opts.faces ?? (opts.skip ? ALL_FACES.filter((f) => !opts.skip.includes(f)) : ALL_FACES);
    for (const f of faces) {
      const F = FACE_DEFS[f];
      const hn = dims[F.sn] / 2, hu = dims[F.su] / 2, hv = dims[F.sv] / 2;
      const c = [pos[0] + F.n[0] * hn, pos[1] + F.n[1] * hn, pos[2] + F.n[2] * hn];
      const fo = opts.faceOpts?.[f] ? { ...opts, ...opts.faceOpts[f] } : opts;
      this.quadGrid(fo.mat ?? matKey, c, F.u, F.v, F.n, hu, hv, fo);
    }
    if (opts.collide) this.boxCollider(pos, size, opts.collide === true ? {} : opts.collide);
    return this;
  }

  // Single-sided quad given center, normal axis name or vectors.
  quad(matKey, center, U, V, hu, hv, opts = {}) {
    const N = new THREE.Vector3(...U).cross(new THREE.Vector3(...V)).normalize().toArray();
    return this.quadGrid(matKey, center, U, V, N, hu, hv, opts);
  }

  // Cylinder along local Y. pos = base center.
  cylinder(matKey, pos, radius, height, opts = {}) {
    const mode = opts.mode ?? 'vtx';
    const segs = opts.segments ?? 16;
    const p = this.part(matKey, mode, opts.region ?? this.region);
    const r0 = radius, r1 = opts.radiusTop ?? radius;
    const sd = opts.subdiv ?? this.defaultSubdiv;
    const nv = mode === 'vtx' ? Math.max(1, Math.min(48, Math.ceil(height * sd))) : 1;
    const uvs = opts.uvScale ?? (this.uvFor ? this.uvFor(matKey) : [1, 1]);
    const su = Array.isArray(uvs) ? uvs[0] : uvs, sv = Array.isArray(uvs) ? uvs[1] : uvs;
    const circ = Math.PI * (r0 + r1);
    const start = p.vcount;
    const slope = (r0 - r1) / height;
    const a0 = opts.arcStart ?? 0, arc = opts.arc ?? Math.PI * 2;
    if (opts.side !== false) {
      for (let j = 0; j <= nv; j++) {
        const t = j / nv;
        const y = pos[1] + t * height;
        const r = r0 + (r1 - r0) * t;
        for (let i = 0; i <= segs; i++) {
          const a = a0 + (i / segs) * arc;
          const cx = Math.cos(a), sz = Math.sin(a);
          const n = new THREE.Vector3(cx, slope, sz).normalize();
          const tu = opts.uvFit ? i / segs : ((i / segs) * circ * (arc / (Math.PI * 2))) / su;
          const tv = opts.uvFit ? t : (t * height) / sv + (opts.uvOffset?.[1] ?? 0);
          this._emitVertex(p, pos[0] + cx * r, y, pos[2] + sz * r, n.x, n.y, n.z, tu, tv, i / segs, t);
        }
      }
      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < segs; i++) {
          const a = start + j * (segs + 1) + i;
          const b = a + 1, c = a + segs + 2, d = a + segs + 1;
          p.idx.push(a, c, b, a, d, c);
        }
      }
      if (mode === 'lm') p.charts.push({ w: circ * (arc / (Math.PI * 2)) * this._axisScale(1, 0, 0), h: height * this._axisScale(0, 1, 0), density: opts.lm ?? this.defaultLm, start, count: (segs + 1) * (nv + 1) });
    }
    const caps = opts.caps ?? [true, true];
    for (let k = 0; k < 2; k++) {
      if (!caps[k]) continue;
      const top = k === 1;
      const r = top ? r1 : r0;
      const y = pos[1] + (top ? height : 0);
      const cs = p.vcount;
      const ny = top ? 1 : -1;
      this._emitVertex(p, pos[0], y, pos[2], 0, ny, 0, (pos[0]) / su, (pos[2]) / su, 0.5, 0.5);
      for (let i = 0; i <= segs; i++) {
        const a = a0 + (i / segs) * arc;
        const x = pos[0] + Math.cos(a) * r, z = pos[2] + Math.sin(a) * r;
        this._emitVertex(p, x, y, z, 0, ny, 0, x / su, z / su, 0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a));
      }
      for (let i = 0; i < segs; i++) {
        if (top) p.idx.push(cs, cs + 2 + i, cs + 1 + i);
        else p.idx.push(cs, cs + 1 + i, cs + 2 + i);
      }
      if (mode === 'lm') p.charts.push({ w: 2 * r * this._axisScale(1, 0, 0), h: 2 * r * this._axisScale(0, 0, 1), density: opts.lm ?? this.defaultLm, start: cs, count: segs + 2 });
    }
    if (opts.collide) this.circleCollider(pos, Math.max(r0, r1), pos[1], pos[1] + height);
    return this;
  }

  // Arbitrary BufferGeometry (positions/normals/uv used). Lightmap mode requires a fitted chart
  // (geometry uv in [0,1] non-overlapping) -> opts.lmChart = [wMeters, hMeters].
  geometry(matKey, geo, opts = {}) {
    const mode = opts.mode ?? 'vtx';
    const p = this.part(matKey, mode, opts.region ?? this.region);
    const g = geo.index ? geo : geo;
    const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
    const start = p.vcount;
    const uvScale = opts.uvScale ?? 1;
    for (let i = 0; i < pos.count; i++) {
      const u = uv ? uv.getX(i) : 0, v = uv ? uv.getY(i) : 0;
      this._emitVertex(p, pos.getX(i), pos.getY(i), pos.getZ(i), nrm.getX(i), nrm.getY(i), nrm.getZ(i), u / uvScale, v / uvScale, u, v);
    }
    if (g.index) { const ix = g.index.array; for (let i = 0; i < ix.length; i++) p.idx.push(start + ix[i]); }
    else for (let i = 0; i < pos.count; i++) p.idx.push(start + i);
    if (mode === 'lm') {
      const [w, h] = opts.lmChart ?? [1, 1];
      p.charts.push({ w, h, density: opts.lm ?? this.defaultLm, start, count: pos.count });
    }
    if (opts.collide) {
      geo.computeBoundingBox();
      const bb = geo.boundingBox; const c = new THREE.Vector3(); bb.getCenter(c); const s = new THREE.Vector3(); bb.getSize(s);
      this.boxCollider(c.toArray(), s.toArray());
    }
    return p;
  }

  // ------------------------------------------------------------------ colliders (2D OBB on XZ + Y range)
  boxCollider(pos, size, opts = {}) {
    const M = this.M;
    const c = new THREE.Vector3(pos[0], pos[1], pos[2]).applyMatrix4(M);
    const ax = new THREE.Vector3(1, 0, 0).transformDirection(M);
    const angle = Math.atan2(-ax.z, ax.x);
    const sx = this._axisScale(1, 0, 0) * size[0] / 2 + (opts.pad ?? 0);
    const sz = this._axisScale(0, 0, 1) * size[2] / 2 + (opts.pad ?? 0);
    const sy = this._axisScale(0, 1, 0) * size[1] / 2;
    const col = { type: 'box', x: c.x, z: c.z, hx: sx, hz: sz, angle, cos: Math.cos(angle), sin: Math.sin(angle), y0: c.y - sy, y1: c.y + sy, tag: opts.tag, enabled: true };
    this.colliders.push(col);
    return col;
  }
  circleCollider(pos, r, y0, y1, opts = {}) {
    const c = new THREE.Vector3(pos[0], pos[1], pos[2]).applyMatrix4(this.M);
    const col = { type: 'circle', x: c.x, z: c.z, r: r * this._axisScale(1, 0, 0) + (opts.pad ?? 0), y0: y0 ?? c.y, y1: y1 ?? c.y + 2, tag: opts.tag, enabled: true };
    this.colliders.push(col);
    return col;
  }

  // ------------------------------------------------------------------ finalize
  finalize() {
    const out = [];
    for (const p of this.parts.values()) {
      if (p.idx.length === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(p.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
      if (p.hasColor) g.setAttribute('color', new THREE.Float32BufferAttribute(p.col, 3));
      const vc = p.vcount;
      g.setIndex(vc > 65535 ? new THREE.Uint32BufferAttribute(p.idx, 1) : new THREE.Uint16BufferAttribute(p.idx, 1));
      g.computeBoundingBox();
      g.computeBoundingSphere();
      out.push({ key: p.key, matKey: p.matKey, region: p.region, mode: p.mode, geometry: g, charts: p.charts, lmLocal: p.lm });
    }
    return out;
  }
}
