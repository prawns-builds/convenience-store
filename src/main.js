import * as THREE from 'three';
import { detectQuality, resolveQuality } from './config.js';
import { setCanvasAniso } from './gfx/CanvasTextures.js';
import { G } from './gfx/Materials.js';
import { World } from './world/World.js';
import { Pipeline } from './render/Pipeline.js';
import { Input } from './core/Input.js';
import { Player } from './player/Player.js';
import { Flashlight } from './player/Flashlight.js';
import { Game } from './game/Game.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: false, preserveDrawingBuffer: params.has('shot') });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.info.autoReset = true;
setCanvasAniso(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

if (params.get('test') === 'tex') {
  document.getElementById('overlay').classList.add('hidden');
  const { runTexTest } = await import('./debug/texTest.js');
  await runTexTest(renderer);
} else {
  start();
}

async function start() {
  const qSel = document.getElementById('ov-quality');
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sandboxed */ } },
  };
  const stored = params.get('q') ?? store.get('ns-quality') ?? 'auto';
  qSel.value = ['auto', 'low', 'medium', 'high', 'ultra'].includes(stored) ? stored : 'auto';
  const qName = stored === 'auto' || !stored ? detectQuality(renderer) : stored;
  const q = resolveQuality(qName === 'auto' ? 'high' : qName);
  if (params.has('scale')) q.scale = Number(params.get('scale'));
  qSel.addEventListener('change', () => { store.set('ns-quality', qSel.value); location.reload(); });

  const bar = document.getElementById('ov-bar');
  const status = document.getElementById('ov-status');
  const btn = document.getElementById('ov-start');
  const progress = (p, s) => { bar.style.width = `${Math.round(p * 100)}%`; if (s) status.textContent = s + '…'; };

  const dpr = Math.min(devicePixelRatio || 1, q.maxDpr);
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight, false);

  const world = new World(renderer, q);
  const t0 = performance.now();
  await world.build(progress);
  console.log('[main] world built in', ((performance.now() - t0) / 1000).toFixed(2), 's', 'quality', q.name);

  const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.05, 900);
  camera.rotation.order = 'YXZ';
  world.scene.add(camera);
  const pipeline = new Pipeline(renderer, q);
  pipeline.glows = world.glows;
  const input = new Input(canvas);
  const player = new Player(camera, world.colliders, input);
  const flashlight = new Flashlight(world.scene, camera, world, q);
  pipeline.flashlight = flashlight;

  const game = new Game({ renderer, world, pipeline, camera, input, player, flashlight, quality: q, params });
  window.__game = game;

  const resize = () => {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    // horizontal FOV ~100deg on wide screens (bodycam), clamp vertical
    const hfov = THREE.MathUtils.degToRad(game.hfov ?? 100);
    let vfov = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
    vfov = Math.min(vfov, THREE.MathUtils.degToRad(92));
    camera.fov = THREE.MathUtils.radToDeg(vfov);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    pipeline.setSize(w, h, dpr * game.dynScale);
  };
  game.onResize = resize;
  addEventListener('resize', resize);
  resize();

  // camera pose from URL (debug/screenshot)
  if (params.has('cam')) {
    const [x, y, z, yaw, pitch] = params.get('cam').split(',').map(Number);
    player.setPose(x, y, z, THREE.MathUtils.degToRad(yaw), THREE.MathUtils.degToRad(pitch));
  }

  btn.disabled = false;
  btn.textContent = 'BEGIN RECORDING';
  status.textContent = 'READY';
  const begin = () => {
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    input.requestLock();
    game.begin();
  };
  btn.addEventListener('click', begin);
  input.onLockChange = (locked) => {
    if (!locked && game.started && !game.noteOpen && !input.dragLook) game.pause(true);
    if (locked) { input.dragLook = false; game.pause(false); }
  };
  input.onFallback = () => game.hud.subtitle('Mouse capture unavailable here — drag with the left button to look around.', 5);
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && input.dragLook && game.started && !game.noteOpen) game.pause(!game.paused);
  });
  document.getElementById('overlay').addEventListener('click', (e) => {
    if (e.target === btn) return;
    if (game.started && e.target.id !== 'ov-quality' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'LABEL') begin();
  });

  if (params.has('autostart')) {
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    game.begin(true);
  }

  // multi-view screenshot support: window.__view(i, overrides) poses the camera and renders a few frames
  if (params.has('views')) {
    const views = params.get('views').split(';').map((v) => v.split(',').map(Number));
    window.__views = views.length;
    window.__view = (i, over = {}) => {
      const [x, y, z, yaw, pitch] = views[i];
      player.setPose(x, y, z, THREE.MathUtils.degToRad(yaw), THREE.MathUtils.degToRad(pitch));
      for (const [k, v] of Object.entries(over.pipeline ?? {})) pipeline.params[k] = v;
      if (over.flash !== undefined) flashlight.on = !!over.flash;
      if (over.breaker !== undefined) world.setGroupLevel(0, over.breaker);
      if (over.lightning) window.__game.events.lightning(over.lightning);
      if (over.car !== undefined) { const tr = window.__game.traffic; tr.spawn(); tr.dir = 1; tr.x = 26.05; tr.z = over.car; tr.car.rotation.y = Math.PI; }
      if (over.rainAmb !== undefined) window.__game.rain.uniforms.uAmbient.value.setScalar(over.rainAmb);
      if (over.debug !== undefined) { G.uDebugView.value = over.debug; pipeline.params.debugRaw = over.debug > 0; }
      pipeline.expo.uniforms.uReset.value = 1;
      window.__viewDone = -1;
      window.__viewReq = { i, frames: over.frames ?? 6, waitBake: !!over.waitBake };
    };
  }
  let last = performance.now();
  let frames = 0;
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.update(dt, now / 1000);
    frames++;
    if (params.has('shot') && frames === (Number(params.get('frames')) || 4)) {
      window.__info = game.debugInfo();
      window.__ready = true;
    }
    if (window.__viewReq && !(window.__viewReq.waitBake && !world.baker.done)) {
      if (--window.__viewReq.frames <= 0) { window.__viewDone = window.__viewReq.i; window.__viewReq = null; window.__info = game.debugInfo(); }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
