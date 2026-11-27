import * as THREE from 'three';

// Canvas-drawn signage, posters, decals and product label atlases, with procedural weathering.

const cache = new Map();
let maxAniso = 8;
export function setCanvasAniso(a) { maxAniso = a; }

// --------------------------------------------------------------- tiny deterministic noise
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function valueNoise2(seed) {
  const rnd = mulberry(seed);
  const P = new Float32Array(256 * 256);
  for (let i = 0; i < P.length; i++) P[i] = rnd();
  const at = (x, y) => P[((y & 255) << 8) | (x & 255)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
const N1 = valueNoise2(1337), N2 = valueNoise2(4242);
function fbm(x, y, oct = 4) { let s = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < oct; i++) { s += a * N1(x * f, y * f); n += a; a *= 0.5; f *= 2; } return s / n; }

// Weather an existing canvas: dirt, fade, rust spots, scratches, edge grime
function weather(ctx, w, h, { dirt = 0.35, rust = 0.25, fade = 0.15, scratches = 20, seed = 1, edge = 0.5, rustColor = [92, 48, 22] } = {}) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const sx = 6 / w * (1 + (seed % 5) * 0.2), sy = 6 / h;
  const ox = seed * 17.3, oy = seed * 9.1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const nx = x * sx * 1.5 + ox, ny = y * sy * 1.5 + oy;
      const n = fbm(nx, ny, 4);
      const n2 = fbm(nx * 4 + 3, ny * 4 + 7, 3);
      // edge darkening
      const ex = Math.min(x, w - 1 - x) / w, ey = Math.min(y, h - 1 - y) / h;
      const e = Math.max(0, 1 - Math.min(ex, ey) * 14) * edge;
      let r = d[i], g = d[i + 1], b = d[i + 2];
      // fade toward grey-ish
      const f = fade * (0.6 + 0.8 * n);
      const l = (r + g + b) / 3;
      r = r + (l * 0.9 + 20 - r) * f; g = g + (l * 0.9 + 20 - g) * f; b = b + (l * 0.9 + 18 - b) * f;
      // dirt
      const dk = 1 - dirt * Math.max(0, (n - 0.35) * 1.6) - e * 0.5 - (y / h) * dirt * 0.35;
      r *= dk; g *= dk; b *= dk;
      // rust blotches
      const rm = Math.max(0, (n2 - (1 - rust * 0.9)) * 6) + Math.max(0, e - 0.4) * rust * 2;
      const rr = Math.min(1, rm);
      r = r + (rustColor[0] * (0.6 + n2) - r) * rr; g = g + (rustColor[1] * (0.6 + n2) - g) * rr; b = b + (rustColor[2] * (0.6 + n2) - b) * rr;
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  }
  ctx.putImageData(img, 0, 0);
  const rnd = mulberry(seed * 31 + 7);
  ctx.save();
  for (let s = 0; s < scratches; s++) {
    ctx.strokeStyle = `rgba(${200 + rnd() * 40},${190 + rnd() * 40},${170 + rnd() * 40},${0.15 + rnd() * 0.25})`;
    ctx.lineWidth = 0.5 + rnd() * 1.2;
    ctx.beginPath();
    const x0 = rnd() * w, y0 = rnd() * h;
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + (rnd() - 0.5) * w * 0.3, y0 + (rnd() - 0.5) * h * 0.2);
    ctx.stroke();
  }
  ctx.restore();
}

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function toTex(c, { srgb = true, mip = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  t.generateMipmaps = mip;
  t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  return t;
}
const FONT_BLOCK = "Impact, 'Haettenschweiler', 'Arial Narrow Bold', 'Arial Black', 'DejaVu Sans Condensed', sans-serif";
const FONT_SANS = "'Helvetica Neue', Helvetica, Arial, 'DejaVu Sans', sans-serif";
const FONT_SERIF = "Georgia, 'Times New Roman', 'DejaVu Serif', serif";
const FONT_SCRIPT = "'Brush Script MT', 'Segoe Script', 'Comic Sans MS', cursive";
const FONT_HAND = "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', 'DejaVu Sans', cursive";

function fitText(ctx, text, maxW, size, font, weight = 'bold') {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${font}`; s -= 2; } while (ctx.measureText(text).width > maxW && s > 6);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// --------------------------------------------------------------- designs
const DESIGNS = {
  vesperWall(c, x) {
    const w = c.width, h = c.height;
    x.fillStyle = '#b3201b'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#efe7d6'; x.lineWidth = 14; x.strokeRect(14, 14, w - 28, h - 28);
    x.fillStyle = '#efe7d6';
    fitText(x, 'VESPER', w * 0.8, h * 0.5, FONT_BLOCK);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('VESPER', w / 2, h * 0.4);
    x.fillRect(40, h * 0.66, w - 80, h * 0.2);
    x.fillStyle = '#b3201b';
    fitText(x, 'GASOLINE', w * 0.6, h * 0.16, FONT_SANS);
    x.fillText('GASOLINE', w / 2, h * 0.765);
    weather(x, w, h, { dirt: 0.4, rust: 0.35, fade: 0.25, seed: 3 });
  },
  motorOil(c, x) {
    const w = c.width, h = c.height;
    x.fillStyle = '#e8dfc8'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#7a1612'; x.lineWidth = 10; x.strokeRect(12, 12, w - 24, h - 24);
    x.fillStyle = '#7a1612'; x.textAlign = 'center'; x.textBaseline = 'middle';
    fitText(x, 'PREMIUM', w * 0.8, h * 0.09, FONT_SANS); x.fillText('PREMIUM', w / 2, h * 0.1);
    fitText(x, 'MOTOR OIL', w * 0.84, h * 0.12, FONT_BLOCK); x.fillText('MOTOR OIL', w / 2, h * 0.21);
    // can
    const cx = w / 2, cy = h * 0.53, cw = w * 0.34, ch = h * 0.42;
    x.fillStyle = '#c42a1e'; x.fillRect(cx - cw / 2, cy - ch / 2, cw, ch);
    x.fillStyle = '#efe7d6'; x.fillRect(cx - cw / 2, cy - ch * 0.12, cw, ch * 0.24);
    x.fillStyle = '#7a1612'; fitText(x, 'VESPER', cw * 0.8, ch * 0.16, FONT_BLOCK); x.fillText('VESPER', cx, cy);
    x.fillStyle = '#d9d0b8'; x.fillRect(cx - cw / 2, cy - ch / 2 - 8, cw, 8); x.fillRect(cx - cw / 2, cy + ch / 2, cw, 8);
    x.fillStyle = '#2a2a2a'; fitText(x, 'KEEPS', w * 0.6, h * 0.07, FONT_SANS); x.fillText('KEEPS', w / 2, h * 0.82);
    fitText(x, 'ENGINES CLEAN', w * 0.8, h * 0.07, FONT_SANS); x.fillText('ENGINES CLEAN', w / 2, h * 0.9);
    weather(x, w, h, { dirt: 0.45, rust: 0.3, fade: 0.2, seed: 5 });
  },
  tires(c, x) {
    const w = c.width, h = c.height;
    x.fillStyle = '#ddd8c8'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#222'; x.lineWidth = 8; x.strokeRect(8, 8, w - 16, h - 16);
    x.fillStyle = '#1a1a1a'; x.textAlign = 'center'; x.textBaseline = 'middle';
    fitText(x, 'TIRES', w * 0.7, h * 0.42, FONT_BLOCK); x.fillText('TIRES', w / 2, h * 0.36);
    fitText(x, 'BATTERIES', w * 0.8, h * 0.22, FONT_SANS); x.fillText('BATTERIES', w / 2, h * 0.74);
    weather(x, w, h, { dirt: 0.5, rust: 0.4, fade: 0.2, seed: 7 });
  },
  ice(c, x) {
    const w = c.width, h = c.height;
    x.fillStyle = '#e9e6dc'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#b01e18'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `bold ${h * 0.62}px ${FONT_SERIF}`;
    const letters = ['I', 'C', 'E'];
    letters.forEach((l, i) => x.fillText(l, w * (0.25 + i * 0.25), h * 0.55));
    weather(x, w, h, { dirt: 0.18, rust: 0.1, fade: 0.08, seed: 9, edge: 0.5, scratches: 12 });
  },
  restroom(c, x) {
    const w = c.width, h = c.height;
    x.fillStyle = '#1f3a5a'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#e8e8e0'; x.textAlign = 'center'; x.textBaseline = 'middle';
    fitText(x, 'RESTROOM', w * 0.86, h * 0.55, FONT_SANS); x.fillText('RESTROOM', w / 2, h / 2);
    weather(x, w, h, { dirt: 0.2, rust: 0.0, fade: 0.1, seed: 11, scratches: 6 });
  },
  employees(c, x) {
    const w = c.width, h = c.height;
    x.fillStyle = '#d8d4c4'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#9c1a14'; x.textAlign = 'center'; x.textBaseline = 'middle';
    fitText(x, 'EMPLOYEES ONLY', w * 0.9, h * 0.45, FONT_SANS); x.fillText('EMPLOYEES ONLY', w / 2, h / 2);
    weather(x, w, h, { dirt: 0.25, rust: 0.0, fade: 0.1, seed: 12, scratches: 6 });
  },
  hoursSticker(c, x) {
    const w = c.width, h = c.height;
    x.clearRect(0, 0, w, h);
    x.fillStyle = 'rgba(240,236,226,0.92)'; roundRect(x, 4, 4, w - 8, h - 8, 10); x.fill();
    x.fillStyle = '#9c1a14'; x.textAlign = 'center'; x.textBaseline = 'middle';
    fitText(x, 'OPEN 24 HOURS', w * 0.85, h * 0.22, FONT_SANS); x.fillText('OPEN 24 HOURS', w / 2, h * 0.3);
    x.fillStyle = '#222'; fitText(x, 'NO CASH KEPT AFTER 10PM', w * 0.85, h * 0.12, FONT_SANS, 'normal'); x.fillText('NO CASH KEPT AFTER 10PM', w / 2, h * 0.58);
    fitText(x, 'PUSH', w * 0.4, h * 0.16, FONT_SANS); x.fillText('PUSH', w / 2, h * 0.8);
  },
  pullSticker(c, x) {
    const w = c.width, h = c.height;
    x.clearRect(0, 0, w, h);
    x.fillStyle = 'rgba(235,230,220,0.92)'; roundRect(x, 4, 4, w - 8, h - 8, 10); x.fill();
    x.fillStyle = '#222'; x.textAlign = 'center'; x.textBaseline = 'middle';
    fitText(x, 'WE ACCEPT', w * 0.7, h * 0.16, FONT_SANS); x.fillText('WE ACCEPT', w / 2, h * 0.28);
    fitText(x, 'CASH • CARD • EBT', w * 0.85, h * 0.14, FONT_SANS); x.fillText('CASH • CARD • EBT', w / 2, h * 0.52);
    x.fillStyle = '#9c1a14'; fitText(x, 'PUSH', w * 0.4, h * 0.16, FONT_SANS); x.fillText('PUSH', w / 2, h * 0.78);
  },
  missing(c, x) {
    const w = c.width, h = c.height;
    x.fillStyle = '#ebe6d6'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#111'; x.textAlign = 'center'; x.textBaseline = 'middle';
    fitText(x, 'MISSING', w * 0.86, h * 0.12, FONT_BLOCK); x.fillText('MISSING', w / 2, h * 0.09);
    // photocopied portrait: dark noisy oval silhouette
    const px = w * 0.2, py = h * 0.18, pw = w * 0.6, ph = h * 0.44;
    x.fillStyle = '#8b877c'; x.fillRect(px, py, pw, ph);
    const g = x.createRadialGradient(w / 2, py + ph * 0.42, 5, w / 2, py + ph * 0.45, pw * 0.5);
    g.addColorStop(0, '#2a2925'); g.addColorStop(0.55, '#3a3833'); g.addColorStop(1, '#8b877c');
    x.fillStyle = g; x.beginPath(); x.ellipse(w / 2, py + ph * 0.42, pw * 0.22, ph * 0.3, 0, 0, Math.PI * 2); x.fill();
    x.fillRect(w / 2 - pw * 0.3, py + ph * 0.72, pw * 0.6, ph * 0.28);
    x.fillStyle = '#111';
    fitText(x, 'HAVE YOU SEEN HIM?', w * 0.86, h * 0.055, FONT_SANS); x.fillText('HAVE YOU SEEN HIM?', w / 2, h * 0.68);
    x.font = `normal ${h * 0.032}px ${FONT_SANS}`;
    const lines = ['DANIEL R. — NIGHT CLERK, 34', 'LAST SEEN: VESPER GAS, HOLLOW CREEK RD', 'WORKING THE 10PM–6AM SHIFT', 'WEARING GREY JACKET, BLUE CAP', 'IF YOU HAVE ANY INFORMATION', 'CALL COUNTY SHERIFF'];
    lines.forEach((l, i) => x.fillText(l, w / 2, h * (0.74 + i * 0.04)));
    weather(x, w, h, { dirt: 0.25, rust: 0.0, fade: 0.25, seed: 21, scratches: 4, edge: 0.6 });
  },
  priceSign(c, x) {
    const w = c.width, h = c.height;
    x.fillStyle = '#efe9da'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#b3201b'; x.fillRect(0, 0, w, h * 0.42);
    x.fillStyle = '#efe9da'; x.textAlign = 'center'; x.textBaseline = 'middle';
    fitText(x, 'VESPER', w * 0.8, h * 0.3, FONT_BLOCK); x.fillText('VESPER', w / 2, h * 0.22);
    x.fillStyle = '#151515';
    const rows = [['REGULAR', '3.49'], ['PLUS', '3.6'], ['DIESEL', '4.1']];
    rows.forEach(([n, p], i) => {
      const y = h * (0.52 + i * 0.16);
      x.textAlign = 'left'; fitText(x, n, w * 0.38, h * 0.09, FONT_SANS); x.fillText(n, w * 0.06, y);
      x.textAlign = 'right'; fitText(x, p, w * 0.4, h * 0.13, FONT_BLOCK); x.fillText(p, w * 0.86, y);
      x.font = `bold ${h * 0.06}px ${FONT_SANS}`; x.fillText('9', w * 0.94, y - h * 0.03);
    });
    weather(x, w, h, { dirt: 0.3, rust: 0.15, fade: 0.15, seed: 31, scratches: 8 });
  },
  canopyBrand(c, x) {
    const w = c.width, h = c.height;
    x.fillStyle = '#26292a'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#9b1c17'; x.fillRect(0, h * 0.78, w, h * 0.12);
    x.fillStyle = '#d8d2c0'; x.textAlign = 'center'; x.textBaseline = 'middle';
    fitText(x, 'VESPER', w * 0.3, h * 0.55, FONT_BLOCK); x.fillText('VESPER', w * 0.5, h * 0.4);
    weather(x, w, h, { dirt: 0.5, rust: 0.4, fade: 0.2, seed: 33, scratches: 30 });
  },
  vanDecal(c, x) {
    const w = c.width, h = c.height;
    x.clearRect(0, 0, w, h);
    // retro stripes
    const stripe = (y, hh, col) => { x.fillStyle = col; roundRect(x, w * 0.02, y, w * 0.96, hh, hh / 2); x.fill(); };
    stripe(h * 0.18, h * 0.62, '#b8341f');
    stripe(h * 0.26, h * 0.46, '#e08a2c');
    stripe(h * 0.33, h * 0.32, '#f2ecdc');
    x.fillStyle = '#7a1e12'; x.textAlign = 'center'; x.textBaseline = 'middle';
    fitText(x, 'KXLR 1180 AM', w * 0.62, h * 0.22, FONT_BLOCK); x.fillText('KXLR 1180 AM', w * 0.5, h * 0.49);
    x.fillStyle = '#f2ecdc'; fitText(x, 'THE LATE SIGNAL • NIGHTS', w * 0.6, h * 0.1, FONT_SANS); x.fillText('THE LATE SIGNAL • NIGHTS', w * 0.5, h * 0.89);
    weather(x, w, h, { dirt: 0.3, rust: 0.15, fade: 0.25, seed: 41, scratches: 25, edge: 0 });
  },
  arrowSign(c, x) {
    const w = c.width, h = c.height;
    x.clearRect(0, 0, w, h);
    x.fillStyle = '#d9cfb4';
    x.beginPath(); x.moveTo(w * 0.04, h * 0.18); x.lineTo(w * 0.78, h * 0.18); x.lineTo(w * 0.97, h * 0.5); x.lineTo(w * 0.78, h * 0.82); x.lineTo(w * 0.04, h * 0.82); x.closePath(); x.fill();
    x.strokeStyle = '#6a2a1c'; x.lineWidth = 10; x.stroke();
    x.fillStyle = '#7a2a1a'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `italic bold ${h * 0.3}px ${FONT_SCRIPT}`; x.fillText('Hollow Creek', w * 0.43, h * 0.43);
    x.font = `bold ${h * 0.09}px ${FONT_SANS}`; x.fillText('GAS • FOOD • ICE  1 MI', w * 0.43, h * 0.68);
    weather(x, w, h, { dirt: 0.5, rust: 0.45, fade: 0.25, seed: 51, scratches: 20 });
  },
  roadSign(c, x) {
    const w = c.width, h = c.height;
    x.fillStyle = '#1d5a33'; roundRect(x, 0, 0, w, h, 18); x.fill();
    x.strokeStyle = '#e8e8e0'; x.lineWidth = 8; roundRect(x, 10, 10, w - 20, h - 20, 12); x.stroke();
    x.fillStyle = '#e8e8e0'; x.textAlign = 'left'; x.textBaseline = 'middle';
    x.font = `bold ${h * 0.17}px ${FONT_SANS}`;
    x.fillText('Hollow Creek', w * 0.08, h * 0.32); x.textAlign = 'right'; x.fillText('12', w * 0.92, h * 0.32);
    x.textAlign = 'left'; x.fillText('Next Services', w * 0.08, h * 0.68); x.textAlign = 'right'; x.fillText('83', w * 0.92, h * 0.68);
    weather(x, w, h, { dirt: 0.3, rust: 0.1, fade: 0.15, seed: 61, scratches: 10, edge: 0.3 });
  },
  poster(c, x, opts) {
    const w = c.width, h = c.height;
    const v = opts.v ?? 0;
    const pal = [['#123c6e', '#f2c230', 'ICE COLD', 'BEER', '2 FOR $5'], ['#a01a14', '#f4e9cf', 'HOT', 'COFFEE', 'ANY SIZE 99¢'], ['#1b5e34', '#f4e9cf', 'LOTTO', 'JACKPOT', '$48 MILLION'], ['#2a2a2a', '#e8c25a', 'WE CARD', 'UNDER 21', 'NO EXCEPTIONS'], ['#5a1d6e', '#f4e9cf', 'NIGHT', 'OWL', 'SNACK DEALS']][v % 5];
    x.fillStyle = pal[0]; x.fillRect(0, 0, w, h);
    x.fillStyle = pal[1]; x.textAlign = 'center'; x.textBaseline = 'middle';
    fitText(x, pal[2], w * 0.85, h * 0.16, FONT_BLOCK); x.fillText(pal[2], w / 2, h * 0.2);
    fitText(x, pal[3], w * 0.9, h * 0.26, FONT_BLOCK); x.fillText(pal[3], w / 2, h * 0.45);
    x.fillRect(w * 0.1, h * 0.62, w * 0.8, 6);
    fitText(x, pal[4], w * 0.85, h * 0.1, FONT_SANS); x.fillText(pal[4], w / 2, h * 0.78);
    weather(x, w, h, { dirt: 0.2, rust: 0, fade: 0.35, seed: 71 + v, scratches: 3, edge: 0.3 });
  },
  rulesNote(c, x) {
    const w = c.width, h = c.height;
    x.fillStyle = '#d8d2bf'; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(80,110,160,0.35)'; x.lineWidth = 2;
    for (let y = h * 0.12; y < h; y += h * 0.07) { x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke(); }
    x.fillStyle = '#1c2350'; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    x.font = `bold ${h * 0.055}px ${FONT_HAND}`;
    const lines = ['NIGHT SHIFT RULES', '1. lock register at 2', '2. dont answer the', '    phone after 3', '3. if the lights go', '    out DO NOT go in', '    the back', '4. he waits by pump 2', '5. dont look at it'];
    lines.forEach((l, i) => x.fillText(l, w * 0.07, h * (0.1 + i * 0.07)));
    weather(x, w, h, { dirt: 0.2, rust: 0, fade: 0.05, seed: 81, scratches: 2, edge: 0.4 });
  },
  breaker(c, x) {
    const w = c.width, h = c.height;
    x.fillStyle = '#9a9c98'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#1a1a1a'; x.font = `bold ${h * 0.05}px ${FONT_SANS}`; x.textAlign = 'center';
    x.fillText('PANEL A — 200A', w / 2, h * 0.07);
    x.textAlign = 'left'; x.font = `normal ${h * 0.03}px ${FONT_SANS}`;
    const labels = ['SALES FLR LTS', 'COOLERS', 'CANOPY', 'PUMPS', 'SIGN', 'OFFICE', 'RESTROOM', 'WALK-IN', 'HVAC', 'SPARE'];
    labels.forEach((l, i) => { x.fillText(l, w * 0.08, h * (0.16 + i * 0.08)); x.fillText(l.split(' ')[0], w * 0.58, h * (0.16 + i * 0.08)); });
    weather(x, w, h, { dirt: 0.4, rust: 0.2, fade: 0.1, seed: 91, scratches: 10 });
  },
  calendar(c, x) {
    const w = c.width, h = c.height;
    x.fillStyle = '#ece6d6'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#7a1612'; x.fillRect(0, 0, w, h * 0.42);
    x.fillStyle = '#efe7d6'; x.font = `bold ${h * 0.07}px ${FONT_SANS}`; x.textAlign = 'center'; x.fillText('NOVEMBER 2026', w / 2, h * 0.36);
    x.fillStyle = '#222'; x.font = `normal ${h * 0.035}px ${FONT_SANS}`;
    for (let d = 1; d <= 30; d++) {
      const col = (d + 6) % 7, row = Math.floor((d + 6) / 7);
      const tx = w * (0.1 + col * 0.13), ty = h * (0.47 + row * 0.09);
      x.fillText(String(d), tx, ty);
      if (d < 27) { x.strokeStyle = '#9c1a14'; x.lineWidth = 3; x.beginPath(); x.moveTo(tx - 12, ty - 14); x.lineTo(tx + 12, ty + 6); x.stroke(); }
    }
    weather(x, w, h, { dirt: 0.15, rust: 0, fade: 0.1, seed: 99, scratches: 2 });
  },
  logbook(c, x) {
    const w = c.width, h = c.height;
    x.fillStyle = '#e2dccb'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#20264a'; x.font = `${h * 0.05}px ${FONT_HAND}`; x.textAlign = 'left';
    const lines = ['11/26  2214  delivery late again', '11/26  2351  van parked out front', '               nobody inside it', '11/27  0105  radio static on', '               every channel', '11/27  0148  lights out in back', '11/27  0203  someone at pump 2', '11/27  0204  not someone'];
    lines.forEach((l, i) => x.fillText(l, w * 0.05, h * (0.1 + i * 0.1)));
  },
  coolerHeader(c, x) {
    const w = c.width, h = c.height;
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#1b2f5a'); g.addColorStop(1, '#10203f');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = '#f4f2ea'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const words = ['ICE COLD', 'BEER', 'SODA', 'ENERGY', 'WATER', 'DAIRY'];
    words.forEach((t, i) => { fitText(x, t, w / words.length * 0.8, h * 0.6, FONT_BLOCK); x.fillText(t, (w / words.length) * (i + 0.5), h * 0.52); });
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(w * 0.66, 0, w * 0.17, h);
  },
  clock(c, x) {
    const w = c.width, h = c.height;
    x.fillStyle = '#e8e4d8'; x.beginPath(); x.arc(w / 2, h / 2, w * 0.48, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#222'; x.lineWidth = w * 0.03; x.stroke();
    x.fillStyle = '#222';
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; x.fillRect(w / 2 + Math.cos(a) * w * 0.38 - 3, h / 2 + Math.sin(a) * h * 0.38 - 3, 6, 6); }
    const hand = (a, len, wd) => { x.lineWidth = wd; x.beginPath(); x.moveTo(w / 2, h / 2); x.lineTo(w / 2 + Math.sin(a) * len, h / 2 - Math.cos(a) * len); x.stroke(); };
    hand(((2 + 47 / 60) / 12) * Math.PI * 2, w * 0.22, w * 0.04);
    hand((47 / 60) * Math.PI * 2, w * 0.34, w * 0.025);
    weather(x, w, h, { dirt: 0.2, rust: 0, fade: 0.1, seed: 101, scratches: 3, edge: 0 });
  },
  exitSign(c, x) {
    const w = c.width, h = c.height;
    x.fillStyle = '#0a1a0e'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#5dff8a'; x.textAlign = 'center'; x.textBaseline = 'middle';
    fitText(x, 'EXIT', w * 0.7, h * 0.75, FONT_SANS); x.fillText('EXIT', w / 2, h * 0.54);
  },
  atmScreen(c, x) {
    const w = c.width, h = c.height;
    x.fillStyle = '#0b2a5c'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#cfe0ff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    fitText(x, 'TEMPORARILY', w * 0.8, h * 0.14, FONT_SANS); x.fillText('TEMPORARILY', w / 2, h * 0.38);
    fitText(x, 'OUT OF SERVICE', w * 0.85, h * 0.14, FONT_SANS); x.fillText('OUT OF SERVICE', w / 2, h * 0.58);
  },
  screenStatic(c, x) {
    const w = c.width, h = c.height;
    const img = x.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const v = Math.random() * 255; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    x.putImageData(img, 0, 0);
  },
};

const SIZES = {
  vesperWall: [512, 384], motorOil: [384, 512], tires: [512, 256], ice: [512, 256], restroom: [256, 96], employees: [256, 96],
  hoursSticker: [256, 160], pullSticker: [256, 160], missing: [384, 512], priceSign: [384, 512], canopyBrand: [1024, 128],
  vanDecal: [1024, 256], arrowSign: [1024, 384], roadSign: [512, 256], poster: [256, 384], rulesNote: [384, 512], breaker: [256, 512],
  calendar: [256, 384], logbook: [512, 384], screenStatic: [128, 128], coolerHeader: [1536, 96], clock: [256, 256], exitSign: [256, 128], atmScreen: [256, 192],
};

export function signTexture(name, opts = {}) {
  const key = name + JSON.stringify(opts);
  if (cache.has(key)) return cache.get(key);
  const [w, h] = SIZES[name] ?? [256, 256];
  const c = makeCanvas(w, h);
  const x = c.getContext('2d', { willReadFrequently: true });
  DESIGNS[name](c, x, opts);
  const t = toTex(c);
  t.userData.canvas = c;
  cache.set(key, t);
  return t;
}

// --------------------------------------------------------------- product label atlas
// 8 x 8 cells of generic product labels (chips, sodas, candy, cans). Returns texture + cell count.
export function productAtlas() {
  if (cache.has('__products')) return cache.get('__products');
  const W = 1024, H = 1024, N = 8;
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  const rnd = mulberry(777);
  const brands = ['CRUNCHOS', 'ZAPP', 'KRISP', 'NITRO', 'BOLT', 'FIZZ', 'MOONPIE', 'TWISTER', 'SALTY', 'GOLDEN', 'RIDGE', 'TANGO', 'HUSK', 'COLA', 'ROOT', 'LEMON', 'OATY', 'CHOCO', 'NUTZ', 'RAZZ', 'POPS', 'JERKY', 'BEEF', 'MINT'];
  const hues = [0, 12, 25, 40, 55, 120, 160, 200, 220, 260, 290, 330];
  const cw = W / N, ch = H / N;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x0 = i * cw, y0 = j * ch;
    const hue = hues[Math.floor(rnd() * hues.length)];
    const sat = 45 + rnd() * 45, lig = 28 + rnd() * 35;
    x.fillStyle = `hsl(${hue},${sat}%,${lig}%)`; x.fillRect(x0, y0, cw, ch);
    // band
    x.fillStyle = `hsl(${(hue + 180 + rnd() * 60) % 360},${sat}%,${70 + rnd() * 20}%)`;
    const by = y0 + ch * (0.3 + rnd() * 0.2);
    x.fillRect(x0, by, cw, ch * (0.18 + rnd() * 0.12));
    // circle / burst
    if (rnd() > 0.5) { x.fillStyle = `hsla(${(hue + 40) % 360},90%,60%,0.9)`; x.beginPath(); x.arc(x0 + cw * (0.3 + rnd() * 0.4), y0 + ch * 0.72, cw * (0.1 + rnd() * 0.12), 0, Math.PI * 2); x.fill(); }
    x.fillStyle = rnd() > 0.5 ? '#111' : '#f4f0e4';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const name = brands[Math.floor(rnd() * brands.length)];
    fitText(x, name, cw * 0.86, ch * 0.2, FONT_BLOCK);
    x.save(); x.translate(x0 + cw / 2, by + ch * 0.1); x.fillText(name, 0, 0); x.restore();
    // fine print
    x.fillStyle = 'rgba(255,255,255,0.5)';
    for (let k = 0; k < 4; k++) x.fillRect(x0 + cw * 0.15, y0 + ch * (0.12 + k * 0.035), cw * (0.3 + rnd() * 0.5), 2);
  }
  const t = toTex(c);
  const out = { texture: t, cells: N };
  cache.set('__products', out);
  return out;
}

// Dynamic canvas texture (phone screen / CCTV overlay)
export function dynamicCanvas(w, h) {
  const c = makeCanvas(w, h);
  const t = toTex(c, { mip: false });
  return { canvas: c, ctx: c.getContext('2d'), texture: t };
}
