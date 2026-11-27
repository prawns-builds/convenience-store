import * as THREE from 'three';
import { SITE } from '../site.js';
import { GROUP } from '../World.js';
import { signTexture } from '../../gfx/CanvasTextures.js';

const C = SITE.canopy;

function pump(b, x, z, rotY, num) {
  b.pushTRS(x, 0.18, z, rotY);
  // base plinth
  b.box('metalDark', [0, 0.07, 0], [0.62, 0.14, 0.86], { mode: 'vtx', subdiv: 3 });
  // main body
  b.box('metalCream', [0, 0.14 + 0.78, 0], [0.5, 1.56, 0.72], { mode: 'vtx', subdiv: 6 });
  // dark stripe band
  b.box('metalDark', [0, 0.98, 0], [0.515, 0.08, 0.735], { mode: 'vtx', subdiv: 4 });
  // head (wider, rounded top approximated by a half cylinder)
  b.box('metalCream', [0, 1.84, 0], [0.56, 0.36, 0.78], { mode: 'vtx', subdiv: 6 });
  b.pushEuler(0, 2.02, 0, -Math.PI / 2, 0, 0);
  b.cylinder('metalCream', [0, -0.39, 0], 0.28, 0.78, { segments: 14, arc: Math.PI, mode: 'vtx', caps: [true, true], subdiv: 4 });
  b.pop();
  // display windows both sides (dark glass) + price digits frame
  for (const s of [1, -1]) {
    b.box('plasticBlack', [s * 0.282, 1.84, 0], [0.012, 0.24, 0.6], { mode: 'vtx', subdiv: 4 });
    b.box('metalWhite', [s * 0.255, 1.42, 0], [0.012, 0.36, 0.5], { mode: 'vtx', subdiv: 4 });
    b.box('plasticBlack', [s * 0.262, 1.48, 0], [0.008, 0.08, 0.36], { mode: 'vtx', subdiv: 3 });
    b.box('plasticBlack', [s * 0.262, 1.36, 0], [0.008, 0.08, 0.36], { mode: 'vtx', subdiv: 3 });
  }
  // nozzle holster + nozzle on +z side
  b.box('metalDark', [0, 1.15, 0.39], [0.16, 0.22, 0.08], { mode: 'vtx', subdiv: 4 });
  b.box('plasticBlack', [0, 1.2, 0.45], [0.06, 0.2, 0.06], { mode: 'vtx', subdiv: 4 });
  b.box('steel', [0, 1.06, 0.47], [0.025, 0.12, 0.025], { mode: 'vtx', subdiv: 3 });
  // hose: tube curve from top-side down and back up to the nozzle
  const pts = [
    new THREE.Vector3(0, 1.66, 0.37), new THREE.Vector3(0, 1.4, 0.5), new THREE.Vector3(0.02, 0.6, 0.56),
    new THREE.Vector3(0.03, 0.25, 0.52), new THREE.Vector3(0.02, 0.4, 0.47), new THREE.Vector3(0, 1.08, 0.46),
  ];
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.TubeGeometry(curve, 28, 0.018, 6, false);
  b.geometry('rubber', tube, { mode: 'vtx' });
  b.pop();
  b.boxCollider([x, 1.0, z], [0.7, 2.0, 0.9]);
}

function barrel(b, x, z, y0 = 0.0, colors = ['metalDark', 'metalWhite']) {
  const r = 0.29, H = 0.88;
  b.cylinder(colors[0], [x, y0, z], r, H * 0.3, { segments: 18, caps: [false, false], subdiv: 3 });
  b.cylinder(colors[1], [x, y0 + H * 0.3, z], r, H * 0.38, { segments: 18, caps: [false, false], subdiv: 3 });
  b.cylinder(colors[0], [x, y0 + H * 0.68, z], r, H * 0.32, { segments: 18, caps: [false, true], subdiv: 3 });
  for (const yy of [0.02, H * 0.33, H * 0.66, H - 0.02]) b.cylinder(colors[0], [x, y0 + yy - 0.015, z], r + 0.012, 0.03, { segments: 18, caps: [false, false], subdiv: 1 });
  // trash inside (dark disc slightly below rim)
  b.cylinder('plasticBlack', [x, y0 + H - 0.12, z], r - 0.02, 0.01, { segments: 14, caps: [false, true], subdiv: 1 });
  b.circleCollider([x, y0, z], r + 0.05, y0, y0 + H);
}

export function buildCanopy(ctx) {
  const { b, mats } = ctx;
  const midX = (C.x0 + C.x1) / 2, midZ = (C.z0 + C.z1) / 2;
  const W = C.x1 - C.x0, D = C.z1 - C.z0;
  // slab: underside (concrete), top (roof)
  b.box('canopyUnder', [midX, C.y0 + C.slab / 2, midZ], [W, C.slab, D], { faces: ['ny'], lm: 9 });
  b.box('roof', [midX, C.y0 + C.slab / 2, midZ], [W, C.slab, D], { faces: ['py'], lm: 2 });
  // fascia band (3 open sides)
  const fy0 = C.y0 - 0.2, fy1 = C.y0 + C.fasciaH - 0.2;
  const fh = fy1 - fy0, fc = (fy0 + fy1) / 2, ft = 0.14;
  b.box('metalDark', [C.x1 - ft / 2, fc, midZ], [ft, fh, D + ft * 2], { lm: 10, skip: ['px'] });
  b.box('metalDark', [midX - ft / 2, fc, C.z0 - ft / 2], [W + ft, fh, ft], { lm: 10, skip: ['nz'] });
  b.box('metalDark', [midX - ft / 2, fc, C.z1 + ft / 2], [W + ft, fh, ft], { lm: 10, skip: ['pz'] });
  // branded outer faces
  const brand = signTexture('canopyBrand');
  mats.define('signCanopy', { map: brand, roughness: 0.55, porosity: 0.2, wetRough: 0.15, metalness: 0.2 });
  b.quad('signCanopy', [C.x1 + 0.001, fc, midZ], [0, 0, -1], [0, 1, 0], (D + 0.28) / 2, fh / 2, { mode: 'vtx', subdiv: 2, uvFit: true });
  b.quad('signCanopy', [midX - ft / 2, fc, C.z0 - ft - 0.001], [-1, 0, 0], [0, 1, 0], (W + ft) / 2, fh / 2, { mode: 'vtx', subdiv: 2, uvFit: true });
  b.quad('signCanopy', [midX - ft / 2, fc, C.z1 + ft + 0.001], [1, 0, 0], [0, 1, 0], (W + ft) / 2, fh / 2, { mode: 'vtx', subdiv: 2, uvFit: true });

  // pillars with chipped paint, green base band and Y brackets
  for (const [px, pz] of SITE.pillars) {
    const s = 0.46;
    b.box('pillarGreen', [px, 0.55, pz], [s, 1.1, s], { lm: 24, skip: ['ny', 'py'] });
    b.box('pillarWhite', [px, 1.1 + (C.y0 - 1.1) / 2, pz], [s, C.y0 - 1.1, s], { lm: 20, skip: ['ny', 'py'] });
    b.boxCollider([px, 1, pz], [s + 0.05, 2, s + 0.05]);
    // steel Y-bracket arms
    for (const sx of [-1, 1]) {
      b.pushEuler(px + sx * 0.36, C.y0 - 0.36, pz, 0, 0, sx * 0.75);
      b.box('steel', [0, 0, 0], [0.09, 0.95, 0.12], { mode: 'vtx', subdiv: 3 });
      b.pop();
    }
    b.box('steel', [px, C.y0 - 0.04, pz], [1.55, 0.08, 0.16], { mode: 'vtx', subdiv: 3 });
  }

  // pump islands + pumps + barrels + bollards
  for (let i = 0; i < SITE.islands.length; i++) {
    const [ix, iz] = SITE.islands[i];
    const L = 5.6;
    b.box('curb', [ix, 0.09, iz], [1.3, 0.18, L], { lm: 16, skip: ['ny'] });
    // painted nose ends
    for (const e of [-1, 1]) b.box('metalYellow', [ix, 0.09, iz + e * (L / 2 + 0.03)], [1.3, 0.18, 0.06], { mode: 'vtx', subdiv: 3 });
    pump(b, ix, iz + 1.55, 0, i * 2 + 1);
    pump(b, ix, iz - 1.55, Math.PI, i * 2 + 2);
    barrel(b, ix + 0.05, iz + 2.55, 0.18, i === 0 ? ['metalDark', 'metalWhite'] : ['metalGreen', 'metalWhite']);
    // bollards (filled steel pipe, yellow)
    for (const e of [-1, 1]) {
      b.cylinder('metalYellow', [ix + e * 0.42, 0.18, iz + e * (L / 2 - 0.25)], 0.085, 1.05, { segments: 12, subdiv: 4 });
      b.circleCollider([ix + e * 0.42, 0, iz + e * (L / 2 - 0.25)], 0.12, 0, 1.2);
    }
    // squeegee bucket on pillar side
    b.cylinder('plasticGrey', [ix - 0.42, 0.18, iz - 0.55], 0.13, 0.32, { segments: 12, subdiv: 4 });
    b.box('metalDark', [ix - 0.32, 1.35, iz - 0.0], [0.16, 0.35, 0.28], { mode: 'vtx', subdiv: 4 });
  }
  // barrel near the store corner under canopy (like reference)
  barrel(b, 0.65, -4.9, 0.0, ['metalDark', 'metalWhite']);

  // fluorescent tube fixtures (bare tubes in channel housings)
  const fixtures = [
    [3.6, -8.2, 'dead'], [9.0, -8.2, 'flicker'], [3.6, -2.4, 'on'], [9.0, -2.4, 'on'], [3.6, 3.2, 'on'], [9.0, 3.2, 'on'], [13.2, -2.4, 'on'],
  ];
  for (const [fx, fz, state] of fixtures) {
    const y = C.y0 - 0.06;
    b.box('metalWhite', [fx, y + 0.03, fz], [0.11, 0.05, 1.32], { mode: 'vtx', subdiv: 4 });
    const em = state === 'dead' ? 'plasticWhite' : state === 'flicker' ? 'emTubeFlicker' : 'emTube';
    for (const dx of [-0.028, 0.028]) {
      b.pushEuler(fx + dx, y - 0.015, fz, Math.PI / 2, 0, 0);
      b.cylinder(em, [0, -0.62, 0], 0.014, 1.24, { segments: 8, mode: state === 'dead' ? 'vtx' : 'none', caps: [true, true] });
      b.pop();
    }
    if (state === 'dead') continue;
    ctx.light({
      kind: 'tube', a: [fx, y - 0.04, fz - 0.6], b: [fx, y - 0.04, fz + 0.6], color: 0xe4eeff, intensity: 24,
      group: state === 'flicker' ? GROUP.FLICKER_EXT : -1, lambert: 0.3, cone: [-0.6, -0.05], range: 20, soft: 0.3,
      glow: { power: 3.2, exterior: true, down: 0.2, color: 0xdfe8ff },
    });
  }
  // fill: light bounced from the wet concrete back onto the canopy underside & pumps
  for (const [fx, fz] of [[4, -5], [10, -5], [4, 1.5], [10, 1.5]]) {
    ctx.light({ kind: 'point', pos: [fx, 0.7, fz], color: 0x8c8a86, intensity: 3.2, axis: [0, 1, 0], lambert: 1.0, cone: [-0.1, 0.25], range: 12, radius: 0.8, soft: 1.0 });
  }
}
