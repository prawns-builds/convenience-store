import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { LAYER_PLAYER } from '../render/Pipeline.js';
import { patchMaterial } from '../gfx/Materials.js';

// Phone held in the right hand: LED torch on the back (shadow-casting spot light with a
// lens cookie), glowing screen facing the camera, inertial sway relative to the bodycam.

function makeCookie() {
  const s = 256;
  const c = document.createElement('canvas'); c.width = c.height = s;
  const x = c.getContext('2d');
  const img = x.createImageData(s, s);
  for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
    const u = (i + 0.5) / s * 2 - 1, v = (j + 0.5) / s * 2 - 1;
    const r = Math.hypot(u, v);
    const a = Math.atan2(v, u);
    // hot core + soft ring + wide spill, faint lens streaks
    let I = 0.85 * Math.exp(-r * r * 18) + 0.45 * Math.exp(-Math.pow((r - 0.32) / 0.13, 2)) + 0.42 * Math.exp(-r * r * 2.4);
    I *= 1 + 0.06 * Math.sin(a * 7 + r * 9) * Math.exp(-r * 3) + 0.04 * Math.sin(a * 13.0 - r * 30.0);
    I *= THREE.MathUtils.smoothstep(1.0, 0.82, r);
    const k = (j * s + i) * 4;
    const t = Math.min(1, I);
    img.data[k] = 255 * Math.min(1, t * 0.98);
    img.data[k + 1] = 255 * Math.min(1, t * 0.99);
    img.data[k + 2] = 255 * t;
    img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Flashlight {
  constructor(scene, camera, world, q) {
    this.camera = camera;
    this.world = world;
    this.on = false;
    this.level = 0;
    this.battery = 0.47;
    this.raised = 1;
    this.raiseT = 1;
    this.intensity = 14;
    this.volumetricScale = 0.05;
    const L = new THREE.SpotLight(0xeef3ff, 0, 34, THREE.MathUtils.degToRad(33), 0.62, 2);
    L.castShadow = true;
    L.shadow.mapSize.set(q.flashShadow, q.flashShadow);
    L.shadow.camera.near = 0.06;
    L.shadow.camera.far = 34;
    L.shadow.bias = -0.0004;
    L.shadow.normalBias = 0.025;
    L.shadow.radius = 3;
    L.map = makeCookie();
    scene.add(L, L.target);
    this.light = L;

    // ------------------------------------------------------------ phone model
    const rig = new THREE.Group();
    rig.name = 'phoneRig';
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.0725, 0.152, 0.0088, 4, 0.0075), this._phoneMat(0x17191b, 0.32, 0.7));
    const frame = new THREE.Mesh(new RoundedBoxGeometry(0.0735, 0.153, 0.0062, 4, 0.0072), this._phoneMat(0x6d7073, 0.25, 1.0));
    rig.add(body, frame);
    // screen (faces camera = local +z)
    this.screenCanvas = document.createElement('canvas');
    this.screenCanvas.width = 288; this.screenCanvas.height = 600;
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    this.screenMat = new THREE.MeshBasicMaterial({ map: this.screenTex, color: new THREE.Color(0.55, 0.55, 0.55), toneMapped: false });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.0665, 0.1455), this.screenMat);
    screen.position.z = 0.00445;
    rig.add(screen);
    // camera bump + LED on the back (local -z)
    const bump = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.034, 0.003, 2, 0.006), this._phoneMat(0x101112, 0.2, 0.5));
    bump.position.set(-0.014, 0.05, -0.0058);
    rig.add(bump);
    this.ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), toneMapped: false });
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.0022, 10), this.ledMat);
    led.position.set(-0.004, 0.058, -0.0076);
    led.rotation.y = Math.PI;
    rig.add(led);
    // gloved hand (simple low-poly wrap: palm + fingers along the right edge, thumb on the left)
    const glove = this._phoneMat(0x0b0c0d, 0.85, 0.0);
    const palm = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.07, 0.03, 3, 0.014), glove);
    palm.position.set(0.006, -0.082, -0.016);
    palm.rotation.set(0.1, 0, -0.08);
    rig.add(palm);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0085, 0.03, 4, 8), glove);
      f.position.set(0.039, -0.035 + i * 0.024, -0.004);
      f.rotation.set(0, 0, Math.PI / 2 + 0.12);
      rig.add(f);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, 0.035, 4, 8), glove);
    thumb.position.set(-0.037, -0.05, 0.0);
    thumb.rotation.set(0.0, 0.25, -0.75);
    rig.add(thumb);
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.12, 10), glove);
    wrist.position.set(0.012, -0.15, -0.03);
    wrist.rotation.set(0.35, 0, -0.15);
    rig.add(wrist);
    rig.traverse((o) => { if (o.isMesh) { o.layers.set(LAYER_PLAYER); o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; o.renderOrder = 5; } });
    scene.add(rig);
    this.rig = rig;
    this.q = new THREE.Quaternion().copy(camera.quaternion);
    this.aimQ = new THREE.Quaternion().copy(camera.quaternion);
    this.lastScreenUpdate = -1;
    this.flicker = 0;
    this._drawScreen(true);
  }

  _phoneMat(color, rough, metal) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    patchMaterial(m, { bake: 'none', variant: 'phone' });
    this.mats = this.mats ?? [];
    this.mats.push(m);
    return m;
  }

  toggle() { this.on = !this.on; this._drawScreen(true); return this.on; }

  _drawScreen(force = false) {
    const now = new Date();
    const key = now.getMinutes() + ':' + this.on + ':' + Math.round(this.battery * 100);
    if (!force && key === this.lastScreenUpdate) return;
    this.lastScreenUpdate = key;
    const c = this.screenCanvas, x = c.getContext('2d');
    const w = c.width, h = c.height;
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0d1016'); g.addColorStop(1, '#05070a');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = '#e8ecf2';
    x.font = '600 26px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    x.textBaseline = 'top';
    const gt = this.gameTime ?? '2:47';
    x.fillText(gt, 26, 18);
    x.font = '500 18px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    x.fillStyle = '#9aa3ad';
    x.fillText('No Service', 98, 22);
    // battery
    const bl = Math.round(this.battery * 100);
    x.strokeStyle = '#e8ecf2'; x.lineWidth = 2; x.strokeRect(w - 62, 22, 34, 17);
    x.fillStyle = bl < 20 ? '#ff453a' : '#e8ecf2'; x.fillRect(w - 59, 25, 28 * this.battery, 11);
    x.fillRect(w - 27, 27, 3, 7);
    // big clock
    x.fillStyle = '#e8ecf2'; x.textAlign = 'center';
    x.font = '200 92px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    x.fillText(gt, w / 2, 90);
    x.font = '400 20px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    x.fillStyle = '#9aa3ad';
    x.fillText('Friday, November 27', w / 2, 196);
    // notification
    x.fillStyle = 'rgba(255,255,255,0.08)';
    x.beginPath(); x.roundRect(18, 250, w - 36, 86, 16); x.fill();
    x.textAlign = 'left'; x.fillStyle = '#e8ecf2'; x.font = '600 17px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    x.fillText('Missed Call (3)', 34, 266);
    x.fillStyle = '#9aa3ad'; x.font = '400 16px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    x.fillText('VESPER GAS & GROC — 1:52 AM', 34, 294);
    // flashlight button
    const cx = 70, cy = h - 80;
    x.fillStyle = this.on ? '#f2f4f7' : 'rgba(255,255,255,0.14)';
    x.beginPath(); x.arc(cx, cy, 34, 0, Math.PI * 2); x.fill();
    x.fillStyle = this.on ? '#0d1016' : '#e8ecf2';
    x.beginPath(); x.roundRect(cx - 7, cy - 18, 14, 30, 3); x.fill();
    x.beginPath(); x.moveTo(cx - 11, cy - 22); x.lineTo(cx + 11, cy - 22); x.lineTo(cx + 7, cy - 14); x.lineTo(cx - 7, cy - 14); x.fill();
    // camera button
    x.fillStyle = 'rgba(255,255,255,0.14)';
    x.beginPath(); x.arc(w - 70, cy, 34, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#e8ecf2'; x.lineWidth = 3; x.beginPath(); x.arc(w - 70, cy, 11, 0, Math.PI * 2); x.stroke();
    // home indicator
    x.fillStyle = '#e8ecf2'; x.fillRect(w / 2 - 60, h - 16, 120, 5);
    this.screenTex.needsUpdate = true;
  }

  update(dt, player, time) {
    const cam = this.camera;
    // inertial follow of camera orientation (hand lags behind the chest cam)
    const kq = 1 - Math.exp(-dt * 11);
    this.q.slerp(cam.quaternion, kq);
    this.aimQ.slerp(cam.quaternion, 1 - Math.exp(-dt * 16));
    this.raiseT = this.on && !this.forceLower ? 1 : 0.35;
    this.raised += (this.raiseT - this.raised) * (1 - Math.exp(-dt * 6));
    const bob = Math.sin(player.stepPhase) * 0.006 * player.moving;
    const bob2 = Math.abs(Math.cos(player.stepPhase)) * 0.008 * player.moving;
    const off = new THREE.Vector3(0.155 + bob, -0.175 + bob2 - (1 - this.raised) * 0.12, -0.3);
    off.applyQuaternion(this.q);
    this.rig.position.copy(cam.position).add(off);
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5 - (1 - this.raised) * 0.5, -0.38, 0.14, 'YXZ'));
    this.rig.quaternion.copy(this.q).multiply(tilt);
    this.rig.updateMatrixWorld(true);

    // battery + flicker
    if (this.on) this.battery = Math.max(0.02, this.battery - dt * 0.00018);
    let target = this.on ? 1 : 0;
    if (this.on && (this.battery < 0.15 || this.flicker > 0)) {
      this.flicker = Math.max(0, this.flicker - dt);
      if (Math.random() < 0.08) target = 0.15 + Math.random() * 0.5;
    }
    this.level += (target - this.level) * (1 - Math.exp(-dt * 30));
    const L = this.light;
    this.nearSmooth = (this.nearSmooth ?? 1) + ((this.nearScale ?? 1) - (this.nearSmooth ?? 1)) * (1 - Math.exp(-dt * 8));
    L.intensity = this.intensity * this.level * this.nearSmooth;
    // LED position (back of phone, top-left)
    const ledW = new THREE.Vector3(-0.004, 0.058, -0.012).applyMatrix4(this.rig.matrixWorld);
    L.position.copy(ledW);
    // aim: mostly where the camera looks (lagging), slightly down like a hand-held light
    const aim = new THREE.Vector3(0.0, -0.06, -1).normalize().applyQuaternion(this.aimQ);
    L.target.position.copy(ledW).addScaledVector(aim, 8);
    L.updateMatrixWorld(); L.target.updateMatrixWorld();
    this.ledMat.color.setScalar(this.level * 30);
    // screen brightness
    this.screenMat.color.setScalar(0.38 + 0.1 * this.level);
    this._drawScreen();
    // phone lit by probe at camera position
    const irr = this.world.sampleProbe(cam.position, new THREE.Vector3());
    for (const m of this.mats) {
      const u = m.userData.uniforms;
      if (u?.uProbeStatic) { u.uProbeStatic.value.copy(irr).addScalar(0.01 + 0.02 * this.level); u.uProbeSky.value = (irr.sky ?? 0); }
    }
  }
}
