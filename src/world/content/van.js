import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { signTexture } from '../../gfx/CanvasTextures.js';

// Old white cargo van parked in front of the store (vertex-lit, rounded panels).
export function buildVan(ctx) {
  const { b, mats } = ctx;
  const X = 3.35, Z = -1.85, ROT = 0; // nose toward -z
  b.pushTRS(X, 0, Z, ROT);
  const W = 1.98;
  const rb = (w, h, d, r, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, r);
  const put = (mat, geo, x, y, z) => { geo.translate(x, y, z); b.geometry(mat, geo, { mode: 'vtx' }); };

  // cargo body
  put('vanPaint', rb(W, 1.62, 3.55, 0.12, 4), 0, 0.46 + 0.81, 0.95);
  // cab
  put('vanPaint', rb(W - 0.02, 1.52, 1.25, 0.14, 4), 0, 0.46 + 0.76, -1.45);
  // hood
  put('vanPaint', rb(W - 0.06, 0.62, 0.75, 0.12, 3), 0, 0.46 + 0.36, -2.35);
  // underbody / rocker panels (dark)
  put('metalDark', rb(W - 0.1, 0.2, 5.0, 0.05, 1), 0, 0.42, -0.3);
  // bumpers
  put('steel', rb(W + 0.04, 0.16, 0.14, 0.04, 2), 0, 0.5, -2.75);
  put('steel', rb(W + 0.04, 0.16, 0.14, 0.04, 2), 0, 0.5, 2.78);
  // grille + headlights
  b.box('plasticBlack', [0, 0.86, -2.73], [1.2, 0.3, 0.02], { mode: 'vtx', subdiv: 6 });
  for (let i = 0; i < 6; i++) b.box('chrome', [0, 0.74 + i * 0.048, -2.735], [1.18, 0.012, 0.02], { mode: 'vtx', subdiv: 4 });
  for (const s of [-1, 1]) {
    b.pushEuler(s * 0.75, 0.88, -2.735, Math.PI / 2, 0, 0);
    b.cylinder('chrome', [0, -0.01, 0], 0.11, 0.02, { segments: 14, mode: 'vtx', subdiv: 1 });
    b.cylinder('porcelain', [0, -0.012, 0], 0.085, 0.005, { segments: 14, mode: 'vtx', subdiv: 1, caps: [true, false] });
    b.pop();
  }
  // windshield + side windows + rear windows (dark glass)
  b.pushEuler(0, 1.72, -2.03, -0.32, 0, 0);
  b.box('plasticBlack', [0, 0, 0], [W - 0.22, 0.6, 0.02], { mode: 'vtx', subdiv: 6 });
  b.pop();
  for (const s of [-1, 1]) {
    b.box('plasticBlack', [s * (W / 2 + 0.003), 1.66, -1.5], [0.012, 0.48, 0.82], { mode: 'vtx', subdiv: 6 });
    // mirrors
    b.box('metalDark', [s * (W / 2 + 0.16), 1.55, -1.95], [0.05, 0.22, 0.14], { mode: 'vtx', subdiv: 3 });
    b.box('steel', [s * (W / 2 + 0.08), 1.55, -1.95], [0.16, 0.02, 0.02], { mode: 'vtx', subdiv: 2 });
    // door seams
    b.box('metalDark', [s * (W / 2 + 0.002), 1.1, -0.86], [0.006, 1.1, 0.012], { mode: 'vtx', subdiv: 4 });
    b.box('metalDark', [s * (W / 2 + 0.002), 1.1, 0.3], [0.006, 1.2, 0.012], { mode: 'vtx', subdiv: 4 });
    b.box('chrome', [s * (W / 2 + 0.012), 1.25, -0.98], [0.02, 0.03, 0.14], { mode: 'vtx', subdiv: 2 });
  }
  // rear doors: seam, windows, handles, tail lights, plate
  b.box('metalDark', [0, 1.25, 2.73], [0.012, 1.5, 0.008], { mode: 'vtx', subdiv: 4 });
  for (const s of [-1, 1]) {
    // solid cargo doors: pressed panel outline + tall tail lamps at the corners
    b.box('metalDark', [s * 0.48, 1.72, 2.727], [0.74, 0.008, 0.006], { mode: 'vtx', subdiv: 2 });
    b.box('metalDark', [s * 0.48, 0.86, 2.727], [0.74, 0.008, 0.006], { mode: 'vtx', subdiv: 2 });
    b.box('plasticRed', [s * 0.9, 1.05, 2.728], [0.12, 0.42, 0.03], { mode: 'vtx', subdiv: 3 });
    b.box('plasticWhite', [s * 0.9, 0.79, 2.728], [0.12, 0.09, 0.03], { mode: 'vtx', subdiv: 2 });
  }
  b.box('chrome', [0.15, 1.2, 2.735], [0.14, 0.03, 0.02], { mode: 'vtx', subdiv: 2 });
  if (!mats.custom.plate) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const x = c.getContext('2d'); x.fillStyle = '#e8e4d8'; x.fillRect(0, 0, 256, 128); x.fillStyle = '#1a2a6a'; x.font = 'bold 54px Arial, sans-serif'; x.textAlign = 'center'; x.fillText('7KX 419', 128, 84);
    x.font = 'bold 16px Arial'; x.fillText('HOLLOW COUNTY', 128, 24);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    mats.define('plate', { map: t, roughness: 0.4, porosity: 0.1, wetRough: 0.1 });
  }
  b.quad('plate', [0, 0.72, 2.81], [1, 0, 0], [0, 1, 0], 0.15, 0.075, { mode: 'vtx', subdiv: 2, uvFit: true });
  // radio antenna on the roof
  b.cylinder('steel', [0.7, 2.08, -1.2], 0.006, 0.9, { segments: 4, mode: 'vtx', subdiv: 2 });
  // wheels
  for (const [wx, wz] of [[-W / 2 + 0.1, -1.95], [W / 2 - 0.1, -1.95], [-W / 2 + 0.1, 1.7], [W / 2 - 0.1, 1.7]]) {
    b.pushEuler(wx, 0.36, wz, 0, 0, Math.PI / 2);
    b.cylinder('rubber', [0, -0.12, 0], 0.36, 0.24, { segments: 20, mode: 'vtx', subdiv: 2 });
    const sgn = Math.sign(wx);
    b.cylinder('chrome', [0, sgn * 0.12 - (sgn > 0 ? 0 : 0.012), 0], 0.2, 0.012, { segments: 16, mode: 'vtx', subdiv: 1 });
    b.pop();
    // arch shadow liner
    b.box('plasticBlack', [wx, 0.62, wz], [0.26, 0.06, 0.86], { mode: 'vtx', subdiv: 3 });
  }
  // decals (side)
  const dec = signTexture('vanDecal');
  if (!mats.custom.vanDecal) mats.define('vanDecal', { map: dec, roughness: 0.4, porosity: 0.1, wetRough: 0.08, alphaTest: 0.4 });
  b.quad('vanDecal', [W / 2 + 0.008, 1.38, 0.8], [0, 0, -1], [0, 1, 0], 1.55, 0.39, { mode: 'vtx', subdiv: 6, uvFit: true });
  b.quad('vanDecal', [-W / 2 - 0.008, 1.38, 0.8], [0, 0, 1], [0, 1, 0], 1.55, 0.39, { mode: 'vtx', subdiv: 6, uvFit: true });
  b.pop();
  b.boxCollider([X, 1.1, Z - 0.1], [W + 0.1, 2.2, 5.7]);
  ctx.interact({
    name: 'van', pos: new THREE.Vector3(X - W / 2, 1.5, Z - 1.5), radius: 0.9,
    prompt: () => '[E] LOOK INSIDE',
    action: (g) => g.events?.van?.(),
  });
}
