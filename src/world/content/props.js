import * as THREE from 'three';
import { SITE } from '../site.js';
import { signTexture } from '../../gfx/CanvasTextures.js';
import { emissiveMaterial } from '../../gfx/Materials.js';

// Exterior props along the façade + lot: wall lamps, tin signs, ICE merchandiser, bench,
// trash can, electrical box, payphone, price pole sign, arrow sign, propane cage.

function tinSign(ctx, key, tex, x, y, z, w, h, rotY = Math.PI / 2) {
  const { b, mats } = ctx;
  if (!mats.custom[key]) mats.define(key, { map: tex, roughness: 0.5, metalness: 0.25, porosity: 0.15, wetRough: 0.12 });
  b.pushTRS(x, y, z, rotY);
  b.quad(key, [0, 0, 0.012], [1, 0, 0], [0, 1, 0], w / 2, h / 2, { mode: 'vtx', subdiv: 5, uvFit: true });
  b.box('steel', [0, 0, 0.005], [w, h, 0.01], { mode: 'vtx', subdiv: 2, skip: ['pz'] });
  b.pop();
}

function wallLamp(ctx, x, y, z, rotY, power = 9) {
  const { b } = ctx;
  const broken = power <= 0;
  b.pushTRS(x, y, z, rotY);
  // wall plate + shade (local +z points away from wall)
  b.box('metalDark', [0, 0.06, 0.02], [0.2, 0.26, 0.04], { mode: 'vtx', subdiv: 6 });
  b.box('metalDark', [0, 0.19, 0.13], [0.22, 0.03, 0.22], { mode: 'vtx', subdiv: 6 });
  // glass globe (emissive) + cage bars
  b.pushEuler(0, 0.06, 0.13, 0, 0, 0);
  b.cylinder(broken ? 'plasticWhite' : 'emBulbWarm', [0, -0.08, 0], 0.07, 0.24, { segments: 12, mode: broken ? 'vtx' : 'none', radiusTop: 0.075 });
  b.pop();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    b.box('metalDark', [Math.cos(a) * 0.085, 0.06, 0.13 + Math.sin(a) * 0.085], [0.01, 0.26, 0.01], { mode: 'vtx', subdiv: 4 });
  }
  b.cylinder('metalDark', [0, -0.07, 0.13], 0.09, 0.015, { segments: 12, mode: 'vtx', subdiv: 1 });
  b.pop();
  if (broken) return;
  const p = new THREE.Vector3(0, 0.05, 0.13).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY).add(new THREE.Vector3(x, y, z));
  ctx.light({ kind: 'point', pos: [p.x, p.y, p.z], color: 0xffa65c, intensity: power, radius: 0.06, axis: [0, -1, 0], lambert: 0.35, cone: [-0.75, -0.35], range: 14, soft: 0.12, glow: { power: 2.2, exterior: true, down: 0.6, color: 0xffb070 } });
}

function bench(ctx, x, z, len, rotY) {
  const { b } = ctx;
  b.pushTRS(x, 0, z, rotY);
  // slats (seat)
  for (let i = 0; i < 4; i++) b.box('wood', [0, 0.45, -0.2 + i * 0.105], [len, 0.035, 0.09], { mode: 'vtx', subdiv: 4, uvScale: [1.6, 1.6] });
  // backrest
  for (let i = 0; i < 3; i++) b.box('wood', [0, 0.62 + i * 0.12, -0.29], [len, 0.09, 0.03], { mode: 'vtx', subdiv: 4, uvScale: [1.6, 1.6] });
  // iron legs
  for (const sx of [-1, 1]) {
    const lx = sx * (len / 2 - 0.15);
    b.box('metalDark', [lx, 0.22, -0.18], [0.04, 0.44, 0.04], { mode: 'vtx', subdiv: 3 });
    b.box('metalDark', [lx, 0.22, 0.12], [0.04, 0.44, 0.04], { mode: 'vtx', subdiv: 3 });
    b.box('metalDark', [lx, 0.43, -0.03], [0.05, 0.03, 0.4], { mode: 'vtx', subdiv: 3 });
    b.box('metalDark', [lx, 0.65, -0.31], [0.04, 0.45, 0.03], { mode: 'vtx', subdiv: 3 });
  }
  b.pop();
  b.boxCollider([x, 0.4, z], rotY === 0 ? [len, 0.8, 0.5] : [0.5, 0.8, len]);
}

export function buildProps(ctx) {
  const { b, mats } = ctx;
  // ------------------------------------------------------------ façade: lamps + signs (solid section z 6.5..15)
  wallLamp(ctx, 0.0, 2.72, 13.5, Math.PI / 2, 8);
  wallLamp(ctx, 0.0, 3.0, 10.3, Math.PI / 2, 10);
  wallLamp(ctx, 0.0, 3.0, -6.75, Math.PI / 2, 0); // broken lamp (dark)
  tinSign(ctx, 'signVesper', signTexture('vesperWall'), 0.0, 2.05, 11.85, 1.3, 0.98);
  tinSign(ctx, 'signOil', signTexture('motorOil'), 0.0, 1.95, 8.95, 0.72, 0.96);
  tinSign(ctx, 'signTires', signTexture('tires'), 0.0, 2.15, 7.45, 0.82, 0.41);

  // ICE merchandiser
  {
    const x0 = 0.12, xw = 0.92, z0 = 9.05, z1 = 11.0, hb = 1.02;
    const cx = x0 + xw / 2, cz = (z0 + z1) / 2;
    b.box('metalDark', [cx, 0.06, cz], [xw - 0.04, 0.12, z1 - z0 - 0.04], { mode: 'vtx', subdiv: 4 });
    b.box('metalWhite', [cx, 0.12 + (hb - 0.12) / 2, cz], [xw, hb - 0.12, z1 - z0], { mode: 'vtx', subdiv: 6 });
    // lid (slight overhang) + handles
    b.box('metalWhite', [cx, hb + 0.04, cz], [xw + 0.05, 0.08, z1 - z0 + 0.05], { mode: 'vtx', subdiv: 6 });
    b.box('chrome', [x0 + xw + 0.04, hb + 0.0, cz - 0.45], [0.03, 0.03, 0.26], { mode: 'vtx', subdiv: 3 });
    b.box('chrome', [x0 + xw + 0.04, hb + 0.0, cz + 0.45], [0.03, 0.03, 0.26], { mode: 'vtx', subdiv: 3 });
    // ICE decal on front (+x)
    if (!mats.custom.signIce) mats.define('signIce', { map: signTexture('ice'), roughness: 0.4, porosity: 0.1, wetRough: 0.1 });
    b.quad('signIce', [x0 + xw + 0.002, 0.62, cz], [0, 0, -1], [0, 1, 0], (z1 - z0) / 2 - 0.08, 0.36, { mode: 'vtx', subdiv: 6, uvFit: true });
    // vent grille
    for (let i = 0; i < 6; i++) b.box('metalDark', [x0 + xw + 0.003, 0.2 + i * 0.03, cz + 0.55], [0.006, 0.012, 0.5], { mode: 'vtx', subdiv: 2 });
    b.boxCollider([cx, 0.5, cz], [xw + 0.05, 1.1, z1 - z0 + 0.05]);
  }
  // trash can (round black bin with dome lid)
  b.cylinder('plasticBlack', [0.48, 0, 12.45], 0.3, 0.86, { segments: 18, subdiv: 4 });
  b.pushEuler(0.48, 0.86, 12.45, 0, 0, 0);
  b.cylinder('plasticBlack', [0, 0, 0], 0.32, 0.14, { segments: 18, radiusTop: 0.22, subdiv: 2 });
  b.pop();
  b.circleCollider([0.48, 0, 12.45], 0.35, 0, 1);
  // electrical meter box + conduit
  b.box('metalCream', [0.09, 1.55, 6.95], [0.18, 0.62, 0.42], { mode: 'vtx', subdiv: 5 });
  b.box('plasticBlack', [0.185, 1.62, 6.95], [0.01, 0.16, 0.16], { mode: 'vtx', subdiv: 3 });
  b.cylinder('metalDark', [0.09, 1.86, 6.95], 0.03, 1.9, { segments: 8, subdiv: 2 });

  // bench under the window (like the reference)
  bench(ctx, 0.62, -2.6, 2.1, Math.PI / 2);
  // second barrel by the bench
  // (built by canopy.js)

  // ------------------------------------------------------------ payphone on the south wall
  {
    const px = -2.6, pz = SITE.store.z1;
    b.pushTRS(px, 0, pz, 0);
    b.box('metalBlue', [0, 2.12, 0.28], [0.75, 0.12, 0.56], { mode: 'vtx', subdiv: 5 });
    b.box('steel', [-0.36, 1.45, 0.25], [0.025, 1.3, 0.5], { mode: 'vtx', subdiv: 4 });
    b.box('steel', [0.36, 1.45, 0.25], [0.025, 1.3, 0.5], { mode: 'vtx', subdiv: 4 });
    b.box('steel', [0, 1.4, 0.09], [0.34, 0.62, 0.16], { mode: 'vtx', subdiv: 6 });
    b.box('plasticBlack', [0.0, 1.5, 0.175], [0.12, 0.16, 0.01], { mode: 'vtx', subdiv: 3 });
    b.box('plasticBlack', [-0.12, 1.42, 0.19], [0.06, 0.24, 0.05], { mode: 'vtx', subdiv: 3 });
    b.box('chrome', [0.05, 1.2, 0.18], [0.12, 0.08, 0.02], { mode: 'vtx', subdiv: 2 });
    const cord = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.12, 1.3, 0.2), new THREE.Vector3(-0.13, 1.05, 0.24), new THREE.Vector3(-0.08, 0.98, 0.22), new THREE.Vector3(-0.02, 1.15, 0.19)]);
    b.geometry('steel', new THREE.TubeGeometry(cord, 16, 0.008, 5, false), { mode: 'vtx' });
    b.pop();
    b.boxCollider([px, 1, pz + 0.28], [0.8, 2, 0.56]);
    ctx.interact({ name: 'payphone', pos: new THREE.Vector3(px, 1.4, pz + 0.3), radius: 0.7, prompt: () => '[E] PICK UP', action: (g) => g.events?.payphone?.() });
  }

  // ------------------------------------------------------------ propane exchange cage (north wall)
  {
    const cx = -2.2, cz = SITE.store.z0 - 0.45;
    const w = 1.8, d = 0.8, h = 1.5;
    for (let i = 0; i <= 9; i++) {
      const x = cx - w / 2 + (w * i) / 9;
      b.box('steel', [x, h / 2, cz - d / 2], [0.012, h, 0.012], { mode: 'vtx', subdiv: 2 });
    }
    for (let j = 0; j <= 6; j++) b.box('steel', [cx, (h * j) / 6 + 0.01, cz - d / 2], [w, 0.012, 0.012], { mode: 'vtx', subdiv: 2 });
    b.box('metalWhite', [cx, h + 0.02, cz], [w + 0.04, 0.04, d + 0.04], { mode: 'vtx', subdiv: 3 });
    for (let i = 0; i < 4; i++) {
      b.cylinder('metalWhite', [cx - 0.6 + i * 0.4, 0.02, cz - 0.05], 0.15, 0.62, { segments: 14, subdiv: 4 });
      b.cylinder('steel', [cx - 0.6 + i * 0.4, 0.64, cz - 0.05], 0.06, 0.08, { segments: 10, subdiv: 1 });
    }
    b.boxCollider([cx, 0.8, cz], [w, 1.6, d]);
  }

  // ------------------------------------------------------------ price pole sign (lit) near the road
  {
    const sx = 21.6, sz = -7.5;
    for (const dz of [-0.75, 0.75]) b.cylinder('steel', [sx, 0, sz + dz], 0.09, 5.2, { segments: 12, subdiv: 2 });
    b.circleCollider([sx, 0, sz - 0.75], 0.15, 0, 2); b.circleCollider([sx, 0, sz + 0.75], 0.15, 0, 2);
    const y0 = 5.0, h = 2.6, w = 2.0;
    b.box('metalDark', [sx, y0 + h / 2, sz], [0.36, h + 0.1, w + 0.1], { mode: 'vtx', subdiv: 3 });
    const tex = signTexture('priceSign');
    const em = mats.registerEmissive('emPriceSign', emissiveMaterial(0xffffff, 2.2, { map: tex }));
    b.quad('emPriceSign', [sx + 0.181, y0 + h / 2, sz], [0, 0, -1], [0, 1, 0], w / 2, h / 2, { mode: 'none', uvFit: true });
    b.quad('emPriceSign', [sx - 0.181, y0 + h / 2, sz], [0, 0, 1], [0, 1, 0], w / 2, h / 2, { mode: 'none', uvFit: true });
    ctx.light({ kind: 'rect', pos: [sx + 0.6, y0 + h / 2, sz], u: [0, 0, 1], v: [0, 1, 0], size: [w, h], color: 0xfff0e0, intensity: 5, axis: [1, 0, 0], lambert: 1, cone: [-0.05, 0.2], range: 14, soft: 0.6, glow: { power: 1.0, exterior: true, down: 0.0, color: 0xfff0e0 } });
    ctx.light({ kind: 'rect', pos: [sx - 0.6, y0 + h / 2, sz], u: [0, 0, 1], v: [0, 1, 0], size: [w, h], color: 0xfff0e0, intensity: 5, axis: [-1, 0, 0], lambert: 1, cone: [-0.05, 0.2], range: 14, soft: 0.6 });
  }
  // vintage arrow sign on a post (unlit) at the lot entrance
  {
    const ax = 20.2, az = 18.5;
    b.cylinder('steel', [ax, 0, az], 0.06, 2.6, { segments: 10, subdiv: 2 });
    if (!mats.custom.signArrow) mats.define('signArrow', { map: signTexture('arrowSign'), roughness: 0.6, porosity: 0.3, wetRough: 0.2, side: THREE.DoubleSide, alphaTest: 0.5 });
    b.pushTRS(ax, 2.3, az, Math.PI * 0.62);
    b.quad('signArrow', [0, 0, 0.04], [1, 0, 0], [0, 1, 0], 1.25, 0.47, { mode: 'vtx', subdiv: 4, uvFit: true });
    b.quad('signArrow', [0, 0, -0.04], [-1, 0, 0], [0, 1, 0], 1.25, 0.47, { mode: 'vtx', subdiv: 4, uvFit: true, uvFlipU: true });
    b.box('woodDark', [0, 0, 0], [2.3, 0.62, 0.07], { mode: 'vtx', subdiv: 3, skip: ['pz', 'nz'] });
    b.pop();
    b.circleCollider([ax, 0, az], 0.12, 0, 2);
  }
  // wet cardboard box + pallet by the north corner
  b.box('cardboardDark', [-1.0, 0.18, -8.0], [0.6, 0.36, 0.45], { mode: 'vtx', subdiv: 4 });
  b.box('woodDark', [-1.8, 0.07, -8.4], [1.2, 0.14, 1.0], { mode: 'vtx', subdiv: 3 });
  b.boxCollider([-1.4, 0.3, -8.2], [1.8, 0.6, 1.2]);
}
