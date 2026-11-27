// Keyboard / mouse (pointer lock) / touch input.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.dx = 0; this.dy = 0;
    this.locked = false;
    this.enabled = false;
    this.touch = { move: { id: null, x0: 0, y0: 0, x: 0, y: 0 }, look: { id: null, x: 0, y: 0 } };
    this.moveAxis = { x: 0, y: 0 };
    this.sensitivity = 0.0022;
    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      // clamp spikes (some browsers report huge deltas on lock)
      const mx = Math.max(-300, Math.min(300, e.movementX));
      const my = Math.max(-300, Math.min(300, e.movementY));
      this.dx += mx; this.dy += my;
    });
    addEventListener('mousedown', (e) => {
      if (!this.enabled || !this.locked) return;
      if (e.button === 0) this.pressed.add('MouseLeft');
      if (e.button === 2) this.pressed.add('MouseRight');
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    // touch: left half = move stick, right half = look
    const ts = { passive: false };
    canvas.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.45 && this.touch.move.id === null) Object.assign(this.touch.move, { id: t.identifier, x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY });
        else if (this.touch.look.id === null) Object.assign(this.touch.look, { id: t.identifier, x: t.clientX, y: t.clientY, t0: performance.now() });
      }
      e.preventDefault();
    }, ts);
    canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.move.id) { this.touch.move.x = t.clientX; this.touch.move.y = t.clientY; }
        if (t.identifier === this.touch.look.id) { this.dx += (t.clientX - this.touch.look.x) * 2.2; this.dy += (t.clientY - this.touch.look.y) * 2.2; this.touch.look.x = t.clientX; this.touch.look.y = t.clientY; }
      }
      e.preventDefault();
    }, ts);
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.move.id) this.touch.move.id = null;
        if (t.identifier === this.touch.look.id) {
          if (performance.now() - (this.touch.look.t0 ?? 0) < 220) this.pressed.add('KeyE');
          this.touch.look.id = null;
        }
      }
    };
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('touchcancel', end);
  }
  requestLock() { try { const p = this.canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => this.canvas.requestPointerLock()); } catch (e) { this.canvas.requestPointerLock(); } }
  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  axis() {
    let x = 0, y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.touch.move.id !== null) {
      const mx = (this.touch.move.x - this.touch.move.x0) / 60, my = -(this.touch.move.y - this.touch.move.y0) / 60;
      x += Math.max(-1, Math.min(1, mx)); y += Math.max(-1, Math.min(1, my));
    }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    this.moveAxis.x = x; this.moveAxis.y = y;
    return this.moveAxis;
  }
  consumeMouse() { const d = { x: this.dx, y: this.dy }; this.dx = 0; this.dy = 0; return d; }
  endFrame() { this.pressed.clear(); }
}
