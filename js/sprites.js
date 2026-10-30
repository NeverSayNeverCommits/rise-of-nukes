// Building pictures, drawn once with canvas shapes and cached (one per type, colour and age).
// Each sprite is 1.5x as tall as the building's footprint so roofs and towers can stick up.
// Sprites also come with a "lit" layer (glowing windows for the night) and chimney spots for smoke.
import { hash2 } from './sim/rng.js';
import { BLDS } from './sim/data.js';

export const SP = 48; // sprite pixels per tile
const cache = new Map();

function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function tint(hex, amt) {
  let [r, g, b] = rgb(hex);
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; } else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// key: type|color|age
export function bldSprite(type, color, age) {
  const key = `${type}|${color}|${age}`;
  let s = cache.get(key);
  if (s) return s;
  const size = BLDS[type].size;
  const W = size * SP, H = Math.round(W * 1.5), top = H - W;
  const img = document.createElement('canvas'); img.width = W; img.height = H;
  const lit = document.createElement('canvas'); lit.width = W; lit.height = H;
  const d = new Draw(img.getContext('2d'), lit.getContext('2d'), color, top, W);
  DRAW[type](d, age, size);
  s = { img, lit: d.anyLit ? lit : null, smoke: d.smoke.map(([x, y]) => [x / SP, (y - top) / SP]), top: top / SP, pump: d.pump };
  cache.set(key, s);
  return s;
}

// Little drawing kit. Coordinates are sprite pixels; the footprint is (0, top) to (W, top + W).
class Draw {
  constructor(g, l, color, top, W) {
    this.g = g; this.l = l; this.c = color; this.top = top; this.W = W; this.smoke = []; this.anyLit = false;
    this.dark = tint(color, -0.35); this.light = tint(color, 0.3);
  }
  // footprint fraction -> pixels
  X(f) { return f * this.W; }
  Y(f) { return this.top + f * this.W; }
  rect(x, y, w, h, c) { this.g.fillStyle = c; this.g.fillRect(x, y, w, h); }
  shadow(x, y, w, d, h) {
    const g = this.g;
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath(); g.moveTo(x, y + d); g.lineTo(x + w, y + d); g.lineTo(x + w + h * 0.55, y + d - h * 0.15); g.lineTo(x + w + h * 0.55, y - h * 0.15 + 2); g.lineTo(x + w, y); g.closePath(); g.fill();
  }
  // A box standing on footprint (x, y, w, d) with height h. Flat roof.
  box(x, y, w, d, h, roof, wall, o = {}) {
    if (!o.noShadow) this.shadow(x, y, w, d, h);
    this.rect(x, y + d - h, w, h, wall);
    this.rect(x, y - h, w, d, roof);
    const g = this.g;
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1;
    g.strokeRect(x + 0.5, y - h + 0.5, w - 1, d + h - 1);
    g.beginPath(); g.moveTo(x, y + d - h + 0.5); g.lineTo(x + w, y + d - h + 0.5); g.stroke();
    // a little highlight along the top-left edges of the roof
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + 1, y - h + 1, w - 2, 2);
  }
  // Box with a pitched roof (ridge running left-right).
  gable(x, y, w, d, h, roof, wall, o = {}) {
    if (!o.noShadow) this.shadow(x, y, w, d, h + d * 0.3);
    const g = this.g, rh = d * 0.3, ov = Math.max(2, w * 0.04);
    this.rect(x, y + d - h, w, h, wall);
    // roof: back slope (lit) and front slope (shaded)
    const ry = y - h - rh, mid = ry + (d + rh) * 0.5;
    g.fillStyle = tint(roof, 0.18); g.fillRect(x - ov, ry, w + ov * 2, mid - ry);
    g.fillStyle = roof; g.fillRect(x - ov, mid, w + ov * 2, y + d - h - mid);
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1;
    g.strokeRect(x - ov + 0.5, ry + 0.5, w + ov * 2 - 1, y + d - h - ry - 1);
    g.strokeStyle = tint(roof, -0.4); g.beginPath(); g.moveTo(x - ov, mid); g.lineTo(x + w + ov, mid); g.stroke();
    // roof texture lines
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.beginPath();
    for (let i = x - ov + 4; i < x + w + ov; i += 5) { g.moveTo(i, ry + 1); g.lineTo(i, y + d - h - 1); }
    g.stroke();
  }
  // Round hut with a straw cone roof.
  hut(cx, cy, r, roof) {
    const g = this.g;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(cx + r * 0.4, cy + r * 0.3, r, r * 0.6, 0, 0, 7); g.fill();
    g.fillStyle = '#7a5a36'; g.fillRect(cx - r * 0.8, cy - r * 0.6, r * 1.6, r * 0.8);
    g.fillStyle = roof; g.beginPath(); g.arc(cx, cy - r * 0.6, r, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.arc(cx - r * 0.3, cy - r * 0.9, r * 0.45, 0, 7); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.beginPath(); g.arc(cx, cy - r * 0.6, r, 0, 7); g.stroke();
    g.fillStyle = '#2a1a0a'; g.fillRect(cx - r * 0.18, cy - r * 0.15, r * 0.36, r * 0.35);
  }
  // Windows on a wall. Lit at night.
  windows(x, y, w, h, cols, rows, o = {}) {
    const g = this.g, l = this.l;
    const cw = w / cols, rh = h / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const wx = x + c * cw + cw * 0.25, wy = y + r * rh + rh * 0.25, ww = cw * 0.5, wh = rh * 0.5;
      g.fillStyle = o.glass || '#1d2a36'; g.fillRect(wx, wy, ww, wh);
      g.fillStyle = 'rgba(160,200,255,0.25)'; g.fillRect(wx, wy, ww * 0.4, wh);
      if (hash2(x + c * 7, y + r * 13, 77) < (o.litChance ?? 0.75)) {
        l.fillStyle = hash2(c, r, (x * 31 + y) | 0) < 0.15 ? '#bfe6ff' : '#ffd36b';
        l.fillRect(wx, wy, ww, wh);
        this.anyLit = true;
      }
    }
  }
  flag(x, y, h, color) {
    const g = this.g;
    g.strokeStyle = '#3a3a3a'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - h); g.stroke();
    g.fillStyle = color || this.c;
    g.beginPath(); g.moveTo(x, y - h); g.quadraticCurveTo(x + h * 0.3, y - h * 0.95, x + h * 0.55, y - h + h * 0.08); g.lineTo(x + h * 0.55, y - h * 0.62); g.quadraticCurveTo(x + h * 0.3, y - h * 0.7, x, y - h * 0.66); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1; g.stroke();
  }
  chimney(x, y, w, h, c = '#7a3b2e') {
    this.box(x, y, w, w * 0.6, h, '#2b2b2b', c);
    this.rect(x, y - h, w, 3, '#555');
    this.smoke.push([x + w / 2, y - h]);
  }
  dome(cx, cy, r, c) {
    const g = this.g;
    const gr = g.createRadialGradient(cx - r * 0.4, cy - r * 0.5, r * 0.1, cx, cy, r);
    gr.addColorStop(0, tint(c, 0.5)); gr.addColorStop(1, tint(c, -0.3));
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, Math.PI, 0); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1; g.stroke();
  }
  cylinder(cx, cy, r, h, c) {
    const g = this.g;
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(cx + h * 0.4, cy, r, r * 0.5, 0, 0, 7); g.fill();
    const gr = g.createLinearGradient(cx - r, 0, cx + r, 0);
    gr.addColorStop(0, tint(c, 0.25)); gr.addColorStop(0.6, c); gr.addColorStop(1, tint(c, -0.4));
    g.fillStyle = gr; g.fillRect(cx - r, cy - h, r * 2, h);
    g.beginPath(); g.ellipse(cx, cy, r, r * 0.45, 0, 0, Math.PI); g.fill();
    g.fillStyle = tint(c, 0.15); g.beginPath(); g.ellipse(cx, cy - h, r, r * 0.45, 0, 0, 7); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1; g.stroke();
  }
  ground(c, inset = 0.04, round = false) {
    const g = this.g, i = this.W * inset;
    g.fillStyle = c;
    if (round) { g.beginPath(); g.ellipse(this.W / 2, this.Y(0.5), this.W / 2 - i, this.W / 2 - i, 0, 0, 7); g.fill(); }
    else { g.fillRect(i, this.top + i, this.W - i * 2, this.W - i * 2); }
  }
  stakes(x0, y0, x1, y1, c = '#6b4a2b') {
    // A wooden palisade around a rectangle.
    const g = this.g, step = 4;
    const post = (x, y) => { g.fillStyle = c; g.fillRect(x - 1.5, y - 7, 3, 7); g.fillStyle = tint(c, 0.3); g.fillRect(x - 1.5, y - 8, 3, 2); };
    for (let x = x0; x <= x1; x += step) post(x, y0);
    for (let y = y0 + step; y < y1; y += step) { post(x0, y); post(x1, y); }
    for (let x = x0; x <= x1; x += step) post(x, y1);
  }
  wall(x0, y0, x1, y1, c, h = 7) {
    const g = this.g, t = 4;
    const seg = (x, y, w, d) => this.box(x, y, w, d, h, tint(c, 0.15), tint(c, -0.15), { noShadow: true });
    seg(x0, y0, x1 - x0, t); seg(x0, y0, t, y1 - y0); seg(x1 - t, y0, t, y1 - y0); seg(x0, y1 - t, x1 - x0, t);
    // crenellations on the front wall
    g.fillStyle = tint(c, 0.25);
    for (let x = x0; x < x1; x += 6) g.fillRect(x, y1 - t - h - 3, 3, 3);
  }
  roundTower(cx, cy, r, h, c, roof) {
    this.cylinder(cx, cy, r, h, c);
    const g = this.g;
    if (roof) {
      g.fillStyle = roof; g.beginPath(); g.moveTo(cx - r - 2, cy - h); g.lineTo(cx, cy - h - r * 2.2); g.lineTo(cx + r + 2, cy - h); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.15)'; g.beginPath(); g.moveTo(cx - r - 2, cy - h); g.lineTo(cx, cy - h - r * 2.2); g.lineTo(cx - r * 0.2, cy - h); g.fill();
    } else {
      g.fillStyle = tint(c, 0.3);
      for (let i = -1; i <= 1; i++) g.fillRect(cx + i * r * 0.6 - 2, cy - h - 4, 4, 4);
    }
  }
  hazard(x, y, w, h) {
    const g = this.g;
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = '#f2c500'; g.fillRect(x, y, w, h);
    g.fillStyle = '#111';
    for (let i = -h; i < w + h; i += 8) { g.beginPath(); g.moveTo(x + i, y + h); g.lineTo(x + i + 4, y + h); g.lineTo(x + i + 4 + h, y); g.lineTo(x + i + h, y); g.fill(); }
    g.restore();
  }
}

const WOOD = '#8b5a2b', STRAW = '#c9a54a', STONE = '#a29c90', BRICK = '#9c4a3a', CONCRETE = '#a7abb0', DIRT = '#7d6a48', PAVE = '#6e6a63';

const DRAW = {
  city(d, age) {
    const W = d.W;
    if (age >= 3) d.ground(PAVE, 0.02);
    else d.ground(age >= 1 ? '#8a7d62' : DIRT, 0.05, age === 0);
    if (age >= 3) {
      // roads
      d.rect(0, d.Y(0.47), W, W * 0.06, '#3b3b3b'); d.rect(d.X(0.47), d.top, W * 0.06, W, '#3b3b3b');
      d.g.fillStyle = '#d9c25a';
      for (let i = 0; i < W; i += 10) { d.g.fillRect(i, d.Y(0.495), 5, 1); d.g.fillRect(d.X(0.495), d.top + i, 1, 5); }
    }
    if (age === 0) {
      d.stakes(d.X(0.08), d.Y(0.12), d.X(0.92), d.Y(0.94));
      for (const [fx, fy, r] of [[0.25, 0.32, 0.09], [0.75, 0.3, 0.085], [0.22, 0.78, 0.09], [0.78, 0.78, 0.085]]) d.hut(d.X(fx), d.Y(fy), W * r, STRAW);
      d.gable(d.X(0.36), d.Y(0.42), W * 0.3, W * 0.22, W * 0.1, d.c, WOOD);
      d.flag(d.X(0.5), d.Y(0.42) - W * 0.18, W * 0.18);
      d.smoke.push([d.X(0.25), d.Y(0.2)]);
    } else if (age <= 2) {
      d.wall(d.X(0.05), d.Y(0.08), d.X(0.95), d.Y(0.96), STONE, age === 2 ? 10 : 7);
      for (const [fx, fy] of [[0.24, 0.3], [0.72, 0.28], [0.25, 0.78], [0.75, 0.8]]) d.gable(d.X(fx) - W * 0.1, d.Y(fy) - W * 0.06, W * 0.2, W * 0.13, W * 0.07, '#b5533a', '#d8c9a8');
      if (age === 2) {
        d.box(d.X(0.36), d.Y(0.36), W * 0.28, W * 0.26, W * 0.3, tint(STONE, 0.1), STONE);
        d.roundTower(d.X(0.36), d.Y(0.62), W * 0.05, W * 0.32, STONE, d.c);
        d.roundTower(d.X(0.64), d.Y(0.62), W * 0.05, W * 0.32, STONE, d.c);
        d.windows(d.X(0.4), d.Y(0.62) - W * 0.22, W * 0.2, W * 0.15, 3, 2);
        d.flag(d.X(0.5), d.Y(0.36) - W * 0.3, W * 0.2);
      } else {
        d.gable(d.X(0.33), d.Y(0.4), W * 0.34, W * 0.24, W * 0.13, d.c, '#e2d6bc');
        d.windows(d.X(0.36), d.Y(0.64) - W * 0.12, W * 0.28, W * 0.08, 4, 1);
        d.flag(d.X(0.5), d.Y(0.4) - W * 0.2, W * 0.18);
      }
      for (const [fx, fy] of [[0.05, 0.08], [0.95, 0.08], [0.05, 0.96], [0.95, 0.96]]) d.roundTower(d.X(fx), d.Y(fy), W * 0.05, W * (age === 2 ? 0.16 : 0.12), STONE, age === 2 ? d.c : null);
    } else if (age === 3) {
      // Industrial town: brick blocks, a clock tower and factory chimneys.
      const blocks = [[0.08, 0.08, 0.34, 0.3, 0.22], [0.58, 0.08, 0.34, 0.3, 0.3], [0.08, 0.6, 0.34, 0.32, 0.26], [0.58, 0.6, 0.34, 0.32, 0.2]];
      for (const [fx, fy, fw, fd, fh] of blocks) {
        d.box(d.X(fx), d.Y(fy), W * fw, W * fd, W * fh, '#5d4037', BRICK);
        d.windows(d.X(fx), d.Y(fy + fd) - W * fh, W * fw, W * fh, 4, Math.max(2, Math.round(fh * 12)));
      }
      d.chimney(d.X(0.1), d.Y(0.12), W * 0.05, W * 0.45);
      d.box(d.X(0.42), d.Y(0.38), W * 0.16, W * 0.16, W * 0.55, d.c, '#c9bfae');
      d.g.fillStyle = '#f5f0e0'; d.g.beginPath(); d.g.arc(d.X(0.5), d.Y(0.54) - W * 0.42, W * 0.05, 0, 7); d.g.fill();
      d.g.strokeStyle = '#222'; d.g.beginPath(); d.g.moveTo(d.X(0.5), d.Y(0.54) - W * 0.42); d.g.lineTo(d.X(0.5), d.Y(0.54) - W * 0.46); d.g.lineTo(d.X(0.52), d.Y(0.54) - W * 0.42); d.g.stroke();
      d.flag(d.X(0.5), d.Y(0.38) - W * 0.55, W * 0.15);
    } else {
      // Atomic age: skyscrapers.
      const towers = [[0.07, 0.06, 0.26, 0.24, 0.55], [0.62, 0.05, 0.3, 0.26, 0.8], [0.08, 0.58, 0.28, 0.3, 0.42], [0.6, 0.6, 0.3, 0.3, 0.62], [0.36, 0.3, 0.28, 0.28, 0.98]];
      towers.sort((a, b) => a[1] + a[3] - (b[1] + b[3]));
      for (const [fx, fy, fw, fd, fh] of towers) {
        const main = fh > 0.9;
        d.box(d.X(fx), d.Y(fy), W * fw, W * fd, W * fh, main ? d.c : '#7d858c', main ? '#9fb4c4' : CONCRETE);
        d.windows(d.X(fx), d.Y(fy + fd) - W * fh, W * fw, W * fh, 4, Math.round(fh * 16), { glass: '#26394a', litChance: 0.6 });
        if (main) {
          d.g.strokeStyle = '#ddd'; d.g.lineWidth = 1.5;
          d.g.beginPath(); d.g.moveTo(d.X(0.5), d.Y(fy) - W * fh); d.g.lineTo(d.X(0.5), d.Y(fy) - W * fh - W * 0.2); d.g.stroke();
          d.l.fillStyle = '#ff3030'; d.l.beginPath(); d.l.arc(d.X(0.5), d.Y(fy) - W * fh - W * 0.2, 2.5, 0, 7); d.l.fill();
        } else d.rect(d.X(fx), d.Y(fy) - W * fh, W * fw, 3, d.c);
      }
    }
  },
  farm(d, age) {
    const W = d.W, g = d.g;
    d.ground('#6b5130', 0.03);
    // crop rows
    const crop = age >= 3 ? '#c8b03a' : '#7fa83a';
    for (let i = 0; i < 9; i++) {
      const y = d.Y(0.1 + i * 0.09);
      g.fillStyle = '#56401f'; g.fillRect(d.X(0.06), y + 2, W * 0.88, 2);
      g.fillStyle = i % 2 ? crop : tint(crop, 0.12);
      for (let x = d.X(0.07); x < d.X(0.93); x += 4) g.fillRect(x, y - 1 - hash2(x, i, 5) * 2, 3, 3);
    }
    // barn in the corner
    d.gable(d.X(0.06), d.Y(0.06), W * 0.34, W * 0.22, W * 0.14, d.c, '#a8322d');
    g.fillStyle = '#fff'; g.fillRect(d.X(0.18), d.Y(0.28) - W * 0.11, W * 0.1, W * 0.1);
    g.strokeStyle = '#a8322d'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(d.X(0.18), d.Y(0.28) - W * 0.11); g.lineTo(d.X(0.28), d.Y(0.28) - W * 0.01); g.moveTo(d.X(0.28), d.Y(0.28) - W * 0.11); g.lineTo(d.X(0.18), d.Y(0.28) - W * 0.01); g.stroke();
    if (age >= 2) d.cylinder(d.X(0.5), d.Y(0.24), W * 0.07, W * 0.32, '#c0c4c8');
    if (age >= 3) { // tractor
      d.rect(d.X(0.66), d.Y(0.7), W * 0.14, W * 0.08, '#2d8a3e');
      g.fillStyle = '#111'; g.beginPath(); g.arc(d.X(0.68), d.Y(0.79), 4, 0, 7); g.arc(d.X(0.79), d.Y(0.79), 3, 0, 7); g.fill();
    } else {
      // scarecrow
      g.strokeStyle = WOOD; g.lineWidth = 2;
      g.beginPath(); g.moveTo(d.X(0.72), d.Y(0.75)); g.lineTo(d.X(0.72), d.Y(0.55)); g.moveTo(d.X(0.64), d.Y(0.6)); g.lineTo(d.X(0.8), d.Y(0.6)); g.stroke();
      g.fillStyle = STRAW; g.beginPath(); g.arc(d.X(0.72), d.Y(0.53), 3.5, 0, 7); g.fill();
      g.fillStyle = '#222'; g.fillRect(d.X(0.69), d.Y(0.49), 7, 2);
    }
    // fence
    g.strokeStyle = '#a07a4a'; g.lineWidth = 1;
    g.strokeRect(d.X(0.03) + 0.5, d.top + W * 0.03 + 0.5, W * 0.94, W * 0.94);
  },
  lumber(d, age) {
    const W = d.W, g = d.g;
    d.ground('#6d5b3c', 0.06, true);
    // sawdust
    g.fillStyle = '#c9a86b';
    for (let i = 0; i < 40; i++) g.fillRect(d.X(0.2 + hash2(i, 1, 3) * 0.6), d.Y(0.5 + hash2(i, 2, 3) * 0.4), 2, 2);
    if (age >= 2) {
      d.gable(d.X(0.1), d.Y(0.12), W * 0.55, W * 0.32, W * 0.18, d.c, '#8d6e4a');
      // saw blade
      g.fillStyle = '#ccc'; g.beginPath(); g.arc(d.X(0.78), d.Y(0.3), W * 0.09, 0, 7); g.fill();
      g.strokeStyle = '#555'; g.stroke();
      d.chimney(d.X(0.55), d.Y(0.14), W * 0.06, W * 0.38, '#555');
    } else {
      d.gable(d.X(0.1), d.Y(0.1), W * 0.45, W * 0.3, W * 0.15, d.c, WOOD);
      // log wall texture
      g.strokeStyle = 'rgba(0,0,0,0.3)';
      for (let y = d.Y(0.4) - W * 0.15; y < d.Y(0.4); y += 3) { g.beginPath(); g.moveTo(d.X(0.1), y); g.lineTo(d.X(0.55), y); g.stroke(); }
    }
    // log pile
    for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++) {
      const cx = d.X(0.55 + i * 0.08 + row * 0.04), cy = d.Y(0.82) - row * W * 0.07;
      g.fillStyle = '#7a4f28'; g.fillRect(cx - W * 0.2, cy - W * 0.035, W * 0.2, W * 0.07);
      g.fillStyle = '#d7a86e'; g.beginPath(); g.arc(cx, cy, W * 0.036, 0, 7); g.fill();
      g.strokeStyle = '#8a5a30'; g.beginPath(); g.arc(cx, cy, W * 0.018, 0, 7); g.stroke();
    }
    // stump with axe
    g.fillStyle = '#6b4423'; g.beginPath(); g.ellipse(d.X(0.25), d.Y(0.75), W * 0.06, W * 0.035, 0, 0, 7); g.fill();
    g.fillStyle = '#c99a5c'; g.beginPath(); g.ellipse(d.X(0.25), d.Y(0.73), W * 0.06, W * 0.03, 0, 0, 7); g.fill();
    g.strokeStyle = '#5a3a1a'; g.lineWidth = 2; g.beginPath(); g.moveTo(d.X(0.25), d.Y(0.73)); g.lineTo(d.X(0.31), d.Y(0.64)); g.stroke();
    g.fillStyle = '#bbb'; g.fillRect(d.X(0.23), d.Y(0.71), 5, 4);
  },
  mine(d, age) {
    const W = d.W, g = d.g;
    // rocky mound
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(d.X(0.55), d.Y(0.6), W * 0.45, W * 0.32, 0, 0, 7); g.fill();
    g.fillStyle = '#6f6a62';
    g.beginPath(); g.moveTo(d.X(0.05), d.Y(0.8)); g.lineTo(d.X(0.2), d.Y(0.25)); g.lineTo(d.X(0.45), d.Y(0.05)); g.lineTo(d.X(0.7), d.Y(0.2)); g.lineTo(d.X(0.95), d.Y(0.75)); g.closePath(); g.fill();
    g.fillStyle = '#8c867c';
    g.beginPath(); g.moveTo(d.X(0.2), d.Y(0.25)); g.lineTo(d.X(0.45), d.Y(0.05)); g.lineTo(d.X(0.5), d.Y(0.5)); g.lineTo(d.X(0.15), d.Y(0.6)); g.closePath(); g.fill();
    // metal glints
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#d6dde4' : '#9aa3ad'; g.fillRect(d.X(0.15 + hash2(i, 4, 9) * 0.7), d.Y(0.15 + hash2(i, 5, 9) * 0.55), 3, 3); }
    // tunnel entrance
    g.fillStyle = '#5a3a1e'; g.fillRect(d.X(0.36), d.Y(0.48), W * 0.28, W * 0.3);
    g.fillStyle = '#0b0b0b'; g.beginPath(); g.moveTo(d.X(0.4), d.Y(0.78)); g.lineTo(d.X(0.4), d.Y(0.58)); g.arc(d.X(0.5), d.Y(0.58), W * 0.1, Math.PI, 0); g.lineTo(d.X(0.6), d.Y(0.78)); g.fill();
    // rails and cart
    g.strokeStyle = '#555'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(d.X(0.45), d.Y(0.78)); g.lineTo(d.X(0.42), d.Y(0.98)); g.moveTo(d.X(0.55), d.Y(0.78)); g.lineTo(d.X(0.58), d.Y(0.98)); g.stroke();
    d.box(d.X(0.43), d.Y(0.84), W * 0.14, W * 0.08, W * 0.06, '#444', '#666', { noShadow: true });
    g.fillStyle = '#b0b8c0'; g.fillRect(d.X(0.44), d.Y(0.84) - W * 0.08, W * 0.12, 3);
    if (age >= 3) {
      // steel headframe
      g.strokeStyle = '#333'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(d.X(0.7), d.Y(0.6)); g.lineTo(d.X(0.78), d.Y(0.6) - W * 0.6); g.lineTo(d.X(0.86), d.Y(0.6)); g.stroke();
      g.fillStyle = '#222'; g.beginPath(); g.arc(d.X(0.78), d.Y(0.6) - W * 0.6, 4, 0, 7); g.fill();
    }
    d.flag(d.X(0.45), d.Y(0.06), W * 0.22);
  },
  oilwell(d) {
    const W = d.W, g = d.g;
    d.ground('#4a4a4a', 0.05);
    g.fillStyle = '#111'; g.beginPath(); g.ellipse(d.X(0.3), d.Y(0.75), W * 0.14, W * 0.08, 0, 0, 7); g.fill();
    d.cylinder(d.X(0.78), d.Y(0.8), W * 0.13, W * 0.28, d.c);
    d.rect(d.X(0.7), d.Y(0.8) - W * 0.17, W * 0.16, 2, '#fff');
    // pumpjack frame (the rocking beam is drawn by the renderer)
    g.strokeStyle = '#333'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(d.X(0.35), d.Y(0.65)); g.lineTo(d.X(0.48), d.Y(0.65) - W * 0.4); g.lineTo(d.X(0.6), d.Y(0.65)); g.stroke();
    d.rect(d.X(0.15), d.Y(0.65), W * 0.6, 4, '#444');
    d.pump = [0.48, (d.Y(0.65) - W * 0.4 - d.top) / W];
  },
  barracks(d, age) {
    const W = d.W, g = d.g;
    d.ground(age >= 3 ? '#6b6b4a' : '#8a7a58', 0.04);
    if (age >= 3) {
      // quonset hut
      const x = d.X(0.08), y = d.Y(0.12), w = W * 0.84, dd = W * 0.42;
      d.shadow(x, y, w, dd, W * 0.2);
      const gr = g.createLinearGradient(0, y - W * 0.2, 0, y + dd);
      gr.addColorStop(0, '#8a9468'); gr.addColorStop(1, '#4b5320');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x + w / 2, y + dd * 0.5, w / 2, dd * 0.75, 0, Math.PI, 0); g.lineTo(x + w, y + dd); g.lineTo(x, y + dd); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo(x + (w * i) / 8, y - dd * 0.2); g.lineTo(x + (w * i) / 8, y + dd); g.stroke(); }
      d.rect(x, y + dd - 6, w, 4, d.c);
      // sandbags
      g.fillStyle = '#b8a77a';
      for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(d.X(0.12 + i * 0.09), d.Y(0.9), 5, 3, 0, 0, 7); g.fill(); }
    } else {
      d.gable(d.X(0.06), d.Y(0.1), W * 0.88, W * 0.3, W * 0.15, d.c, age >= 1 ? '#cfc2a6' : WOOD);
      d.windows(d.X(0.1), d.Y(0.4) - W * 0.12, W * 0.8, W * 0.08, 6, 1, { litChance: 0.5 });
      // training dummies
      for (let i = 0; i < 3; i++) {
        const x = d.X(0.25 + i * 0.22), y = d.Y(0.82);
        g.strokeStyle = WOOD; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 12); g.moveTo(x - 6, y - 9); g.lineTo(x + 6, y - 9); g.stroke();
        g.fillStyle = STRAW; g.beginPath(); g.arc(x, y - 14, 3.5, 0, 7); g.fill();
      }
    }
    d.flag(d.X(0.9), d.Y(0.6), W * 0.4);
  },
  stable(d, age) {
    const W = d.W, g = d.g;
    d.ground(age >= 3 ? PAVE : '#7e7048', 0.04);
    if (age >= 3) factory(d, true);
    else {
      d.gable(d.X(0.06), d.Y(0.08), W * 0.6, W * 0.36, W * 0.15, d.c, WOOD);
      // stable doors
      for (let i = 0; i < 3; i++) { g.fillStyle = '#3a2410'; g.fillRect(d.X(0.1 + i * 0.18), d.Y(0.44) - W * 0.11, W * 0.12, W * 0.11); }
      // hay bales
      for (const [fx, fy] of [[0.78, 0.2], [0.86, 0.32], [0.74, 0.34]]) {
        g.fillStyle = '#d9b44a'; g.beginPath(); g.arc(d.X(fx), d.Y(fy), W * 0.06, 0, 7); g.fill();
        g.strokeStyle = '#a07e22'; g.beginPath(); g.arc(d.X(fx), d.Y(fy), W * 0.035, 0, 7); g.stroke();
      }
      // paddock fence
      g.strokeStyle = '#c8a878'; g.lineWidth = 1.5;
      g.strokeRect(d.X(0.1), d.Y(0.58), W * 0.8, W * 0.35);
      g.beginPath(); g.moveTo(d.X(0.1), d.Y(0.75)); g.lineTo(d.X(0.9), d.Y(0.75)); g.stroke();
      d.rect(d.X(0.6), d.Y(0.82), W * 0.18, W * 0.06, '#5a7fa8');
    }
  },
  workshop(d, age) {
    const W = d.W, g = d.g;
    d.ground(age >= 2 ? PAVE : '#7a6a4a', 0.04);
    if (age >= 3) { factory(d, false); return; }
    if (age === 2) {
      d.box(d.X(0.08), d.Y(0.12), W * 0.6, W * 0.4, W * 0.22, '#4b3b33', BRICK);
      d.chimney(d.X(0.55), d.Y(0.12), W * 0.08, W * 0.5);
      d.l.fillStyle = 'rgba(255,140,40,0.9)'; d.l.fillRect(d.X(0.2), d.Y(0.52) - W * 0.12, W * 0.2, W * 0.1); d.anyLit = true;
      g.fillStyle = '#2a1a10'; g.fillRect(d.X(0.2), d.Y(0.52) - W * 0.12, W * 0.2, W * 0.1);
    } else {
      d.gable(d.X(0.06), d.Y(0.1), W * 0.55, W * 0.35, W * 0.14, d.c, WOOD);
    }
    // gear sign
    g.fillStyle = '#888';
    const cx = d.X(0.8), cy = d.Y(0.25), r = W * 0.09;
    g.beginPath(); for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, rr = i % 2 ? r : r * 0.75; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.fill();
    g.fillStyle = '#444'; g.beginPath(); g.arc(cx, cy, r * 0.35, 0, 7); g.fill();
    // half-built catapult
    g.strokeStyle = '#6b4423'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(d.X(0.2), d.Y(0.85)); g.lineTo(d.X(0.55), d.Y(0.85)); g.moveTo(d.X(0.3), d.Y(0.85)); g.lineTo(d.X(0.5), d.Y(0.62)); g.stroke();
    g.fillStyle = '#333'; g.beginPath(); g.arc(d.X(0.24), d.Y(0.88), 3.5, 0, 7); g.arc(d.X(0.5), d.Y(0.88), 3.5, 0, 7); g.fill();
  },
  library(d, age) {
    const W = d.W, g = d.g;
    d.ground(age >= 3 ? '#8d8a80' : '#b8ad92', 0.04);
    if (age <= 2) {
      // classical temple
      d.box(d.X(0.08), d.Y(0.1), W * 0.84, W * 0.55, W * 0.08, '#e8e0cc', '#cfc4a8');
      d.gable(d.X(0.14), d.Y(0.12), W * 0.72, W * 0.42, W * 0.22, d.c, '#ece5d2', { noShadow: true });
      g.fillStyle = '#f4efe2';
      for (let i = 0; i < 6; i++) g.fillRect(d.X(0.17 + i * 0.125), d.Y(0.54) - W * 0.22, W * 0.05, W * 0.22);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (let i = 0; i < 6; i++) g.fillRect(d.X(0.205 + i * 0.125), d.Y(0.54) - W * 0.22, W * 0.015, W * 0.22);
      d.l.fillStyle = 'rgba(255,210,110,0.8)'; d.l.fillRect(d.X(0.2), d.Y(0.54) - W * 0.16, W * 0.6, W * 0.12); d.anyLit = true;
      // scrolls
      for (let i = 0; i < 4; i++) { g.fillStyle = '#efe3c0'; g.fillRect(d.X(0.2 + i * 0.16), d.Y(0.8), W * 0.1, W * 0.04); }
    } else {
      d.box(d.X(0.06), d.Y(0.2), W * 0.88, W * 0.5, W * 0.25, age === 4 ? '#e8eef2' : '#6b4a3a', age === 4 ? '#f2f5f7' : BRICK);
      d.windows(d.X(0.06), d.Y(0.7) - W * 0.25, W * 0.88, W * 0.25, 7, 3, { litChance: 0.85 });
      d.dome(d.X(0.5), d.Y(0.25) - W * 0.25, W * 0.18, age === 4 ? '#dfe6ea' : d.c);
      if (age === 4) {
        // satellite dish
        g.fillStyle = '#ddd'; g.beginPath(); g.ellipse(d.X(0.82), d.Y(0.25) - W * 0.32, W * 0.08, W * 0.05, -0.6, 0, 7); g.fill();
        g.strokeStyle = '#888'; g.beginPath(); g.moveTo(d.X(0.82), d.Y(0.25) - W * 0.32); g.lineTo(d.X(0.82), d.Y(0.25) - W * 0.25); g.stroke();
        d.rect(d.X(0.06), d.Y(0.2) - W * 0.25, W * 0.88, 3, d.c);
      }
    }
  },
  tower(d, age) {
    const W = d.W, g = d.g;
    if (age >= 3) {
      // concrete bunker with sandbags
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(d.X(0.56), d.Y(0.6), W * 0.45, W * 0.32, 0, 0, 7); g.fill();
      g.fillStyle = '#8b8f86'; g.beginPath(); g.ellipse(d.X(0.5), d.Y(0.55), W * 0.42, W * 0.36, 0, 0, 7); g.fill();
      g.fillStyle = '#a3a79c'; g.beginPath(); g.ellipse(d.X(0.5), d.Y(0.45), W * 0.36, W * 0.28, 0, 0, 7); g.fill();
      g.fillStyle = '#111'; g.fillRect(d.X(0.3), d.Y(0.58), W * 0.4, 3);
      d.rect(d.X(0.3), d.Y(0.32), W * 0.4, 3, d.c);
      g.fillStyle = '#b8a77a';
      for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(d.X(0.1 + i * 0.16), d.Y(0.88), 4.5, 3, 0, 0, 7); g.fill(); }
      return;
    }
    if (age === 0) {
      // wooden watchtower
      g.strokeStyle = WOOD; g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(d.X(0.25), d.Y(0.9)); g.lineTo(d.X(0.3), d.Y(0.9) - W * 0.7);
      g.moveTo(d.X(0.75), d.Y(0.9)); g.lineTo(d.X(0.7), d.Y(0.9) - W * 0.7);
      g.moveTo(d.X(0.25), d.Y(0.9)); g.lineTo(d.X(0.7), d.Y(0.9) - W * 0.4);
      g.moveTo(d.X(0.75), d.Y(0.9)); g.lineTo(d.X(0.3), d.Y(0.9) - W * 0.4);
      g.stroke();
      d.box(d.X(0.18), d.Y(0.18) - W * 0.0, W * 0.64, W * 0.3, W * 0.12, '#a07040', WOOD, { noShadow: true });
      g.fillStyle = d.c; g.beginPath(); g.moveTo(d.X(0.12), d.Y(0.18) - W * 0.12); g.lineTo(d.X(0.5), d.Y(0.18) - W * 0.45); g.lineTo(d.X(0.88), d.Y(0.18) - W * 0.12); g.closePath(); g.fill();
      return;
    }
    d.roundTower(d.X(0.5), d.Y(0.75), W * 0.3, W * 0.85, STONE, age === 2 ? d.c : null);
    d.windows(d.X(0.42), d.Y(0.75) - W * 0.6, W * 0.16, W * 0.3, 1, 2, { litChance: 1 });
    if (age === 1) d.flag(d.X(0.5), d.Y(0.75) - W * 0.88, W * 0.4);
  },
  silo(d) {
    const W = d.W, g = d.g;
    d.ground('#8a8d90', 0.02);
    d.hazard(d.X(0.02), d.Y(0.02), W * 0.96, W * 0.06);
    d.hazard(d.X(0.02), d.Y(0.92), W * 0.96, W * 0.06);
    // hatch
    g.fillStyle = '#5a5e62'; g.beginPath(); g.arc(d.X(0.5), d.Y(0.5), W * 0.32, 0, 7); g.fill();
    g.fillStyle = '#c9cdd1'; g.beginPath(); g.arc(d.X(0.5), d.Y(0.48), W * 0.29, 0, 7); g.fill();
    g.strokeStyle = '#333'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(d.X(0.21), d.Y(0.48)); g.lineTo(d.X(0.79), d.Y(0.48)); g.stroke();
    // radiation symbol
    const cx = d.X(0.5), cy = d.Y(0.48), r = W * 0.2;
    g.fillStyle = '#f2c500'; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
    g.fillStyle = '#111';
    for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + (i * Math.PI * 2) / 3; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, r * 0.9, a - 0.5, a + 0.5); g.closePath(); g.fill(); }
    g.fillStyle = '#f2c500'; g.beginPath(); g.arc(cx, cy, r * 0.25, 0, 7); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(cx, cy, r * 0.15, 0, 7); g.fill();
    d.rect(d.X(0.02), d.Y(0.08), W * 0.06, W * 0.84, d.c);
    d.rect(d.X(0.92), d.Y(0.08), W * 0.06, W * 0.84, d.c);
    d.l.fillStyle = '#ff3030'; d.l.beginPath(); d.l.arc(d.X(0.12), d.Y(0.15), 3, 0, 7); d.l.arc(d.X(0.88), d.Y(0.15), 3, 0, 7); d.l.fill(); d.anyLit = true;
  },
  market(d, age) {
    const W = d.W, g = d.g;
    d.ground(PAVE, 0.04);
    if (age >= 2) {
      // A bank with columns.
      const x = d.X(0.1), y = d.Y(0.16), w = W * 0.8, dd = W * 0.46, h = W * 0.3;
      d.box(x, y, w, dd, h, '#c9c2b2', '#dbd5c7');
      for (let i = 0; i < 6; i++) d.rect(x + w * (0.04 + i * 0.165), y + dd - h, w * 0.07, h, '#f3efe6');
      g.fillStyle = '#efe9db'; g.beginPath(); g.moveTo(x - 3, y + dd - h); g.lineTo(x + w / 2, y + dd - h - W * 0.16); g.lineTo(x + w + 3, y + dd - h); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1; g.stroke();
      g.fillStyle = '#e8b923'; g.font = `bold ${Math.round(W * 0.13)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('$', x + w / 2, y + dd - h - W * 0.06);
      d.rect(d.X(0.1), d.Y(0.66), W * 0.8, W * 0.03, d.c);
    } else {
      // Market stalls with striped awnings.
      for (const [fx, fy] of [[0.08, 0.14], [0.54, 0.14], [0.3, 0.56]]) {
        const x = d.X(fx), y = d.Y(fy), w = W * 0.38, h = W * 0.2;
        d.rect(x, y + h * 0.5, w, h * 0.7, '#7a5a36');
        g.fillStyle = '#c9a54a'; g.fillRect(x + 2, y + h * 0.65, w - 4, h * 0.22);
        for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? '#f4f1ea' : d.c; g.fillRect(x + (w * i) / 5 - 1, y, w / 5 + 1, h * 0.55); }
        g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1; g.strokeRect(x - 1, y, w + 1, h * 0.55);
        for (let i = 0; i < 4; i++) { g.fillStyle = ['#e74c3c', '#f1c40f', '#2ecc71', '#e67e22'][i]; g.beginPath(); g.arc(x + w * (0.2 + i * 0.2), y + h * 0.72, 2.2, 0, 7); g.fill(); }
      }
    }
  },
  // ----- Wonders. Big, and meant to be looked at. -----
  pyramids(d) {
    const W = d.W, g = d.g;
    d.ground('#cdb37a', 0.01);
    const small = (cx, base, size) => {
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.moveTo(cx - size, base); g.lineTo(cx + size * 1.5, base + size * 0.15); g.lineTo(cx, base - size * 0.9); g.fill();
      g.fillStyle = '#d9c084'; g.beginPath(); g.moveTo(cx - size, base); g.lineTo(cx, base - size * 1.1); g.lineTo(cx, base + size * 0.1); g.closePath(); g.fill();
      g.fillStyle = '#b39a5e'; g.beginPath(); g.moveTo(cx + size, base); g.lineTo(cx, base - size * 1.1); g.lineTo(cx, base + size * 0.1); g.closePath(); g.fill();
    };
    small(d.X(0.84), d.Y(0.48), W * 0.13);
    const cx = d.X(0.47), base = d.Y(0.9), hw = W * 0.45, h = W * 0.78;
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.beginPath(); g.moveTo(cx, base + 3); g.lineTo(cx + hw + W * 0.1, base - W * 0.04); g.lineTo(cx, base - h); g.fill();
    const steps = 13;
    for (let i = 0; i < steps; i++) {
      const y0 = base - (h * i) / steps, y1 = base - (h * (i + 1)) / steps;
      const w0 = hw * (1 - i / steps), w1 = hw * (1 - (i + 1) / steps);
      g.fillStyle = i % 2 ? '#e3cc90' : '#dcc488'; g.beginPath(); g.moveTo(cx - w0, y0); g.lineTo(cx - w1, y1); g.lineTo(cx + W * 0.08 * (1 - i / steps), y1); g.lineTo(cx + W * 0.08 * (1 - i / steps), y0); g.closePath(); g.fill();
      g.fillStyle = i % 2 ? '#b0975c' : '#a78e54'; g.beginPath(); g.moveTo(cx + W * 0.08 * (1 - i / steps), y0); g.lineTo(cx + W * 0.08 * (1 - i / steps), y1); g.lineTo(cx + w1, y1); g.lineTo(cx + w0, y0); g.closePath(); g.fill();
    }
    // golden tip in the player's colour
    g.fillStyle = '#ffd24a'; g.beginPath(); g.moveTo(cx - hw * 0.12, base - h * 0.88); g.lineTo(cx, base - h); g.lineTo(cx + hw * 0.12, base - h * 0.88); g.closePath(); g.fill();
    d.flag(d.X(0.1), d.Y(0.95), W * 0.26);
    d.l.fillStyle = 'rgba(255,210,74,0.9)'; d.l.beginPath(); d.l.arc(cx, base - h - 2, 5, 0, 7); d.l.fill(); d.anyLit = true;
  },
  colosseum(d) {
    const W = d.W, g = d.g;
    d.ground('#9c9483', 0.01);
    const cx = d.X(0.5), cy = d.Y(0.55), rx = W * 0.46, ry = W * 0.34, h = W * 0.36;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(cx + W * 0.04, cy + W * 0.02, rx + 2, ry + 2, 0, 0, 7); g.fill();
    // far wall
    g.fillStyle = '#b5a98f'; g.beginPath(); g.ellipse(cx, cy - h, rx, ry, 0, 0, 7); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1; g.stroke();
    // inside: seats and sand
    g.fillStyle = '#8f8570'; g.beginPath(); g.ellipse(cx, cy - h * 0.9, rx * 0.86, ry * 0.84, 0, 0, 7); g.fill();
    g.fillStyle = '#a09580'; g.beginPath(); g.ellipse(cx, cy - h * 0.72, rx * 0.72, ry * 0.68, 0, 0, 7); g.fill();
    g.fillStyle = '#d9c084'; g.beginPath(); g.ellipse(cx, cy - h * 0.55, rx * 0.54, ry * 0.5, 0, 0, 7); g.fill();
    g.fillStyle = d.c; g.beginPath(); g.ellipse(cx, cy - h * 0.55, rx * 0.12, ry * 0.11, 0, 0, 7); g.fill();
    // near wall with three rows of arches
    g.save(); g.beginPath(); g.moveTo(cx - rx, cy - h); g.ellipse(cx, cy - h, rx, ry, 0, Math.PI, 0, true); g.lineTo(cx + rx, cy); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI); g.closePath(); g.clip();
    const wall = g.createLinearGradient(cx - rx, 0, cx + rx, 0);
    wall.addColorStop(0, '#d4c8ad'); wall.addColorStop(0.55, '#c4b89c'); wall.addColorStop(1, '#8b8069');
    g.fillStyle = wall; g.fillRect(cx - rx, cy - h, rx * 2, h + ry + 2);
    for (let row = 0; row < 3; row++) {
      const n = 13;
      for (let i = 0; i < n; i++) {
        const a = Math.PI - ((i + 0.5) / n) * Math.PI;
        const ax = cx + Math.cos(a) * rx * 0.98, ay = cy + Math.sin(a) * ry - h * (0.08 + row * 0.31);
        const aw = Math.max(1.5, Math.sin(a) * rx * 0.075);
        g.fillStyle = '#332b20'; g.beginPath(); g.moveTo(ax - aw, ay + h * 0.09); g.lineTo(ax - aw, ay); g.arc(ax, ay, aw, Math.PI, 0); g.lineTo(ax + aw, ay + h * 0.09); g.closePath(); g.fill();
        if (hash2(i, row, 3) < 0.6) { d.l.fillStyle = '#ffb04a'; d.l.fillRect(ax - aw * 0.6, ay, aw * 1.2, h * 0.08); d.anyLit = true; }
      }
    }
    g.restore();
    d.flag(cx - rx * 0.55, cy - h * 1.2, W * 0.2);
    d.flag(cx + rx * 0.55, cy - h * 1.2, W * 0.2);
  },
  terracotta(d) {
    const W = d.W, g = d.g;
    d.ground('#8a6f4d', 0.01);
    // a long dug-out pit
    const x = d.X(0.06), y = d.Y(0.1), w = W * 0.88, dd = W * 0.8;
    g.fillStyle = '#5b4631'; g.fillRect(x, y, w, dd);
    g.strokeStyle = '#3d2f20'; g.lineWidth = 2; g.strokeRect(x, y, w, dd);
    g.fillStyle = '#6e5539'; g.fillRect(x + 2, y + 2, w - 4, W * 0.04);
    // rows of soldiers, back to front
    for (let row = 0; row < 7; row++) {
      for (let c = 0; c < 9; c++) {
        const px = x + w * (0.08 + c * 0.105), py = y + dd * (0.14 + row * 0.125);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(px + 2, py + 1, 4.5, 2, 0, 0, 7); g.fill();
        g.fillStyle = '#b5764a'; g.fillRect(px - 3.5, py - 11, 7, 12);
        g.fillStyle = '#8f5a36'; g.fillRect(px + 1, py - 11, 2.5, 12); g.fillRect(px - 3.5, py - 5, 7, 1.2);
        g.fillStyle = '#c98a5c'; g.beginPath(); g.arc(px, py - 13.5, 3, 0, 7); g.fill();
        g.fillStyle = '#6e4228'; g.fillRect(px - 2.5, py - 16.5, 5, 2);
      }
    }
    // the general on a plinth, in the player's colour
    const gx = d.X(0.5), gy = d.Y(0.97);
    d.box(gx - W * 0.09, gy - W * 0.12, W * 0.18, W * 0.1, W * 0.05, '#a29c90', '#7f796e');
    g.fillStyle = d.c; g.fillRect(gx - 7, gy - W * 0.27, 14, W * 0.13);
    g.fillStyle = '#d9a77c'; g.beginPath(); g.arc(gx, gy - W * 0.29, 6, 0, 7); g.fill();
    d.l.fillStyle = '#ffb04a'; d.l.fillRect(x, y, 4, 4); d.l.fillRect(x + w - 4, y, 4, 4); d.l.fillRect(x, y + dd - 4, 4, 4); d.l.fillRect(x + w - 4, y + dd - 4, 4, 4); d.anyLit = true;
  },
  goldencow(d) {
    const W = d.W, g = d.g;
    d.ground('#7d8a5c', 0.01);
    // round plaza with a pattern in the player's colour
    g.fillStyle = '#b9b2a2'; g.beginPath(); g.ellipse(d.X(0.5), d.Y(0.62), W * 0.47, W * 0.35, 0, 0, 7); g.fill();
    g.strokeStyle = d.c; g.lineWidth = 3; g.beginPath(); g.ellipse(d.X(0.5), d.Y(0.62), W * 0.42, W * 0.3, 0, 0, 7); g.stroke();
    // plinth
    d.box(d.X(0.26), d.Y(0.5), W * 0.48, W * 0.26, W * 0.13, '#e2dccb', '#b9b2a2');
    d.rect(d.X(0.26), d.Y(0.74), W * 0.48, W * 0.025, d.c);
    const ox = d.X(0.5), oy = d.Y(0.5) - W * 0.13;
    const gold = g.createLinearGradient(ox - W * 0.3, oy - W * 0.5, ox + W * 0.3, oy);
    gold.addColorStop(0, '#fff2a8'); gold.addColorStop(0.45, '#f6c830'); gold.addColorStop(1, '#a8741a');
    g.fillStyle = gold;
    // legs
    for (const lx of [-0.2, -0.1, 0.1, 0.2]) g.fillRect(ox + W * lx - W * 0.03, oy - W * 0.17, W * 0.055, W * 0.17);
    // body, neck and head
    g.beginPath(); g.ellipse(ox, oy - W * 0.24, W * 0.27, W * 0.12, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(ox - W * 0.2, oy - W * 0.3); g.lineTo(ox - W * 0.33, oy - W * 0.4); g.lineTo(ox - W * 0.28, oy - W * 0.2); g.closePath(); g.fill();
    g.beginPath(); g.ellipse(ox - W * 0.36, oy - W * 0.39, W * 0.085, W * 0.065, -0.3, 0, 7); g.fill();
    // horns, ear, tail
    g.strokeStyle = '#fff2a8'; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(ox - W * 0.36, oy - W * 0.44); g.quadraticCurveTo(ox - W * 0.4, oy - W * 0.52, ox - W * 0.34, oy - W * 0.54); g.moveTo(ox - W * 0.31, oy - W * 0.43); g.quadraticCurveTo(ox - W * 0.28, oy - W * 0.5, ox - W * 0.23, oy - W * 0.5); g.stroke();
    g.strokeStyle = '#c8921e'; g.beginPath(); g.moveTo(ox + W * 0.26, oy - W * 0.28); g.quadraticCurveTo(ox + W * 0.35, oy - W * 0.24, ox + W * 0.32, oy - W * 0.11); g.stroke(); g.lineCap = 'butt';
    g.fillStyle = '#6b4a10'; g.beginPath(); g.arc(ox - W * 0.385, oy - W * 0.405, 2.2, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(ox - W * 0.06, oy - W * 0.31, W * 0.13, W * 0.028, -0.08, 0, 7); g.fill();
    // glow at night
    const gl = d.l.createRadialGradient(ox, oy - W * 0.25, 2, ox, oy - W * 0.25, W * 0.42);
    gl.addColorStop(0, 'rgba(255,215,90,0.75)'); gl.addColorStop(1, 'rgba(255,215,90,0)');
    d.l.fillStyle = gl; d.l.fillRect(ox - W * 0.5, oy - W * 0.7, W, W * 0.9); d.anyLit = true;
    // sparkles
    g.fillStyle = '#fffbd0';
    for (let i = 0; i < 8; i++) { const sx = ox + (hash2(i, 1, 5) - 0.5) * W * 0.8, sy = oy - hash2(i, 2, 5) * W * 0.55; g.fillRect(sx - 0.5, sy - 3, 1, 6); g.fillRect(sx - 3, sy - 0.5, 6, 1); }
  },
  radio(d) {
    const W = d.W, g = d.g, H = d.top + W;
    d.ground('#70786a', 0.01);
    const cx = d.X(0.5), base = d.Y(0.82), top = 8;
    const ht = base - top, hw = W * 0.34;
    const halfAt = (t) => hw * (1 - t) * (1 - t) + 2; // curved like the Eiffel Tower
    // shadow
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.moveTo(cx - hw, base); g.lineTo(cx + hw * 2.1, base - W * 0.07); g.lineTo(cx + hw, base); g.fill();
    g.lineCap = 'round';
    // legs
    g.strokeStyle = '#59616a'; g.lineWidth = 3.5;
    for (const side of [-1, 1]) {
      g.beginPath();
      for (let i = 0; i <= 24; i++) { const t = i / 24, x = cx + side * halfAt(t), y = base - t * ht; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
    // lattice
    g.strokeStyle = '#7d858e'; g.lineWidth = 1.2;
    for (let i = 0; i < 20; i++) {
      const t0 = i / 20, t1 = (i + 1) / 20;
      const y0 = base - t0 * ht, y1 = base - t1 * ht, a = halfAt(t0), b = halfAt(t1);
      g.beginPath(); g.moveTo(cx - a, y0); g.lineTo(cx + b, y1); g.moveTo(cx + a, y0); g.lineTo(cx - b, y1); g.moveTo(cx - b, y1); g.lineTo(cx + b, y1); g.stroke();
    }
    // platforms in the player's colour
    for (const t of [0.14, 0.36, 0.62]) { const y = base - t * ht, a = halfAt(t) + 6; d.rect(cx - a, y - 3, a * 2, 5, d.c); g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.strokeRect(cx - a, y - 3, a * 2, 5); }
    // big arch at the bottom
    g.strokeStyle = '#59616a'; g.lineWidth = 3; g.beginPath(); g.arc(cx, base + 2, hw * 0.55, Math.PI, 0); g.stroke();
    // dishes and mast
    for (const [t, side] of [[0.5, -1], [0.3, 1]]) {
      const y = base - t * ht, x = cx + side * (halfAt(t) + 9);
      g.fillStyle = '#e8ecef'; g.beginPath(); g.ellipse(x, y, 5, 9, side * 0.3, 0, 7); g.fill(); g.strokeStyle = '#59616a'; g.lineWidth = 1; g.stroke();
    }
    g.strokeStyle = '#c9ced3'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, base - ht * 0.8); g.lineTo(cx, top - 4); g.stroke();
    g.lineCap = 'butt';
    d.l.fillStyle = '#ff4040';
    for (const t of [0.14, 0.36, 0.62, 0.99]) { const y = base - t * ht, a = halfAt(t) + 4; d.l.beginPath(); d.l.arc(cx - a, y, 2.5, 0, 7); d.l.arc(cx + a, y, 2.5, 0, 7); d.l.fill(); }
    d.anyLit = true;
    void H;
  },
  laser(d) {
    const W = d.W, g = d.g;
    d.ground('#585d63', 0.01);
    d.hazard(d.X(0.02), d.Y(0.02), W * 0.96, W * 0.035);
    d.hazard(d.X(0.02), d.Y(0.945), W * 0.96, W * 0.035);
    // control bunker
    d.box(d.X(0.06), d.Y(0.56), W * 0.3, W * 0.3, W * 0.12, '#8f949a', '#70757b');
    d.windows(d.X(0.08), d.Y(0.74), W * 0.26, W * 0.08, 4, 1, { litChance: 1 });
    d.rect(d.X(0.06), d.Y(0.84), W * 0.3, W * 0.02, d.c);
    // the dish on a mount
    const cx = d.X(0.58), cy = d.Y(0.42), r = W * 0.34;
    d.box(cx - W * 0.1, cy + W * 0.3, W * 0.2, W * 0.14, W * 0.3, '#8f949a', '#6c7177');
    g.save(); g.translate(cx, cy); g.rotate(-0.45);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(4, 6, r, r * 0.55, 0, 0, 7); g.fill();
    const grad = g.createRadialGradient(-r * 0.2, -r * 0.1, 3, 0, 0, r);
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.65, '#cfd4d9'); grad.addColorStop(1, '#7a8086');
    g.fillStyle = grad; g.beginPath(); g.ellipse(0, 0, r, r * 0.55, 0, 0, 7); g.fill();
    g.strokeStyle = '#555b61'; g.lineWidth = 1.5; g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 1;
    for (const k of [0.33, 0.66]) { g.beginPath(); g.ellipse(0, 0, r * k, r * 0.55 * k, 0, 0, 7); g.stroke(); }
    // emitter on three struts, pointing up
    g.strokeStyle = '#3f4449'; g.lineWidth = 2.5;
    for (const a of [-1, 0, 1]) { g.beginPath(); g.moveTo(a * r * 0.55, a === 0 ? r * 0.3 : 0); g.lineTo(0, -r * 0.62); g.stroke(); }
    g.fillStyle = d.c; g.beginPath(); g.arc(0, -r * 0.65, 7, 0, 7); g.fill();
    g.strokeStyle = '#000'; g.lineWidth = 1; g.stroke();
    g.restore();
    const ex = cx + Math.sin(0.45) * -(-r * 0.65) * -1, ey = cy - Math.cos(0.45) * r * 0.65;
    d.l.fillStyle = '#5ff0ff'; d.l.beginPath(); d.l.arc(ex, ey, 9, 0, 7); d.l.fill(); d.anyLit = true;
  },
  rocket(d) {
    const W = d.W, g = d.g;
    d.ground('#6c6f73', 0.01);
    d.hazard(d.X(0.14), d.Y(0.78), W * 0.72, W * 0.05);
    // flame trench
    g.fillStyle = '#26282b'; g.fillRect(d.X(0.3), d.Y(0.72), W * 0.4, W * 0.08);
    const cx = d.X(0.46), base = d.Y(0.74), h = base - 6, r = W * 0.1;
    // gantry
    const gx = d.X(0.72);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(gx, base - 2, W * 0.24, 8);
    g.strokeStyle = '#a03a2a'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(gx, base); g.lineTo(gx, base - h * 0.78); g.moveTo(gx + W * 0.13, base); g.lineTo(gx + W * 0.13, base - h * 0.78); g.stroke();
    g.lineWidth = 1.2;
    for (let i = 0; i < 12; i++) { const y0 = base - (h * 0.78 * i) / 12, y1 = base - (h * 0.78 * (i + 1)) / 12; g.beginPath(); g.moveTo(gx, y0); g.lineTo(gx + W * 0.13, y1); g.moveTo(gx + W * 0.13, y0); g.lineTo(gx, y1); g.stroke(); }
    g.lineWidth = 2.5; for (const t of [0.3, 0.55, 0.72]) { g.beginPath(); g.moveTo(gx, base - h * t); g.lineTo(cx + r, base - h * t); g.stroke(); }
    // rocket body
    const body = g.createLinearGradient(cx - r, 0, cx + r, 0);
    body.addColorStop(0, '#d7dade'); body.addColorStop(0.4, '#ffffff'); body.addColorStop(1, '#9ca2a8');
    g.fillStyle = body;
    g.fillRect(cx - r, base - h * 0.42, r * 2, h * 0.42);
    g.fillRect(cx - r * 0.82, base - h * 0.72, r * 1.64, h * 0.3);
    g.beginPath(); g.moveTo(cx - r, base - h * 0.42); g.lineTo(cx - r * 0.82, base - h * 0.46); g.lineTo(cx + r * 0.82, base - h * 0.46); g.lineTo(cx + r, base - h * 0.42); g.fill();
    g.beginPath(); g.moveTo(cx - r * 0.6, base - h * 0.82); g.lineTo(cx + r * 0.6, base - h * 0.82); g.lineTo(cx + r * 0.82, base - h * 0.72); g.lineTo(cx - r * 0.82, base - h * 0.72); g.fill();
    g.fillRect(cx - r * 0.6, base - h * 0.88, r * 1.2, h * 0.06);
    g.beginPath(); g.moveTo(cx - r * 0.6, base - h * 0.88); g.lineTo(cx, base - h); g.lineTo(cx + r * 0.6, base - h * 0.88); g.closePath(); g.fill();
    // bands in the player's colour
    for (const [t, ww] of [[0.08, 1], [0.28, 1], [0.54, 0.82], [0.66, 0.82], [0.84, 0.6]]) d.rect(cx - r * ww, base - h * t, r * 2 * ww, h * 0.035, d.c);
    d.rect(cx - r, base - h * 0.42, r * 2, 2, '#333');
    // fins
    g.fillStyle = d.dark;
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * r, base - h * 0.14); g.lineTo(cx + s * r * 1.8, base + 2); g.lineTo(cx + s * r, base); g.closePath(); g.fill(); }
    g.fillStyle = '#26282b'; g.fillRect(cx - r * 0.6, base, r * 1.2, 6);
    // windows
    d.windows(cx - r * 0.4, base - h * 0.62, r * 0.8, h * 0.05, 2, 1, { litChance: 1 });
    d.l.fillStyle = '#ff4040'; d.l.beginPath(); d.l.arc(cx, base - h, 3, 0, 7); d.l.arc(gx + W * 0.065, base - h * 0.8, 3, 0, 7); d.l.fill(); d.anyLit = true;
  },
  airfield(d, age) {
    const W = d.W, g = d.g;
    d.ground('#6f7a5c', 0.02);
    // runway with dashed centre line
    d.rect(d.X(0.04), d.Y(0.62), W * 0.92, W * 0.22, '#3d3f42');
    g.fillStyle = '#e9e9e9';
    for (let i = 0; i < 7; i++) g.fillRect(d.X(0.08 + i * 0.13), d.Y(0.725), W * 0.07, 2);
    g.fillStyle = '#f2c500'; g.fillRect(d.X(0.04), d.Y(0.62), 3, W * 0.22); g.fillRect(d.X(0.96) - 3, d.Y(0.62), 3, W * 0.22);
    // runway lights (lit at night)
    d.l.fillStyle = '#9fd8ff';
    for (let i = 0; i < 9; i++) { d.l.fillRect(d.X(0.06 + i * 0.11), d.Y(0.615), 2, 2); d.l.fillRect(d.X(0.06 + i * 0.11), d.Y(0.84), 2, 2); }
    d.anyLit = true;
    // curved hangar
    const hx = d.X(0.06), hy = d.Y(0.1), hw = W * 0.52, hd = W * 0.4, hh = W * 0.2;
    d.shadow(hx, hy, hw, hd, hh);
    g.fillStyle = age >= 4 ? '#c8ccd0' : '#7b8471';
    g.beginPath(); g.moveTo(hx, hy + hd); g.lineTo(hx, hy + hd - hh * 0.4); g.quadraticCurveTo(hx + hw / 2, hy - hh * 1.2, hx + hw, hy + hd - hh * 0.4); g.lineTo(hx + hw, hy + hd); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1; g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.15)';
    for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(hx + (hw * i) / 6, hy + hd); g.lineTo(hx + (hw * i) / 6, hy + hd - hh * 0.9); g.stroke(); }
    g.fillStyle = '#1f2326'; g.fillRect(hx + hw * 0.2, hy + hd - hh * 0.55, hw * 0.6, hh * 0.55);
    d.rect(hx, hy + hd - 3, hw, 3, d.c);
    // control tower
    d.box(d.X(0.72), d.Y(0.18), W * 0.14, W * 0.12, W * 0.42, '#d9dcdf', '#b9bdc1');
    d.rect(d.X(0.7), d.Y(0.18) - W * 0.46, W * 0.18, W * 0.07, '#22343f');
    g.fillStyle = 'rgba(160,220,255,0.45)'; g.fillRect(d.X(0.71), d.Y(0.18) - W * 0.45, W * 0.16, W * 0.03);
    d.l.fillStyle = '#ff4040'; d.l.beginPath(); d.l.arc(d.X(0.79), d.Y(0.18) - W * 0.5, 2.5, 0, 7); d.l.fill();
    d.windows(d.X(0.72), d.Y(0.3) - W * 0.4, W * 0.14, W * 0.3, 1, 3, { litChance: 0.8 });
    // windsock
    g.strokeStyle = '#555'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(d.X(0.92), d.Y(0.5)); g.lineTo(d.X(0.92), d.Y(0.5) - W * 0.2); g.stroke();
    g.fillStyle = '#ff7a1a'; g.beginPath(); g.moveTo(d.X(0.92), d.Y(0.5) - W * 0.2); g.lineTo(d.X(0.8), d.Y(0.5) - W * 0.17); g.lineTo(d.X(0.8), d.Y(0.5) - W * 0.14); g.lineTo(d.X(0.92), d.Y(0.5) - W * 0.15); g.fill();
  },
};

// Industrial factory with a sawtooth roof and chimneys (tank factory, arms factory).
function factory(d, tanks) {
  const W = d.W, g = d.g;
  const x = d.X(0.06), y = d.Y(0.12), w = W * 0.8, dd = W * 0.5, h = W * 0.2;
  d.box(x, y, w, dd, h, '#6d7378', '#8e9499');
  // sawtooth roof
  for (let i = 0; i < 4; i++) {
    const sx = x + (w * i) / 4;
    g.fillStyle = '#5a6066'; g.beginPath(); g.moveTo(sx, y - h + dd); g.lineTo(sx, y - h - 6); g.lineTo(sx + w / 4, y - h + dd); g.fill();
    g.fillStyle = '#9fc4dd'; g.fillRect(sx, y - h - 6, 3, dd + 6);
  }
  d.rect(x, y + dd - h, w, 4, d.c);
  d.windows(x, y + dd - h + 6, w, h - 8, 6, 1, { litChance: 0.9 });
  d.chimney(d.X(0.74), d.Y(0.1), W * 0.07, W * 0.55);
  d.chimney(d.X(0.62), d.Y(0.14), W * 0.06, W * 0.45);
  if (tanks) {
    // a tank waiting outside
    d.rect(d.X(0.2), d.Y(0.78), W * 0.26, W * 0.14, '#4b5320');
    g.fillStyle = '#3a4019'; g.beginPath(); g.arc(d.X(0.33), d.Y(0.85), W * 0.05, 0, 7); g.fill();
    d.rect(d.X(0.36), d.Y(0.84), W * 0.18, 2.5, '#333');
  } else {
    // crates of shells
    for (let i = 0; i < 3; i++) d.box(d.X(0.18 + i * 0.13), d.Y(0.8), W * 0.1, W * 0.08, W * 0.06, '#7a6a3a', '#5e512c', { noShadow: true });
  }
}
