import * as THREE from 'three';

// Fully procedural WebAudio soundscape (no audio files).
export class AudioEngine {
  constructor(game) {
    this.g = game;
    this.ctx = null;
    this.paused = false;
    this.inside = 0;
    this.under = 0;
    this.t = 0;
    this.nextThunder = 12 + Math.random() * 20;
    this._tmp = new THREE.Vector3();
  }

  async start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    try { await ctx.resume(); } catch (e) { /* ignore */ }
    const master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.25;
    master.connect(comp).connect(ctx.destination);
    this.master = master;
    // meters
    const split = ctx.createChannelSplitter(2);
    comp.connect(split);
    this.anL = ctx.createAnalyser(); this.anR = ctx.createAnalyser();
    this.anL.fftSize = this.anR.fftSize = 512;
    split.connect(this.anL, 0); split.connect(this.anR, 1);
    this.meterBuf = new Float32Array(512);

    // shared noise buffers
    this.white = this._noise('white', 4);
    this.pink = this._noise('pink', 6);
    this.brown = this._noise('brown', 6);
    this.crackle = this._crackleBuffer(3, 900);
    this.dripsBuf = this._crackleBuffer(4, 60);

    // ---- rain bed (outside), muffled bed (inside)
    this.rainOut = this._loop(this.pink, { type: 'bandpass', freq: 1600, q: 0.35 }, 0.0);
    this.rainHiss = this._loop(this.white, { type: 'highpass', freq: 5200, q: 0.5 }, 0.0);
    this.rainTap = this._loop(this.crackle, { type: 'bandpass', freq: 3200, q: 0.8 }, 0.0);
    this.rainIn = this._loop(this.brown, { type: 'lowpass', freq: 420, q: 0.5 }, 0.0);
    this.roofDrum = this._loop(this.crackle, { type: 'lowpass', freq: 900, q: 0.6 }, 0.0, 0.6);
    this.canopyDrum = this._loop(this.dripsBuf, { type: 'bandpass', freq: 1400, q: 3.5 }, 0.0, 0.9);
    this.wind = this._loop(this.brown, { type: 'lowpass', freq: 260, q: 0.9 }, 0.0, 0.5);
    this.windLfo = ctx.createOscillator(); this.windLfo.frequency.value = 0.07;
    const wl = ctx.createGain(); wl.gain.value = 120; this.windLfo.connect(wl).connect(this.wind.filter.frequency); this.windLfo.start();

    // ---- fluorescent buzz (canopy) + interior ballast + cooler hum (positional)
    this.buzzExt = this._buzz(new THREE.Vector3(6.5, 4.2, -2.5), 120, 0.05);
    this.buzzInt = this._buzz(new THREE.Vector3(-6.4, 2.9, -1.2), 120, 0.035);
    this.hum = this._hum(new THREE.Vector3(-9.0, 1.2, -2.0));
    this.officeHum = this._hum(new THREE.Vector3(-9.2, 1.0, 12.3), 0.015, 15734 / 4);

    this.listener = ctx.listener;
    this.started = true;
  }

  // ------------------------------------------------------------------ builders
  _noise(type, seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (type === 'white') d[i] = w * 0.5;
        else if (type === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      }
      // crossfade loop ends
      const f = Math.floor(ctx.sampleRate * 0.05);
      for (let i = 0; i < f; i++) { const a = i / f; d[len - f + i] = d[len - f + i] * (1 - a) + d[i] * a; }
    }
    return buf;
  }
  _crackleBuffer(seconds, rate) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const n = Math.floor(seconds * rate);
      for (let k = 0; k < n; k++) {
        const p = Math.floor(Math.random() * (len - 400));
        const amp = Math.pow(Math.random(), 2.5) * 0.9 + 0.05;
        const dec = 40 + Math.random() * 200;
        for (let i = 0; i < 300; i++) d[p + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / dec);
      }
    }
    return buf;
  }
  _loop(buffer, filt, gain, rate = 1) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = true; src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = filt.type; f.frequency.value = filt.freq; f.Q.value = filt.q ?? 0.7;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start(0, Math.random() * buffer.duration);
    return { src, filter: f, gain: g };
  }
  _panner(pos, ref = 2, roll = 1.2) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = 200;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    p.connect(this.master);
    return p;
  }
  _buzz(pos, f0, vol) {
    const ctx = this.ctx;
    const pan = this._panner(pos, 2.5, 1.4);
    const g = ctx.createGain(); g.gain.value = vol;
    const lp = ctx.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 480; lp.Q.value = 0.6;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = f0;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = f0 * 2.003;
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o1.connect(lp); o2.connect(g2).connect(lp);
    const crk = this._loop(this.crackle, { type: 'highpass', freq: 2500, q: 0.7 }, 0, 1.0);
    crk.gain.disconnect(); crk.gain.connect(pan);
    lp.connect(g).connect(pan);
    o1.start(); o2.start();
    return { gain: g, crackle: crk.gain, base: vol };
  }
  _hum(pos, vol = 0.03, f = 60) {
    const ctx = this.ctx;
    const pan = this._panner(pos, 2, 1.6);
    const g = ctx.createGain(); g.gain.value = vol;
    const o1 = ctx.createOscillator(); o1.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.frequency.value = f * 3.01;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.21;
    const lg = ctx.createGain(); lg.gain.value = vol * 0.4;
    lfo.connect(lg).connect(g.gain);
    o1.connect(g); o2.connect(g2).connect(g); g.connect(pan);
    o1.start(); o2.start(); lfo.start();
    return { gain: g, base: vol };
  }

  // ------------------------------------------------------------------ one-shots
  _env(node, t, a, peak, d) {
    node.gain.setValueAtTime(0, t);
    node.gain.linearRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  _noiseHit(dest, t, { buf = this.white, type = 'bandpass', freq = 2000, q = 1, peak = 0.3, a = 0.002, d = 0.12, rate = 1 }) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    s.connect(f).connect(g).connect(dest);
    this._env(g, t, a, peak, d);
    s.start(t, Math.random() * (buf.duration - 1)); s.stop(t + a + d + 0.05);
    return f;
  }
  _tone(dest, t, f, { type = 'sine', peak = 0.2, a = 0.002, d = 0.5, detune = 0 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune;
    const g = ctx.createGain();
    o.connect(g).connect(dest);
    this._env(g, t, a, peak, d);
    o.start(t); o.stop(t + a + d + 0.05);
    return o;
  }

  footstep(run, pos) {
    if (!this.ctx || this.paused) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const inside = this._isInside(pos);
    const v = 0.55 + run * 0.35 + Math.random() * 0.15;
    const dest = this.master;
    if (inside) {
      this._noiseHit(dest, t, { freq: 2600 + Math.random() * 1200, q: 1.4, peak: 0.16 * v, d: 0.05 });
      this._noiseHit(dest, t + 0.012, { buf: this.brown, type: 'lowpass', freq: 220, q: 0.8, peak: 0.35 * v, d: 0.09 });
      this._noiseHit(dest, t + 0.05, { freq: 5200, q: 2, peak: 0.03 * v, d: 0.04 }); // squeak/grit
    } else {
      this._noiseHit(dest, t, { buf: this.brown, type: 'lowpass', freq: 180, q: 0.7, peak: 0.3 * v, d: 0.1 });
      this._noiseHit(dest, t + 0.008, { freq: 1300 + Math.random() * 900, q: 0.7, peak: 0.12 * v, d: 0.16 });
      // wet splash
      this._noiseHit(dest, t + 0.02, { freq: 3500 + Math.random() * 2500, q: 0.9, peak: 0.09 * v * (0.6 + Math.random()), d: 0.22 });
    }
  }

  play(name, pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const dest = pos ? this._panner(pos, 1.5, 1.2) : this.master;
    switch (name) {
      case 'click': this._noiseHit(this.master, t, { freq: 4200, q: 3, peak: 0.12, d: 0.025 }); this._noiseHit(this.master, t + 0.04, { freq: 3000, q: 3, peak: 0.05, d: 0.02 }); break;
      case 'chime': {
        // two-tone shop door bell
        const notes = [1318.5, 1046.5];
        notes.forEach((f, i) => { this._tone(dest, t + i * 0.42, f, { peak: 0.13, d: 1.6 }); this._tone(dest, t + i * 0.42, f * 2.76, { peak: 0.03, d: 0.6 }); this._tone(dest, t + i * 0.42, f * 5.4, { peak: 0.012, d: 0.25 }); });
        break;
      }
      case 'doorGlassOpen': this._noiseHit(dest, t, { freq: 900, q: 0.8, peak: 0.12, d: 0.25 }); this._noiseHit(dest, t + 0.05, { buf: this.brown, type: 'lowpass', freq: 300, peak: 0.2, d: 0.2 }); break;
      case 'doorOpen': {
        const f = this._noiseHit(dest, t, { freq: 700, q: 6, peak: 0.12, a: 0.05, d: 0.7 });
        f.frequency.linearRampToValueAtTime(1500, t + 0.6);
        this._noiseHit(dest, t, { buf: this.brown, type: 'lowpass', freq: 200, peak: 0.25, d: 0.15 });
        break;
      }
      case 'doorClose': this._noiseHit(dest, t, { buf: this.brown, type: 'lowpass', freq: 160, peak: 0.6, d: 0.25 }); this._noiseHit(dest, t, { freq: 1800, q: 1, peak: 0.1, d: 0.08 }); break;
      case 'locked': for (let i = 0; i < 3; i++) this._noiseHit(dest, t + i * 0.09, { freq: 1800 + i * 300, q: 2, peak: 0.12, d: 0.06 }); break;
      case 'paper': for (let i = 0; i < 4; i++) this._noiseHit(this.master, t + i * 0.05, { freq: 3500 + Math.random() * 3000, q: 0.6, peak: 0.06, d: 0.08 }); break;
      case 'breaker': this._noiseHit(dest, t, { buf: this.brown, type: 'lowpass', freq: 250, peak: 0.7, d: 0.2 }); this._noiseHit(dest, t, { freq: 2500, q: 2, peak: 0.25, d: 0.03 }); break;
      case 'tink': this._noiseHit(dest, t, { freq: 6000, q: 4, peak: 0.08, d: 0.03 }); this._tone(dest, t, 120, { type: 'sawtooth', peak: 0.04, d: 0.12 }); break;
      case 'ring': {
        for (let k = 0; k < 2; k++) {
          const tt = t + k * 0.5;
          const o = this._tone(dest, tt, 1050, { type: 'square', peak: 0.0, d: 0.42 });
          const g = ctx.createGain(); g.gain.value = 0;
          o.disconnect(); o.connect(g).connect(dest);
          const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 22;
          const lg = ctx.createGain(); lg.gain.value = 0.06;
          lfo.connect(lg).connect(g.gain);
          lfo.start(tt); lfo.stop(tt + 0.42);
          const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 1320; o2.connect(g); o2.start(tt); o2.stop(tt + 0.42);
        }
        break;
      }
      case 'static': this._noiseHit(dest, t, { freq: 1800, q: 0.4, peak: 0.12, a: 0.05, d: 1.5 }); break;
      case 'thunder': {
        const d = 3 + Math.random() * 3;
        this._noiseHit(this.master, t, { buf: this.brown, type: 'lowpass', freq: 140, q: 0.5, peak: 0.9, a: 0.25, d });
        const f = this._noiseHit(this.master, t + 0.05, { buf: this.pink, type: 'lowpass', freq: 900, q: 0.4, peak: 0.25, a: 0.08, d: d * 0.6 });
        f.frequency.exponentialRampToValueAtTime(120, t + d * 0.6);
        break;
      }
      case 'crack': this._noiseHit(this.master, t, { buf: this.white, type: 'highpass', freq: 800, peak: 0.8, d: 0.6 }); this._noiseHit(this.master, t, { buf: this.brown, type: 'lowpass', freq: 200, peak: 1.0, d: 2.5 }); break;
      case 'sting': {
        this._tone(this.master, t, 46, { type: 'sawtooth', peak: 0.12, a: 0.6, d: 3.5 });
        this._tone(this.master, t, 46.6, { type: 'sawtooth', peak: 0.1, a: 0.6, d: 3.5 });
        this._noiseHit(this.master, t, { buf: this.pink, freq: 380, q: 6, peak: 0.12, a: 1.0, d: 3 });
        break;
      }
      case 'knock': for (let i = 0; i < 3; i++) { this._noiseHit(dest, t + i * 0.28, { buf: this.brown, type: 'lowpass', freq: 300, peak: 0.9, d: 0.12 }); this._noiseHit(dest, t + i * 0.28, { freq: 900, q: 2, peak: 0.15, d: 0.05 }); } break;
      default: break;
    }
  }

  _isInside(p) { return p.x > -10 && p.x < 0 && p.z > -7 && p.z < 15; }

  setFlicker(ext, int) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.buzzExt.gain.gain.setTargetAtTime(this.buzzExt.base * (0.6 + 0.4 * ext), t, 0.02);
    this.buzzExt.crackle.gain.setTargetAtTime(ext < 0.9 ? 0.05 : 0.0, t, 0.02);
    this.buzzInt.gain.gain.setTargetAtTime(this.buzzInt.base * int, t, 0.02);
    this.buzzInt.crackle.gain.setTargetAtTime(int > 0.05 && int < 0.85 ? 0.06 : 0.0, t, 0.02);
  }

  setPaused(p) {
    this.paused = p;
    if (!this.ctx) return;
    if (p) this.ctx.suspend(); else this.ctx.resume();
  }

  levels() {
    if (!this.anL) return [0, 0];
    const rms = (an) => { an.getFloatTimeDomainData(this.meterBuf); let s = 0; for (let i = 0; i < this.meterBuf.length; i++) s += this.meterBuf[i] * this.meterBuf[i]; return Math.sqrt(s / this.meterBuf.length); };
    const k = 5.5;
    return [Math.min(1, rms(this.anL) * k), Math.min(1, rms(this.anR) * k)];
  }

  update(dt) {
    if (!this.ctx || this.paused) return;
    const g = this.g;
    const cam = g.camera;
    const t = this.ctx.currentTime;
    // listener
    const L = this.listener;
    const p = cam.position;
    const f = this._tmp.set(0, 0, -1).applyQuaternion(cam.quaternion);
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    }
    // environment mix: inside / under canopy / open
    const inside = this._isInside(p) ? 1 : 0;
    const under = !inside && p.x > 0 && p.x < 14.5 && p.z > -10.5 && p.z < 6.4 ? 1 : 0;
    this.inside += (inside - this.inside) * Math.min(1, dt * 3);
    this.under += (under - this.under) * Math.min(1, dt * 3);
    const out = 1 - this.inside;
    // door open lets more rain in
    const doorOpen = g.world.dynamics.find((d) => d.name === 'entrance')?.open ?? 0;
    const leak = this.inside * (0.25 + doorOpen * 0.5);
    const set = (node, v) => node.gain.gain.setTargetAtTime(v, t, 0.08);
    const rain = g.world.rainAmount ?? 1;
    set(this.rainOut, (0.34 * out + 0.12 * leak) * rain);
    set(this.rainHiss, (0.06 * out * (1 - this.under * 0.5)) * rain);
    set(this.rainTap, (0.16 * out * (1 - this.under * 0.6) + 0.03 * leak) * rain);
    set(this.rainIn, 0.55 * this.inside * rain);
    set(this.roofDrum, 0.22 * this.inside * rain);
    set(this.canopyDrum, (0.12 * this.under + 0.04 * out) * rain);
    set(this.wind, 0.16 * out + 0.04);
    // thunder
    this.nextThunder -= dt;
    if (this.nextThunder <= 0) {
      this.nextThunder = 25 + Math.random() * 45;
      g.events?.lightning?.();
    }
  }
}
