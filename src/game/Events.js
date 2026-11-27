import * as THREE from 'three';
import { G } from '../gfx/Materials.js';
import { GROUP } from '../world/World.js';
import { LAYER_NO_REFLECT } from '../render/Pipeline.js';
import { Sparks } from '../world/Sparks.js';

const LAYER_CCTV_ONLY = 3;

function makeFigure(mat) {
  const g = new THREE.Group();
  const add = (geo, x, y, z, rx = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); m.castShadow = true; g.add(m); return m; };
  add(new THREE.CapsuleGeometry(0.17, 0.62, 4, 10), 0, 1.32, 0);          // torso
  add(new THREE.SphereGeometry(0.12, 12, 10), 0, 1.98, 0.02);            // head
  add(new THREE.CapsuleGeometry(0.055, 0.78, 4, 8), -0.24, 1.18, 0, 0, 0.06); // arms (long)
  add(new THREE.CapsuleGeometry(0.055, 0.78, 4, 8), 0.24, 1.18, 0, 0, -0.06);
  add(new THREE.CapsuleGeometry(0.075, 0.78, 4, 8), -0.1, 0.48, 0);      // legs
  add(new THREE.CapsuleGeometry(0.075, 0.78, 4, 8), 0.1, 0.48, 0);
  g.scale.setScalar(1.08);
  return g;
}

export class Events {
  constructor(game) {
    this.g = game;
    this.t = 0;
    this.flash = 0;
    this.flashSeq = [];
    this.baseSky = G.uSkyColor.value.clone();
    this.state = { blackout: false, enteredStore: false, phoneRang: false, phoneAnswered: false, breakerOn: false, figureRoad: 'hidden', pumpFigure: 0, lookTime: 0, knocked: false, payphone: 0 };
    if (game.params.has('blackout')) this.state.blackout = true;
    const W = game.world;
    // figure (shared dark material, faintly lit by flashlight)
    const mat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 });
    this.figRoad = makeFigure(mat);
    this.figRoad.position.set(27.2, 0, 9.0);
    this.figRoad.rotation.y = -Math.PI / 2 + 0.4;
    this.figRoad.visible = false;
    W.scene.add(this.figRoad);
    this.figPump = makeFigure(mat);
    this.figPump.position.set(12.35, 0.0, 1.0);
    this.figPump.rotation.y = Math.PI / 2 + 0.25;
    this.figPump.visible = false;
    W.scene.add(this.figPump);
    // a figure that only exists on the CCTV feed (aisle 2)
    this.figCCTV = makeFigure(mat);
    this.figCCTV.position.set(-6.9, 0, -3.05);
    this.figCCTV.rotation.y = Math.PI / 2;
    this.figCCTV.traverse((o) => o.layers.set(LAYER_CCTV_ONLY));
    W.scene.add(this.figCCTV);
    this.figCCTV.visible = false;

    this.sparks = new Sparks(W.scene);
    // door hooks
    const entrance = W.dynamics.find((d) => d.name === 'entrance');
    if (entrance) entrance.onOpen = () => { this.state.enteredStore = true; };
    this.pending = [];
  }

  after(sec, fn) { this.pending.push({ t: this.t + sec, fn }); }

  // ---------------------------------------------------------------- lightning
  lightning(strength = 1) {
    const s = strength * (0.7 + Math.random() * 0.5);
    const now = this.t;
    this.flashSeq = [[now, s], [now + 0.07, 0.15 * s], [now + 0.12, 0.9 * s], [now + 0.2, 0.2 * s], [now + 0.32, 0.6 * s * Math.random()]];
    const d = new THREE.Vector3(Math.random() - 0.5, 0.5 + Math.random() * 0.4, Math.random() - 0.5).normalize();
    this.g.world.sky?.uniforms.uFlashDir.value.copy(d);
    const delay = 0.8 + Math.random() * 3.5;
    this.after(delay, () => this.g.audio?.play(delay < 1.5 ? 'crack' : 'thunder'));
    // a flash may reveal the figure at pump 2 (only after the breaker was reset)
    if ((this.state.breakerOn || this.forcePump) && this.state.pumpFigure === 0) {
      const spot = this._pumpSpot();
      if (spot) {
        this.state.pumpFigure = 1;
        this.figPump.position.set(spot.x, 0, spot.z);
        const cp = this.g.camera.position;
        this.figPump.rotation.y = Math.atan2(cp.x - spot.x, cp.z - spot.z);
        this.figPump.visible = true;
        this.after(0.5, () => { this.figPump.visible = false; this.state.pumpFigure = 2; this.g.audio?.play('sting'); this.g.glitch(0.8); });
      }
    }
  }
  // a spot by pump 2 that is in view and not hidden behind a pillar / pump / van
  _pumpSpot() {
    const cam = this.g.camera;
    const cp = cam.position;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const cands = [[12.55, 2.6], [12.55, 0.9], [9.85, 0.9], [9.85, 2.7], [13.6, 1.8], [12.6, -0.6], [9.8, -0.6]];
    let best = null, bestDot = 0.55;
    for (const [x, z] of cands) {
      const to = new THREE.Vector3(x, 1.4, z).sub(cp);
      const dist = to.length();
      if (dist < 3 || dist > 40) continue;
      const dot = to.normalize().dot(fwd);
      if (dot < bestDot) continue;
      if (!this.g.lineOfSight(cp, new THREE.Vector3(x, 1.4, z))) continue;
      best = { x, z }; bestDot = dot;
    }
    return best;
  }
  _outsideNearCanopy() { const p = this.g.player.pos; return p.x > -1 && p.x < 22 && p.z > -15 && p.z < 30; }

  // ---------------------------------------------------------------- approach blackout
  // Walking up to the store: the caged wall lamp by the ICE chest buzzes, stutters and pops,
  // then the sales floor lights drop out. Coolers, the EXIT sign and the faulty troffer (own
  // circuit) stay on; the canopy keeps humming.
  _checkApproach() {
    const st = this.state;
    if (st.blackout || this.t < 2.0) return;
    const p = this.g.player.pos;
    const dLamp = Math.hypot(p.x - 0.6, p.z - 10.3);
    const dDoor = Math.hypot(p.x - 0.6, p.z - 2.6);
    const inside = p.x > -10 && p.x < 0 && p.z > -7 && p.z < 15;
    if (dLamp < 9.5 || dDoor < 8.5 || inside) this.blackout();
  }

  blackout() {
    const st = this.state;
    if (st.blackout) return;
    st.blackout = true;
    const g = this.g, W = g.world;
    const lampPos = new THREE.Vector3(0.25, 3.0, 10.3);
    const stutter = [0.45, 1.0, 0.15, 0.9, 0.0, 0.7, 0.05, 0.55];
    stutter.forEach((lv, i) => this.after(i * 0.075 + Math.random() * 0.02, () => W.setGroupLevel(GROUP.LAMP, lv)));
    // filament overdrive flash, then the bulb blows
    this.after(0.62, () => W.setGroupLevel(GROUP.LAMP, 2.2));
    this.after(0.66, () => { W.setGroupLevel(GROUP.LAMP, 0); g.audio?.play('pop', lampPos); this.sparks.burst(new THREE.Vector3(0.22, 2.96, 10.3), new THREE.Vector3(1, 0, 0)); });
    const storePos = new THREE.Vector3(-4.2, 2.9, 0.4);
    this.after(2.1, () => { W.setGroupLevel(GROUP.STORE, 0.5); g.audio?.play('powerdown', storePos); });
    this.after(2.2, () => W.setGroupLevel(GROUP.STORE, 0.85));
    this.after(2.32, () => W.setGroupLevel(GROUP.STORE, 0.15));
    this.after(2.45, () => W.setGroupLevel(GROUP.STORE, 0.4));
    this.after(2.55, () => W.setGroupLevel(GROUP.STORE, 0.0));
    this.after(4.2, () => { if (!g.flashlight.on) g.hud.subtitle('[F] Phone flashlight', 3.5); });
  }

  // ---------------------------------------------------------------- interactions
  breaker() {
    const g = this.g, W = g.world;
    const on = W.groupLevels[GROUP.STORE] > 0.5;
    g.audio?.play('breaker', g.world.ctx?.breakerPos);
    if (on) {
      W.setGroupLevel(GROUP.STORE, 0);
      g.hud.subtitle('The sales floor goes dark.');
      return;
    }
    // fluorescent start-up: stutter then steady
    this.state.breakerOn = true;
    this.state.blackout = true;
    const seq = [0.0, 0.25, 0.0, 0.0, 0.6, 0.1, 0.0, 0.9, 0.3, 1.0];
    seq.forEach((lv, i) => this.after(0.25 + i * 0.12 + Math.random() * 0.05, () => { W.setGroupLevel(GROUP.STORE, lv); if (lv > 0.2) g.audio?.play('tink', new THREE.Vector3(-4.8, 2.9, -1)); }));
    this.after(2.0, () => g.hud.subtitle('The lights hum back on.'));
    // the store phone rings a little later
    if (!this.state.phoneRang) this.after(14, () => this.ringPhone());
  }

  ringPhone() {
    if (this.state.phoneAnswered) return;
    this.state.phoneRang = true;
    this.ringing = 9;
    this._ringTick = 0;
  }

  wallphone() {
    const g = this.g;
    if (this.ringing > 0) {
      this.ringing = 0;
      this.state.phoneAnswered = true;
      g.audio?.play('static');
      g.hud.subtitle('Static. Then, very close to the mouthpiece: "...you turned the lights back on."', 5);
      g.glitch(0.5);
      this.after(5.5, () => g.hud.subtitle('"He can see you now."', 3.5));
      this.after(6.0, () => { this.lightning(1.2); });
      this.after(24.0, () => this.startEnding());
    } else {
      g.audio?.play('static');
      g.hud.subtitle('Dial tone. Then nothing at all.');
    }
  }

  // ---------------------------------------------------------------- ending
  // Put a figure on the camera's forward line at a visible distance, facing the camera.
  placeInView(fig, dmin, dmax) {
    const g = this.g;
    const cam = g.camera;
    const cp = cam.position;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    f.y = 0;
    if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
    f.normalize();
    let d = dmax;
    for (; d >= dmin; d -= 0.5) {
      const t = cp.clone().addScaledVector(f, d);
      if (g.lineOfSight(cp, t)) break;
    }
    d = Math.max(2.2, d);
    const p = cp.clone().addScaledVector(f, d);
    fig.position.set(p.x, 0, p.z);
    fig.rotation.y = Math.atan2(cp.x - p.x, cp.z - p.z);
    fig.updateMatrixWorld(true);
  }

  startEnding() {
    if (this.endingStarted) return;
    this.endingStarted = true;
    const g = this.g, W = g.world;
    g.audio?.play('sting');
    g.glitch(1.2);
    [0.9, 0.15, 0.7, 0.0, 0.4, 0.0].forEach((lv, i) => this.after(0.1 + i * 0.14, () => { W.setGroupLevel(GROUP.STORE, lv); if (lv > 0.3) g.audio?.play('tink', new THREE.Vector3(-4.8, 2.9, -1)); }));
    this.after(0.95, () => { this.intDead = true; });
    this.after(2.3, () => {
      this.placeInView(this.figPump, 3.5, 7.0);
      this.figPump.visible = true;
      this.state.pumpFigure = 2;
      this.lightning(1.8);
    });
    this.after(2.85, () => { this.figPump.visible = false; g.glitch(3.0); g.audio?.play('static'); });
    this.after(3.3, () => { this.fading = true; g.audio?.fadeOut?.(1.6); });
    this.after(5.0, () => this.showEndCard());
  }

  showEndCard() {
    const g = this.g;
    g.ending = true;
    g.paused = true;
    document.getElementById('end-meta').textContent = `UNIT 0731 · CAM 02 · ${g.clockString(true)}`;
    const card = document.getElementById('endcard');
    card.classList.remove('hidden');
    try { document.exitPointerLock?.(); } catch (e) { /* ignore */ }
    const dismiss = () => {
      removeEventListener('keydown', dismiss, true);
      card.removeEventListener('click', dismiss);
      card.classList.add('hidden');
      this.fading = false;
      g.pipeline.params.fade = 0;
      this.intDead = false;
      g.ending = false;
      g.audio?.fadeIn?.(1.0);
      g.input.requestLock();
      g.pause(false);
      g.hud.subtitle('The recording continues.', 3);
    };
    setTimeout(() => { addEventListener('keydown', dismiss, true); card.addEventListener('click', dismiss); }, 1200);
  }

  payphone() {
    const g = this.g;
    this.state.payphone++;
    g.audio?.play('static', new THREE.Vector3(-2.6, 1.4, 15.3));
    const lines = ['Dead line. Rain drumming on the hood.', 'Someone is breathing on the other end.', 'A voice, far away: "...pump two..."'];
    g.hud.subtitle(lines[Math.min(lines.length - 1, this.state.payphone - 1)], 4);
  }

  van() {
    const g = this.g;
    g.audio?.play('static', new THREE.Vector3(3.35, 1.4, -3.3));
    g.hud.subtitle('Keys still in the ignition. The radio is on — nothing but static on 1180 AM.', 5);
  }

  // ---------------------------------------------------------------- per-frame
  update(dt) {
    const g = this.g;
    this.t += dt;
    // pending timers
    for (let i = this.pending.length - 1; i >= 0; i--) if (this.pending[i].t <= this.t) { const p = this.pending.splice(i, 1)[0]; p.fn(); }
    this._checkApproach();
    this.sparks.update(dt, g.camera, g.pipeline.h);
    // lightning envelope
    let f = 0;
    for (const [t0, s] of this.flashSeq) { const dtt = this.t - t0; if (dtt >= 0) f = Math.max(f, s * Math.exp(-dtt * 14)); }
    this.flash = f;
    G.uLightning.value = f;
    G.uSkyColor.value.copy(this.baseSky).multiplyScalar(1 + f * 260);
    g.pipeline.params.flash = f * 0.004;
    // phone ringing
    if (this.ringing > 0) {
      this.ringing -= dt;
      this._ringTick -= dt;
      if (this._ringTick <= 0) { this._ringTick = 3.0; g.audio?.play('ring', new THREE.Vector3(-0.75, 1.55, 6.4)); }
    }
    // distant figure under a street light down the road
    const p = g.player.pos;
    const outside = !(p.x > -10 && p.x < 0 && p.z > -7 && p.z < 15);
    const st = this.state;
    if (st.figureRoad === 'hidden' && this.t > 75 && outside) { st.figureRoad = 'visible'; this.figRoad.visible = true; }
    if (st.figureRoad === 'visible') {
      const cam = g.camera;
      const to = this.figRoad.position.clone().setY(1.6).sub(cam.position);
      const dist = to.length();
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const looking = to.normalize().dot(fwd) > 0.97;
      if (looking) st.lookTime += dt;
      if (dist < 15 || st.lookTime > 3.0) {
        // vanish only when not observed
        if (!looking) { this.figRoad.visible = false; st.figureRoad = 'gone'; }
      }
    }
    // knock on the side door when standing in the stockroom
    if (!st.knocked && p.x > -6.8 && p.x < -0.3 && p.z > 8 && p.z < 14.7 && this.t > 30) {
      st.knocked = true;
      this.after(1.5, () => g.audio?.play('knock', new THREE.Vector3(0.3, 1.2, 13.5)));
    }
    // CCTV-only figure appears after the phone call
    this.figCCTV.visible = st.phoneAnswered;
    // ending fade to black
    if (this.fading) g.pipeline.params.fade = Math.min(1, g.pipeline.params.fade + dt / 1.6);
  }
}

export { LAYER_CCTV_ONLY };
