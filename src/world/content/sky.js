import * as THREE from 'three';
import { G } from '../../gfx/Materials.js';

// Storm sky dome: two scrolling cloud layers, horizon glow, lightning illumination.
export function buildSky(ctx) {
  const uniforms = {
    tClouds: { value: ctx.tex.clouds },
    uTime: G.uTime,
    uLightning: G.uLightning,
    uFlashDir: { value: new THREE.Vector3(0.3, 0.6, -0.7).normalize() },
    uReflPass: G.uReflPass,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tClouds;
      uniform float uTime;
      uniform float uLightning;
      uniform vec3 uFlashDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 zen = vec3(0.0032, 0.0034, 0.0042);
        vec3 hor = vec3(0.0132, 0.0128, 0.0130);
        vec3 col = mix(hor, zen, smoothstep(-0.02, 0.55, h));
        // town glow on the horizon to the south-east (warm, faint)
        float glow = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(0.4, 0.0, 1.0))), 0.0), 6.0) * smoothstep(0.35, 0.0, h);
        col += glow * vec3(0.018, 0.010, 0.004);
        vec2 uv = d.xz / max(h + 0.15, 0.06) * 0.055;
        float c1 = texture2D(tClouds, uv + uTime * vec2(0.0016, 0.0009)).r;
        float c2 = texture2D(tClouds, uv * 2.3 + vec2(0.31, 0.77) - uTime * vec2(0.0024, -0.0008)).g;
        float c3 = texture2D(tClouds, uv * 0.6 + vec2(0.5) + uTime * vec2(0.0008, 0.0012)).b;
        float dens = smoothstep(0.38, 0.78, c1 * 0.7 + c2 * 0.3 + c3 * 0.15);
        float edge = smoothstep(0.0, 0.25, dens) * (1.0 - smoothstep(0.4, 1.0, dens));
        vec3 cloudBase = vec3(0.0110, 0.0106, 0.0106) * (0.35 + 1.35 * c2);
        // underside lit warm near the horizon (station + town glow)
        cloudBase += vec3(0.007, 0.0042, 0.002) * smoothstep(0.5, 0.05, h) * (0.5 + c3);
        float vis = smoothstep(-0.04, 0.12, h);
        col = mix(col, cloudBase, dens * vis);
        col += edge * vis * vec3(0.0055, 0.0058, 0.0068);
        // lightning
        float fl = uLightning * (0.25 + 0.75 * pow(max(dot(d, uFlashDir), 0.0), 3.0));
        col += fl * vec3(0.55, 0.6, 0.78) * (0.25 + dens * 2.0) * vis;
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), mat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  sky.name = 'sky';
  sky.onBeforeRender = (renderer, scene, camera) => {
    sky.position.setFromMatrixPosition(camera.matrixWorld);
    sky.updateMatrixWorld();
  };
  ctx.extra.push(sky);
  return { mesh: sky, uniforms };
}
