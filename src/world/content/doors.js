import * as THREE from 'three';
import { GeoBuilder } from '../GeoBuilder.js';
import { MATS } from '../matlib.js';
import { UV } from '../site.js';
import { signTexture } from '../../gfx/CanvasTextures.js';

// Swinging door with pivot animation, collider and interaction.
export function buildDoor(ctx, opt) {
  const { mats } = ctx;
  const w = opt.width, h = opt.height;
  const gb = new GeoBuilder();
  gb.uvFor = (k) => { const d = MATS[k] ?? mats.custom[k]; if (!d || !d.tex) return [1, 1]; const s = (UV[d.tex] ?? 1) * (d.uvMul ?? 1); return [s, s]; };
  const T = opt.kind === 'glassDouble' ? 0.05 : 0.045;
  const region = opt.region ?? 'ext';
  // panel spans local x in [0, w], y [0, h], z thickness centered at 0
  if (opt.kind === 'glassDouble') {
    const st = 0.09, top = 0.1, bot = 0.24;
    gb.box('frame', [st / 2, h / 2, 0], [st, h, T], { mode: 'none', region });
    gb.box('frame', [w - st / 2, h / 2, 0], [st, h, T], { mode: 'none', region });
    gb.box('frame', [w / 2, h - top / 2, 0], [w - 2 * st, top, T], { mode: 'none', region });
    gb.box('frame', [w / 2, bot / 2, 0], [w - 2 * st, bot, T], { mode: 'none', region });
    gb.quad('glass', [w / 2, (h - top + bot) / 2, 0], [1, 0, 0], [0, 1, 0], (w - 2 * st) / 2, (h - top - bot) / 2, { mode: 'none', region });
  } else if (opt.kind === 'steel') {
    gb.box(opt.mat ?? 'metalGreen', [w / 2, h / 2, 0], [w, h, T], { mode: 'none', region });
    gb.box('chrome', [w - 0.12, 1.02, T / 2 + 0.03], [0.14, 0.025, 0.03], { mode: 'none', region });
    gb.box('chrome', [w - 0.12, 1.02, -T / 2 - 0.03], [0.14, 0.025, 0.03], { mode: 'none', region });
    gb.box('steel', [w - 0.06, 1.02, 0], [0.06, 0.1, T + 0.03], { mode: 'none', region });
  } else {
    gb.box(opt.mat ?? 'laminate', [w / 2, h / 2, 0], [w, h, T], { mode: 'none', region });
    gb.box('chrome', [w - 0.1, 1.0, T / 2 + 0.03], [0.12, 0.02, 0.025], { mode: 'none', region });
    gb.box('chrome', [w - 0.1, 1.0, -T / 2 - 0.03], [0.12, 0.02, 0.025], { mode: 'none', region });
    gb.box('steel', [w - 0.1, 1.0, 0], [0.05, 0.06, T + 0.035], { mode: 'none', region });
    gb.box('steel', [w * 0.5, 0.12, 0], [w - 0.04, 0.22, T + 0.004], { mode: 'none', region });
  }
  const parts = gb.finalize();
  const pivot = new THREE.Group();
  pivot.name = opt.name;
  const probeMats = [];
  for (const p of parts) {
    const m = mats.get(p.matKey, 'none', p.region);
    const mesh = new THREE.Mesh(p.geometry, m);
    mesh.castShadow = !m.transparent;
    mesh.receiveShadow = true;
    if (m.transparent) mesh.renderOrder = 2;
    pivot.add(mesh);
    if (m.userData.uniforms?.uProbeStatic) probeMats.push(m);
  }
  if (opt.kind === 'glassDouble') {
    const barGeo = new THREE.CylinderGeometry(0.016, 0.016, w - 0.26, 8).rotateZ(Math.PI / 2);
    const barMat = mats.get('chrome', 'none', region);
    probeMats.push(barMat);
    for (const s of [1, -1]) {
      const bar = new THREE.Mesh(barGeo, barMat);
      bar.position.set(w / 2, 1.02, s * 0.075);
      pivot.add(bar);
      for (const x of [0.2, w - 0.2]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.06), barMat);
        post.position.set(x, 1.02, s * 0.045);
        pivot.add(post);
      }
    }
    // sticker
    const tex = signTexture(opt.mirror ? 'pullSticker' : 'hoursSticker');
    const sticker = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.22), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, color: new THREE.Color(0.08, 0.08, 0.08) }));
    sticker.position.set(w / 2, 1.45, 0.028);
    sticker.rotation.y = 0;
    sticker.renderOrder = 3;
    pivot.add(sticker);
    sticker.userData.lit = true;
  }
  if (opt.sign) {
    const tex = signTexture(opt.sign);
    const sm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 });
    sm.userData.region = region;
    for (const s of [1, -1]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.12), sm);
      sign.position.set(w / 2, 1.6, s * (T / 2 + 0.002));
      if (s < 0) sign.rotation.y = Math.PI;
      pivot.add(sign);
    }
    mats.all.push(sm);
  }

  const base = opt.axis === 'z' ? (opt.mirror ? Math.PI / 2 : -Math.PI / 2) : (opt.mirror ? Math.PI : 0);
  const sign = (opt.swing ?? 1) * (opt.axis === 'z' ? 1 : -1) * (opt.mirror ? -1 : 1);
  pivot.position.set(...opt.hinge);
  pivot.rotation.y = base;
  pivot.updateMatrixWorld(true);

  // collider (closed)
  const dir = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), base);
  const c = new THREE.Vector3(...opt.hinge).addScaledVector(dir, w / 2);
  const angle = Math.atan2(-dir.z, dir.x);
  const col = { type: 'box', x: c.x, z: c.z, hx: w / 2, hz: 0.06, angle, cos: Math.cos(angle), sin: Math.sin(angle), y0: 0, y1: h, enabled: true, tag: opt.name };
  ctx.b.colliders.push(col);

  const door = {
    name: opt.name, object: pivot, open: 0, target: 0, locked: !!opt.locked, chime: !!opt.chime, probeMats,
    center: c.clone().setY(1.2), collider: col, maxAngle: THREE.MathUtils.degToRad(opt.maxAngle ?? 95),
    onOpen: null,
    update(dt) {
      const k = this.target > this.open ? 2.2 : 1.6;
      this.open += THREE.MathUtils.clamp(this.target - this.open, -k * dt, k * dt);
      const e = this.open < 0.5 ? 2 * this.open * this.open : 1 - Math.pow(-2 * this.open + 2, 2) / 2;
      pivot.rotation.y = base + sign * e * this.maxAngle;
      col.enabled = this.open < 0.15;
    },
    toggle() {
      if (this.locked) return false;
      this.target = this.target > 0.5 ? 0 : 1;
      if (this.target === 1 && this.onOpen) this.onOpen(this);
      return true;
    },
  };
  ctx.dynamics.push(door);
  ctx.interact({
    name: opt.name,
    pos: c.clone().setY(1.1),
    radius: Math.max(0.6, w * 0.6),
    prompt: () => (door.locked ? 'LOCKED' : door.target > 0.5 ? '[E] CLOSE DOOR' : '[E] OPEN DOOR'),
    action: (game) => {
      if (door.locked) { game.audio?.play('locked', door.center); game.hud?.subtitle(opt.lockedText ?? 'It\'s locked.'); return; }
      door.toggle();
      game.audio?.play(door.target > 0.5 ? (opt.kind === 'glassDouble' ? 'doorGlassOpen' : 'doorOpen') : 'doorClose', door.center);
      if (door.chime && door.target > 0.5) game.audio?.play('chime', door.center);
    },
    door,
  });
  return door;
}
