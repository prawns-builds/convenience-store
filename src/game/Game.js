import * as THREE from 'three';
import { G } from '../gfx/Materials.js';
import { HUD } from '../ui/HUD.js';
import { GROUP } from '../world/World.js';
import { Rain } from '../world/Rain.js';
import { CCTV } from './CCTV.js';
import { Events } from './Events.js';
import { AudioEngine } from '../audio/Audio.js';
import { Traffic } from '../world/Traffic.js';

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
    this.traffic = new Traffic(this);
    this.glitchT = 0;
    this.events = new Events(this);
  }

  begin(silent = false) {
    const wasStarted = this.started;
    this.started = true;
    this.input.enabled = true;
    // create/resume audio synchronously inside the user gesture (Safari autoplay rules)
    if (!silent && !this.audio) {
      this.audio = new AudioEngine(this);
      this.audio.start();
    }
    if (wasStarted) this.pause(false); else this.paused = false;
  }

  pause(p) {
    this.paused = p;
    if (!p) document.getElementById('overlay').classList.add('hidden');
    if (p) {
      document.getElementById('overlay').classList.remove('hidden');
      const btn = document.getElementById('ov-start');
      btn.textContent = 'RESUME';
      document.querySelector('.ov-rec').innerHTML = '<span class="rec-dot"></span>PAUSED';
    }
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
    this.flashlight.nearScale = this.flashNearScale();
    this.flashlight.update(dt, this.player, this.time);
    if (!this.paused) this.traffic.update(dt);
    if (this.glitchT > 0) { this.glitchT = Math.max(0, this.glitchT - dt); this.pipeline.params.glitch = Math.min(1, this.glitchT * 2.5) * (0.6 + 0.4 * Math.random()); }
    else this.pipeline.params.glitch = 0;
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
    if (!this.hinted && this.started && !this.paused && this.time > 7 && !this.flashlight.on) { this.hinted = true; this.hud.subtitle('[F] Phone flashlight     [E] Interact', 4.5); }
    this.audio?.update(dt);
    // progressive bake refinement
    if (!W.baker.done) {
      W.baker.step(this.quality.bakeBudget, this.params.has('shot') ? 3 : 4);
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

  glitch(sec = 0.6) { this.glitchT = Math.max(this.glitchT, sec); }

  // distance to what the phone light hits (2D collider raycast + floor plane) -> soften near-field blow-out
  flashNearScale() {
    const cam = this.camera;
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const o = cam.position;
    let tHit = 30;
    if (d.y < -0.05) tHit = Math.min(tHit, o.y / -d.y);
    const hx = d.x, hz = d.z, hl = Math.hypot(hx, hz);
    if (hl > 1e-3) {
      const dx = hx / hl, dz = hz / hl;
      for (const c of this.world.colliders) {
        if (!c.enabled || c.y1 < 0.9 || c.y0 > 2.2) continue;
        let t = Infinity;
        if (c.type === 'circle') {
          const ox = o.x - c.x, oz = o.z - c.z;
          const b = ox * dx + oz * dz, cc = ox * ox + oz * oz - c.r * c.r;
          const disc = b * b - cc;
          if (disc >= 0) { const r = -b - Math.sqrt(disc); if (r > 0) t = r; }
        } else {
          const ox = o.x - c.x, oz = o.z - c.z;
          const lx = c.cos * ox - c.sin * oz, lz = c.sin * ox + c.cos * oz;
          const ldx = c.cos * dx - c.sin * dz, ldz = c.sin * dx + c.cos * dz;
          let t0 = -Infinity, t1 = Infinity;
          for (const [p, q, h] of [[lx, ldx, c.hx], [lz, ldz, c.hz]]) {
            if (Math.abs(q) < 1e-6) { if (Math.abs(p) > h) { t0 = Infinity; break; } continue; }
            let a = (-h - p) / q, b2 = (h - p) / q;
            if (a > b2) [a, b2] = [b2, a];
            t0 = Math.max(t0, a); t1 = Math.min(t1, b2);
          }
          if (t0 <= t1 && t0 > 0) t = t0;
        }
        if (t < Infinity) tHit = Math.min(tHit, t / hl);
      }
    }
    return 0.32 + 0.68 * THREE.MathUtils.smoothstep(tHit, 0.35, 2.4);
  }

  clockString(withSeconds = true) {
    const t = Math.floor(this.gameClock);
    const h = Math.floor(t / 3600) % 24, m = Math.floor(t / 60) % 60, s = t % 60;
    return withSeconds ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${h}:${String(m).padStart(2, '0')}`;
  }

  debugInfo() {
    const r = this.renderer.info;
    return { programs: r.programs?.length, calls: r.render.calls, tris: r.render.triangles, geos: r.memory.geometries, tex: r.memory.textures, bake: this.world.baker.progress, scale: this.world.baker.scale, atlas: this.world.packInfo };
  }
}
