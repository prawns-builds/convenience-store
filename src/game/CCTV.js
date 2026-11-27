import * as THREE from 'three';
import { G } from '../gfx/Materials.js';
import { LAYER_CCTV_ONLY } from './Events.js';

// Live security-camera feeds rendered to small targets, displayed on the CRT monitors
// in the office and on the counter (grayscale, scanlines, noise, timestamp).
export class CCTV {
  constructor(game, screens) {
    this.g = game;
    const W = game.world;
    this.rt = [0, 1].map(() => new THREE.WebGLRenderTarget(320, 240, { type: THREE.HalfFloatType, samples: 0 }));
    const mk = (pos, look, fov = 62) => {
      const c = new THREE.PerspectiveCamera(fov, 4 / 3, 0.1, 120);
      c.position.set(...pos);
      c.lookAt(new THREE.Vector3(...look));
      c.layers.set(0);
      c.layers.enable(1);
      c.layers.enable(LAYER_CCTV_ONLY);
      c.updateMatrixWorld(true);
      return c;
    };
    this.cams = [
      mk([0.45, 3.9, -6.6], [9, 0.5, 2.5], 70),       // front lot / pumps
      mk([-0.7, 2.82, -6.35], [-6, 0.6, 3.5], 74),     // sales floor
    ];
    this.labels = ['CAM 1  PUMPS', 'CAM 2  SALES FLR'];
    this.overlay = document.createElement('canvas');
    this.overlay.width = 320; this.overlay.height = 240;
    this.overlayTex = new THREE.CanvasTexture(this.overlay);
    this.overlayTex.colorSpace = THREE.SRGBColorSpace;
    this.mats = [];
    screens.forEach((s, i) => {
      const camIdx = s.region === 'int' ? 0 : i % 2;
      const m = new THREE.ShaderMaterial({
        uniforms: { tFeed: { value: this.rt[camIdx].texture }, tOver: { value: this.overlayTex }, uTime: G.uTime, uCam: { value: camIdx }, uOn: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: /* glsl */ `
          uniform sampler2D tFeed; uniform sampler2D tOver; uniform float uTime; uniform float uCam; uniform float uOn;
          varying vec2 vUv;
          float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
          void main(){
            vec2 uv = vUv;
            vec2 c = uv - 0.5;
            uv = 0.5 + c * (1.0 + dot(c,c) * 0.18);
            float roll = sin(uTime * 0.7 + uCam) * 0.002;
            uv.y += roll;
            vec3 col = texture2D(tFeed, uv).rgb * 5.0;
            float l = dot(col, vec3(0.299, 0.587, 0.114));
            l = l / (1.0 + l);
            l = pow(l, 0.85);
            float scan = 0.82 + 0.18 * sin(vUv.y * 480.0);
            float n = h(vUv * 320.0 + fract(uTime * 7.0) * 100.0) - 0.5;
            vec3 o = vec3(l * scan + n * 0.12) * vec3(0.82, 1.0, 0.86);
            vec4 ov = texture2D(tOver, vec2(vUv.x, uCam > 0.5 ? vUv.y * 0.5 + 0.5 : vUv.y * 0.5));
            o = mix(o, vec3(0.9), ov.a * 0.9);
            float vig = smoothstep(0.75, 0.25, length(c));
            o *= vig;
            if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) o = vec3(0.0);
            gl_FragColor = vec4(o * 1.6 * uOn, 1.0);
          }`,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), m);
      mesh.position.set(...s.pos);
      mesh.lookAt(new THREE.Vector3(...s.pos).add(new THREE.Vector3(...s.normal)));
      W.scene.add(mesh);
      this.mats.push(m);
      (this.meshes = this.meshes ?? []).push(mesh);
    });
    this.screenPos = screens.map((s) => new THREE.Vector3(...s.pos));
    this.tick = 0;
    this.cur = 0;
    this._drawOverlay();
  }

  _drawOverlay() {
    const x = this.overlay.getContext('2d');
    x.clearRect(0, 0, 320, 240);
    x.fillStyle = '#fff';
    x.font = '14px monospace';
    const ts = `11-27-26  ${this.g.clockString(true)}`;
    // top half = cam 2, bottom half = cam 1 (packed in one texture)
    x.fillText(this.labels[1], 10, 18); x.fillText(ts, 170, 18);
    x.fillText(this.labels[0], 10, 138); x.fillText(ts, 170, 138);
    x.fillStyle = '#f33'; x.beginPath(); x.arc(305, 13, 4, 0, 6.3); x.fill(); x.beginPath(); x.arc(305, 133, 4, 0, 6.3); x.fill();
    this.overlayTex.needsUpdate = true;
  }

  update(dt) {
    const g = this.g;
    const p = g.camera.position;
    let near = false;
    for (const s of this.screenPos) if (s.distanceTo(p) < 7) near = true;
    if (!near) return;
    this.tick += dt;
    if (this.tick < 1 / 10) return;
    this.tick = 0;
    const R = g.renderer;
    const i = this.cur;
    this.cur = 1 - this.cur;
    G.uPlanarOn.value = 0;
    for (const m of this.meshes) m.visible = false;
    R.setRenderTarget(this.rt[i]);
    R.render(g.world.scene, this.cams[i]);
    R.setRenderTarget(null);
    for (const m of this.meshes) m.visible = true;
    G.uPlanarOn.value = 1;
    if (i === 0) this._drawOverlay();
  }
}
