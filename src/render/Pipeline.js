import * as THREE from 'three';
import { FSPass, fsMaterial, makeRT } from './FSPass.js';
import * as SH from './shaders.js';
import { G } from '../gfx/Materials.js';

export const LAYER_NO_REFLECT = 1; // not in planar reflection (ground, floors, rain)
export const LAYER_PLAYER = 2;     // main view only (player's phone/hand)

// Orchestrates the frame: planar reflection -> main HDR -> volumetrics -> fog composite ->
// bloom -> auto exposure -> bodycam final pass.
export class Pipeline {
  constructor(renderer, q) {
    this.r = renderer;
    this.q = q;
    this.frame = 0;
    this.time = 0;
    this.reflCam = new THREE.PerspectiveCamera();
    this.reflCam.layers.set(0);
    this.prevViewProj = new THREE.Matrix4();
    this.viewProj = new THREE.Matrix4();
    // Look: crisp near field, fog that only builds with distance (street lights fading down the
    // highway), deep blacks, restrained lens effects. Values are scene-linear HDR.
    this.params = {
      fogDensity: 0.016, fogHeight: 7, fogStart: 16, dustDensity: 0.0012,
      fogColor: new THREE.Color(0.0066, 0.0067, 0.0078), fogColorHigh: new THREE.Color(0.0040, 0.0042, 0.0052),
      bloomStrength: 0.045, bloomRadius: 1.0,
      sharpen: 0.55, contrast: 1.18,
      distortion: 0.14, ca: 0.012, vignette: 0.5, grain: 0.011,
      exposureBias: 1.0, saturation: 0.92,
      lift: new THREE.Vector3(0.0012, 0.0014, 0.002), gain: new THREE.Vector3(1.0, 1.0, 1.0),
      motionBlur: 0.0,
      key: 0.03, minExp: 0.4, maxExp: 2.2,
      flash: 0, glitch: 0, fade: 0, lightning: 0, glowGain: 3.0,
    };
    this.glows = [];
    this.flashlight = null;
    this._v0 = new THREE.Vector3(); this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._build();
  }

  _build() {
    // passes
    this.down13 = new FSPass(fsMaterial({ uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, fragmentShader: SH.DOWNSAMPLE13 }));
    this.blurDir = new FSPass(fsMaterial({ uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }, fragmentShader: SH.BLUR_DIR }));
    this.upTent = new FSPass(fsMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } },
      fragmentShader: SH.UPSAMPLE_TENT,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    }));
    const depthU = () => ({ uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() } });
    const box = { uBoxMin: { value: new THREE.Vector3(-10.15, 0, -7.15) }, uBoxMax: { value: new THREE.Vector3(0.15, 4.35, 15.15) } };
    this.vol = new FSPass(fsMaterial({
      uniforms: {
        ...depthU(), ...box,
        tDepth: { value: null }, uCamPos: { value: new THREE.Vector3() }, uTime: { value: 0 }, uFrame: { value: 0 },
        uFogDensity: { value: 0 }, uFogHeight: { value: 10 }, uFogStart: { value: 15 }, uDustDensity: { value: 0 },
        uFlashOn: { value: 0 }, uFlashPos: { value: new THREE.Vector3() }, uFlashDir: { value: new THREE.Vector3(0, 0, -1) },
        uFlashColor: { value: new THREE.Vector3() }, uFlashCone: { value: new THREE.Vector2(0.8, 0.95) },
        tFlashShadow: { value: null }, uFlashShadowMatrix: { value: new THREE.Matrix4() }, tNoise: { value: null },
        uGlowCount: { value: 0 }, uGlowGain: { value: 5 },
        uGlowPos: { value: Array.from({ length: 32 }, () => new THREE.Vector4()) },
        uGlowCol: { value: Array.from({ length: 32 }, () => new THREE.Vector4()) },
      },
      defines: { VOL_STEPS: this.q.volSteps },
      fragmentShader: SH.VOLUMETRIC,
    }));
    this.comp = new FSPass(fsMaterial({
      uniforms: {
        ...depthU(), ...box,
        tColor: { value: null }, tDepth: { value: null }, tVol: { value: null }, uVolTexel: { value: new THREE.Vector2() },
        uCamPos: { value: new THREE.Vector3() }, uFogDensity: { value: 0 }, uFogHeight: { value: 10 }, uFogStart: { value: 15 }, uDustDensity: { value: 0 },
        uFogColor: { value: new THREE.Vector3() }, uFogColorHigh: { value: new THREE.Vector3() }, uLightning: { value: 0 },
      },
      fragmentShader: SH.COMPOSITE,
    }));
    this.expo = new FSPass(fsMaterial({
      uniforms: {
        tSrc: { value: null }, tPrev: { value: null }, uDt: { value: 0.016 }, uKey: { value: 0.18 },
        uRange: { value: new THREE.Vector2(0.5, 20) }, uSpeedUp: { value: 1.2 }, uSpeedDown: { value: 2.0 }, uReset: { value: 1 },
      },
      fragmentShader: SH.EXPOSURE,
    }));
    this.final = new FSPass(fsMaterial({
      uniforms: {
        ...depthU(),
        tColor: { value: null }, tBloom: { value: null }, tExposure: { value: null }, tDepth: { value: null },
        uResolution: { value: new THREE.Vector2() }, uTime: { value: 0 }, uFrame: { value: 0 },
        uBloomStrength: { value: 0.08 }, uSharpen: { value: 0.5 }, uContrast: { value: 1.0 }, uDistortion: { value: 0.2 }, uCA: { value: 0.03 }, uVignette: { value: 0.5 },
        uGrain: { value: 0.04 }, uExposureBias: { value: 1 }, uSaturation: { value: 0.85 },
        uLift: { value: new THREE.Vector3() }, uGain: { value: new THREE.Vector3(1, 1, 1) },
        uMotionBlur: { value: 0 }, uPrevViewProj: { value: new THREE.Matrix4() }, uViewProj: { value: new THREE.Matrix4() },
        uFlash: { value: 0 }, uGlitch: { value: 0 }, uFade: { value: 0 },
      },
      fragmentShader: SH.FINAL,
    }));
    this.expRT = [makeRT(1, 1, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }), makeRT(1, 1, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter })];
    this.expIdx = 0;
    this.expReadBuf = new Float32Array(4);
    this.exposureInfo = { exposure: 1, avg: 0.1 };
  }

  // Compile every post-processing program in parallel during loading.
  async precompile() {
    const passes = [this.down13, this.blurDir, this.upTent, this.vol, this.comp, this.expo, this.final];
    const scene = new THREE.Scene();
    for (const p of passes) scene.add(p.mesh);
    try { if (this.r.compileAsync) await this.r.compileAsync(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)); } catch (e) { /* lazy compile */ }
    for (const p of passes) scene.remove(p.mesh);
  }

  setSize(cssW, cssH, pixelRatio) {
    const q = this.q;
    const w = Math.max(16, Math.round(cssW * pixelRatio * q.scale));
    const h = Math.max(16, Math.round(cssH * pixelRatio * q.scale));
    if (this.w === w && this.h === h && this.rts) return;
    this.w = w; this.h = h;
    this._disposeRTs();
    const depthTex = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    depthTex.minFilter = THREE.NearestFilter; depthTex.magFilter = THREE.NearestFilter;
    // at high pixel densities 2x MSAA is enough (edges are already sub-pixel)
    const samples = pixelRatio * q.scale >= 1.5 ? Math.min(q.msaa, 2) : q.msaa;
    const main = makeRT(w, h, { type: THREE.HalfFloatType, depth: true, samples, depthTexture: depthTex });
    const comp = makeRT(w, h, { type: THREE.HalfFloatType });
    const rw = Math.max(8, Math.round(w * q.reflScale)), rh = Math.max(8, Math.round(h * q.reflScale));
    const refl0 = makeRT(rw, rh, { type: THREE.HalfFloatType, depth: true });
    const refl1 = makeRT(rw >> 1, rh >> 1, { type: THREE.HalfFloatType });
    const refl1b = makeRT(rw >> 1, rh >> 1, { type: THREE.HalfFloatType });
    const refl2 = makeRT(rw >> 2, rh >> 2, { type: THREE.HalfFloatType });
    const refl2b = makeRT(rw >> 2, rh >> 2, { type: THREE.HalfFloatType });
    const vw = Math.max(8, Math.round(w * q.volScale)), vh = Math.max(8, Math.round(h * q.volScale));
    const vol = makeRT(vw, vh, { type: THREE.HalfFloatType });
    const bloom = [];
    let bw = w, bh = h;
    for (let i = 0; i < q.bloomLevels; i++) {
      bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1);
      bloom.push(makeRT(bw, bh, { type: THREE.HalfFloatType }));
    }
    this.rts = { main, comp, refl0, refl1, refl1b, refl2, refl2b, vol, bloom, depthTex };
    G.uRefl0.value = refl0.texture; G.uRefl1.value = refl1.texture; G.uRefl2.value = refl2.texture;
    G.uResolution.value.set(w, h);
    this.final.uniforms.uResolution.value.set(w, h);
  }

  _disposeRTs() {
    if (!this.rts) return;
    for (const [k, v] of Object.entries(this.rts)) {
      if (Array.isArray(v)) v.forEach((r) => r.dispose());
      else if (v && v.dispose) v.dispose();
    }
    this.rts = null;
  }

  // ---------------------------------------------------------------------------------------
  _renderReflection(scene, camera) {
    const R = this.r;
    const rc = this.reflCam;
    rc.projectionMatrix.copy(camera.projectionMatrix);
    rc.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    // mirrored position / orientation (non-mirrored handedness; sampled with u flipped)
    const cp = this._v0.setFromMatrixPosition(camera.matrixWorld);
    const fwd = this._v1.set(0, 0, -1).transformDirection(camera.matrixWorld);
    const up = this._v2.set(0, 1, 0).transformDirection(camera.matrixWorld);
    cp.y = -cp.y; fwd.y = -fwd.y; up.y = -up.y;
    rc.position.copy(cp);
    rc.up.copy(up);
    rc.lookAt(this._v3.copy(cp).add(fwd));
    rc.updateMatrixWorld(true);
    G.uReflPass.value = 1;
    G.uReflCamPos.value.copy(cp);
    R.setRenderTarget(this.rts.refl0);
    R.render(scene, rc);
    G.uReflPass.value = 0;
    // blur chain
    const { refl0, refl1, refl1b, refl2, refl2b } = this.rts;
    this.down13.uniforms.tSrc.value = refl0.texture;
    this.down13.uniforms.uTexel.value.set(1 / refl0.width, 1 / refl0.height);
    this.down13.render(R, refl1b);
    this.blurDir.uniforms.tSrc.value = refl1b.texture;
    this.blurDir.uniforms.uDir.value.set(0, 1.6 / refl1b.height);
    this.blurDir.render(R, refl1);
    this.down13.uniforms.tSrc.value = refl1.texture;
    this.down13.uniforms.uTexel.value.set(1 / refl1.width, 1 / refl1.height);
    this.down13.render(R, refl2b);
    this.blurDir.uniforms.tSrc.value = refl2b.texture;
    this.blurDir.uniforms.uDir.value.set(0, 2.2 / refl2b.height);
    this.blurDir.render(R, refl2);
  }

  _bloom(src) {
    const R = this.r;
    const B = this.rts.bloom;
    let s = src;
    for (let i = 0; i < B.length; i++) {
      this.down13.uniforms.tSrc.value = s.texture;
      this.down13.uniforms.uTexel.value.set(1 / s.width, 1 / s.height);
      this.down13.render(R, B[i]);
      s = B[i];
    }
    const prevAuto = R.autoClear;
    R.autoClear = false;
    for (let i = B.length - 1; i > 0; i--) {
      this.upTent.uniforms.tSrc.value = B[i].texture;
      this.upTent.uniforms.uTexel.value.set(1 / B[i].width, 1 / B[i].height);
      this.upTent.uniforms.uRadius.value = this.params.bloomRadius;
      this.upTent.render(R, B[i - 1]);
    }
    R.autoClear = prevAuto;
    return B[0];
  }

  render(scene, camera, dt) {
    const R = this.r;
    const P = this.params;
    this.time += dt;
    this.frame++;
    camera.updateMatrixWorld();
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

    // dynamic shadow maps (flashlight) are rendered once per frame by whichever pass runs first,
    // and not at all while the phone light is off
    R.shadowMap.autoUpdate = false;
    R.shadowMap.needsUpdate = !this.flashlight || this.flashlight.light.intensity > 0.001;
    // reflection-pass fog follows the main fog settings
    G.uFogColor.value.set(P.fogColor.r, P.fogColor.g, P.fogColor.b);
    G.uFogDensity.value = P.fogDensity;
    G.uFogStart.value = P.fogStart;
    // reflection
    const pitch = Math.asin(THREE.MathUtils.clamp(this._v0.set(0, 0, -1).transformDirection(camera.matrixWorld).y, -1, 1));
    const vfov = THREE.MathUtils.degToRad(camera.fov) * 0.5;
    const groundVisible = pitch - vfov < 0.05;
    if (groundVisible && this.q.reflScale > 0) this._renderReflection(scene, camera);

    // main
    camera.layers.enable(LAYER_NO_REFLECT);
    camera.layers.enable(LAYER_PLAYER);
    R.setRenderTarget(this.rts.main);
    R.render(scene, camera);

    // matrices
    const projInv = camera.projectionMatrixInverse;
    const viewInv = camera.matrixWorld;
    const camPos = this._camPos.setFromMatrixPosition(camera.matrixWorld);

    // volumetrics
    const V = this.vol.uniforms;
    V.uProjInv.value.copy(projInv); V.uViewInv.value.copy(viewInv);
    V.tDepth.value = this.rts.depthTex;
    V.uCamPos.value.copy(camPos);
    V.uTime.value = this.time; V.uFrame.value = this.frame % 64;
    V.uFogDensity.value = P.fogDensity; V.uFogHeight.value = P.fogHeight; V.uFogStart.value = P.fogStart; V.uDustDensity.value = P.dustDensity;
    V.tNoise.value = G.uNoiseTex.value;
    const fl = this.flashlight;
    if (fl && fl.light.intensity > 0.001 && fl.light.shadow.map) {
      V.uFlashOn.value = 1;
      V.uFlashPos.value.setFromMatrixPosition(fl.light.matrixWorld);
      const tp = this._v3.setFromMatrixPosition(fl.light.target.matrixWorld);
      V.uFlashDir.value.copy(tp).sub(V.uFlashPos.value).normalize();
      V.uFlashColor.value.set(fl.light.color.r, fl.light.color.g, fl.light.color.b).multiplyScalar(fl.light.intensity * fl.volumetricScale);
      V.uFlashCone.value.set(Math.cos(fl.light.angle), Math.cos(fl.light.angle * (1 - fl.light.penumbra)));
      V.tFlashShadow.value = fl.light.shadow.map.depthTexture;
      V.uFlashShadowMatrix.value.copy(fl.light.shadow.matrix);
    } else V.uFlashOn.value = 0;
    V.uGlowGain.value = P.glowGain ?? 5;
    // pick the 32 most relevant glow emitters for this camera
    if (!this._glowSel) this._glowSel = [];
    const sel = this._glowSel;
    sel.length = 0;
    for (const g of this.glows) {
      const lv = g.level ? g.level() : 1;
      const pw = g.power * lv;
      if (pw <= 1e-4) continue;
      const dx = g.pos.x - camPos.x, dy = g.pos.y - camPos.y, dz = g.pos.z - camPos.z;
      g._score = pw / (dx * dx + dy * dy + dz * dz + 40);
      g._pw = pw;
      sel.push(g);
    }
    if (sel.length > 32) sel.sort((a, b) => b._score - a._score);
    const n = Math.min(32, sel.length);
    V.uGlowCount.value = n;
    for (let i = 0; i < n; i++) {
      const g = sel[i];
      V.uGlowPos.value[i].set(g.pos.x, g.pos.y, g.pos.z, g.exterior ? 1 : 0);
      V.uGlowCol.value[i].set(g.color.r * g._pw, g.color.g * g._pw, g.color.b * g._pw, g.down ?? 0.5);
    }
    this.vol.render(R, this.rts.vol);

    // composite
    const C = this.comp.uniforms;
    C.uProjInv.value.copy(projInv); C.uViewInv.value.copy(viewInv);
    C.tColor.value = this.rts.main.texture; C.tDepth.value = this.rts.depthTex; C.tVol.value = this.rts.vol.texture;
    C.uVolTexel.value.set(1 / this.rts.vol.width, 1 / this.rts.vol.height);
    C.uCamPos.value.copy(camPos);
    C.uFogDensity.value = P.fogDensity; C.uFogHeight.value = P.fogHeight; C.uFogStart.value = P.fogStart; C.uDustDensity.value = P.dustDensity;
    C.uFogColor.value.set(P.fogColor.r, P.fogColor.g, P.fogColor.b);
    C.uFogColorHigh.value.set(P.fogColorHigh.r, P.fogColorHigh.g, P.fogColorHigh.b);
    C.uLightning.value = P.lightning;
    this.comp.render(R, this.rts.comp);

    // bloom
    const bloom = this._bloom(this.rts.comp);

    // exposure
    const E = this.expo.uniforms;
    const small = this.rts.bloom[Math.min(this.rts.bloom.length - 1, 4)];
    E.tSrc.value = small.texture;
    E.tPrev.value = this.expRT[this.expIdx].texture;
    E.uDt.value = Math.min(dt, 0.1);
    E.uKey.value = P.key;
    E.uRange.value.set(P.minExp, P.maxExp);
    this.expIdx = 1 - this.expIdx;
    this.expo.render(R, this.expRT[this.expIdx]);
    E.uReset.value = 0;

    // final
    const F = this.final.uniforms;
    F.uProjInv.value.copy(projInv); F.uViewInv.value.copy(viewInv);
    F.tColor.value = this.rts.comp.texture; F.tBloom.value = bloom.texture; F.tExposure.value = this.expRT[this.expIdx].texture;
    F.tDepth.value = this.rts.depthTex;
    F.uTime.value = this.time; F.uFrame.value = this.frame;
    F.uBloomStrength.value = P.bloomStrength; F.uDistortion.value = P.distortion; F.uCA.value = P.ca;
    F.uSharpen.value = P.sharpen; F.uContrast.value = P.contrast;
    F.uVignette.value = P.vignette; F.uGrain.value = P.grain; F.uExposureBias.value = P.exposureBias;
    F.uSaturation.value = P.saturation; F.uLift.value.copy(P.lift); F.uGain.value.copy(P.gain);
    F.uMotionBlur.value = this.q.motionBlur ? P.motionBlur : 0;
    F.uPrevViewProj.value.copy(this.prevViewProj); F.uViewProj.value.copy(this.viewProj);
    F.uFlash.value = P.flash; F.uGlitch.value = P.glitch; F.uFade.value = P.fade;
    if (P.debugRaw) {
      if (!this.copyPass) this.copyPass = new FSPass(fsMaterial({ uniforms: { tSrc: { value: null } }, fragmentShader: 'uniform sampler2D tSrc; varying vec2 vUv; void main(){ vec3 c = texture2D(tSrc, vUv).rgb; gl_FragColor = vec4(pow(clamp(c,0.0,1.0), vec3(1.0/2.2)), 1.0); }' }));
      this.copyPass.uniforms.tSrc.value = this.rts.main.texture;
      this.copyPass.render(R, null);
    } else this.final.render(R, null);
    this.prevViewProj.copy(this.viewProj);
  }

  // async readback of exposure for HUD (ISO display)
  pollExposure() {
    try {
      this.r.readRenderTargetPixels(this.expRT[this.expIdx], 0, 0, 1, 1, this.expReadBuf);
      this.exposureInfo.exposure = this.expReadBuf[0];
      this.exposureInfo.avg = this.expReadBuf[1];
    } catch (e) { /* ignore */ }
    return this.exposureInfo;
  }
}
