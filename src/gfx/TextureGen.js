import * as THREE from 'three';
import { FSPass, fsMaterial, makeRT } from '../render/FSPass.js';
import { NOISE_GLSL, COMMON_GLSL } from './glsl/noise.js';

// GPU procedural texture generator.
// A "surface" definition supplies:
//   float heightFn(vec2 uv);
//   void surface(vec2 uv, out vec3 albedo, out float rough, out float extra);
// and produces two tileable mip-mapped textures:
//   albedo  (sRGB RGB + linear roughness in A)
//   normal  (tangent-space normal RGB + "extra" in A)
export class TextureGen {
  constructor(renderer) {
    this.renderer = renderer;
    this.maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }

  _material(body, mode, normalStrength) {
    return fsMaterial({
      uniforms: { uTexel: { value: new THREE.Vector2() }, uNormalStrength: { value: normalStrength } },
      defines: { MODE: mode },
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform vec2 uTexel;
        uniform float uNormalStrength;
        ${COMMON_GLSL}
        ${NOISE_GLSL}
        ${body}
        void main() {
          vec2 uv = vUv;
          #if MODE == 0
            vec3 albedo; float rough; float extra;
            surface(uv, albedo, rough, extra);
            gl_FragColor = vec4(clamp(albedo, 0.0, 1.0), clamp(rough, 0.02, 1.0));
          #elif MODE == 1
            float hL = heightFn(fract(uv - vec2(uTexel.x, 0.0)));
            float hR = heightFn(fract(uv + vec2(uTexel.x, 0.0)));
            float hD = heightFn(fract(uv - vec2(0.0, uTexel.y)));
            float hU = heightFn(fract(uv + vec2(0.0, uTexel.y)));
            vec3 n = normalize(vec3((hL - hR) * uNormalStrength, (hD - hU) * uNormalStrength, 1.0));
            vec3 albedo; float rough; float extra;
            surface(uv, albedo, rough, extra);
            gl_FragColor = vec4(n * 0.5 + 0.5, clamp(extra, 0.0, 1.0));
          #else
            gl_FragColor = raw(uv);
          #endif
        }
      `,
    });
  }

  _render(mat, size, { srgb = false, mipmaps = true, type = THREE.UnsignedByteType, wrap = THREE.RepeatWrapping } = {}) {
    const rt = makeRT(size, size, {
      type,
      wrap,
      minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
      mipmaps,
      colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
    });
    rt.texture.anisotropy = this.maxAniso;
    mat.uniforms.uTexel.value.set(1 / size, 1 / size);
    const pass = new FSPass(mat);
    pass.render(this.renderer, rt);
    this.renderer.setRenderTarget(null);
    mat.dispose();
    return rt.texture;
  }

  // Generate many textures at once. All generator programs are compiled up front in parallel
  // (KHR_parallel_shader_compile via compileAsync), which matters on D3D/ANGLE where large
  // procedural shaders are slow to compile one after another.
  //  items: [{ surface: def, size } | { raw: glsl, size, opts }]
  async batch(items, onProgress = () => {}) {
    const R = this.renderer;
    const mats = [];
    for (const it of items) {
      if (it.surface) {
        const ns = it.surface.normalStrength ?? 1;
        it.mA = this._material(it.surface.glsl, 0, ns);
        it.mN = this._material(it.surface.glsl, 1, ns);
        mats.push(it.mA, it.mN);
      } else {
        it.mR = this._material(it.raw, 2, 1);
        mats.push(it.mR);
      }
    }
    if (R.compileAsync) {
      const scene = new THREE.Scene();
      for (const m of mats) { const pass = new FSPass(m); scene.add(pass.mesh); }
      try { await R.compileAsync(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)); } catch (e) { /* fall back to lazy compile */ }
    }
    const out = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.surface) {
        const albedo = this._render(it.mA, it.size, { srgb: true });
        const normal = this._render(it.mN, it.size, {});
        albedo.name = it.surface.name + '_albedo';
        normal.name = it.surface.name + '_normal';
        out.push({ albedo, normal, name: it.surface.name });
      } else {
        out.push(this._render(it.mR, it.size, it.opts ?? {}));
      }
      onProgress((i + 1) / items.length);
    }
    return out;
  }

  // Full PBR surface -> { albedo, normal }
  surface(def, size = 1024) {
    const albedo = this._render(this._material(def.glsl, 0, def.normalStrength ?? 1), size, { srgb: true });
    const normal = this._render(this._material(def.glsl, 1, def.normalStrength ?? 1), size, {});
    albedo.name = def.name + '_albedo';
    normal.name = def.name + '_normal';
    return { albedo, normal, name: def.name };
  }

  // Raw RGBA texture from `vec4 raw(vec2 uv)`
  raw(glsl, size = 512, opts = {}) {
    return this._render(this._material(glsl, 2, 1), size, opts);
  }
}
