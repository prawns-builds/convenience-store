import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SITE } from '../site.js';
import { GROUP } from '../World.js';
import { signTexture, productAtlas } from '../../gfx/CanvasTextures.js';
import { emissiveMaterial } from '../../gfx/Materials.js';

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ---------------------------------------------------------------- product geometry
function bottleGeo() {
  const pts = [];
  const prof = [[0, 0], [0.032, 0], [0.035, 0.01], [0.035, 0.15], [0.03, 0.18], [0.014, 0.21], [0.012, 0.235], [0.013, 0.24], [0, 0.24]];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 10);
}
function canGeo() { return new THREE.CylinderGeometry(0.033, 0.033, 0.122, 12).translate(0, 0.061, 0); }
function boxGeo() { return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); }
function bagGeo() { return new RoundedBoxGeometry(1, 1, 1, 2, 0.35).translate(0, 0.5, 0); }

export function buildInterior(ctx) {
  const { b, mats } = ctx;
  const r = rng(4242);
  const atlas = productAtlas();
  const PATCH_ATLAS = {
    variant: 'products',
    vertPre: 'attribute vec2 aCell;\n',
    afterUvVertex: '#ifdef USE_MAP\n vMapUv = (uv * 0.94 + 0.03) * 0.125 + aCell;\n#endif\n',
  };
  mats.define('products', { map: atlas.texture, roughness: 0.42, patch: PATCH_ATLAS });
  mats.define('productsGloss', { map: atlas.texture, roughness: 0.18, metalness: 0.0, patch: { ...PATCH_ATLAS, variant: 'productsG' } });

  // instanced product sets
  const sets = {};
  const mk = (name, geo, mat, region = 'int') => {
    const s = ctx.instances(name, geo, mat, { region, mode: 'inst', castShadow: true });
    s.cells = [];
    s.place = (pos, rotY, scale, bakeN) => {
      const m = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), scale);
      const bp = pos.clone().add(new THREE.Vector3(0, scale.y * 0.5, 0)).addScaledVector(bakeN, 0.06);
      s.add(m, bp, bakeN);
      const cell = s.cellPick();
      s.cells.push(cell[0] / 8, cell[1] / 8);
    };
    s.cur = [0, 0]; s.left = 0;
    s.cellPick = () => { if (s.left-- <= 0) { s.cur = [Math.floor(r() * 8), Math.floor(r() * 8)]; s.left = 2 + Math.floor(r() * 6); } return s.cur; };
    sets[name] = s;
    return s;
  };
  mk('pBoxes', boxGeo(), 'products');
  mk('pBags', bagGeo(), 'productsGloss');
  mk('pCans', canGeo(), 'productsGloss');
  mk('pBottles', bottleGeo(), 'productsGloss');
  mk('pBoxesBack', boxGeo(), 'cardboard', 'back');

  // fill a shelf (products facing +dir along z, or along x for coolers)
  const fillRun = (x0, x1, y, zFront, dir, depth, axis = 'x', opts = {}) => {
    const kinds = opts.kinds ?? ['box', 'bag', 'can', 'bottle', 'candy'];
    const kind = kinds[Math.floor(r() * kinds.length)];
    const S = {
      box: { set: sets.pBoxes, w: 0.17 + r() * 0.06, h: 0.2 + r() * 0.1, d: 0.06 + r() * 0.03, rows: 2 },
      bag: { set: sets.pBags, w: 0.19, h: 0.26 + r() * 0.06, d: 0.08, rows: 2 },
      can: { set: sets.pCans, w: 0.07, h: 1, d: 0.07, rows: 4 },
      bottle: { set: sets.pBottles, w: 0.075, h: 1, d: 0.075, rows: 4 },
      candy: { set: sets.pBoxes, w: 0.1, h: 0.14, d: 0.025, rows: 3 },
    }[kind];
    let t = x0 + 0.03;
    const end = x1 - 0.03;
    const bakeN = axis === 'x' ? new THREE.Vector3(0, 0, dir) : new THREE.Vector3(dir, 0, 0);
    while (t + S.w < end) {
      if (r() < (opts.gap ?? 0.07)) { t += S.w * (1 + r() * 2); continue; }
      const rows = Math.min(S.rows, Math.max(1, Math.floor(depth / (S.d + 0.01))));
      const nRows = Math.max(1, rows - (r() < 0.25 ? 1 : 0));
      for (let k = 0; k < nRows; k++) {
        const off = -dir * (k * (S.d + 0.012) + S.d / 2 + 0.01);
        const pos = axis === 'x' ? new THREE.Vector3(t + S.w / 2, y, zFront + off) : new THREE.Vector3(zFront + off, y, t + S.w / 2);
        const rot = axis === 'x' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        const jitterRot = (r() - 0.5) * 0.12;
        if (kind === 'can' || kind === 'bottle') S.set.place(pos, rot + jitterRot, new THREE.Vector3(1, 1, 1), bakeN);
        else S.set.place(pos, rot + jitterRot, new THREE.Vector3(S.w * 0.96, S.h, S.d), bakeN);
      }
      t += S.w + 0.008;
    }
  };

  // ================================================================== GONDOLAS (aisles)
  const gondola = (x0, x1, zc) => {
    const L = x1 - x0, xc = (x0 + x1) / 2;
    b.region = 'int';
    b.box('metalShelf', [xc, 0.07, zc], [L, 0.14, 0.96], { mode: 'vtx', subdiv: 3 });
    b.box('metalShelf', [xc, 0.85, zc], [L, 1.5, 0.05], { lm: 18 });
    b.box('metalShelf', [xc, 1.62, zc], [L + 0.02, 0.04, 0.12], { mode: 'vtx', subdiv: 3 });
    // end caps
    for (const e of [-1, 1]) b.box('metalShelf', [xc + e * (L / 2 + 0.02), 0.78, zc], [0.04, 1.56, 0.96], { lm: 18 });
    const levels = [0.16, 0.52, 0.88, 1.22];
    for (const s of [1, -1]) {
      const zf = zc + s * 0.47;
      for (const y of levels) {
        b.box('metalShelf', [xc, y, zc + s * 0.25], [L, 0.025, 0.45], { mode: 'vtx', subdiv: 3 });
        // price channel strip
        b.box('plasticWhite', [xc, y - 0.01, zf + s * 0.005], [L, 0.04, 0.012], { mode: 'vtx', subdiv: 2 });
        fillRun(x0, x1, y + 0.0125, zf - s * 0.01, s, 0.42, 'x');
      }
    }
    b.boxCollider([xc, 0.8, zc], [L + 0.1, 1.6, 1.0]);
  };
  gondola(-7.4, -3.0, -4.55);
  gondola(-7.4, -3.0, -1.55);
  // short end display near entrance (chips rack)
  b.region = 'int';
  b.box('metalShelf', [-2.3, 0.55, 0.35], [0.9, 1.1, 0.5], { mode: 'vtx', subdiv: 3 });
  for (const y of [0.3, 0.65, 1.0]) fillRun(-2.72, -1.88, y, 0.62, 1, 0.22, 'x', { kinds: ['bag'] });
  b.boxCollider([-2.3, 0.6, 0.35], [0.95, 1.2, 0.55]);

  // knocked over items on the floor of aisle 2
  for (let i = 0; i < 5; i++) {
    const pos = new THREE.Vector3(-6.5 + r() * 3, 0.0, -3.05 + (r() - 0.5) * 0.8);
    const m = new THREE.Matrix4().compose(pos.clone().setY(0.035), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, r() * 6.28, 0)), new THREE.Vector3(0.19, 0.27, 0.07));
    sets.pBoxes.add(m, pos.clone().setY(0.1), new THREE.Vector3(0, 1, 0));
    sets.pBoxes.cells.push(Math.floor(r() * 8) / 8, Math.floor(r() * 8) / 8);
  }
  for (let i = 0; i < 4; i++) {
    const pos = new THREE.Vector3(-5.2 + r() * 1.5, 0.034, -2.9 + r() * 0.6);
    const m = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * 6.28, Math.PI / 2)), new THREE.Vector3(1, 1, 1));
    sets.pCans.add(m, pos.clone().setY(0.1), new THREE.Vector3(0, 1, 0));
    sets.pCans.cells.push(Math.floor(r() * 8) / 8, Math.floor(r() * 8) / 8);
  }

  // ================================================================== COOLER BANK (back wall)
  const CX0 = -9.7, CX1 = -8.82, CZ0 = -6.45, CZ1 = 2.55, CH = 2.2;
  const nDoors = 12, dw = (CZ1 - CZ0) / nDoors;
  b.region = 'int';
  b.box('plasticWhite', [CX0 + 0.04, CH / 2, (CZ0 + CZ1) / 2], [0.06, CH, CZ1 - CZ0], { faces: ['px'], lm: 14 });
  b.box('plasticBlack', [(CX0 + CX1) / 2, 0.14, (CZ0 + CZ1) / 2], [CX1 - CX0, 0.28, CZ1 - CZ0], { faces: ['px', 'py'], mode: 'vtx', subdiv: 2 });
  b.box('metalDark', [(CX0 + CX1) / 2, CH + 0.18, (CZ0 + CZ1) / 2], [CX1 - CX0 + 0.04, 0.36, CZ1 - CZ0 + 0.04], { lm: 14, skip: ['nx'] });
  b.box('metalDark', [(CX0 + CX1) / 2, CH / 2, CZ0 - 0.03], [CX1 - CX0, CH, 0.06], { lm: 14, skip: ['nx'] });
  b.box('metalDark', [(CX0 + CX1) / 2, CH / 2, CZ1 + 0.03], [CX1 - CX0, CH, 0.06], { lm: 14, skip: ['nx'] });
  // inner ceiling of cooler
  b.quad('plasticWhite', [(CX0 + CX1) / 2, CH - 0.01, (CZ0 + CZ1) / 2], [1, 0, 0], [0, 0, 1], (CX1 - CX0) / 2, (CZ1 - CZ0) / 2, { lm: 10 });
  // lit header sign
  const hdr = mats.registerEmissive('emCoolerHeader', emissiveMaterial(0xffffff, 1.6, { map: signTexture('coolerHeader') }));
  b.quad('emCoolerHeader', [CX1 + 0.021, CH + 0.18, (CZ0 + CZ1) / 2], [0, 0, -1], [0, 1, 0], (CZ1 - CZ0) / 2 - 0.1, 0.15, { mode: 'none', uvFit: true });
  const shelfY = [0.42, 0.78, 1.14, 1.5, 1.86];
  const deadSection = [8, 9];
  for (let i = 0; i < nDoors; i++) {
    const z0 = CZ0 + i * dw, z1 = z0 + dw;
    // interior wire shelves + stock
    for (const y of shelfY) {
      b.box('metalShelf', [(CX0 + CX1) / 2 - 0.03, y, (z0 + z1) / 2], [CX1 - CX0 - 0.1, 0.02, dw - 0.02], { mode: 'vtx', subdiv: 3 });
      if (r() < 0.93) fillRun(z0 + 0.02, z1 - 0.02, y + 0.01, CX1 - 0.08, 1, 0.65, 'z', { kinds: ['can', 'bottle', 'bottle'], gap: 0.12 });
    }
    // mullion + glass door + handle
    b.box('frame', [CX1 + 0.02, CH / 2, z0], [0.05, CH, 0.05], { mode: 'vtx', subdiv: 3 });
    b.quad('glassCooler', [CX1 + 0.02, CH / 2 + 0.06, (z0 + z1) / 2], [0, 0, -1], [0, 1, 0], dw / 2 - 0.035, CH / 2 - 0.1, { mode: 'none' });
    b.box('frame', [CX1 + 0.02, 0.31, (z0 + z1) / 2], [0.05, 0.06, dw], { mode: 'vtx', subdiv: 2 });
    b.box('frame', [CX1 + 0.02, CH - 0.03, (z0 + z1) / 2], [0.05, 0.06, dw], { mode: 'vtx', subdiv: 2 });
    b.box('chrome', [CX1 + 0.075, 1.15, z1 - 0.07], [0.025, 0.9, 0.025], { mode: 'vtx', subdiv: 4 });
    // LED strip inside mullion
    const dead = deadSection.includes(i);
    b.box(dead ? 'plasticWhite' : 'emCooler', [CX1 - 0.02, CH / 2, z0 + 0.03], [0.012, CH - 0.5, 0.02], { mode: dead ? 'vtx' : 'none', subdiv: 2 });
    if (i % 2 === 0 && !dead) {
      ctx.light({ kind: 'tube', a: [CX1 - 0.06, 0.35, z1], b: [CX1 - 0.06, CH - 0.15, z1], color: 0xe2ecff, intensity: 2.3, lambert: 0, range: 9, soft: 0.25, glow: { power: 0.35, exterior: false, down: 0, color: 0xe2ecff } });
    }
  }
  b.box('frame', [CX1 + 0.02, CH / 2, CZ1], [0.05, CH, 0.05], { mode: 'vtx', subdiv: 3 });
  b.boxCollider([(CX0 + CX1) / 2 + 0.1, 1, (CZ0 + CZ1) / 2], [CX1 - CX0 + 0.25, 2, CZ1 - CZ0]);

  // ================================================================== COUNTER
  const KZ0 = 4.2, KZ1 = 4.92, KX0 = -4.3, KX1 = -0.55;
  b.region = 'int';
  b.box('laminate', [(KX0 + KX1) / 2, 0.5, (KZ0 + KZ1) / 2], [KX1 - KX0, 0.9, KZ1 - KZ0], { lm: 20, skip: ['ny'] });
  b.box('plasticBlack', [(KX0 + KX1) / 2, 0.05, KZ0 + 0.02], [KX1 - KX0, 0.1, 0.04], { mode: 'vtx', subdiv: 2 });
  b.box('counterTop', [(KX0 + KX1) / 2, 0.97, (KZ0 + KZ1) / 2], [KX1 - KX0 + 0.08, 0.05, KZ1 - KZ0 + 0.1], { lm: 24 });
  b.box('metalRed', [(KX0 + KX1) / 2, 0.62, KZ0 - 0.004], [KX1 - KX0, 0.06, 0.01], { mode: 'vtx', subdiv: 2 });
  b.boxCollider([(KX0 + KX1) / 2, 0.5, (KZ0 + KZ1) / 2], [KX1 - KX0, 1, KZ1 - KZ0 + 0.1]);
  // register
  b.box('plasticWhite', [-1.5, 1.07, 4.62], [0.42, 0.14, 0.36], { mode: 'vtx', subdiv: 6 });
  b.pushEuler(-1.5, 1.25, 4.7, -0.5, 0, 0);
  b.box('plasticGrey', [0, 0, 0], [0.32, 0.2, 0.04], { mode: 'vtx', subdiv: 5 });
  b.pop();
  b.box('plasticBlack', [-1.5, 1.03, 4.38], [0.38, 0.07, 0.2], { mode: 'vtx', subdiv: 4 }); // open drawer
  b.box('plasticGrey', [-1.05, 1.06, 4.65], [0.16, 0.12, 0.2], { mode: 'vtx', subdiv: 3 }); // receipt printer
  // CCTV monitor on the counter (screen faces clerk side +z)
  b.box('plasticGrey', [-2.6, 1.17, 4.68], [0.36, 0.34, 0.34], { mode: 'vtx', subdiv: 5 });
  ctx.cctvScreens = ctx.cctvScreens ?? [];
  ctx.cctvScreens.push({ pos: [-2.6, 1.18, 4.852], normal: [0, 0, 1], w: 0.28, h: 0.22, region: 'int' });
  // lottery dispenser
  b.box('glass', [-3.6, 1.12, 4.42], [0.4, 0.26, 0.2], { mode: 'none' });
  for (let i = 0; i < 6; i++) b.box(['metalRed', 'metalYellow', 'metalBlue', 'metalGreen'][i % 4], [-3.75 + i * 0.06, 1.11, 4.42], [0.05, 0.2, 0.012], { mode: 'vtx', subdiv: 2 });
  // coffee cup (still warm?) + the note
  b.cylinder('plasticWhite', [-2.05, 1.0, 4.45], 0.04, 0.12, { segments: 12, radiusTop: 0.046, subdiv: 2 });
  b.cylinder('plasticBlack', [-2.05, 1.12, 4.45], 0.047, 0.012, { segments: 12, subdiv: 1 });
  {
    const t = signTexture('rulesNote');
    mats.define('noteRules', { map: t, roughness: 0.8 });
    b.pushEuler(-2.45, 0.998, 4.4, -Math.PI / 2, 0.35, 0, 'YXZ');
    b.quad('noteRules', [0, 0, 0], [1, 0, 0], [0, 1, 0], 0.075, 0.1, { mode: 'vtx', subdiv: 1, uvFit: true, region: 'int' });
    b.pop();
    ctx.interact({ name: 'rules', pos: new THREE.Vector3(-2.45, 1.0, 4.4), radius: 0.45, prompt: () => '[E] READ NOTE', action: (g) => g.showNote('rules') });
  }
  // candy rack in front of the counter
  b.box('metalShelf', [-3.0, 0.45, 4.05], [0.9, 0.9, 0.25], { mode: 'vtx', subdiv: 3 });
  for (const y of [0.25, 0.55, 0.85]) fillRun(-3.42, -2.58, y, 3.94, -1, 0.2, 'x', { kinds: ['candy'], gap: 0.03 });

  // behind the counter: cigarette rack on the partition + phone + clock
  b.box('metalDark', [-2.4, 1.85, SITE.partitionZ - 0.18], [3.4, 1.3, 0.32], { lm: 16, skip: ['pz'] });
  for (let row = 0; row < 6; row++) {
    for (let i = 0; i < 26; i++) {
      const pos = new THREE.Vector3(-4.0 + i * 0.124, 1.26 + row * 0.205, SITE.partitionZ - 0.33);
      sets.pBoxes.place(pos, Math.PI, new THREE.Vector3(0.056, 0.088, 0.022), new THREE.Vector3(0, 0, -1));
    }
  }
  b.box('plasticWhite', [-0.75, 1.55, SITE.partitionZ - 0.04], [0.2, 0.26, 0.08], { mode: 'vtx', subdiv: 4 });
  b.box('plasticWhite', [-0.75, 1.6, SITE.partitionZ - 0.095], [0.06, 0.22, 0.05], { mode: 'vtx', subdiv: 3 });
  ctx.interact({ name: 'wallphone', pos: new THREE.Vector3(-0.75, 1.55, SITE.partitionZ - 0.1), radius: 0.45, prompt: () => '[E] PICK UP PHONE', action: (g) => g.events?.wallphone?.() });
  {
    const cl = signTexture('clock');
    mats.define('clockFace', { map: cl, roughness: 0.3 });
    b.quad('clockFace', [-4.4, 2.55, SITE.partitionZ - 0.02], [-1, 0, 0], [0, 1, 0], 0.16, 0.16, { mode: 'vtx', subdiv: 2, uvFit: true });
    const cal = signTexture('calendar');
    mats.define('calendarTex', { map: cal, roughness: 0.8 });
    b.quad('calendarTex', [-0.25 - 0.06, 1.6, 5.4], [0, 0, -1], [0, 1, 0], 0.14, 0.21, { mode: 'vtx', subdiv: 2, uvFit: true });
  }

  // pendant lamps above the counter (warm domes)
  for (const px of [-1.4, -3.3]) {
    const y = 2.42;
    b.cylinder('plasticBlack', [px, y + 0.18, 4.55], 0.006, SITE.store.ceilY - y - 0.18, { segments: 4, subdiv: 1 });
    b.cylinder('metalRed', [px, y, 4.55], 0.25, 0.2, { segments: 20, radiusTop: 0.06, caps: [false, true], subdiv: 2 });
    b.cylinder('emPendant', [px, y + 0.03, 4.55], 0.07, 0.005, { segments: 16, mode: 'none', caps: [true, false] });
    b.cylinder('plasticBlack', [px, y + 0.005, 4.55], 0.235, 0.004, { segments: 20, mode: 'vtx', caps: [true, false], subdiv: 1 });
    ctx.light({ kind: 'point', pos: [px, y - 0.04, 4.55], radius: 0.08, color: 0xffa860, intensity: 3.0, axis: [0, -1, 0], lambert: 0.5, cone: [-0.05, 0.35], range: 11, soft: 0.2, glow: { power: 0.6, exterior: false, down: 0.9, color: 0xffb070 } });
  }

  // ================================================================== CEILING FIXTURES (troffers)
  mats.define('trofferLens', { color: 0xe8e8e8, roughness: 0.3, emissive: 0xf2f6ff, emissiveIntensity: 9, group: GROUP.BREAKER });
  mats.define('trofferLensF', { color: 0xe8e8e8, roughness: 0.3, emissive: 0xf2f6ff, emissiveIntensity: 9, group: GROUP.FLICKER_INT });
  const tr = [[-3.35, -4.27], [-6.4, -4.27], [-3.35, -1.22], [-6.4, -1.22], [-3.35, 1.83], [-6.4, 1.83]];
  tr.forEach(([tx, tz], i) => {
    const flick = i === 3;
    b.box('plasticWhite', [tx, SITE.store.ceilY - 0.01, tz], [0.64, 0.02, 1.24], { mode: 'vtx', subdiv: 3, faces: ['ny'] });
    b.quad(flick ? 'trofferLensF' : 'trofferLens', [tx, SITE.store.ceilY - 0.022, tz], [1, 0, 0], [0, 0, 1], 0.28, 0.58, { mode: 'none', region: 'int' });
    ctx.light({ kind: 'rect', pos: [tx, SITE.store.ceilY - 0.06, tz], u: [1, 0, 0], v: [0, 0, 1], size: [0.56, 1.16], color: 0xf2f6ff, intensity: 7.5, group: flick ? GROUP.FLICKER_INT : GROUP.BREAKER, axis: [0, -1, 0], lambert: 1.0, cone: [-0.05, 0.15], range: 16, soft: 0.4 });
  });
  // exit sign above the entrance (inside)
  {
    const ex = mats.registerEmissive('emExit', emissiveMaterial(0xffffff, 3.0, { map: signTexture('exitSign') }));
    b.box('plasticWhite', [-0.45, 2.62, 2.6], [0.12, 0.2, 0.42], { mode: 'vtx', subdiv: 2 });
    b.quad('emExit', [-0.515, 2.62, 2.6], [0, 0, 1], [0, 1, 0], 0.19, 0.09, { mode: 'none', uvFit: true });
    ctx.light({ kind: 'point', pos: [-0.62, 2.62, 2.6], color: 0x40ff70, intensity: 0.25, radius: 0.05, range: 5, soft: 0.2 });
  }
  // security camera dome in the corner
  b.box('plasticWhite', [-0.6, 2.93, -6.4], [0.14, 0.1, 0.14], { mode: 'vtx', subdiv: 2 });
  b.cylinder('plasticBlack', [-0.6, 2.82, -6.4], 0.06, 0.08, { segments: 10, subdiv: 1 });

  // ================================================================== COFFEE STATION (north wall)
  {
    const z0 = -6.7, d = 0.62, x0 = -8.6, x1 = -5.2;
    b.box('laminate', [(x0 + x1) / 2, 0.45, z0 + d / 2], [x1 - x0, 0.9, d], { lm: 18, skip: ['ny', 'nz'] });
    b.box('counterTop', [(x0 + x1) / 2, 0.925, z0 + d / 2], [x1 - x0 + 0.04, 0.05, d + 0.04], { lm: 20 });
    b.boxCollider([(x0 + x1) / 2, 0.5, z0 + d / 2], [x1 - x0, 1, d]);
    for (const cx of [-8.15, -7.55]) {
      b.box('plasticBlack', [cx, 1.27, z0 + 0.25], [0.42, 0.65, 0.4], { mode: 'vtx', subdiv: 5 });
      b.cylinder('emRed', [cx, 0.952, z0 + 0.42], 0.075, 0.006, { segments: 12, mode: 'none' });
      b.cylinder('glass', [cx, 0.96, z0 + 0.42], 0.07, 0.17, { segments: 12, mode: 'none' });
    }
    b.cylinder('plasticWhite', [-6.95, 0.95, z0 + 0.3], 0.045, 0.45, { segments: 10, subdiv: 2 });
    b.cylinder('plasticWhite', [-6.8, 0.95, z0 + 0.3], 0.055, 0.4, { segments: 10, subdiv: 2 });
    // microwave + hot dog roller
    b.box('plasticGrey', [-5.85, 1.12, z0 + 0.28], [0.5, 0.32, 0.4], { mode: 'vtx', subdiv: 4 });
    b.box('plasticBlack', [-5.92, 1.12, z0 + 0.483], [0.3, 0.22, 0.01], { mode: 'vtx', subdiv: 2 });
    b.box('steel', [-6.45, 1.02, z0 + 0.32], [0.5, 0.12, 0.38], { mode: 'vtx', subdiv: 3 });
    for (let i = 0; i < 6; i++) b.cylinder('emBulbDim', [-6.68 + i * 0.09, 1.09, z0 + 0.15], 0.012, 0.32, { segments: 6, mode: 'none' });
    ctx.light({ kind: 'point', pos: [-6.45, 1.15, z0 + 0.4], color: 0xff7030, intensity: 0.25, radius: 0.15, range: 4, soft: 0.2 });
    // poster above
    mats.define('posterCoffee', { map: signTexture('poster', { v: 1 }), roughness: 0.5 });
    b.quad('posterCoffee', [-7.0, 1.95, z0 + 0.32 - 0.31], [1, 0, 0], [0, 1, 0], 0.28, 0.42, { mode: 'vtx', subdiv: 2, uvFit: true });
  }

  // ================================================================== ICE CREAM FREEZER (front corner)
  {
    const x0 = -1.75, x1 = -0.65, z0 = -6.25, z1 = -4.65, h = 0.85;
    b.box('metalWhite', [(x0 + x1) / 2, h / 2, (z0 + z1) / 2], [x1 - x0, h, z1 - z0], { mode: 'vtx', subdiv: 5, skip: ['py'] });
    b.quad('glassCooler', [(x0 + x1) / 2, h + 0.005, (z0 + z1) / 2], [1, 0, 0], [0, 0, -1], (x1 - x0) / 2 - 0.04, (z1 - z0) / 2 - 0.04, { mode: 'none' });
    b.quad('emCooler', [(x0 + x1) / 2, h - 0.25, (z0 + z1) / 2], [1, 0, 0], [0, 0, -1], (x1 - x0) / 2 - 0.06, (z1 - z0) / 2 - 0.06, { mode: 'none' });
    ctx.light({ kind: 'rect', pos: [(x0 + x1) / 2, h + 0.05, (z0 + z1) / 2], u: [1, 0, 0], v: [0, 0, 1], size: [0.9, 1.4], color: 0xdde8ff, intensity: 0.6, axis: [0, 1, 0], lambert: 1, cone: [-0.05, 0.2], range: 6, soft: 0.4 });
    b.boxCollider([(x0 + x1) / 2, 0.45, (z0 + z1) / 2], [x1 - x0, 0.9, z1 - z0]);
  }

  // ================================================================== ATM
  {
    const ax = -7.6, az = SITE.partitionZ - 0.3;
    b.box('metalBlue', [ax, 0.75, az], [0.62, 1.5, 0.55], { mode: 'vtx', subdiv: 5 });
    const atm = mats.registerEmissive('emATM', emissiveMaterial(0xffffff, 1.4, { map: signTexture('atmScreen') }));
    b.pushEuler(ax, 1.22, az - 0.29, -0.25, Math.PI, 0);
    b.quad('emATM', [0, 0, 0], [1, 0, 0], [0, 1, 0], 0.16, 0.12, { mode: 'none', uvFit: true });
    b.pop();
    b.box('plasticBlack', [ax, 0.98, az - 0.3], [0.3, 0.08, 0.1], { mode: 'vtx', subdiv: 2 });
    ctx.light({ kind: 'point', pos: [ax, 1.25, az - 0.5], color: 0x7ab0ff, intensity: 0.3, radius: 0.1, range: 4, soft: 0.3 });
    b.boxCollider([ax, 0.75, az], [0.65, 1.5, 0.6]);
  }

  // ================================================================== ENTRANCE: mat, wet floor sign, trash can
  b.box('rubber', [-1.15, 0.005, 2.6], [1.5, 0.01, 1.7], { mode: 'vtx', subdiv: 2, region: 'int' });
  {
    // yellow A-frame wet floor sign
    b.pushTRS(-2.4, 0, 1.15, 0.5);
    for (const s of [1, -1]) {
      b.pushEuler(0, 0.32, s * 0.09, s * 0.25, 0, 0);
      b.box('metalYellow', [0, 0, 0], [0.3, 0.64, 0.015], { mode: 'vtx', subdiv: 4 });
      b.pop();
    }
    b.pop();
    b.circleCollider([-2.4, 0, 1.15], 0.25, 0, 0.7);
  }
  b.cylinder('plasticGrey', [-0.75, 0, 0.75], 0.24, 0.75, { segments: 14, subdiv: 3 });
  b.circleCollider([-0.75, 0, 0.75], 0.28, 0, 0.8);

  // window posters (inside, facing out) + paper backs
  const posters = [[-5.2, 1.55, 0], [-3.0, 1.45, 3], [0.6, 1.55, -1], [4.4, 1.5, 2], [5.6, 1.55, 4]];
  posters.forEach(([z, y, v], i) => {
    const key = 'poster' + i;
    const tex = v < 0 ? signTexture('missing') : signTexture('poster', { v });
    mats.define(key, { map: tex, roughness: 0.6 });
    b.quad(key, [-0.18, y, z], [0, 0, -1], [0, 1, 0], 0.3, 0.45, { mode: 'vtx', subdiv: 2, uvFit: true, region: 'ext' });
    b.quad('plasticWhite', [-0.181, y, z], [0, 0, 1], [0, 1, 0], 0.3, 0.45, { mode: 'vtx', subdiv: 2, region: 'int' });
  });

  // ================================================================== BACK AREA
  b.region = 'back';
  // --- stockroom shelving with boxes
  const rack = (x0, x1, z, depth, facing) => {
    const L = x1 - x0, xc = (x0 + x1) / 2;
    for (const y of [0.12, 0.85, 1.58, 2.25]) {
      b.box('steel', [xc, y, z], [L, 0.03, depth], { mode: 'vtx', subdiv: 3 });
      if (y < 2.2) {
        let t = x0 + 0.05;
        while (t < x1 - 0.35) {
          const w = 0.3 + r() * 0.3, h = 0.25 + r() * 0.3, d = depth * (0.6 + r() * 0.35);
          if (r() < 0.85) sets.pBoxesBack.place(new THREE.Vector3(t + w / 2, y + 0.015, z + (r() - 0.5) * 0.05), (r() - 0.5) * 0.1, new THREE.Vector3(w, h, d), new THREE.Vector3(0, 0, facing));
          t += w + 0.04 + r() * 0.1;
        }
      }
    }
    for (const xx of [x0, x1]) for (const zz of [z - depth / 2, z + depth / 2]) b.box('steel', [xx, 1.2, zz], [0.04, 2.4, 0.04], { mode: 'vtx', subdiv: 3 });
    b.boxCollider([xc, 1, z], [L, 2, depth + 0.05]);
  };
  rack(-6.6, -3.0, 14.3, 0.6, -1);
  rack(-4.5, -2.3, 7.15, 0.6, 1);
  // pallet with drink cases
  b.box('woodDark', [-1.4, 0.07, 9.4], [1.2, 0.14, 1.0], { mode: 'vtx', subdiv: 3 });
  for (let i = 0; i < 9; i++) sets.pBoxesBack.place(new THREE.Vector3(-1.75 + (i % 3) * 0.36, 0.14 + Math.floor(i / 3) * 0.26, 9.2 + (r() - 0.5) * 0.06), 0, new THREE.Vector3(0.34, 0.25, 0.5), new THREE.Vector3(0, 1, 0));
  b.boxCollider([-1.4, 0.5, 9.4], [1.25, 1.0, 1.05]);
  // mop sink + bucket + water heater
  b.box('porcelain', [-6.4, 0.3, 9.6], [0.6, 0.6, 0.6], { mode: 'vtx', subdiv: 4 });
  b.cylinder('metalYellow', [-5.7, 0, 9.4], 0.2, 0.38, { segments: 12, subdiv: 2 });
  b.cylinder('metalWhite', [-6.4, 0, 11.1], 0.28, 1.55, { segments: 16, subdiv: 3 });
  b.circleCollider([-6.4, 0, 11.1], 0.32, 0, 1.6);
  b.boxCollider([-6.1, 0.3, 9.5], [1.2, 0.6, 0.7]);
  // breaker panel on the front wall interior near the green door (interactive)
  {
    const bx = -0.3, bz = 11.7;
    b.box('steel', [bx - 0.06, 1.55, bz], [0.12, 0.8, 0.5], { mode: 'vtx', subdiv: 5 });
    mats.define('breakerFace', { map: signTexture('breaker'), roughness: 0.5, metalness: 0.3 });
    b.quad('breakerFace', [bx - 0.121, 1.55, bz], [0, 0, 1], [0, 1, 0], 0.22, 0.37, { mode: 'vtx', subdiv: 4, uvFit: true });
    // open panel door
    b.pushTRS(bx - 0.12, 1.55, bz + 0.25, -1.9);
    b.box('steel', [0.24, 0, 0], [0.48, 0.78, 0.012], { mode: 'vtx', subdiv: 4 });
    b.pop();
    ctx.breakerPos = new THREE.Vector3(bx - 0.15, 1.55, bz);
    ctx.interact({ name: 'breaker', pos: ctx.breakerPos.clone(), radius: 0.5, prompt: (g) => (g.world.groupLevels[0] > 0.5 ? '[E] CUT POWER (SALES FLOOR)' : '[E] RESET BREAKER'), action: (g) => g.events?.breaker?.() });
  }
  // bare bulb (stockroom)
  b.cylinder('plasticBlack', [-3.4, 2.75, 10.4], 0.005, 0.25, { segments: 4, subdiv: 1 });
  b.cylinder('emBulbDim', [-3.4, 2.68, 10.4], 0.035, 0.08, { segments: 10, mode: 'none' });
  ctx.light({ kind: 'point', pos: [-3.4, 2.66, 10.4], radius: 0.04, color: 0xffc890, intensity: 1.2, range: 10, soft: 0.1, glow: { power: 0.25, exterior: false, down: 0.3, color: 0xffa050 } });
  // fill from the bulb bounce
  ctx.light({ kind: 'point', pos: [-3.4, 0.5, 10.4], color: 0x8a7a68, intensity: 0.35, axis: [0, 1, 0], lambert: 1, cone: [-0.1, 0.2], range: 8, radius: 0.5, soft: 1 });

  // --- office: desk, CRT monitors, chair, filing cabinet, safe, desk lamp, logbook
  {
    b.box('laminate', [-9.25, 0.74, 12.4], [0.75, 0.04, 1.8], { mode: 'vtx', subdiv: 4 });
    for (const [lx, lz] of [[-9.55, 11.55], [-8.95, 11.55], [-9.55, 13.25], [-8.95, 13.25]]) b.box('steel', [lx, 0.36, lz], [0.04, 0.72, 0.04], { mode: 'vtx', subdiv: 2 });
    b.box('metalGrey' in mats.custom ? 'metalGrey' : 'plasticGrey', [-9.25, 0.36, 13.0], [0.7, 0.68, 0.45], { mode: 'vtx', subdiv: 3 });
    b.boxCollider([-9.25, 0.4, 12.4], [0.8, 0.8, 1.85]);
    for (const [mz, s] of [[11.9, 1], [12.75, 1]]) {
      b.box('plasticGrey', [-9.35, 0.98, mz], [0.4, 0.38, 0.42], { mode: 'vtx', subdiv: 5 });
      ctx.cctvScreens.push({ pos: [-9.148, 0.99, mz], normal: [1, 0, 0], w: 0.3, h: 0.24, region: 'back' });
    }
    ctx.light({ kind: 'rect', pos: [-9.0, 0.99, 12.33], u: [0, 0, 1], v: [0, 1, 0], size: [1.2, 0.3], color: 0xa8c8ff, intensity: 0.5, axis: [1, 0, 0], lambert: 1, cone: [-0.05, 0.2], range: 5, soft: 0.3 });
    b.box('plasticBlack', [-9.0, 0.775, 12.35], [0.18, 0.025, 0.45], { mode: 'vtx', subdiv: 2 });
    // desk lamp
    b.cylinder('plasticBlack', [-9.45, 0.76, 13.15], 0.08, 0.02, { segments: 10, subdiv: 1 });
    b.cylinder('plasticBlack', [-9.45, 0.78, 13.15], 0.01, 0.38, { segments: 6, subdiv: 1 });
    b.cylinder('metalGreen', [-9.38, 1.08, 13.15], 0.11, 0.12, { segments: 14, radiusTop: 0.04, subdiv: 1 });
    b.cylinder('emBulbWarm', [-9.38, 1.075, 13.15], 0.06, 0.005, { segments: 10, mode: 'none' });
    ctx.light({ kind: 'point', pos: [-9.38, 1.04, 13.15], color: 0xffb070, intensity: 0.9, radius: 0.03, axis: [0, -1, 0], lambert: 0.6, cone: [0.0, 0.3], range: 6, soft: 0.1 });
    // logbook on desk
    mats.define('logbookTex', { map: signTexture('logbook'), roughness: 0.8 });
    b.pushEuler(-9.1, 0.762, 12.95, -Math.PI / 2, 0.2, 0, 'YXZ');
    b.quad('logbookTex', [0, 0, 0], [1, 0, 0], [0, 1, 0], 0.16, 0.12, { mode: 'vtx', subdiv: 1, uvFit: true });
    b.pop();
    ctx.interact({ name: 'logbook', pos: new THREE.Vector3(-9.1, 0.8, 12.95), radius: 0.45, prompt: () => '[E] READ LOGBOOK', action: (g) => g.showNote('logbook') });
    // chair
    b.cylinder('plasticBlack', [-8.45, 0.05, 12.4], 0.28, 0.04, { segments: 5, subdiv: 1 });
    b.cylinder('steel', [-8.45, 0.08, 12.4], 0.025, 0.36, { segments: 6, subdiv: 1 });
    b.box('fabric', [-8.45, 0.47, 12.4], [0.46, 0.08, 0.46], { mode: 'vtx', subdiv: 3 });
    b.box('fabric', [-8.2, 0.78, 12.4], [0.06, 0.55, 0.44], { mode: 'vtx', subdiv: 3 });
    b.circleCollider([-8.45, 0, 12.4], 0.3, 0, 1);
    // filing cabinet + safe
    b.box('plasticGrey', [-9.4, 0.65, 14.35], [0.5, 1.3, 0.5], { mode: 'vtx', subdiv: 4 });
    for (let i = 0; i < 4; i++) b.box('chrome', [-9.14, 0.25 + i * 0.3, 14.35], [0.02, 0.02, 0.14], { mode: 'vtx', subdiv: 1 });
    b.box('metalDark', [-7.5, 0.4, 14.35], [0.6, 0.8, 0.55], { mode: 'vtx', subdiv: 4 });
    b.boxCollider([-8.4, 0.6, 14.35], [2.4, 1.2, 0.6]);
    // calendar
    mats.define('calendarOffice', { map: signTexture('calendar'), roughness: 0.8 });
    b.quad('calendarOffice', [-8.3, 1.6, 10.53], [1, 0, 0], [0, 1, 0], 0.14, 0.21, { mode: 'vtx', subdiv: 2, uvFit: true });
  }

  // --- restroom: toilet, sink, mirror, tile wainscot, flickering light
  {
    b.box('porcelain', [-9.35, 0.2, 9.4], [0.36, 0.4, 0.5], { mode: 'vtx', subdiv: 4 });
    b.cylinder('porcelain', [-9.25, 0.4, 9.15], 0.2, 0.04, { segments: 14, subdiv: 1 });
    b.box('porcelain', [-9.6, 0.62, 9.4], [0.18, 0.4, 0.5], { mode: 'vtx', subdiv: 3 });
    b.boxCollider([-9.35, 0.4, 9.3], [0.6, 0.8, 0.7]);
    b.box('porcelain', [-9.5, 0.82, 7.6], [0.4, 0.16, 0.5], { mode: 'vtx', subdiv: 3 });
    b.box('chrome', [-9.62, 0.95, 7.6], [0.06, 0.14, 0.04], { mode: 'vtx', subdiv: 1 });
    b.quad('mirrorDirty', [-9.69, 1.55, 7.6], [0, 0, -1], [0, 1, 0], 0.28, 0.38, { mode: 'vtx', subdiv: 2 });
    // tile wainscot
    for (const [cx, cz, sx, sz] of [[-9.69, 8.5, 0.01, 3.7], [-8.35, 6.81, 2.6, 0.01], [-7.01, 8.5, 0.01, 3.7]]) {
      b.box('wallTile', [cx, 0.75, cz], [sx, 1.5, sz], { lm: 14 });
    }
    // flickering vanity fixture
    b.box('metalWhite', [-9.65, 2.15, 7.6], [0.08, 0.08, 0.7], { mode: 'vtx', subdiv: 3 });
    b.box('trofferLensF', [-9.6, 2.12, 7.6], [0.02, 0.05, 0.62], { mode: 'none' });
    ctx.light({ kind: 'tube', a: [-9.52, 2.1, 7.3], b: [-9.52, 2.1, 7.9], color: 0xe8f0ff, intensity: 2.2, group: GROUP.FLICKER_INT, lambert: 0.2, range: 8, soft: 0.2 });
  }

  // ---------------------------------------------------------------- finalize atlas cell attributes
  for (const s of Object.values(sets)) {
    if (s.cells.length !== s.matrices.length * 2) {
      // pad (should not happen)
      while (s.cells.length < s.matrices.length * 2) s.cells.push(0, 0);
    }
    s.geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(s.cells), 2));
  }
  b.region = 'ext';
}
