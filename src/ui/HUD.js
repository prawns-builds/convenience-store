// Bodycam HUD overlay (DOM). Mirrors the reference footage layout.
export class HUD {
  constructor(game) {
    this.g = game;
    this.el = {
      time: document.getElementById('hud-time'),
      batt: document.getElementById('hud-batt'),
      battFill: document.getElementById('hud-batt-fill'),
      fov: document.getElementById('hud-fov'),
      iso: document.getElementById('hud-iso'),
      res: document.getElementById('hud-res'),
      ml: document.getElementById('hud-ml'),
      mr: document.getElementById('hud-mr'),
      prompt: document.getElementById('prompt'),
      sub: document.getElementById('subtitle'),
      stats: document.getElementById('stats'),
    };
    for (const m of [this.el.ml, this.el.mr]) for (let i = 0; i < 8; i++) m.appendChild(document.createElement('i'));
    this.t = 0;
    this.slow = 0;
    this.camBatt = 0.92;
    this.subT = 0;
    this.lastPrompt = null;
    this.iso = 800;
    this.showStats = game.params.has('stats');
    if (this.showStats) this.el.stats.classList.remove('hidden');
    addEventListener('keydown', (e) => { if (e.code === 'F3') { this.showStats = !this.showStats; this.el.stats.classList.toggle('hidden', !this.showStats); e.preventDefault(); } });
    this.fps = 60;
  }
  prompt(text) {
    if (text === this.lastPrompt) return;
    this.lastPrompt = text;
    this.el.prompt.textContent = text ?? '';
    this.el.prompt.classList.toggle('show', !!text);
  }
  subtitle(text, dur = 3.5) {
    this.el.sub.textContent = text;
    this.el.sub.classList.add('show');
    this.subT = dur;
  }
  update(dt) {
    const g = this.g;
    this.t += dt;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) this.el.sub.classList.remove('show'); }
    // audio meters
    const lv = g.audio?.levels?.() ?? [0, 0];
    const bars = (m, v) => { const n = Math.round(Math.min(1, v) * 8); const kids = m.children; for (let i = 0; i < kids.length; i++) kids[i].className = i < n ? 'on' : ''; };
    bars(this.el.ml, lv[0]); bars(this.el.mr, lv[1]);
    this.slow -= dt;
    if (this.slow > 0) return;
    this.slow = 0.25;
    const d = '2026-11-27';
    this.el.time.textContent = `${d} ${g.clockString(true)}`;
    this.camBatt = Math.max(0.05, 0.92 - g.time / 3600 * 0.1);
    const pct = Math.round(this.camBatt * 100);
    this.el.batt.textContent = `${pct}%`;
    this.el.battFill.style.width = `${Math.round(this.camBatt * 85)}%`;
    // ISO follows auto exposure
    const info = g.pipeline.pollExposure();
    const iso = Math.round(Math.min(6400, Math.max(100, 320 * info.exposure)) / 100) * 100;
    this.iso += (iso - this.iso) * 0.5;
    this.el.iso.textContent = `ISO ${Math.round(this.iso / 100) * 100}`;
    this.el.fov.textContent = `FOV ${Math.round(g.hfov + 10)}°`;
    const h = Math.round(g.pipeline.h ?? 1080);
    this.el.res.textContent = `${h}P`;
    if (this.showStats) {
      const r = g.renderer.info;
      this.el.stats.textContent = `FPS ${this.fps.toFixed(0)}  scale ${g.dynScale.toFixed(2)}  ${g.pipeline.w}x${g.pipeline.h}\ncalls ${r.render.calls}  tris ${(r.render.triangles / 1000).toFixed(0)}k\nbake ${(g.world.baker.progress * 100).toFixed(0)}%  q=${g.quality.name}\npos ${g.player.pos.x.toFixed(1)} ${g.player.pos.z.toFixed(1)}`;
    }
  }
}
