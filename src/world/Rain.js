import * as THREE from 'three';
import { G } from '../gfx/Materials.js';
import { LAYER_NO_REFLECT } from '../render/Pipeline.js';
import { SITE } from './site.js';

// GPU rain: streaks wrapped in a box around the camera, masked by roof/canopy footprints,
// lit by nearby static lights + the flashlight cone + lightning. Plus ground splashes and
// drip lines falling from the canopy edges. Additive, no depth write, main view only.

const LIGHTING_GLSL = /* glsl */ `
#define MAXL 16
uniform int uLightCount;
uniform vec4 uLightPos[MAXL];   // xyz, w = range
uniform vec3 uLightCol[MAXL];
uniform vec3 uFlashPos;
uniform vec3 uFlashDir;
uniform vec3 uFlashCol;
uniform vec2 uFlashCone;
uniform float uLightning;
uniform vec3 uAmbient;
vec3 dropLight(vec3 p, vec3 viewDir) {
  vec3 c = uAmbient * (1.0 + uLightning * 30.0);
  for (int i = 0; i < MAXL; i++) {
    if (i >= uLightCount) break;
    vec3 L = uLightPos[i].xyz - p;
    float d2 = dot(L, L);
    float r = uLightPos[i].w;
    float win = clamp(1.0 - d2 / (r * r), 0.0, 1.0);
    // drops scatter strongly forward: brighter when the light is behind them
    float fwd = 0.35 + 0.9 * pow(max(dot(normalize(L), viewDir), 0.0), 3.0);
    c += uLightCol[i] * win * win * fwd / (d2 + 0.6);
  }
  vec3 F = p - uFlashPos;
  float fd = length(F);
  float cc = dot(F / max(fd, 1e-3), uFlashDir);
  if (cc > uFlashCone.x) {
    float cone = smoothstep(uFlashCone.x, uFlashCone.y, cc);
    c += uFlashCol * cone / (fd * fd + 0.3) * (0.5 + 1.2 * pow(max(dot(-viewDir, uFlashDir), 0.0), 4.0));
  }
  return c;
}
bool roofed(vec3 p) {
  if (p.y < 0.0) return true;
  if (p.x > -10.1 && p.x < 0.15 && p.z > -7.1 && p.z < 15.1 && p.y < 4.8) return true;   // store
  if (p.x > -0.1 && p.x < 14.65 && p.z > -10.65 && p.z < 6.55 && p.y < 4.6) return true;  // canopy
  return false;
}
`;

export class Rain {
  constructor(scene, quality) {
    this.uniforms = {
      uTime: G.uTime,
      uCamPos: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(26, 16, 26) },
      uWind: { value: new THREE.Vector2(0.9, -0.5) },
      uSpeed: { value: 8.5 },
      uLen: { value: 0.34 },
      uWidth: { value: 0.0022 },
      uRes: { value: new THREE.Vector2(1280, 720) },
      uIntensity: { value: 1.0 },
      uLightCount: { value: 0 },
      uLightPos: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) },
      uLightCol: { value: Array.from({ length: 16 }, () => new THREE.Vector3()) },
      uFlashPos: { value: new THREE.Vector3() },
      uFlashDir: { value: new THREE.Vector3(0, 0, -1) },
      uFlashCol: { value: new THREE.Vector3() },
      uFlashCone: { value: new THREE.Vector2(0.8, 0.9) },
      uLightning: G.uLightning,
      uAmbient: { value: new THREE.Vector3(0.016, 0.017, 0.021) },
    };
    const count = { test: 7000, low: 6000, medium: 9000, high: 12000, ultra: 16000 }[quality.name] ?? 9000;
    // ---------------------------------------------------------------- streaks
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count * 4; i++) seeds[i] = Math.random();
    quad.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    quad.instanceCount = count;
    const streakMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime; uniform vec3 uCamPos; uniform vec3 uBox; uniform vec2 uWind; uniform float uSpeed;
        uniform float uLen; uniform float uWidth; uniform vec2 uRes; uniform float uIntensity;
        varying vec2 vQ; varying vec3 vCol; varying float vA;
        ${LIGHTING_GLSL}
        void main() {
          float sp = uSpeed * (0.85 + aSeed.w * 0.3);
          vec3 vel = vec3(uWind.x, -sp, uWind.y);
          vec3 wp = aSeed.xyz * uBox + vel * uTime;
          vec3 o = uCamPos - uBox * 0.5;
          o.y = uCamPos.y - uBox.y * 0.35;
          vec3 p = mod(wp - o, uBox) + o;
          vec3 dir = normalize(vel);
          vec3 p0 = p, p1 = p - dir * uLen * (0.8 + 0.4 * aSeed.w);
          if (roofed(p0) || aSeed.w > uIntensity) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
          vec4 c0 = projectionMatrix * viewMatrix * vec4(p0, 1.0);
          vec4 c1 = projectionMatrix * viewMatrix * vec4(p1, 1.0);
          vec2 s0 = c0.xy / c0.w * uRes * 0.5, s1 = c1.xy / c1.w * uRes * 0.5;
          vec2 sd = s1 - s0;
          float sl = length(sd);
          vec2 sn = sl > 1e-4 ? vec2(-sd.y, sd.x) / sl : vec2(1.0, 0.0);
          float wpx = uWidth * uRes.y / max(c0.w, 0.1) * 1.2;
          float wdraw = max(wpx, 1.1);
          vec4 c = position.y > 0.5 ? c1 : c0;
          c.xy += sn * position.x * wdraw / uRes * 2.0 * c.w;
          gl_Position = c;
          vQ = vec2(position.x, position.y);
          vec3 viewDir = normalize(p0 - uCamPos);
          vCol = dropLight(p0, viewDir);
          float dist = length(p0 - uCamPos);
          vA = (wpx / wdraw) * smoothstep(0.3, 1.2, dist) * smoothstep(uBox.x * 0.5, uBox.x * 0.25, dist) * 1.5;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vQ; varying vec3 vCol; varying float vA;
        void main() {
          float a = (1.0 - vQ.x * vQ.x) * smoothstep(0.0, 0.25, vQ.y) * smoothstep(1.0, 0.6, vQ.y);
          gl_FragColor = vec4(vCol * a * vA, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.streaks = new THREE.Mesh(quad, streakMat);
    this.streaks.frustumCulled = false;
    this.streaks.layers.set(LAYER_NO_REFLECT);
    this.streaks.renderOrder = 4;
    scene.add(this.streaks);

    // ---------------------------------------------------------------- splashes (on exposed ground near camera)
    const scount = Math.round(count * 0.18);
    const sgeo = new THREE.InstancedBufferGeometry();
    sgeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3));
    sgeo.setIndex([0, 2, 1, 0, 3, 2]);
    const ss = new Float32Array(scount * 4);
    for (let i = 0; i < scount * 4; i++) ss[i] = Math.random();
    sgeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(ss, 4));
    sgeo.instanceCount = scount;
    const splashMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime; uniform vec3 uCamPos; uniform float uIntensity;
        varying vec2 vQ; varying vec3 vCol; varying float vT;
        ${LIGHTING_GLSL}
        float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
        void main() {
          float period = 0.55 + aSeed.w * 0.5;
          float tt = uTime / period + aSeed.z * 10.0;
          float cyc = floor(tt);
          vT = fract(tt);
          float R = 11.0;
          vec2 rp = vec2(h1(cyc * 1.7 + aSeed.x * 91.0), h1(cyc * 3.1 + aSeed.y * 57.0)) * 2.0 - 1.0;
          vec3 p = vec3(uCamPos.x + rp.x * R, 0.008, uCamPos.z + rp.y * R);
          if (roofed(p + vec3(0.0, 0.1, 0.0)) || aSeed.w > uIntensity * 0.9) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
          float size = 0.035 + 0.05 * vT;
          vec3 wp = p + vec3(position.x, 0.0, position.z) * size;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          vQ = position.xz;
          vCol = dropLight(p + vec3(0.0, 0.05, 0.0), normalize(p - uCamPos)) * 1.2;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vQ; varying vec3 vCol; varying float vT;
        void main() {
          float r = length(vQ);
          float ring = smoothstep(0.18, 0.0, abs(r - 0.75)) * (1.0 - vT);
          float core = smoothstep(0.35, 0.0, r) * smoothstep(0.25, 0.0, vT);
          float a = (ring * 0.8 + core) * (1.0 - vT);
          gl_FragColor = vec4(vCol * a * 0.9, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.splashes = new THREE.Mesh(sgeo, splashMat);
    this.splashes.frustumCulled = false;
    this.splashes.layers.set(LAYER_NO_REFLECT);
    this.splashes.renderOrder = 4;
    scene.add(this.splashes);

    // ---------------------------------------------------------------- drip lines from canopy + roof edges
    const C = SITE.canopy;
    const edges = [
      [[C.x1 + 0.1, 4.12, C.z0], [C.x1 + 0.1, 4.12, C.z1]],
      [[C.x0 + 0.2, 4.12, C.z0 - 0.1], [C.x1, 4.12, C.z0 - 0.1]],
      [[C.x0 + 0.2, 4.12, C.z1 + 0.1], [C.x1, 4.12, C.z1 + 0.1]],
      [[0.35, 4.75, 6.6], [0.35, 4.75, 15.0]], // store front roof edge (solid section)
    ];
    const dcount = 900;
    const dgeo = new THREE.InstancedBufferGeometry();
    dgeo.setAttribute('position', quad.attributes.position);
    dgeo.setIndex([0, 1, 2, 0, 2, 3]);
    const dA = new Float32Array(dcount * 3), dB = new Float32Array(dcount * 3), dS = new Float32Array(dcount * 4);
    for (let i = 0; i < dcount; i++) {
      const e = edges[Math.min(edges.length - 1, Math.floor(Math.random() * 3.6))];
      const t = Math.random();
      // clustered drips (gutters overflow at points)
      const tc = Math.round(t * 40) / 40 + (Math.random() - 0.5) * 0.01;
      const tt = Math.random() < 0.6 ? tc : t;
      for (let k = 0; k < 3; k++) dA[i * 3 + k] = e[0][k] + (e[1][k] - e[0][k]) * tt;
      dS[i * 4] = Math.random(); dS[i * 4 + 1] = Math.random(); dS[i * 4 + 2] = Math.random(); dS[i * 4 + 3] = Math.random();
    }
    dgeo.setAttribute('aStart', new THREE.InstancedBufferAttribute(dA, 3));
    dgeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(dS, 4));
    dgeo.instanceCount = dcount;
    const dripMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 aStart; attribute vec4 aSeed;
        uniform float uTime; uniform vec3 uCamPos; uniform vec2 uRes; uniform float uIntensity;
        varying vec2 vQ; varying vec3 vCol; varying float vA;
        ${LIGHTING_GLSL}
        void main() {
          float H = aStart.y;
          float period = sqrt(2.0 * H / 9.81) * (1.0 + aSeed.x * 1.5);
          float t = fract(uTime / period + aSeed.y) * period;
          float y = H - 0.5 * 9.81 * t * t;
          float v = 9.81 * t;
          vec3 p0 = vec3(aStart.x, max(y, 0.0), aStart.z);
          vec3 p1 = p0 + vec3(0.0, min(v * 0.033 + 0.02, 0.5), 0.0);
          if (y < 0.0 || aSeed.w > uIntensity) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
          vec4 c0 = projectionMatrix * viewMatrix * vec4(p0, 1.0);
          vec4 c1 = projectionMatrix * viewMatrix * vec4(p1, 1.0);
          vec2 s0 = c0.xy / c0.w * uRes * 0.5, s1 = c1.xy / c1.w * uRes * 0.5;
          vec2 sd = s1 - s0; float sl = length(sd);
          vec2 sn = sl > 1e-4 ? vec2(-sd.y, sd.x) / sl : vec2(1.0, 0.0);
          float wpx = 0.004 * uRes.y / max(c0.w, 0.1);
          float wdraw = max(wpx, 1.2);
          vec4 c = position.y > 0.5 ? c1 : c0;
          c.xy += sn * position.x * wdraw / uRes * 2.0 * c.w;
          gl_Position = c;
          vQ = position.xy;
          vCol = dropLight(p0, normalize(p0 - uCamPos));
          vA = (wpx / wdraw) * 0.9;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vQ; varying vec3 vCol; varying float vA;
        void main() {
          float a = (1.0 - vQ.x * vQ.x) * smoothstep(0.0, 0.2, vQ.y) * smoothstep(1.0, 0.5, vQ.y);
          gl_FragColor = vec4(vCol * a * vA, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.drips = new THREE.Mesh(dgeo, dripMat);
    this.drips.frustumCulled = false;
    this.drips.layers.set(LAYER_NO_REFLECT);
    this.drips.renderOrder = 4;
    scene.add(this.drips);
  }

  setLights(lights) {
    // choose static lights for rain illumination (exterior only)
    const U = this.uniforms;
    let n = 0;
    for (const L of lights) {
      if (n >= 16) break;
      if (!L.exteriorRain) continue;
      U.uLightPos.value[n].set(L.pos.x, L.pos.y, L.pos.z, L.rainRange ?? 12);
      U.uLightCol.value[n].set(L.color.r, L.color.g, L.color.b).multiplyScalar(L.rainPower ?? L.intensity * 0.02);
      n++;
    }
    U.uLightCount.value = n;
  }

  update(camera, flashlight, res, groupLevels) {
    const U = this.uniforms;
    U.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    U.uRes.value.set(res.x, res.y);
    const L = flashlight.light;
    U.uFlashPos.value.setFromMatrixPosition(L.matrixWorld);
    const tp = new THREE.Vector3().setFromMatrixPosition(L.target.matrixWorld);
    U.uFlashDir.value.copy(tp).sub(U.uFlashPos.value).normalize();
    U.uFlashCol.value.set(L.color.r, L.color.g, L.color.b).multiplyScalar(L.intensity * 0.06);
    U.uFlashCone.value.set(Math.cos(L.angle), Math.cos(L.angle * (1 - L.penumbra)));
  }
}
