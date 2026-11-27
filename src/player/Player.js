import * as THREE from 'three';

const _v = new THREE.Vector3();

// First-person controller with a chest-mounted bodycam feel: inertial look, step bob,
// sway and handheld micro-shake. Collides against 2D colliders (OBB / circles) with Y ranges.
export class Player {
  constructor(camera, colliders, input) {
    this.camera = camera;
    this.colliders = colliders;
    this.input = input;
    this.pos = new THREE.Vector3(9.5, 0, 30);
    this.vel = new THREE.Vector3();
    this.yaw = 0.16; this.pitch = -0.05;
    this.yawT = this.yaw; this.pitchT = this.pitch;
    this.radius = 0.28;
    this.eye = 1.52;
    this.crouch = 0;
    this.stepPhase = 0;
    this.stepDist = 0;
    this.bob = 0;
    this.shakeT = 0;
    this.onStep = null;
    this.moving = 0;
    this.run = 0;
    this.lookVel = new THREE.Vector2();
    this.camRoll = 0;
    this.frozen = false;
    this.headOffset = new THREE.Vector3();
    this.fovKick = 0;
  }

  setPose(x, y, z, yaw, pitch) {
    this.pos.set(x, 0, z);
    if (y !== undefined) this.eye = y;
    this.yaw = this.yawT = yaw ?? this.yaw;
    this.pitch = this.pitchT = pitch ?? this.pitch;
  }

  update(dt) {
    const inp = this.input;
    // ---------------------------------------------------------------- look (inertial)
    const m = inp.consumeMouse();
    if (!this.frozen) {
      this.yawT -= m.x * inp.sensitivity;
      this.pitchT -= m.y * inp.sensitivity;
      this.pitchT = THREE.MathUtils.clamp(this.pitchT, -1.35, 1.3);
    }
    const k = 1 - Math.exp(-dt * 18);
    const pyaw = this.yaw;
    this.yaw += (this.yawT - this.yaw) * k;
    this.pitch += (this.pitchT - this.pitch) * k;
    const yawRate = (this.yaw - pyaw) / Math.max(dt, 1e-4);

    // ---------------------------------------------------------------- move
    const ax = this.frozen ? { x: 0, y: 0 } : inp.axis();
    const wantRun = inp.down('ShiftLeft') || inp.down('ShiftRight');
    const wantCrouch = inp.down('KeyC') || inp.down('ControlLeft');
    this.crouch += ((wantCrouch ? 1 : 0) - this.crouch) * (1 - Math.exp(-dt * 8));
    this.run += ((wantRun && ax.y > 0.2 ? 1 : 0) - this.run) * (1 - Math.exp(-dt * 4));
    const speed = THREE.MathUtils.lerp(1.55, 3.6, this.run) * THREE.MathUtils.lerp(1, 0.5, this.crouch);
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = fwd.multiplyScalar(ax.y).add(right.multiplyScalar(ax.x));
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(speed);
    const accel = wish.lengthSq() > 0 ? 9 : 11;
    this.vel.x += (wish.x - this.vel.x) * (1 - Math.exp(-dt * accel));
    this.vel.z += (wish.z - this.vel.z) * (1 - Math.exp(-dt * accel));
    const step = this.vel.clone().multiplyScalar(dt);
    // sub-step for robustness
    const n = Math.max(1, Math.ceil(step.length() / 0.12));
    for (let i = 0; i < n; i++) {
      this.pos.x += step.x / n;
      this.pos.z += step.z / n;
      this.collide();
    }
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.moving = THREE.MathUtils.clamp(hs / 1.5, 0, 1.6);

    // ---------------------------------------------------------------- bodycam motion
    this.stepDist += hs * dt;
    const stride = THREE.MathUtils.lerp(0.72, 1.05, this.run);
    const prevPhase = this.stepPhase;
    this.stepPhase = (this.stepDist / stride) * Math.PI;
    if (Math.floor(prevPhase / Math.PI) !== Math.floor(this.stepPhase / Math.PI) && hs > 0.3 && this.onStep) this.onStep(this.run, this.pos);
    const amp = Math.min(1, hs / 1.5) * (1 + this.run * 0.8);
    const bobY = (Math.abs(Math.sin(this.stepPhase)) - 0.5) * 0.034 * amp;
    const bobX = Math.sin(this.stepPhase * 0.5) * 0.022 * amp;
    this.shakeT += dt;
    const t = this.shakeT;
    const shakeYaw = (Math.sin(t * 1.3) * 0.6 + Math.sin(t * 2.7 + 1.0) * 0.3 + Math.sin(t * 5.1 + 2.0) * 0.1) * 0.0035;
    const shakePitch = (Math.sin(t * 1.7 + 0.5) * 0.6 + Math.sin(t * 3.3 + 2.4) * 0.3) * 0.003;
    const stepRoll = Math.sin(this.stepPhase * 0.5) * 0.012 * amp;
    const targetRoll = THREE.MathUtils.clamp(-yawRate * 0.012, -0.05, 0.05) + stepRoll;
    this.camRoll += (targetRoll - this.camRoll) * (1 - Math.exp(-dt * 6));

    const eye = this.eye - this.crouch * 0.55;
    const cam = this.camera;
    const sideX = Math.cos(this.yaw), sideZ = -Math.sin(this.yaw);
    cam.position.set(this.pos.x + sideX * bobX, eye + bobY, this.pos.z + sideZ * bobX);
    cam.rotation.set(this.pitch + shakePitch + bobY * 0.4, this.yaw + shakeYaw, this.camRoll, 'YXZ');
    cam.updateMatrixWorld();
  }

  collide() {
    const p = this.pos;
    const r = this.radius;
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (const c of this.colliders) {
        if (!c.enabled) continue;
        if (c.y1 < 0.22 || c.y0 > 1.75) continue;
        if (c.type === 'circle') {
          const dx = p.x - c.x, dz = p.z - c.z;
          const d2 = dx * dx + dz * dz, rr = r + c.r;
          if (d2 < rr * rr) {
            const d = Math.sqrt(d2) || 1e-4;
            const push = rr - d;
            p.x += (dx / d) * push; p.z += (dz / d) * push;
            moved = true;
          }
        } else {
          // into box local frame
          const dx = p.x - c.x, dz = p.z - c.z;
          const lx = c.cos * dx - c.sin * dz;
          const lz = c.sin * dx + c.cos * dz;
          const qx = THREE.MathUtils.clamp(lx, -c.hx, c.hx), qz = THREE.MathUtils.clamp(lz, -c.hz, c.hz);
          let ox = lx - qx, oz = lz - qz;
          const d2 = ox * ox + oz * oz;
          if (d2 < r * r) {
            let nx, nz, push;
            if (d2 > 1e-8) {
              const d = Math.sqrt(d2);
              nx = ox / d; nz = oz / d; push = r - d;
            } else {
              // center inside box: push out along least penetration axis
              const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
              if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; push = px + r; }
              else { nx = 0; nz = Math.sign(lz) || 1; push = pz + r; }
            }
            // back to world
            const wx = c.cos * nx + c.sin * nz;
            const wz = -c.sin * nx + c.cos * nz;
            p.x += wx * push; p.z += wz * push;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
  }

  get forward() { return _v.set(0, 0, -1).applyQuaternion(this.camera.quaternion); }
}
