import * as THREE from 'three';
import { LAYER_NO_REFLECT } from '../render/Pipeline.js';

// Small CPU-simulated spark burst (a bulb blowing): hot additive points with gravity,
// bouncing once off the ground and cooling from yellow to red.
export class Sparks {
  constructor(scene, n = 48) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.lifeAttr = new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('aLife', this.lifeAttr);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute float aLife; uniform float uScale; varying float vL;
        void main() {
          vL = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = aLife > 0.0 ? projectionMatrix * mv : vec4(0.0, 0.0, 2.0, 1.0);
          gl_PointSize = clamp(uScale * 0.018 * (0.5 + aLife) / max(-mv.z, 0.1), 1.5, 12.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vL;
        void main() {
          float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
          vec3 hot = mix(vec3(1.0, 0.25, 0.05), vec3(1.0, 0.8, 0.45), clamp(vL, 0.0, 1.0));
          gl_FragColor = vec4(hot * a * vL * vL * 60.0, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.layers.set(LAYER_NO_REFLECT);
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.alive = 0;
  }

  // origin: THREE.Vector3, out: preferred outward direction (away from the wall)
  burst(origin, out) {
    for (let i = 0; i < this.n; i++) {
      this.pos[i * 3] = origin.x + (Math.random() - 0.5) * 0.06;
      this.pos[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.06;
      this.pos[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.06;
      const s = 0.8 + Math.random() * 2.6;
      const dx = out.x + (Math.random() - 0.5) * 1.6, dy = 0.2 + Math.random() * 0.9, dz = out.z + (Math.random() - 0.5) * 1.6;
      const l = Math.hypot(dx, dy, dz);
      this.vel[i * 3] = (dx / l) * s; this.vel[i * 3 + 1] = (dy / l) * s; this.vel[i * 3 + 2] = (dz / l) * s;
      this.life[i] = 0.55 + Math.random() * 0.7;
    }
    this.alive = this.n;
    this.points.visible = true;
  }

  update(dt, camera, viewportH) {
    if (!this.alive) return;
    this.mat.uniforms.uScale.value = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      const k = i * 3;
      this.vel[k + 1] -= 9.8 * dt;
      this.vel[k] *= 1 - dt * 0.6; this.vel[k + 2] *= 1 - dt * 0.6;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.01) { this.pos[k + 1] = 0.01; this.vel[k + 1] *= -0.3; this.vel[k] *= 0.5; this.vel[k + 2] *= 0.5; this.life[i] -= 0.25; }
      this.life[i] -= dt * 1.1;
      if (this.life[i] > 0) alive++;
    }
    this.posAttr.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
    this.alive = alive;
    if (!alive) this.points.visible = false;
  }
}
