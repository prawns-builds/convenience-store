import * as THREE from 'three';
import { SITE } from '../site.js';
import { signTexture } from '../../gfx/CanvasTextures.js';
import { emissiveMaterial } from '../../gfx/Materials.js';
import { LAYER_NO_REFLECT } from '../../render/Pipeline.js';

// Highway: street lights (cobra heads) receding into fog, power poles + sagging wires,
// fence posts, trees (procedural, instanced), grass tufts, road signs.

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// Build a stylised tree: trunk + forked branches (merged geometry) and a list of foliage card transforms.
function makeTreeVariant(seed, flat = 0.7) {
  const r = rng(seed);
  const geos = [];
  const cards = [];
  const branch = (p0, dir, len, rad, depth) => {
    const p1 = p0.clone().addScaledVector(dir, len);
    const g = new THREE.CylinderGeometry(rad * 0.7, rad, len, 6, 1, true);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    g.applyQuaternion(q);
    g.translate(p0.x, p0.y, p0.z);
    geos.push(g);
    if (depth >= 3 || len < 0.6) {
      // foliage clusters around branch tips (flattened, acacia-like)
      const n = 2 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const c = p1.clone().add(new THREE.Vector3((r() - 0.5) * 1.6, (r() - 0.2) * 0.5, (r() - 0.5) * 1.6));
        cards.push({ pos: c, size: 1.4 + r() * 1.2, rot: r() * Math.PI });
      }
      return;
    }
    const kids = depth === 0 ? 3 : 2 + Math.floor(r() * 2);
    for (let i = 0; i < kids; i++) {
      const spread = depth === 0 ? 0.75 : 0.55;
      const a = r() * Math.PI * 2;
      const nd = dir.clone().add(new THREE.Vector3(Math.cos(a) * spread, (1 - flat) * 0.4 + 0.15, Math.sin(a) * spread)).normalize();
      branch(p1, nd, len * (0.62 + r() * 0.2), rad * 0.62, depth + 1);
    }
  };
  branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3((r() - 0.5) * 0.15, 1, (r() - 0.5) * 0.15).normalize(), 2.2 + r() * 1.4, 0.2 + r() * 0.08, 0);
  // merge trunk geometry
  let count = 0; for (const g of geos) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  const idx = [];
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3); nrm.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2);
    for (const i of g.index.array) idx.push(i + o);
    o += g.attributes.position.count;
  }
  const trunk = new THREE.BufferGeometry();
  trunk.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  trunk.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  trunk.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  trunk.setIndex(idx);
  return { trunk, cards };
}

export function buildRoadside(ctx) {
  const { b, mats } = ctx;
  const r = rng(99);

  // ------------------------------------------------------------ street lights (cobra-head)
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, SITE.streetH, 8, 4).translate(0, SITE.streetH / 2, 0);
  const armCurve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, SITE.streetH - 0.5, 0), new THREE.Vector3(0.3, SITE.streetH + 0.25, 0), new THREE.Vector3(2.15, SITE.streetH + 0.12, 0));
  const armGeo = new THREE.TubeGeometry(armCurve, 10, 0.05, 6, false);
  const headGeo = new THREE.BoxGeometry(0.75, 0.16, 0.34).translate(2.35, SITE.streetH + 0.05, 0);
  const lensGeo = new THREE.BoxGeometry(0.6, 0.02, 0.24).translate(2.35, SITE.streetH - 0.04, 0);
  const merge = (gs) => {
    let n = 0; for (const g of gs) n += g.attributes.position.count;
    const out = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2); const idx = [];
    let o = 0;
    for (let g of gs) { if (!g.index) g = g.toNonIndexed(); pos.set(g.attributes.position.array, o * 3); nrm.set(g.attributes.normal.array, o * 3); if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2); if (g.index) for (const i of g.index.array) idx.push(i + o); o += g.attributes.position.count; }
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); out.setIndex(idx);
    return out;
  };
  const streetGeo = merge([poleGeo, armGeo, headGeo]);
  const poles = ctx.instances('streetPoles', streetGeo, 'steel', { mode: 'inst', castShadow: true });
  const lenses = ctx.instances('streetLens', lensGeo, 'emStreet', { mode: 'none', castShadow: false, material: mats.custom.emStreet.material });
  for (let k = -9; k <= 9; k++) {
    const z = SITE.streetZ0 + k * SITE.streetSpacing;
    const m = new THREE.Matrix4().makeTranslation(SITE.streetPoleX, 0, z);
    poles.add(m, new THREE.Vector3(SITE.streetPoleX + 0.3, 3, z), new THREE.Vector3(1, 0, 0));
    lenses.add(m);
    if (Math.abs(z - 8) < 1 || Math.abs(z + 24) < 1) {
      ctx.light({ kind: 'point', pos: [SITE.streetHeadX + 0.1, SITE.streetH - 0.12, z], radius: 0.18, color: 0xffa65a, intensity: 110, axis: [0, -1, 0], lambert: 0.6, cone: [0.25, 0.55], range: 34, soft: 0.5 });
    }
    ctx.glows.push({ pos: new THREE.Vector3(SITE.streetHeadX + 0.1, SITE.streetH - 0.25, z), color: new THREE.Color(0xffa05a), power: 7.5, exterior: true, down: 0.85, group: -1 });
    b.circleCollider([SITE.streetPoleX, 0, z], 0.2, 0, 2);
  }

  // ------------------------------------------------------------ power poles + wires along the far side of the road
  const ppGeo = merge([
    new THREE.CylinderGeometry(0.11, 0.16, 9.5, 7, 3).translate(0, 4.75, 0),
    new THREE.BoxGeometry(0.12, 0.12, 2.2).translate(0, 8.9, 0),
    new THREE.BoxGeometry(0.1, 0.1, 1.4).translate(0, 8.2, 0),
  ]);
  const pps = ctx.instances('powerPoles', ppGeo, 'bark', { mode: 'inst' });
  const spacing = 45, px = 35.5;
  const wirePts = [];
  for (let k = -8; k <= 8; k++) {
    const z = 4 + k * spacing;
    pps.add(new THREE.Matrix4().makeTranslation(px, 0, z), new THREE.Vector3(px - 0.2, 4, z), new THREE.Vector3(-1, 0, 0));
    wirePts.push(z);
  }
  // wires: sagging catenaries between poles (3 conductors), unlit dark
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x060606 });
  const wireGeos = [];
  for (let i = 0; i < wirePts.length - 1; i++) {
    for (const [ox, oy] of [[-1.0, 8.95], [0, 8.95], [1.0, 8.95], [-0.6, 8.25], [0.6, 8.25]]) {
      const pts = [];
      for (let t = 0; t <= 12; t++) {
        const f = t / 12;
        pts.push(new THREE.Vector3(px, oy - 4 * 1.1 * f * (1 - f), wirePts[i] + (wirePts[i + 1] - wirePts[i]) * f + ox * 0.02));
      }
      wireGeos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.012, 3, false));
    }
  }
  const wires = new THREE.Mesh(merge(wireGeos), wireMat);
  wires.name = 'wires';
  ctx.extra.push(wires);

  // service drop: wire from the nearest pole to the store roof
  {
    const a = new THREE.Vector3(px, 8.3, 4), c = new THREE.Vector3(0.05, 4.2, 9.0);
    const mid = a.clone().lerp(c, 0.5); mid.y -= 1.3;
    const g = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, c), 24, 0.014, 3, false);
    ctx.extra.push(new THREE.Mesh(g, wireMat));
  }

  // ------------------------------------------------------------ fence posts + wire along the field beyond the road
  const postGeo = new THREE.BoxGeometry(0.1, 1.2, 0.1).translate(0, 0.6, 0);
  const posts = ctx.instances('fencePosts', postGeo, 'woodDark', { mode: 'inst' });
  for (let z = -260; z <= 260; z += 3.2) {
    const m = new THREE.Matrix4().makeRotationY((r() - 0.5) * 0.3).setPosition(37.5 + (r() - 0.5) * 0.15, 0, z);
    m.multiply(new THREE.Matrix4().makeRotationZ((r() - 0.5) * 0.12));
    posts.add(m, new THREE.Vector3(37.5, 0.8, z), new THREE.Vector3(-1, 0, 0));
  }

  // ------------------------------------------------------------ trees (instanced variants)
  mats.define('leaves', { alphaMap: ctx.tex.leaves, roughness: 0.85, color: 0xffffff, porosity: 0.3, wetRough: 0.3 });
  const variants = [makeTreeVariant(11, 0.8), makeTreeVariant(23, 0.7), makeTreeVariant(37, 0.85), makeTreeVariant(51, 0.6)];
  const placements = [];
  // field across the road: scattered savanna-like trees in clusters
  for (let i = 0; i < 140; i++) {
    const z = -300 + r() * 600;
    const x = 44 + r() * 160;
    placements.push([x, z, 0.8 + r() * 0.7]);
  }
  // behind the store + north/south of the lot
  for (let i = 0; i < 70; i++) {
    let x, z;
    do { x = -120 + r() * 150; z = -200 + r() * 400; } while ((x > -26 && x < 34 && z > -40 && z < 46) || (x > 20 && x < 40));
    placements.push([x, z, 0.8 + r() * 0.7]);
  }
  // a few close, characterful trees
  placements.push([-15, 22, 1.25], [-19, -10, 1.15], [14, 40, 1.1], [42, -14, 1.3], [41, 22, 1.2]);
  const byVar = variants.map(() => []);
  placements.forEach((p, i) => byVar[i % variants.length].push(p));
  variants.forEach((v, vi) => {
    const trunks = ctx.instances('trunks' + vi, v.trunk, 'bark', { mode: 'inst' });
    const cardGeo = new THREE.PlaneGeometry(1, 1);
    const leaves = ctx.instances('leaves' + vi, cardGeo, 'leaves', { mode: 'inst', alphaMap: ctx.tex.leaves });
    for (const [x, z, s] of byVar[vi]) {
      const rot = r() * Math.PI * 2;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(s, s, s));
      trunks.add(m, new THREE.Vector3(x, 1.5 * s, z), new THREE.Vector3(0, 1, 0));
      for (const c of v.cards) {
        // two crossed cards per cluster, mostly horizontal-ish for a flat canopy
        for (let k = 0; k < 2; k++) {
          const lp = c.pos.clone().applyMatrix4(m);
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + (k ? 0.9 : -0.35), c.rot + k * 1.6 + rot, 0, 'YXZ'));
          const sc = c.size * s;
          const cm = new THREE.Matrix4().compose(lp, q, new THREE.Vector3(sc, sc * 0.8, sc));
          leaves.add(cm, lp, new THREE.Vector3(0, 1, 0));
        }
      }
    }
  });

  // ------------------------------------------------------------ grass tufts (no reflection, no shadow)
  const tuftGeo = new THREE.PlaneGeometry(0.7, 0.55).translate(0, 0.27, 0);
  const tuftGeo2 = tuftGeo.clone().rotateY(Math.PI / 2);
  const tg = merge([tuftGeo, tuftGeo2]);
  mats.define('grassTuft', { alphaMap: ctx.tex.grass, roughness: 0.8, color: 0xffffff, porosity: 0.3, wetRough: 0.25 });
  const tufts = ctx.instances('grassTufts', tg, 'grassTuft', { mode: 'inst', castShadow: false });
  const tuftAt = (x, z, s) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI), new THREE.Vector3(s, s * (0.7 + r() * 0.8), s));
    tufts.add(m, new THREE.Vector3(x, 0.3, z), new THREE.Vector3(0, 1, 0));
  };
  // along the lot edge / shoulders / cracks
  for (let i = 0; i < 900; i++) {
    const z = -70 + r() * 150;
    const side = r();
    let x;
    if (side < 0.35) x = 22.8 + r() * 1.2; // lot-road shoulder
    else if (side < 0.6) x = 31.8 + r() * 6; // beyond road
    else if (side < 0.8) x = -12 - r() * 25; // behind the store
    else { x = 33 + r() * 25; }
    tuftAt(x, z, 0.6 + r() * 0.8);
  }
  // weeds along the store façade base and in slab joints
  for (let i = 0; i < 60; i++) tuftAt(0.15 + r() * 0.35, -6.5 + r() * 21, 0.4 + r() * 0.4);
  for (let i = 0; i < 40; i++) { const jx = Math.round((2 + r() * 20) / 4.5) * 4.5; tuftAt(jx + (r() - 0.5) * 0.1, -25 + r() * 55, 0.3 + r() * 0.3); }

  // ------------------------------------------------------------ road signs
  {
    if (!mats.custom.signRoad) mats.define('signRoad', { map: signTexture('roadSign'), roughness: 0.35, porosity: 0.1, wetRough: 0.08, metalness: 0.2 });
    const sx = 33.2, sz = 40;
    b.cylinder('steel', [sx, 0, sz - 0.9], 0.04, 3.1, { segments: 8, subdiv: 2 });
    b.cylinder('steel', [sx, 0, sz + 0.9], 0.04, 3.1, { segments: 8, subdiv: 2 });
    b.quad('signRoad', [sx - 0.03, 2.6, sz], [0, 0, 1], [0, 1, 0], 1.2, 0.6, { mode: 'vtx', subdiv: 3, uvFit: true });
    b.box('steel', [sx, 2.6, sz], [0.03, 1.2, 2.4], { mode: 'vtx', subdiv: 2, skip: ['nx'] });
  }
}
