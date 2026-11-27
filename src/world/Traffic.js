import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { emissiveMaterial, patchMaterial, G } from '../gfx/Materials.js';
import { LAYER_NO_REFLECT } from '../render/Pipeline.js';
import { SITE } from './site.js';

// Occasional car passing on the highway: emissive head/tail lights (reflected by the wet
// road via the planar reflection), dynamic fog halos, a light pool on the road, rain lit by
// the headlights and positional doppler audio. It never stops.
export class Traffic {
  constructor(game) {
    this.g = game;
    const scene = game.world.scene;
    const car = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: [0x5a1d1a, 0x3d4a52, 0x6b6e70, 0x2f3a2c][Math.floor(Math.random() * 4)], roughness: 0.28, metalness: 0.35 });
    patchMaterial(paint, { bake: 'none', variant: 'car' });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0a0c0e, roughness: 0.06, metalness: 0.0 });
    patchMaterial(glass, { bake: 'none', variant: 'car' });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.8 });
    patchMaterial(rubber, { bake: 'none', variant: 'car' });
    this.probeMats = [paint, glass, rubber];
    const env = game.world.envMaps?.ext;
    if (env) for (const m of this.probeMats) { m.envMap = env; m.envMapIntensity = 1.0; }
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.62, 4.7, 3, 0.16), paint);
    body.position.y = 0.62;
    const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.62, 0.52, 2.4, 3, 0.2), glass);
    cabin.position.set(0, 1.12, 0.2);
    car.add(body, cabin);
    for (const [x, z] of [[-0.8, 1.45], [0.8, 1.45], [-0.8, -1.5], [0.8, -1.5]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 14).rotateZ(Math.PI / 2), rubber);
      w.position.set(x, 0.33, z);
      car.add(w);
    }
    // local -z is the front
    this.headMat = emissiveMaterial(0xfff1d8, 60);
    this.tailMat = emissiveMaterial(0xff1a10, 9);
    for (const x of [-0.62, 0.62]) {
      const h = new THREE.Mesh(new THREE.CircleGeometry(0.1, 12), this.headMat);
      h.position.set(x, 0.7, -2.36); h.rotation.y = Math.PI;
      const t = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.1), this.tailMat);
      t.position.set(x, 0.78, 2.36);
      car.add(h, t);
    }
    car.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    car.visible = false;
    scene.add(car);
    this.car = car;

    // light pool on the road ahead of the car (additive decal, main view only)
    const poolMat = new THREE.ShaderMaterial({
      uniforms: { uI: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */ `
        uniform float uI; varying vec2 vUv;
        void main(){
          vec2 p = vUv - vec2(0.5, 0.0);
          float along = vUv.y;
          float w = 0.16 + along * 0.34;
          float a = smoothstep(w, w * 0.4, abs(p.x)) * smoothstep(0.0, 0.08, along) * pow(1.0 - along, 1.6);
          gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * a * uI, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(7, 26).rotateX(-Math.PI / 2).translate(0, 0.02, -13 - 2.4), poolMat);
    pool.layers.set(LAYER_NO_REFLECT);
    car.add(pool);
    this.poolMat = poolMat;

    // dynamic fog halos (registered in the pipeline glow list)
    this.glows = [0, 1].map(() => ({ pos: new THREE.Vector3(), color: new THREE.Color(0xfff0d8), power: 0, exterior: true, down: 0.0, dynamic: true }));
    for (const gl of this.glows) game.pipeline.glows.push(gl);
    this.next = 35 + Math.random() * 40;
    this.active = false;
    this.z = 0; this.dir = 1; this.speed = 17;
    this._v = new THREE.Vector3();
  }

  spawn() {
    this.active = true;
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.speed = 15 + Math.random() * 7;
    this.z = this.dir > 0 ? -420 : 420;
    this.x = this.dir > 0 ? SITE.road.center - 1.85 : SITE.road.center + 1.85;
    this.car.visible = true;
    this.car.rotation.y = this.dir > 0 ? Math.PI : 0; // local -z (front) faces travel direction
    this.g.audio?.startCar?.(this);
  }

  update(dt) {
    if (!this.active) {
      this.next -= dt;
      if (this.next <= 0) this.spawn();
      for (const gl of this.glows) gl.power = 0;
      return;
    }
    this.z += this.dir * this.speed * dt;
    this.car.position.set(this.x, 0, this.z);
    this.car.updateMatrixWorld(true);
    const fade = THREE.MathUtils.smoothstep(Math.abs(this.z), 420, 300);
    this.headMat.setLevel(fade);
    this.tailMat.setLevel(fade);
    this.poolMat.uniforms.uI.value = 0.35 * fade;
    const front = this.dir;
    this.glows.forEach((gl, i) => {
      gl.pos.set(this.x + (i ? 0.62 : -0.62), 0.7, this.z + front * 2.4);
      gl.power = 14 * fade;
    });
    // lighting of the car body from the probe/streetlights is approximated with a fixed dim ambient
    // lit by the nearest street lights: brighten when passing under a lamp
    const k = Math.round((this.z - SITE.streetZ0) / SITE.streetSpacing);
    const dz = this.z - (SITE.streetZ0 + k * SITE.streetSpacing);
    const lamp = 0.25 + 2.2 * Math.exp(-(dz * dz) / 60);
    for (const m of this.probeMats) { const u = m.userData.uniforms; if (u?.uProbeStatic) { u.uProbeStatic.value.set(1.0, 0.68, 0.42).multiplyScalar(lamp); u.uProbeSky.value = 1; } }
    this.g.audio?.updateCar?.(this);
    if (Math.abs(this.z) > 430) {
      this.active = false;
      this.car.visible = false;
      this.next = 70 + Math.random() * 110;
      this.g.audio?.stopCar?.();
    }
  }
}
