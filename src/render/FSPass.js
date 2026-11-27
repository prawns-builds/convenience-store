import * as THREE from 'three';

// Minimal full-screen triangle pass helper shared by all post/bake passes.
const _geo = new THREE.BufferGeometry();
_geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
_geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
const _cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export function fsMaterial({ uniforms = {}, fragmentShader, defines = {}, blending = THREE.NoBlending, glslVersion = null, vertexShader = FS_VERT, ...rest }) {
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    defines,
    depthTest: false,
    depthWrite: false,
    blending,
    toneMapped: false,
    ...rest,
  });
  if (glslVersion) m.glslVersion = glslVersion;
  return m;
}

export class FSPass {
  constructor(material) {
    this.material = material;
    this.mesh = new THREE.Mesh(_geo, material);
    this.mesh.frustumCulled = false;
  }
  get uniforms() { return this.material.uniforms; }
  render(renderer, target = null) {
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, _cam);
  }
  dispose() { this.material.dispose(); }
}

export function makeRT(w, h, opts = {}) {
  const rt = new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
    type: opts.type ?? THREE.HalfFloatType,
    format: opts.format ?? THREE.RGBAFormat,
    minFilter: opts.minFilter ?? THREE.LinearFilter,
    magFilter: opts.magFilter ?? THREE.LinearFilter,
    wrapS: opts.wrap ?? THREE.ClampToEdgeWrapping,
    wrapT: opts.wrap ?? THREE.ClampToEdgeWrapping,
    depthBuffer: opts.depth ?? false,
    stencilBuffer: false,
    samples: opts.samples ?? 0,
    generateMipmaps: opts.mipmaps ?? false,
    colorSpace: opts.colorSpace ?? THREE.NoColorSpace,
    count: opts.count ?? 1,
    depthTexture: opts.depthTexture ?? null,
  });
  if (opts.anisotropy) rt.texture.anisotropy = opts.anisotropy;
  return rt;
}
