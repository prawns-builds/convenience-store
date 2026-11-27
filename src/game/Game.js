import * as THREE from 'three';
import { G } from '../gfx/Materials.js';
import { HUD } from '../ui/HUD.js';
import { GROUP } from '../world/World.js';
import { Rain } from '../world/Rain.js';
import { CCTV } from './CCTV.js';
import { Events } from './Events.js';

const NOTES = {
  rules: `NIGHT SHIFT RULES

1. Lock the register at 2.
2. Don't answer the phone after 3.
   It isn't the manager.
3. If the lights go out, DO NOT go
   into the back. Wait for them
   to come back on.
4. He waits by pump 2. Don't turn
   on the canopy lights for him.
5. Don't look at it.
   Don't look at it.

                                  — D.`,
  logbook: `SHIFT LOG — 11/26 → 11/27

22:14  delivery late again
23:51  white van parked out front.
       nobody inside it. engine warm.
01:05  radio static on every channel
01:48  lights out in back. breaker
       won't stay on
02:03  someone standing at pump 2
02:04  not someone

(the rest of the page is torn out)`,
};

export class Game {
  constructor(sys) {
    Object.assign(this, sys);
    this.started = false;
    this.paused = true;
    this.time = 0;
    this.hfov = 100;
    this.dynScale = 1;
    this.frameTimes = [];
    this.noteOpen = false;
    this.hud = new HUD(this);
    this.events = null;
    this.audio = null;
    this.focus = null;
    this.gameClock = 2 * 3600 + 47 * 60; // 02:47:00
    this.world.setGroupLevel(GROUP.BREAKER, 0);
    this.world.setGroupLevel(GROUP.FLICKER_EXT, 1);
    this.world.setGroupLevel(GROUP.FLICKER_INT, 0.6);
    this.flick = { ext: 1, int: 1, extT: 0, intT: 0 };
    this.player.onStep = (run, pos) => this.audio?.footstep(run, pos);
    const p = this.params;
    if (p.has('flash')) this.flashlight.on = true;
    if (p.has('breaker')) this.world.setGroupLevel(GROUP.BREAKER, 1);
    if (!p.has('cam')) this.player.setPose(9.2, 1.52, 28.5, THREE.MathUtils.degToRad(14), THREE.MathUtils.degToRad(-3));
    // rain + its light set (exterior static lights + street light heads)
    this.rain = new Rain(this.world.scene, this.quality);
    const rl = [];
    for (const L of this.world.lights) {
      const pos = L.pos;
      const inStore = pos.x > -10 && pos.x < 0.05 && pos.z > -7 && pos.z < 15 && pos.y < 4.4;
      if (inStore || L.group === GROUP.BREAKER || L.group === GROUP.FLICKER_INT) continue;
      if (L.intensity < 4) continue;
      rl.push({ pos, color: L.color, exteriorRain: true, rainRange: L.range > 25 ? 26 : 14, rainPower: L.intensity * (L.range > 25 ? 0.05 : 0.09) });
    }
    for (let k = -3; k <= 3; k++) rl.push({ pos: new THREE.Vector3(25.2, 8.4, 8 + k * 32), color: new THREE.Color(0xffa65a), exteriorRain: true, rainRange: 26, rainPower: 5.5 });
    this.rain.setLights(rl);
    this.cctv = new CCTV(this, this.world.ctx.cctvScreens ?? []);
    this.events = new Events(this);
  }

  async begin(silent = false) {
    this.started = true;
    this.paused = false;
    this.input.enabled = true;
    if (!silent && !this.audio) {
      const { AudioEngine } = await import('../audio/Audio.js');
      this.audio = new AudioEngine(this);
      await this.audio.start();
    }

  }

  pause(p) {
    this.paused = p;
    if (p) document.getElementById('overlay').classList.remove('hidden');
    this.audio?.setPaused(p);
  }

  showNote(id) {
    const el = document.getElementById('note');
    document.getElementById('note-text').textContent = NOTES[id] ?? id;
    el.classList.remove('hidden');
    this.noteOpen = true;
    this.player.frozen = true;
    this.audio?.play('paper');
  }
  closeNote() {
    document.getElementById('note').classList.add('hidden');
    this.noteOpen = false;
    this.player.frozen = false;
  }

  // ------------------------------------------------------------------------------- lights
  updateLights(dt) {
    const W = this.world;
    const f = this.flick;
    // exterior faulty tube: mostly on, with bursts of stutter
    f.extT -= dt;
    if (f.extT <= 0) { f.extMode = Math.random() < 0.25 ? 'stutter' : 'on'; f.extT = f.extMode === 'stutter' ? 0.4 + Math.random() * 1.2 : 2 + Math.random() * 6; }
    let ext = 1;
    if (f.extMode === 'stutter') ext = Math.random() < 0.45 ? 0.05 + Math.random() * 0.2 : 1;
    W.setGroupLevel(GROUP.FLICKER_EXT, ext);
    // interior faulty troffer / restroom: dim, buzzing, irregular
    f.intT -= dt;
    if (f.intT <= 0) { f.intMode = Math.random() < 0.4 ? 'stutter' : (Math.random() < 0.5 ? 'off' : 'on'); f.intT = f.intMode === 'stutter' ? 0.3 + Math.random() * 1.0 : 1 + Math.random() * 4; }
    let it = f.intMode === 'off' ? 0.0 : 0.85;
    if (f.intMode === 'stutter') it = Math.random() < 0.5 ? Math.random() * 0.3 : 0.9;
    W.setGroupLevel(GROUP.FLICKER_INT, it);
    this.audio?.setFlicker(ext, it);
  }

  // ------------------------------------------------------------------------------- interactions
  updateInteract() {
    const cam = this.camera;
    const o = cam.position;
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    let best = null, bestScore = Infinity;
    for (const it of this.world.interactables) {
      if (it.enabled === false) continue;
      const to = it.pos.clone().sub(o);
      const dist = to.length();
      if (dist > 2.3) continue;
      const t = to.dot(d);
      if (t < 0) continue;
      const perp = to.clone().addScaledVector(d, -t).length();
      const r = it.radius ?? 0.5;
      if (perp > r) continue;
      const score = perp / r + dist * 0.15;
      if (score < bestScore) { best = it; bestScore = score; }
    }
    this.focus = best;
    this.hud.prompt(best ? (typeof best.prompt === 'function' ? best.prompt(this) : best.prompt) : null);
    if (best && this.input.hit('KeyE')) best.action(this);
  }

  // ------------------------------------------------------------------------------- dynamic resolution
  updateDynRes(dt) {
    if (this.params.has('shot') || this.params.has('fixedres')) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 45) return;
    const sorted = this.frameTimes.slice().sort((a, b) => a - b);
    const p80 = sorted[Math.floor(sorted.length * 0.8)];
    this.frameTimes.length = 0;
    let s = this.dynScale;
    if (p80 > 1 / 50) s = Math.max(0.55, s - 0.08);
    else if (p80 < 1 / 70 && s < 1) s = Math.min(1, s + 0.05);
    if (s !== this.dynScale) { this.dynScale = s; this.onResize?.(); }
  }

  update(dt, now) {
    const inp = this.input;
    const W = this.world;
    if (!this.paused) this.time += dt;
    G.uTime.value = this.time;
    if (this.noteOpen && (inp.hit('KeyE') || inp.hit('Escape'))) { this.closeNote(); inp.endFrame(); }
    if (!this.paused) {
      if (inp.hit('KeyF')) { this.flashlight.toggle(); this.audio?.play('click'); }
      if (inp.hit('KeyQ')) { this.flashlight.raiseT = this.flashlight.raiseT; this.flashlight.forceLower = !this.flashlight.forceLower; }
      this.player.update(dt);
      if (!this.noteOpen) this.updateInteract();
      this.gameClock += dt;
    } else if (this.params.has('cam')) {
      this.player.update(dt);
    }
    this.flashlight.gameTime = this.clockString(false);
    this.flashlight.update(dt, this.player, this.time);
    this.updateLights(dt);
    for (const d of W.dynamics) d.update?.(dt);
    // probe lighting for dynamic objects (staggered)
    this._probeTick = (this._probeTick ?? 0) + 1;
    if (this._probeTick % 10 === 0) for (const d of W.dynamics) {
      if (!d.probeMats) continue;
      const irr = W.sampleProbe(d.center, new THREE.Vector3());
      for (const m of d.probeMats) { m.userData.uniforms.uProbeStatic.value.copy(irr); m.userData.uniforms.uProbeSky.value = irr.sky ?? 0; }
    }
    W.update(dt, this.time);
    if (!this.paused || this.params.has('cam')) this.events?.update(dt);
    this.audio?.update(dt);
    // progressive bake refinement
    if (!W.baker.done) {
      W.baker.step(this.quality.bakeBudget, this.params.has('shot') ? 1 : 4);
      if (W.baker.done) { W.captureProbes(); W._readProbes(); W.baker.disposeAccumulators(); }
    }
    this.pipeline.params.lightning = G.uLightning.value;
    this.rain.update(this.camera, this.flashlight, { x: this.pipeline.w, y: this.pipeline.h });
    this.cctv.update(dt);
    this.pipeline.render(W.scene, this.camera, dt);
    this.hud.update(dt);
    this.updateDynRes(dt);
    inp.endFrame();
  }

  clockString(withSeconds = true) {
    const t = Math.floor(this.gameClock);
    const h = Math.floor(t / 3600) % 24, m = Math.floor(t / 60) % 60, s = t % 60;
    return withSeconds ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${h}:${String(m).padStart(2, '0')}`;
  }

  debugInfo() {
    const r = this.renderer.info;
    return { calls: r.render.calls, tris: r.render.triangles, geos: r.memory.geometries, tex: r.memory.textures, bake: this.world.baker.progress, scale: this.world.baker.scale, atlas: this.world.packInfo };
  }
}
