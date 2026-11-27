import * as THREE from 'three';
import { G } from '../gfx/Materials.js';
import { LAYER_NO_REFLECT } from '../render/Pipeline.js';

// Dust motes drifting in the phone light indoors: tiny additive sprites wrapped in a box
// around the camera, visible only inside the flashlight cone (forward-scattering glint when
// you look along the beam). Main view only.
export class Dust {
  constructor(scene, quality) {
    // dense near the camera: the bright inner beam is narrow, so it needs ~100 motes/m3 to read
    const count = { test: 1600, low: 1600, medium: 2200, high: 3000, ultra: 3600 }[quality.name] ?? 2200;
    this.uniforms = {
      uTime: G.uTime,
      uCamPos: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(3.4, 2.6, 3.4) },
      uRes: { value: new THREE.Vector2(1280, 720) },
      uFlashPos: { value: new THREE.Vector3() },
      uFlashDir: { value: new THREE.Vector3(0, 0, -1) },
      uFlashCol: { value: new THREE.Vector3() },
      uFlashCone: { value: new THREE.Vector2(0.8, 0.9) },
    };
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count * 4; i++) seeds[i] = Math.random();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = count;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime; uniform vec3 uCamPos; uniform vec3 uBox; uniform vec2 uRes;
        uniform vec3 uFlashPos; uniform vec3 uFlashDir; uniform vec3 uFlashCol; uniform vec2 uFlashCone;
        varying vec2 vQ; varying vec3 vCol;
        void main() {
          // slow Brownian-ish drift + gentle settling
          vec3 drift = vec3(sin(uTime * (0.07 + aSeed.w * 0.05) + aSeed.x * 40.0),
                            -0.025 * uTime + sin(uTime * 0.11 + aSeed.y * 30.0) * 0.3,
                            cos(uTime * (0.06 + aSeed.z * 0.05) + aSeed.z * 50.0)) * 0.35;
          vec3 wp = aSeed.xyz * uBox + drift;
          vec3 o = uCamPos - uBox * 0.5;
          vec3 p = mod(wp - o, uBox) + o;
          // indoors only (store footprint below the ceiling)
          bool inside = p.x > -9.9 && p.x < -0.1 && p.z > -6.9 && p.z < 14.9 && p.y > 0.05 && p.y < 2.95;
          vec3 F = p - uFlashPos;
          float fd = length(F);
          float c = dot(F / max(fd, 1e-3), uFlashDir);
          float cone = pow(smoothstep(uFlashCone.x, uFlashCone.y, c), 0.6);
          if (!inside || cone <= 0.0 || fd > 2.9) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
          vec3 viewDir = normalize(p - uCamPos);
          float fwd = 0.25 + 2.2 * pow(max(dot(viewDir, uFlashDir), 0.0), 6.0);
          float tw = 0.55 + 0.45 * sin(uTime * (1.5 + aSeed.w * 3.0) + aSeed.x * 60.0);
          vCol = uFlashCol * cone * fwd * tw / (fd * fd + 0.3) * 0.16;
          vec4 cp = projectionMatrix * viewMatrix * vec4(p, 1.0);
          float px = mix(0.9, 2.0, aSeed.y * aSeed.y) * clamp(1.4 / cp.w, 0.6, 2.0);
          cp.xy += position.xy * px / uRes * 2.0 * cp.w;
          gl_Position = cp;
          vQ = position.xy;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vQ; varying vec3 vCol;
        void main() {
          float a = smoothstep(1.0, 0.0, length(vQ));
          gl_FragColor = vec4(vCol * a * a, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(LAYER_NO_REFLECT);
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    this._tp = new THREE.Vector3();
  }

  update(camera, flashlight, res) {
    const U = this.uniforms;
    const L = flashlight.light;
    const on = L.intensity > 0.01;
    this.mesh.visible = on;
    if (!on) return;
    U.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    U.uRes.value.set(res.x, res.y);
    U.uFlashPos.value.setFromMatrixPosition(L.matrixWorld);
    this._tp.setFromMatrixPosition(L.target.matrixWorld);
    U.uFlashDir.value.copy(this._tp).sub(U.uFlashPos.value).normalize();
    U.uFlashCol.value.set(L.color.r, L.color.g, L.color.b).multiplyScalar(L.intensity);
    U.uFlashCone.value.set(Math.cos(L.angle), Math.cos(L.angle * (1 - L.penumbra)));
  }
}
