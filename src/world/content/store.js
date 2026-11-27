import * as THREE from 'three';
import { SITE, UV } from '../site.js';
import { GROUP } from '../World.js';
import { makeFloorMaterial, makeGlassMaterial } from '../matlib.js';
import { buildDoor } from './doors.js';

// Store building: exterior shell, storefront, roof, parapet, chimney, antenna, partitions,
// ceilings and floors. Walls are emitted as boxes with per-face materials so exterior faces
// get stucco (wet/streaked) and interior faces get plaster.

const S = SITE.store;
const BAND = 0.9; // height of the green base band outside

// Emit a box with explicit per-face material/region. faces: { px: [mat, region] | null, ... }
function wbox(b, x0, x1, y0, y1, z0, z1, faces, opts = {}) {
  const pos = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const size = [x1 - x0, y1 - y0, z1 - z0];
  for (const f of ['px', 'nx', 'py', 'ny', 'pz', 'nz']) {
    const spec = faces[f];
    if (!spec) continue;
    b.box(spec[0], pos, size, { faces: [f], region: spec[1], lm: spec[2] ?? opts.lm, mode: opts.mode });
  }
  if (opts.collide !== false && y0 < 1.8 && y1 > 0.3) b.boxCollider(pos, size);
}

// Wall running along Z (thickness along X). extSide: 'px' or 'nx'. openings: [{z0,z1,y0,y1}]
function wallZ(b, { x0, x1, z0, z1, y1, extSide, intRegion, intMat = 'plaster', extMat = 'stuccoWall', band = true, openings = [], ext = true, intMat2 = null, intRegion2 = null }) {
  const cuts = [z0, z1];
  for (const o of openings) cuts.push(o.z0, o.z1);
  const zs = [...new Set(cuts)].sort((a, b) => a - b);
  const intSide = extSide === 'px' ? 'nx' : 'px';
  for (let i = 0; i < zs.length - 1; i++) {
    const a = zs[i], c = zs[i + 1];
    if (c - a < 1e-4) continue;
    const op = openings.find((o) => o.z0 <= a + 1e-4 && o.z1 >= c - 1e-4);
    const spans = op ? [[0, op.y0], [op.y1, y1]] : [[0, y1]];
    for (const [ya, yb] of spans) {
      if (yb - ya < 1e-4) continue;
      const pieces = band && ext && ya < BAND && yb > BAND ? [[ya, BAND], [BAND, yb]] : [[ya, yb]];
      for (const [p0, p1] of pieces) {
        const em = ext ? (p1 <= BAND + 1e-4 && band ? 'stuccoBand' : extMat) : intMat2 ?? intMat;
        const er = ext ? 'ext' : intRegion2 ?? intRegion;
        const faces = {};
        faces[extSide] = [em, er];
        faces[intSide] = [intMat, intRegion];
        if (!op) {
          if (a !== z0) faces.nz = [em, er];
          if (c !== z1) faces.pz = [em, er];
        } else {
          if (p1 === op.y0 && op.y0 > 0) faces.py = [em, er];
          if (p0 === op.y1) faces.ny = [em, er];
        }
        wbox(b, x0, x1, p0, p1, a, c, faces);
      }
    }
  }
}

// Wall running along X (thickness along Z)
function wallX(b, { x0, x1, z0, z1, y1, extSide, intRegion, intMat = 'plaster', extMat = 'stuccoWall', band = true, openings = [], ext = true, intMat2 = null, intRegion2 = null }) {
  const cuts = [x0, x1];
  for (const o of openings) cuts.push(o.x0, o.x1);
  const xs = [...new Set(cuts)].sort((a, b) => a - b);
  const intSide = extSide === 'pz' ? 'nz' : 'pz';
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], c = xs[i + 1];
    if (c - a < 1e-4) continue;
    const op = openings.find((o) => o.x0 <= a + 1e-4 && o.x1 >= c - 1e-4);
    const spans = op ? [[0, op.y0], [op.y1, y1]] : [[0, y1]];
    for (const [ya, yb] of spans) {
      if (yb - ya < 1e-4) continue;
      const pieces = band && ext && ya < BAND && yb > BAND ? [[ya, BAND], [BAND, yb]] : [[ya, yb]];
      for (const [p0, p1] of pieces) {
        const em = ext ? (p1 <= BAND + 1e-4 && band ? 'stuccoBand' : extMat) : intMat2 ?? intMat;
        const er = ext ? 'ext' : intRegion2 ?? intRegion;
        const faces = {};
        faces[extSide] = [em, er];
        faces[intSide] = [intMat, intRegion];
        if (!op) {
          if (a !== x0) faces.nx = [em, er];
          if (c !== x1) faces.px = [em, er];
        } else {
          if (p1 === op.y0 && op.y0 > 0) faces.py = [em, er];
          if (p0 === op.y1) faces.ny = [em, er];
        }
        wbox(b, a, c, p0, p1, z0, z1, faces);
      }
    }
  }
}

export function buildStore(ctx) {
  const { b, mats } = ctx;
  const T = S.wallT;
  const H = S.wallH;
  const PZ = SITE.partitionZ;

  // ------------------------------------------------------------------ floors (planar mapped, ground LM)
  mats.registerShared('floorVCT', makeFloorMaterial(ctx.tex));
  mats.registerShared('floorConc', makeFloorMaterial({ vct: ctx.tex.concrete }, { color: 0x8a8a86, variant: 'conc' }));
  mats.registerShared('glass', makeGlassMaterial({ opacity: 0.1 }));
  mats.registerShared('glassCooler', makeGlassMaterial({ opacity: 0.06, frost: true, color: 0xc8d8e0 }));
  const floorQuad = (mat, x0, x1, z0, z1, region) => b.quad(mat, [(x0 + x1) / 2, 0.0, (z0 + z1) / 2], [1, 0, 0], [0, 0, -1], (x1 - x0) / 2, (z1 - z0) / 2, { mode: 'ground', region, uvScale: mat === 'floorVCT' ? (UV.vct ?? 1.2192) : (ctx.tex.concrete.scan ? UV.concrete : 4) });
  floorQuad('floorVCT', -10.02, 0.02, -7.02, PZ + 0.07, 'int');
  floorQuad('floorConc', -6.94, 0.02, PZ + 0.07, 15.02, 'back');
  floorQuad('floorVCT', -10.02, -6.94, PZ + 0.07, 15.02, 'back');

  // ------------------------------------------------------------------ exterior walls
  const winOpen = SITE.windows.map(([z0, z1]) => ({ z0, z1, y0: SITE.kneeH, y1: SITE.windowTop }));
  const doorOpen = { z0: SITE.door.z0, z1: SITE.door.z1, y0: 0, y1: SITE.windowTop };
  const greenOpen = { z0: SITE.greenDoor.z0, z1: SITE.greenDoor.z1, y0: 0, y1: SITE.greenDoor.h };
  // front (east) wall: x in [-T, 0]
  wallZ(b, { x0: -T, x1: 0, z0: S.z0, z1: PZ + 0.075, y1: H, extSide: 'px', intRegion: 'int', openings: [...winOpen, doorOpen] });
  wallZ(b, { x0: -T, x1: 0, z0: PZ + 0.075, z1: S.z1, y1: H, extSide: 'px', intRegion: 'back', intMat: 'plasterBack', openings: [greenOpen] });
  // back (west) wall
  wallZ(b, { x0: S.x0, x1: S.x0 + T, z0: S.z0, z1: PZ + 0.075, y1: H, extSide: 'nx', intRegion: 'int', extMat: 'stuccoRear' });
  wallZ(b, { x0: S.x0, x1: S.x0 + T, z0: PZ + 0.075, z1: S.z1, y1: H, extSide: 'nx', intRegion: 'back', intMat: 'plasterBack', extMat: 'stuccoRear' });
  // north wall
  wallX(b, { x0: S.x0, x1: 0, z0: S.z0, z1: S.z0 + T, y1: H, extSide: 'nz', intRegion: 'int', extMat: 'stuccoRear' });
  // south wall (with a high small window in the stockroom)
  wallX(b, { x0: S.x0, x1: 0, z0: S.z1 - T, z1: S.z1, y1: H, extSide: 'pz', intRegion: 'back', intMat: 'plasterBack', openings: [{ x0: -4.2, x1: -3.2, y0: 1.9, y1: 2.5 }] });
  b.quad('glass', [-3.7, 2.2, S.z1 - T / 2], [1, 0, 0], [0, 1, 0], 0.5, 0.3, { mode: 'none', region: 'back' });

  // parapet cap (metal flashing) on top of walls
  const capH = 0.06;
  const cap = (x0, x1, z0, z1) => b.box('metalDark', [(x0 + x1) / 2, H + capH / 2, (z0 + z1) / 2], [x1 - x0 + 0.06, capH, z1 - z0 + 0.06], { mode: 'vtx', subdiv: 1, skip: ['ny'] });
  cap(-T, 0, S.z0, S.z1); cap(S.x0, S.x0 + T, S.z0, S.z1); cap(S.x0, 0, S.z0, S.z0 + T); cap(S.x0, 0, S.z1 - T, S.z1);
  // roof slab + membrane (only top visible)
  b.box('roof', [(S.x0 + 0) / 2, S.roofY + 0.1, (S.z0 + S.z1) / 2], [Math.abs(S.x0) - 2 * T, 0.2, S.z1 - S.z0 - 2 * T], { faces: ['py'], lm: 4 });
  // inner faces of parapet above roof
  b.box('stuccoRear', [-T - 0.005, (S.roofY + 0.2 + H) / 2, (S.z0 + S.z1) / 2], [0.01, H - S.roofY - 0.2, S.z1 - S.z0 - 2 * T], { faces: ['nx'], lm: 4 });
  b.box('stuccoRear', [S.x0 + T + 0.005, (S.roofY + 0.2 + H) / 2, (S.z0 + S.z1) / 2], [0.01, H - S.roofY - 0.2, S.z1 - S.z0 - 2 * T], { faces: ['px'], lm: 4 });
  b.box('stuccoRear', [S.x0 / 2, (S.roofY + 0.2 + H) / 2, S.z0 + T + 0.005], [-S.x0 - 2 * T, H - S.roofY - 0.2, 0.01], { faces: ['pz'], lm: 4 });
  b.box('stuccoRear', [S.x0 / 2, (S.roofY + 0.2 + H) / 2, S.z1 - T - 0.005], [-S.x0 - 2 * T, H - S.roofY - 0.2, 0.01], { faces: ['nz'], lm: 4 });

  // chimney (brick) + cap, roof vent, AC unit, antenna
  b.box('brick', [-6.8, H + 0.8, 11.5], [0.75, 1.6 + 0.6, 0.75], { skip: ['ny'], lm: 10 });
  b.box('metalDark', [-6.8, H + 1.95, 11.5], [0.95, 0.1, 0.95], { mode: 'vtx', subdiv: 1 });
  b.cylinder('steel', [-6.8, H + 2.0, 11.5], 0.12, 0.35, { segments: 10, mode: 'vtx' });
  b.box('metalWhite', [-3.2, S.roofY + 0.2 + 0.45, -2.5], [1.6, 0.9, 1.2], { mode: 'vtx', subdiv: 2 });
  b.box('metalDark', [-3.2, S.roofY + 0.2 + 0.92, -2.5], [1.4, 0.04, 1.0], { mode: 'vtx', subdiv: 1 });
  // antenna mast
  b.cylinder('steel', [-8.3, S.roofY + 0.2, 13.2], 0.03, 3.6, { segments: 6, mode: 'vtx', caps: [false, true] });
  for (let i = 0; i < 5; i++) {
    const y = S.roofY + 2.2 + i * 0.32, len = 1.6 - i * 0.22;
    b.pushTRS(-8.3, y, 13.2, 0.4);
    b.box('steel', [0, 0, 0], [len, 0.018, 0.018], { mode: 'vtx', subdiv: 2 });
    b.pop();
  }

  // ------------------------------------------------------------------ storefront glazing
  const fz = (z0, z1, y0, y1) => b.quad('glass', [-0.12, (y0 + y1) / 2, (z0 + z1) / 2], [0, 0, -1], [0, 1, 0], (z1 - z0) / 2, (y1 - y0) / 2, { mode: 'none', region: 'ext' });
  for (const [z0, z1] of SITE.windows) {
    // mullions every ~2m
    const n = Math.max(1, Math.round((z1 - z0) / 2.0));
    for (let i = 0; i < n; i++) {
      const za = z0 + ((z1 - z0) * i) / n, zb = z0 + ((z1 - z0) * (i + 1)) / n;
      fz(za + 0.03, zb - 0.03, SITE.kneeH + 0.04, SITE.windowTop - 0.04);
    }
    for (let i = 0; i <= n; i++) {
      const z = z0 + ((z1 - z0) * i) / n;
      b.box('frame', [-0.12, (SITE.kneeH + SITE.windowTop) / 2, z], [0.1, SITE.windowTop - SITE.kneeH, 0.07], { mode: 'vtx', subdiv: 2 });
    }
    b.box('frame', [-0.12, SITE.kneeH + 0.02, (z0 + z1) / 2], [0.12, 0.05, z1 - z0], { mode: 'vtx', subdiv: 2 });
    b.box('frame', [-0.12, SITE.windowTop - 0.02, (z0 + z1) / 2], [0.12, 0.05, z1 - z0], { mode: 'vtx', subdiv: 2 });
    // window sill outside
    b.box('metalDark', [0.04, SITE.kneeH - 0.015, (z0 + z1) / 2], [0.1, 0.03, z1 - z0], { mode: 'vtx', subdiv: 2 });
  }
  // door frame + transom
  const D = SITE.door;
  b.box('frame', [-0.12, SITE.door.h + 0.03, (D.z0 + D.z1) / 2], [0.12, 0.06, D.z1 - D.z0], { mode: 'vtx', subdiv: 2 });
  b.box('frame', [-0.12, SITE.windowTop / 2, D.z0 + 0.035], [0.12, SITE.windowTop, 0.07], { mode: 'vtx', subdiv: 2 });
  b.box('frame', [-0.12, SITE.windowTop / 2, D.z1 - 0.035], [0.12, SITE.windowTop, 0.07], { mode: 'vtx', subdiv: 2 });
  fz(D.z0 + 0.07, D.z1 - 0.07, SITE.door.h + 0.06, SITE.windowTop - 0.03);
  // entrance double doors (dynamic)
  buildDoor(ctx, { kind: 'glassDouble', hinge: [-0.12, 0, D.z0 + 0.07], width: (D.z1 - D.z0 - 0.14) / 2, height: SITE.door.h, axis: 'z', swing: 1, region: 'ext', name: 'entrance', chime: true });
  buildDoor(ctx, { kind: 'glassDouble', hinge: [-0.12, 0, D.z1 - 0.07], width: (D.z1 - D.z0 - 0.14) / 2, height: SITE.door.h, axis: 'z', swing: 1, mirror: true, region: 'ext', name: 'entrance2', chime: true });
  // green steel side door into stockroom
  const GD = SITE.greenDoor;
  b.box('frame', [0.02, GD.h + 0.03, (GD.z0 + GD.z1) / 2], [0.06, 0.06, GD.z1 - GD.z0 + 0.12], { mode: 'vtx', subdiv: 2 });
  b.box('frame', [0.02, GD.h / 2, GD.z0 - 0.03], [0.06, GD.h, 0.06], { mode: 'vtx', subdiv: 2 });
  b.box('frame', [0.02, GD.h / 2, GD.z1 + 0.03], [0.06, GD.h, 0.06], { mode: 'vtx', subdiv: 2 });
  buildDoor(ctx, { kind: 'steel', hinge: [-0.06, 0, GD.z1], width: GD.z1 - GD.z0, height: GD.h, axis: 'z', swing: 1, mirror: true, region: 'ext', name: 'sideDoor', mat: 'metalGreen', locked: true });

  // rolled shutter housing above storefront
  b.box('metalDark', [0.18, 2.98, (SITE.windows[0][0] + SITE.windows[1][1]) / 2], [0.36, 0.42, SITE.windows[1][1] - SITE.windows[0][0] + 0.2], { lm: 12 });
  b.box('metalDark', [0.05, 3.32, (S.z0 + S.z1) / 2], [0.1, 0.08, S.z1 - S.z0], { mode: 'vtx', subdiv: 1 });

  // downspouts + conduit
  for (const [x, z] of [[0.12, S.z0 + 0.15], [0.12, S.z1 - 0.15]]) {
    b.cylinder('metalDark', [x, 0.05, z], 0.05, H - 0.05, { segments: 8, mode: 'vtx', subdiv: 1 });
    b.box('metalDark', [x, 0.05, z], [0.16, 0.08, 0.12], { mode: 'vtx', subdiv: 1 });
  }
  b.cylinder('steel', [0.05, 0.4, 6.95], 0.018, 3.4, { segments: 6, mode: 'vtx', subdiv: 1 });
  b.box('steel', [0.05, 3.8, 9.5], [0.03, 0.03, 5.1], { mode: 'vtx', subdiv: 1 });

  // ------------------------------------------------------------------ interior partitions
  const PT = 0.15;
  // sales floor / back partition (z in [PZ, PZ+PT]) with door to restroom + stockroom
  wallX(b, { x0: S.x0 + T, x1: -T, z0: PZ, z1: PZ + PT, y1: S.ceilY, extSide: 'pz', ext: false, intMat: 'plaster', intRegion: 'int', intMat2: 'plasterBack', intRegion2: 'back', band: false,
    openings: [{ x0: -9.25, x1: -8.35, y0: 0, y1: 2.1 }, { x0: -6.2, x1: -5.3, y0: 0, y1: 2.1 }] });
  // restroom / office west block divider at x in [-7.0, -6.88]
  wallZ(b, { x0: -7.0, x1: -6.88, z0: PZ + PT, z1: S.z1 - T, y1: S.ceilY, extSide: 'px', ext: false, intMat: 'plasterBack', intRegion: 'back', band: false,
    openings: [{ z0: 12.0, z1: 12.9, y0: 0, y1: 2.1 }] });
  // restroom/office split
  wallX(b, { x0: S.x0 + T, x1: -7.0, z0: 10.4, z1: 10.52, y1: S.ceilY, extSide: 'pz', ext: false, intMat: 'wallTile', intRegion: 'back', intMat2: 'plasterBack', intRegion2: 'back', band: false });

  // interior doors (dynamic)
  buildDoor(ctx, { kind: 'wood', hinge: [-9.25, 0, PZ + PT / 2], width: 0.9, height: 2.1, axis: 'x', swing: 1, region: 'int', name: 'restroomDoor', sign: 'restroom' });
  buildDoor(ctx, { kind: 'wood', hinge: [-5.3, 0, PZ + PT / 2], width: 0.9, height: 2.1, axis: 'x', swing: 1, mirror: true, region: 'int', name: 'stockDoor', sign: 'employees' });
  buildDoor(ctx, { kind: 'wood', hinge: [-6.94, 0, 12.0], width: 0.9, height: 2.1, axis: 'z', swing: -1, region: 'back', name: 'officeDoor' });
  // door trims
  const trim = (x, z, w, axis, region) => {
    if (axis === 'x') {
      b.box('frame', [x + w / 2, 2.13, z], [w + 0.12, 0.06, PT + 0.04], { mode: 'vtx', subdiv: 1, region });
    } else {
      b.box('frame', [x, 2.13, z + w / 2], [0.16, 0.06, w + 0.12], { mode: 'vtx', subdiv: 1, region });
    }
  };
  trim(-9.25, PZ + PT / 2, 0.9, 'x', 'int'); trim(-6.2, PZ + PT / 2, 0.9, 'x', 'int'); trim(-6.94, 12.0, 0.9, 'z', 'back');

  // ------------------------------------------------------------------ ceilings (drop ceiling, faces down)
  const ceil = (x0, x1, z0, z1, region, mat = 'ceilingTile') => b.quad(mat, [(x0 + x1) / 2, S.ceilY, (z0 + z1) / 2], [1, 0, 0], [0, 0, 1], (x1 - x0) / 2, (z1 - z0) / 2, { region, lm: 14 });
  // sales floor ceiling with 2 missing tiles (open to dark plenum)
  const missing = [[-7.62, -7.01, -3.05, -2.44], [-3.05, -2.44, 3.66, 4.27]];
  const cx0 = S.x0 + T, cx1 = -T, cz0 = S.z0 + T, cz1 = PZ;
  // split ceiling into strips around missing tiles (simple: cut along x at the missing tiles)
  const xsCut = [cx0, cx1];
  for (const m of missing) xsCut.push(m[0], m[1]);
  xsCut.sort((a, b) => a - b);
  for (let i = 0; i < xsCut.length - 1; i++) {
    const xa = xsCut[i], xb = xsCut[i + 1];
    const ms = missing.filter((m) => m[0] <= xa + 1e-3 && m[1] >= xb - 1e-3);
    let zcuts = [cz0, cz1];
    for (const m of ms) zcuts.push(m[2], m[3]);
    zcuts.sort((a, b) => a - b);
    for (let j = 0; j < zcuts.length - 1; j++) {
      const za = zcuts[j], zb = zcuts[j + 1];
      if (ms.some((m) => m[2] <= za + 1e-3 && m[3] >= zb - 1e-3)) continue;
      ceil(xa, xb, za, zb, 'int');
    }
  }
  for (const m of missing) {
    // plenum void: black inward-facing box above the hole
    b.box('emBlack', [(m[0] + m[1]) / 2, S.ceilY + 0.5, (m[2] + m[3]) / 2], [m[1] - m[0], 1.0, m[3] - m[2]], { faces: ['py', 'px', 'nx', 'pz', 'nz'], region: 'int', mode: 'none', flip: true });
  }
  ceil(-6.88, -T, PZ + PT, S.z1 - T, 'back');
  ceil(S.x0 + T, -7.0, PZ + PT, 10.4, 'back');
  ceil(S.x0 + T, -7.0, 10.52, S.z1 - T, 'back');
  // T-bar wall angle trim
  b.box('plasticWhite', [(cx0 + cx1) / 2, S.ceilY - 0.01, cz0 + 0.01], [cx1 - cx0, 0.02, 0.02], { mode: 'vtx', subdiv: 1, region: 'int' });

  // interior baseboards (rubber cove base)
  const base = (x0, x1, z0, z1, region) => b.box('plasticBlack', [(x0 + x1) / 2, 0.05, (z0 + z1) / 2], [x1 - x0, 0.1, z1 - z0], { mode: 'vtx', subdiv: 1, region, skip: ['ny'] });
  base(S.x0 + T, S.x0 + T + 0.012, S.z0 + T, PZ, 'int');
  base(S.x0 + T, -T, S.z0 + T, S.z0 + T + 0.012, 'int');
  base(S.x0 + T, -9.25, PZ - 0.012, PZ, 'int');
  base(-8.35, -6.2, PZ - 0.012, PZ, 'int');
  base(-5.3, -T, PZ - 0.012, PZ, 'int');
}
