import * as THREE from 'three';
import { TextureGen } from '../gfx/TextureGen.js';
import * as S from '../gfx/surfaces.js';

// Debug: render all generated textures into a grid.
export async function runTexTest(renderer) {
  const gen = new TextureGen(renderer);
  const t0 = performance.now();
  const list = [];
  for (const def of [S.ASPHALT, S.CONCRETE, S.STUCCO, S.PLASTER, S.VCT, S.CEILING, S.METAL, S.WOOD, S.GROUNDCOVER]) {
    const t = gen.surface(def, 512);
    list.push(t.albedo, t.normal);
  }
  list.push(gen.raw(S.NOISE_RAW, 256), gen.raw(S.CLOUDS_RAW, 256), gen.raw(S.LEAVES_RAW, 256), gen.raw(S.GRASS_RAW, 256));
  console.log('tex gen ms', performance.now() - t0);
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(0, 6, 4, 0, -1, 1);
  list.forEach((tex, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98), new THREE.MeshBasicMaterial({ map: tex }));
    m.position.set((i % 6) + 0.5, 3.5 - Math.floor(i / 6), 0);
    scene.add(m);
  });
  renderer.setRenderTarget(null);
  renderer.render(scene, cam);
  window.__ready = true;
}
