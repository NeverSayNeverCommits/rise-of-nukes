// Draws the game on a canvas. Nothing in here changes the game state.
import { T, DEP } from './sim/map.js';
import { hash2 } from './sim/rng.js';
import { UNITS, BLDS, NUKE, cityRadius } from './sim/data.js';
import { DT } from './sim/sim.js';
import { bldSprite, tint } from './sprites.js';
import { flagCanvas } from './flags.js';

const TS = 32;     // pixels per tile in the cached terrain chunks
const CHUNK = 16;  // tiles per chunk side
const DAY = 7200;  // ticks per day/night cycle (6 minutes)
const TAU = Math.PI * 2;
export const ALT = 1.1; // how high planes fly, in tiles (they are drawn this far up the screen)

export function shade(hex, amt) { return tint(hex, amt); }
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const sstep = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = sstep(x - ix), fy = sstep(y - iy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  const t = a + (b - a) * fx, u = c + (d - c) * fx;
  return t + (u - t) * fy;
}
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class Renderer {
  constructor(canvas, world, me) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.me = me;
    this.cam = { x: 0, y: 0, z: 32 };
    this.chunks = new Map();
    this.fx = [];
    this.parts = [];
    this.floats = [];
    this.bubbles = new Map();
    this.decals = [];
    this.shake = 0;
    this.frame = 0;
    this.lastNow = performance.now();
    const n = world.W * world.H;
    this.visible = new Uint8Array(n);
    this.explored = new Uint8Array(n);
    this.fogMode = world.settings.fog;
    if (this.fogMode !== 'on') this.explored.fill(1);
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = world.W; this.fogCanvas.height = world.H;
    this.fogImg = this.fogCanvas.getContext('2d').createImageData(world.W, world.H);
    this.terrCanvas = document.createElement('canvas');
    this.terrCanvas.width = world.W; this.terrCanvas.height = world.H;
    this.terrVersion = -1;
    this.facing = new Map();
    this.planes = new Map();   // smooth drawing state for each plane (circling, heading, contrail)
    this.planeAt = new Map();  // where each plane was drawn, for clicking on it
    this.nextBirds = performance.now() + 15000;
    this.noNight = localStorage.getItem('ron-night') === '0';
    this.calcDepth();
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.vw = this.cv.clientWidth; this.vh = this.cv.clientHeight;
    this.cv.width = Math.round(this.vw * dpr); this.cv.height = Math.round(this.vh * dpr);
  }

  // ---------- camera ----------
  toScreen(x, y) { return [(x - this.cam.x) * this.cam.z, (y - this.cam.y) * this.cam.z]; }
  toWorld(sx, sy) { return [sx / this.cam.z + this.cam.x, sy / this.cam.z + this.cam.y]; }
  centreOn(x, y) {
    this.cam.x = x - this.vw / 2 / this.cam.z;
    this.cam.y = y - (this.vh - 212 + 34) / 2 / this.cam.z;
    this.clampCam();
  }
  clampCam() {
    const w = this.world;
    const vw = this.vw / this.cam.z, vh = this.vh / this.cam.z;
    this.cam.x = Math.max(-4, Math.min(w.W - vw + 4, this.cam.x));
    this.cam.y = Math.max(-2, Math.min(w.H - vh + 212 / this.cam.z, this.cam.y));
  }
  zoomAt(sx, sy, factor) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.cam.z = Math.max(12, Math.min(64, this.cam.z * factor));
    this.cam.x = wx - sx / this.cam.z; this.cam.y = wy - sy / this.cam.z;
    this.clampCam();
  }
  // Centre of the visible play area, and how wide it is (in tiles). Used for positional sound.
  viewCentre() {
    const [x, y] = this.toWorld(this.vw / 2, (this.vh - 212 + 34) / 2);
    return [x, y, this.vw / this.cam.z];
  }
  onScreen(x, y, m = 1) {
    const z = this.cam.z;
    return x > this.cam.x - m && y > this.cam.y - m && x < this.cam.x + this.vw / z + m && y < this.cam.y + this.vh / z + m;
  }

  isVisible(x, y) {
    if (this.fogMode === 'off') return true;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.world.W || ty >= this.world.H) return false;
    return this.visible[ty * this.world.W + tx] === 1;
  }
  isExplored(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.world.W || ty >= this.world.H) return false;
    return this.explored[ty * this.world.W + tx] === 1;
  }

  // ---------- terrain ----------
  // How far each water tile is from land (for shallow/deep water colours).
  calcDepth() {
    const m = this.world.map, W = m.w, H = m.h;
    const dist = new Uint8Array(W * H).fill(255);
    const q = [];
    for (let i = 0; i < W * H; i++) if (m.tiles[i] !== T.WATER) { dist[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % W, y = (i / W) | 0, d = dist[i];
      if (d >= 8) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (dist[j] > d + 1) { dist[j] = d + 1; q.push(j); }
      }
    }
    for (let i = 0; i < W * H; i++) if (dist[i] === 255) dist[i] = 8;
    this.depth = dist;
  }

  tileAt(x, y) {
    const m = this.world.map;
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) return T.MOUNTAIN;
    return m.tiles[y * m.w + x];
  }

  // Colour of the ground at a world position. Blends neighbouring tiles so coasts and forest
  // edges look natural, with sandy beaches and white foam at the water's edge.
  groundColor(wx, wy) {
    const m = this.world.map;
    const ox = (vnoise(wx * 0.9, wy * 0.9, 3) - 0.5) * 0.75, oy = (vnoise(wx * 0.9, wy * 0.9, 4) - 0.5) * 0.75;
    const fx = wx + ox - 0.5, fy = wy + oy - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = sstep(fx - ix), ty = sstep(fy - iy);
    let wW = 0, wM = 0, wF = 0, dep = 0;
    const add = (x, y, wt) => {
      const t = this.tileAt(x, y);
      if (t === T.WATER) { wW += wt; const xx = Math.max(0, Math.min(m.w - 1, x)), yy = Math.max(0, Math.min(m.h - 1, y)); dep += this.depth[yy * m.w + xx] * wt; }
      else if (t === T.MOUNTAIN) wM += wt;
      else if (t === T.FOREST) wF += wt;
    };
    add(ix, iy, (1 - tx) * (1 - ty)); add(ix + 1, iy, tx * (1 - ty)); add(ix, iy + 1, (1 - tx) * ty); add(ix + 1, iy + 1, tx * ty);
    const n1 = vnoise(wx * 0.12, wy * 0.12, 1), n2 = vnoise(wx * 0.5, wy * 0.5, 2), n3 = vnoise(wx * 2.2, wy * 2.2, 5);
    let c = lerp3([66, 104, 44], [104, 140, 58], n1 * 0.7 + n2 * 0.3);
    if (n1 > 0.72) c = lerp3(c, [138, 140, 70], (n1 - 0.72) * 2.5); // dry patches
    c = lerp3(c, [c[0] * 0.9, c[1] * 0.95, c[2] * 0.9], n3);
    if (wF > 0) c = lerp3(c, [36, 66, 32], Math.min(1, wF * 1.1));
    if (wM > 0.3) {
      const rock = lerp3([96, 90, 82], [140, 132, 120], n2 * 0.6 + n3 * 0.4);
      c = lerp3(c, rock, Math.min(1, (wM - 0.3) * 4));
    }
    if (wW > 0.3) {
      if (wW < 0.5) c = lerp3(c, [212, 192, 136], Math.min(1, (wW - 0.3) * 6));
      else {
        const d = dep / wW;
        let water = lerp3([70, 150, 160], [20, 52, 96], Math.min(1, (d - 0.6) / 4));
        water = lerp3(water, [water[0] * 0.85, water[1] * 0.9, water[2]], n2);
        if (wW < 0.58) water = lerp3([225, 235, 225], water, (wW - 0.5) / 0.08);
        c = water;
      }
    }
    return c;
  }

  chunk(cx, cy) {
    const key = cy * 1000 + cx;
    let c = this.chunks.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    const N = CHUNK * TS;
    c.width = c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N), D = img.data;
    const bx = cx * CHUNK, by = cy * CHUNK;
    for (let py = 0; py < N; py += 2) {
      for (let px = 0; px < N; px += 2) {
        const col = this.groundColor(bx + (px + 1) / TS, by + (py + 1) / TS);
        for (let k = 0; k < 4; k++) {
          const i = ((py + (k >> 1)) * N + px + (k & 1)) * 4;
          D[i] = col[0]; D[i + 1] = col[1]; D[i + 2] = col[2]; D[i + 3] = 255;
        }
      }
    }
    g.putImageData(img, 0, 0);
    // Trees, rocks, flowers. Draw one tile beyond the chunk so trees that spill over line up.
    g.save();
    g.translate(-bx * TS, -by * TS);
    for (let y = by - 1; y <= by + CHUNK; y++) for (let x = bx - 1; x <= bx + CHUNK; x++) this.drawDetail(g, x, y);
    g.restore();
    this.chunks.set(key, c);
    return c;
  }

  drawDetail(g, x, y) {
    const m = this.world.map;
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) return;
    const t = m.tiles[y * m.w + x];
    const px = x * TS, py = y * TS;
    const h = (s) => hash2(x, y, s);
    if (t === T.GRASS) {
      g.strokeStyle = 'rgba(30,60,20,0.35)'; g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < 3; i++) {
        const gx = px + h(40 + i) * TS, gy = py + h(50 + i) * TS;
        g.moveTo(gx - 2, gy - 3); g.lineTo(gx, gy); g.lineTo(gx + 2, gy - 3);
      }
      g.stroke();
      if (h(60) < 0.12) {
        const cols = ['#f4e04d', '#ffffff', '#e86fa0', '#9ec5ff'];
        g.fillStyle = cols[Math.floor(h(61) * 4)];
        for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(px + h(62 + i) * TS, py + h(66 + i) * TS, 1.5, 0, TAU); g.fill(); }
      }
      if (h(70) < 0.03) {
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(px + 17, py + 19, 6, 3, 0, 0, TAU); g.fill();
        g.fillStyle = '#8f8a80'; g.beginPath(); g.ellipse(px + 16, py + 16, 6, 4, 0, 0, TAU); g.fill();
        g.fillStyle = '#b3aea2'; g.beginPath(); g.ellipse(px + 14.5, py + 14.5, 3, 2, 0, 0, TAU); g.fill();
      }
    } else if (t === T.FOREST) {
      const n = 2 + Math.floor(h(1) * 2);
      for (let i = 0; i < n; i++) {
        const tx = px + 4 + h(100 + i) * (TS - 8), ty = py + 8 + h(110 + i) * (TS - 8);
        const r = 7 + h(120 + i) * 5;
        const pine = vnoise(x * 0.15, y * 0.15, 9) > 0.55;
        g.fillStyle = 'rgba(0,0,0,0.28)';
        g.beginPath(); g.ellipse(tx + r * 0.5, ty + r * 0.35, r * 0.95, r * 0.55, 0, 0, TAU); g.fill();
        g.fillStyle = '#4a3020'; g.fillRect(tx - 1.5, ty - 2, 3, 5);
        const hue = 105 + h(130 + i) * 30, lit = 20 + h(140 + i) * 9;
        if (pine) {
          for (let k = 0; k < 3; k++) {
            const w = r * (1 - k * 0.25), yy = ty - k * r * 0.45;
            g.fillStyle = `hsl(${hue + 15}, 40%, ${lit - 2 + k * 3}%)`;
            g.beginPath(); g.moveTo(tx - w, yy); g.lineTo(tx, yy - r * 0.9); g.lineTo(tx + w, yy); g.closePath(); g.fill();
          }
        } else {
          g.fillStyle = `hsl(${hue}, 45%, ${lit}%)`;
          g.beginPath(); g.arc(tx, ty - r * 0.5, r, 0, TAU); g.fill();
          g.fillStyle = `hsl(${hue - 5}, 50%, ${lit + 7}%)`;
          g.beginPath(); g.arc(tx - r * 0.3, ty - r * 0.8, r * 0.55, 0, TAU); g.fill();
          g.fillStyle = 'rgba(255,255,200,0.12)';
          g.beginPath(); g.arc(tx - r * 0.4, ty - r * 0.95, r * 0.28, 0, TAU); g.fill();
        }
      }
    } else if (t === T.MOUNTAIN) {
      if (h(2) < 0.35) return;
      const bx = px + h(80) * 8, base = py + TS + 2, ph = 18 + h(90) * 16, pw = 22 + h(91) * 14;
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath(); g.moveTo(bx + pw * 0.5, base - ph); g.lineTo(bx + pw + ph * 0.5, base); g.lineTo(bx + pw, base); g.fill();
      g.fillStyle = '#857c70';
      g.beginPath(); g.moveTo(bx, base); g.lineTo(bx + pw / 2, base - ph); g.lineTo(bx + pw, base); g.fill();
      g.fillStyle = '#5e574e';
      g.beginPath(); g.moveTo(bx + pw / 2, base - ph); g.lineTo(bx + pw, base); g.lineTo(bx + pw * 0.62, base); g.fill();
      g.fillStyle = '#f2f4f7';
      g.beginPath(); g.moveTo(bx + pw / 2, base - ph); g.lineTo(bx + pw * 0.34, base - ph * 0.66); g.lineTo(bx + pw * 0.45, base - ph * 0.72); g.lineTo(bx + pw * 0.55, base - ph * 0.64); g.lineTo(bx + pw * 0.66, base - ph * 0.68); g.closePath(); g.fill();
    } else if (t === T.WATER) {
      if (this.depth[y * m.w + x] >= 2) {
        g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1.2;
        g.beginPath();
        const wy = py + 8 + h(2) * 16, wx = px + 4 + h(3) * 10;
        g.moveTo(wx, wy); g.quadraticCurveTo(wx + 5, wy - 3, wx + 10, wy); g.stroke();
      } else if (h(4) < 0.08) {
        g.fillStyle = '#4f8a3a'; g.beginPath(); g.arc(px + 10 + h(5) * 12, py + 10 + h(6) * 12, 3.5, 0.4, TAU - 0.2); g.fill();
      }
    }
  }

  drawDeposits(ctx, x0, y0, x1, y1) {
    const w = this.world, m = w.map, z = this.cam.z, now = performance.now();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = m.dep[y * m.w + x];
        if (!d || !this.isExplored(x, y)) continue;
        if (w.blockId[y * m.w + x]) continue; // covered by a mine or well
        const [sx, sy] = this.toScreen(x + 0.5, y + 0.5);
        if (d === DEP.METAL) {
          for (let i = 0; i < 5; i++) {
            const ox = (hash2(x, y, 300 + i) - 0.5) * z * 1.2, oy = (hash2(x, y, 310 + i) - 0.5) * z * 1.0;
            const r = z * (0.18 + hash2(x, y, 320 + i) * 0.14);
            ctx.fillStyle = '#3e434a';
            ctx.beginPath(); ctx.arc(sx + ox + 1, sy + oy + 2, r, 0, TAU); ctx.fill();
            ctx.fillStyle = '#9aa3ad';
            ctx.beginPath(); ctx.arc(sx + ox, sy + oy, r, 0, TAU); ctx.fill();
            ctx.fillStyle = '#d6dde4';
            ctx.beginPath(); ctx.arc(sx + ox - r * 0.3, sy + oy - r * 0.3, r * 0.35, 0, TAU); ctx.fill();
          }
          // a glint now and then
          const ph = (now / 2000 + hash2(x, y, 9)) % 1;
          if (ph < 0.06) {
            ctx.strokeStyle = `rgba(255,255,255,${1 - ph / 0.06})`; ctx.lineWidth = 1.5;
            const gx = sx - z * 0.2, gy = sy - z * 0.2, r = z * 0.2;
            ctx.beginPath(); ctx.moveTo(gx - r, gy); ctx.lineTo(gx + r, gy); ctx.moveTo(gx, gy - r); ctx.lineTo(gx, gy + r); ctx.stroke();
          }
        } else {
          ctx.fillStyle = '#0a0a0a';
          ctx.beginPath(); ctx.ellipse(sx, sy, z * 0.75, z * 0.5, 0, 0, TAU); ctx.fill();
          const gr = ctx.createLinearGradient(sx - z * 0.5, sy - z * 0.3, sx + z * 0.5, sy + z * 0.3);
          const sh = (now / 3000 + hash2(x, y, 4)) % 1;
          gr.addColorStop(0, 'rgba(120,60,200,0.35)'); gr.addColorStop(Math.max(0.05, Math.min(0.95, sh)), 'rgba(40,200,180,0.3)'); gr.addColorStop(1, 'rgba(220,180,40,0.3)');
          ctx.fillStyle = gr;
          ctx.beginPath(); ctx.ellipse(sx - z * 0.1, sy - z * 0.08, z * 0.4, z * 0.22, 0, 0, TAU); ctx.fill();
        }
      }
    }
  }

  // Little moving glints on the water.
  drawWater(ctx, x0, y0, x1, y1, now) {
    const z = this.cam.z, m = this.world.map;
    if (z < 16) return;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * m.w + x;
      if (m.tiles[i] !== T.WATER || this.depth[i] < 1) continue;
      const ph = (now / 2600 + hash2(x, y, 33)) % 1;
      if (ph > 0.25) continue;
      const a = Math.sin((ph / 0.25) * Math.PI);
      const [sx, sy] = this.toScreen(x + hash2(x, y, 34), y + hash2(x, y, 35));
      ctx.globalAlpha = a * 0.6;
      ctx.fillRect(sx - z * 0.15 * a, sy, z * 0.3 * a + 1, 1.5);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- territory ----------
  updateTerritory() {
    const w = this.world;
    if (this.terrVersion === w.terrVersion) return;
    this.terrVersion = w.terrVersion;
    const g = this.terrCanvas.getContext('2d');
    const img = g.createImageData(w.W, w.H);
    const cols = w.s.players.map((p) => { const n = parseInt(p.color.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; });
    for (let i = 0; i < w.W * w.H; i++) {
      const o = w.terr[i];
      if (o < 0) continue;
      img.data[i * 4] = cols[o][0]; img.data[i * 4 + 1] = cols[o][1]; img.data[i * 4 + 2] = cols[o][2]; img.data[i * 4 + 3] = 34;
    }
    g.putImageData(img, 0, 0);
    // border segments per owner, in tile coordinates
    this.borders = w.s.players.map(() => []);
    const W = w.W, H = w.H;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = w.terr[y * W + x];
        if (o < 0) continue;
        const segs = this.borders[o];
        if (x === 0 || w.terr[y * W + x - 1] !== o) segs.push(x, y, x, y + 1);
        if (x === W - 1 || w.terr[y * W + x + 1] !== o) segs.push(x + 1, y, x + 1, y + 1);
        if (y === 0 || w.terr[(y - 1) * W + x] !== o) segs.push(x, y, x + 1, y);
        if (y === H - 1 || w.terr[(y + 1) * W + x] !== o) segs.push(x, y + 1, x + 1, y + 1);
      }
    }
  }

  drawBorders(ctx, x0, y0, x1, y1, now) {
    const w = this.world;
    const pulse = 0.75 + 0.25 * Math.sin(now / 700);
    this.borders.forEach((segs, p) => {
      if (!segs.length) return;
      ctx.beginPath();
      for (let i = 0; i < segs.length; i += 4) {
        if (segs[i + 2] < x0 - 1 || segs[i] > x1 + 2 || segs[i + 3] < y0 - 1 || segs[i + 1] > y1 + 2) continue;
        const [ax, ay] = this.toScreen(segs[i], segs[i + 1]);
        const [bx, by] = this.toScreen(segs[i + 2], segs[i + 3]);
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      }
      const col = w.s.players[p].color;
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba(col, 0.22 * pulse); ctx.lineWidth = 7; ctx.stroke();
      ctx.strokeStyle = rgba(col, 0.4); ctx.lineWidth = 3.5; ctx.stroke();
      ctx.strokeStyle = rgba(col, 0.95); ctx.lineWidth = 1.5; ctx.stroke();
      ctx.lineCap = 'butt';
    });
  }

  // ---------- fog ----------
  updateFog() {
    const w = this.world, W = w.W, H = w.H;
    const vis = this.visible;
    if (this.fogMode === 'off') { vis.fill(1); return; }
    vis.fill(0);
    const reveal = (cx, cy, r) => {
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.floor(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.floor(cy + r));
      const r2 = r * r;
      for (let y = y0; y <= y1; y++) {
        const dy = y + 0.5 - cy;
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx;
          if (dx * dx + dy * dy <= r2) { const i = y * W + x; vis[i] = 1; this.explored[i] = 1; }
        }
      }
    };
    const me = this.me;
    const watching = this.spectate || !w.s.players[me] || !w.s.players[me].alive;
    for (const u of w.s.units) if (watching || w.ally(me, u.owner)) reveal(u.x, u.y, UNITS[u.type].sight);
    for (const b of w.s.blds) if (watching || w.ally(me, b.owner)) reveal(b.x + b.size / 2, b.y + b.size / 2, BLDS[b.type].sight + b.size / 2);
    const d = this.fogImg.data;
    for (let i = 0; i < W * H; i++) {
      d[i * 4] = 8; d[i * 4 + 1] = 10; d[i * 4 + 2] = 16;
      d[i * 4 + 3] = vis[i] ? 0 : this.explored[i] ? 115 : 255;
    }
    this.fogCanvas.getContext('2d').putImageData(this.fogImg, 0, 0);
  }

  // ---------- particles, floating text, speech bubbles ----------
  part(p) { if (this.parts.length < 1500) { p.t0 = p.t0 || performance.now(); this.parts.push(p); } }
  float(x, y, text, color = '#fff', big = false) { this.floats.push({ x, y, text, color, big, t0: performance.now() }); }
  bubble(id, text, ms = 2600) { this.bubbles.set(id, { text, t0: performance.now(), ms }); }
  fireworks(x, y, n = 5) {
    const now = performance.now();
    for (let k = 0; k < n; k++) {
      const cx = x + (Math.random() - 0.5) * 8, cy = y - 3 - Math.random() * 4;
      const col = `hsl(${Math.random() * 360}, 100%, 65%)`;
      const t0 = now + k * 350 + Math.random() * 200;
      this.part({ k: 'rocket', x: cx, y: cy + 5, tx: cx, ty: cy, t0, life: 600, col });
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * TAU, s = 2.5 + Math.random() * 2;
        this.part({ k: 'spark', x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t0: t0 + 600, life: 1300, col, g: 2.5 });
      }
    }
  }
  burst(x, y, col, n = 14, speed = 3, size = 0.08) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = speed * (0.4 + Math.random() * 0.8);
      this.part({ k: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.5, life: 600 + Math.random() * 500, col, g: 5, size });
    }
  }

  updateParts(dt, now) {
    const keep = [];
    for (const p of this.parts) {
      const t = (now - p.t0) / p.life;
      if (t >= 1) continue;
      keep.push(p);
      if (t < 0) continue;
      if (p.vx != null) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.g) p.vy += p.g * dt; if (p.drag) { p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt; } }
    }
    this.parts = keep;
  }

  drawParts(ctx, now, layer) {
    const z = this.cam.z;
    for (const p of this.parts) {
      if ((p.layer || 0) !== layer) continue;
      const t = (now - p.t0) / p.life;
      if (t < 0 || t >= 1) continue;
      if (!this.onScreen(p.x, p.y, 3)) continue;
      const [sx, sy] = this.toScreen(p.x, p.y);
      switch (p.k) {
        case 'smoke': {
          const r = z * (p.size || 0.2) * (1 + t * 2.5);
          ctx.fillStyle = p.col ? p.col.replace('A', (0.45 * (1 - t)).toFixed(3)) : `rgba(80,80,85,${0.45 * (1 - t)})`;
          ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
          break;
        }
        case 'fire': {
          const r = z * (p.size || 0.18) * (1 - t * 0.6);
          ctx.fillStyle = `rgba(255,${(200 - t * 160) | 0},40,${0.9 * (1 - t)})`;
          ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
          break;
        }
        case 'spark': {
          ctx.globalAlpha = 1 - t * t;
          ctx.fillStyle = p.col;
          const r = Math.max(1, z * (p.size || 0.07));
          ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
          ctx.globalAlpha = 1;
          break;
        }
        case 'rocket': {
          const [tx, ty] = this.toScreen(p.tx, p.ty);
          const x = sx + (tx - sx) * t, y = sy + (ty - sy) * t;
          ctx.fillStyle = '#ffe9a0'; ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
          ctx.strokeStyle = 'rgba(255,200,120,0.5)'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + z * 0.6); ctx.stroke();
          break;
        }
        case 'emoji': {
          const hop = Math.abs(Math.sin(t * Math.PI * (p.hops || 3))) * z * 0.5;
          const x = sx + (p.dx || 0) * t * z;
          ctx.globalAlpha = t > 0.85 ? (1 - t) / 0.15 : 1;
          ctx.font = `${Math.round(z * (p.size || 0.6))}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillText(p.e, x, sy - hop);
          ctx.globalAlpha = 1;
          break;
        }
        case 'bird': {
          const x = sx + p.vx * (now - p.t0) / 1000 * z, y = sy + p.vy * (now - p.t0) / 1000 * z;
          const flap = Math.sin(now / 90 + p.ph) * z * 0.12;
          ctx.strokeStyle = 'rgba(20,20,20,0.75)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(x - z * 0.25, y - flap); ctx.lineTo(x, y); ctx.lineTo(x + z * 0.25, y - flap); ctx.stroke();
          ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(x + z * 1.5, y + z * 2, 3, 2);
          break;
        }
        case 'debris': {
          ctx.fillStyle = p.col || '#5a4a3a';
          ctx.save(); ctx.translate(sx, sy); ctx.rotate(t * 8 + p.r0);
          ctx.fillRect(-z * 0.07, -z * 0.04, z * 0.14, z * 0.08); ctx.restore();
          break;
        }
      }
    }
  }

  // Background life: chimney smoke, burning buildings, birds, frogs.
  ambient(dt, now, x0, y0, x1, y1) {
    const w = this.world;
    for (const b of w.s.blds) {
      if (b.x > x1 + 2 || b.y > y1 + 3 || b.x + b.size < x0 - 1 || b.y + b.size < y0 - 1) continue;
      if (!b.done) continue;
      const spr = bldSprite(b.type, w.s.players[b.owner].color, w.s.players[b.owner].age);
      for (const [cx, cy] of spr.smoke) {
        if (Math.random() < dt * 2.5) this.part({ k: 'smoke', x: b.x + cx + (Math.random() - 0.5) * 0.1, y: b.y + cy, vx: 0.25 + Math.random() * 0.2, vy: -0.6 - Math.random() * 0.3, life: 2200, size: 0.12, layer: 1 });
      }
      const f = b.hp / w.maxHp(b);
      if (f < 0.6 && Math.random() < dt * (1 - f) * 14) {
        const px = b.x + 0.2 + Math.random() * (b.size - 0.4), py = b.y + 0.3 + Math.random() * (b.size - 0.4);
        this.part({ k: 'fire', x: px, y: py, vx: (Math.random() - 0.5) * 0.3, vy: -1.2, life: 500 + Math.random() * 300, size: 0.15 + (1 - f) * 0.15, layer: 1 });
        if (Math.random() < 0.4) this.part({ k: 'smoke', x: px, y: py - 0.3, vx: 0.3, vy: -0.9, life: 1800, size: 0.2, col: 'rgba(30,30,30,A)', layer: 1 });
      }
    }
    // birds
    if (now > this.nextBirds) {
      this.nextBirds = now + 20000 + Math.random() * 30000;
      const fromLeft = Math.random() < 0.5;
      const sx = fromLeft ? x0 - 2 : x1 + 2, sy = y0 + Math.random() * (y1 - y0);
      const vx = (fromLeft ? 1 : -1) * (3 + Math.random()), vy = (Math.random() - 0.5) * 1.2;
      const life = ((x1 - x0 + 6) / Math.abs(vx)) * 1000;
      for (let i = 0; i < 4 + Math.floor(Math.random() * 5); i++) this.part({ k: 'bird', x: sx - Math.sign(vx) * (i % 3) * 0.8, y: sy + (i - 2) * 0.6 + Math.random() * 0.4, vx, vy, life, ph: Math.random() * 6, layer: 2 });
    }
    // music notes: bands, jeepneys, and karaoke cities at night
    for (const u of w.s.units) {
      if ((u.type !== 'oompah' && u.type !== 'jeepney') || u.x < x0 || u.x > x1 || u.y < y0 || u.y > y1 || !this.isVisible(u.x, u.y)) continue;
      if (Math.random() < dt * 1.6) this.part({ k: 'emoji', e: Math.random() < 0.5 ? '🎵' : '🎶', x: u.x + (Math.random() - 0.5) * 0.6, y: u.y - 0.4, dx: (Math.random() - 0.5) * 1.5, hops: 1, life: 1400, size: 0.4, layer: 2 });
    }
    if (this.nightAmount() > 0.3) {
      for (const b of w.s.blds) {
        if (b.type !== 'city' || !b.done || !w.s.players[b.owner].techs.karaoke || b.x + 3 < x0 || b.x > x1 || b.y + 3 < y0 || b.y > y1 || !this.isVisible(b.x + 1.5, b.y + 1.5)) continue;
        if (Math.random() < dt * 2.5) this.part({ k: 'emoji', e: ['🎤', '🎵', '🎶', '🎵'][Math.floor(Math.random() * 4)], x: b.x + 0.3 + Math.random() * 2.4, y: b.y + 0.5, dx: (Math.random() - 0.5) * 2, hops: 1, life: 1800, size: 0.5, layer: 2 });
      }
    }
    // plague of frogs
    if (w.s.mods && w.s.mods.food && Math.random() < dt * 6) {
      const x = x0 + Math.random() * (x1 - x0), y = y0 + 1 + Math.random() * (y1 - y0 - 2);
      this.part({ k: 'emoji', e: '🐸', x, y, dx: (Math.random() - 0.5) * 6, hops: 3, life: 2000, size: 0.55, layer: 1 });
    }
    if (w.s.mods && w.s.mods.gather && Math.random() < dt * 3) {
      const x = x0 + Math.random() * (x1 - x0), y = y0 + 1 + Math.random() * (y1 - y0 - 2);
      this.part({ k: 'emoji', e: '💰', x, y, dx: 0, hops: 1, life: 1200, size: 0.5, layer: 2 });
    }
  }

  // ---------- events -> effects ----------
  addEvents(evs) {
    const w = this.world, now = performance.now();
    for (const e of evs) {
      if (w.s.tick - e.tick > 40) continue; // skip old events after catching up
      const seen = e.x == null || this.isVisible(e.x, e.y) || (e.x2 != null && this.isVisible(e.x2, e.y2));
      switch (e.type) {
        case 'shot':
          if (!seen) break;
          if (e.fa || e.ta) {
            const e2 = { ...e, y: e.fa ? e.y - ALT : e.y, y2: e.ta ? e.y2 - ALT : e.y2 };
            if (e.cls === 'aa' || (e.cls === 'bld' && e.age >= 3)) {
              this.fx.push({ k: 'flak', x: e2.x, y: e2.y, x2: e2.x2 + (Math.random() - 0.5) * 0.8, y2: e2.y2 + (Math.random() - 0.5) * 0.6, t0: now, d: 900 });
              break;
            }
            this.fx.push({ k: 'bullet', x: e2.x, y: e2.y, x2: e2.x2, y2: e2.y2, t0: now, d: 120 });
            if (e.fa) this.fx.push({ k: 'bullet', x: e2.x, y: e2.y + 0.15, x2: e2.x2, y2: e2.y2 + 0.15, t0: now + 60, d: 120 });
            break;
          }
          if (e.melee) { this.fx.push({ k: 'spark', x: e.x2, y: e.y2, t0: now, d: 200 }); break; }
          if (e.ut === 'bowler') { this.fx.push({ k: 'cricket', x: e.x, y: e.y, x2: e.x2, y2: e.y2, t0: now, d: 380 }); break; }
          if (e.uq === 1 && e.ut === 'ranged') { this.fx.push({ k: 'pearls', x: e.x, y: e.y, x2: e.x2, y2: e.y2, t0: now, d: 220 }); break; }
          if (e.cls === 'sie') this.fx.push({ k: e.age >= 4 ? 'rocket' : 'ball', x: e.x, y: e.y, x2: e.x2, y2: e.y2, t0: now, d: e.age >= 4 ? 700 : 550, boom: true, age: e.age });
          else if (e.cls === 'cav' && e.age >= 3) this.fx.push({ k: 'shell', x: e.x, y: e.y, x2: e.x2, y2: e.y2, t0: now, d: 160, boom: true });
          else if (e.age >= 2) this.fx.push({ k: 'bullet', x: e.x, y: e.y, x2: e.x2, y2: e.y2, t0: now, d: 120 });
          else this.fx.push({ k: 'arrow', x: e.x, y: e.y, x2: e.x2, y2: e.y2, t0: now, d: 300 });
          break;
        case 'die':
          if (seen) {
            this.fx.push({ k: 'die', x: e.x, y: e.y, t0: now, d: 6000, cls: e.cls, r0: Math.random() * 6 });
            this.burst(e.x, e.y, e.cls === 'cav' && e.age >= 3 ? '#555' : '#8a1a1a', 6, 1.5, 0.05);
          }
          break;
        case 'destroyed':
          if (seen) {
            this.fx.push({ k: 'boom', x: e.x, y: e.y, t0: now, d: 900, r: e.size * 0.9 });
            this.fx.push({ k: 'smoke', x: e.x, y: e.y, t0: now, d: 6000, r: e.size });
            for (let i = 0; i < 16; i++) {
              const a = Math.random() * TAU, s = 2 + Math.random() * 3;
              this.part({ k: 'debris', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 3, g: 9, drag: 1, life: 900, r0: Math.random() * 6, layer: 1 });
            }
            this.shake = Math.max(this.shake, 4);
          }
          break;
        case 'built':
          if (seen) for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; this.part({ k: 'smoke', x: e.x + Math.cos(a) * 1.2, y: e.y + Math.sin(a) * 1.2, vx: Math.cos(a) * 0.8, vy: Math.sin(a) * 0.8, life: 900, size: 0.25, col: 'rgba(170,150,120,A)' }); }
          break;
        case 'nuke':
          this.fx.push({ k: 'nuke', x: e.x, y: e.y, t0: now, d: 9000 });
          this.decals.push({ k: 'crater', x: e.x, y: e.y, r: NUKE.killRadius * 0.9, t0: now, d: 120000 });
          this.shake = Math.max(this.shake, 22);
          break;
        case 'bomb': {
          if (!seen) break;
          const n = 6 + e.age;
          for (let i = 0; i < n; i++) {
            const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * e.r * 0.8;
            const bx = e.x + Math.cos(a) * rr, by = e.y + Math.sin(a) * rr, delay = i * 70 + Math.random() * 40;
            this.fx.push({ k: 'bombfall', x: bx, y: by - ALT, x2: bx, y2: by, t0: now + delay, d: 380, boom: true });
            this.decals.push({ k: 'crater', x: bx, y: by, r: 0.7, t0: now + delay + 380, d: 40000 });
          }
          this.fx.push({ k: 'smoke', x: e.x, y: e.y, t0: now + 500, d: 5000, r: 2 });
          if (this.onScreen(e.x, e.y, 10)) this.shake = Math.max(this.shake, 6);
          break;
        }
        case 'upgraded':
          if (seen) {
            this.burst(e.x, e.y - 0.5, '#ffd700', 26, 3, 0.06);
            this.fx.push({ k: 'ring', x: e.x, y: e.y, t0: now, d: 900, color: '#ffd700' });
          }
          break;
        case 'intercept':
          this.fx.push({ k: 'boom', x: e.x, y: e.y, t0: now, d: 1200, r: 2.5, sky: true });
          this.burst(e.x, e.y, '#ffd27a', 30, 6, 0.08);
          break;
        case 'captured':
        case 'convert':
          this.fx.push({ k: 'ring', x: e.x, y: e.y, t0: now, d: 1200, color: w.s.players[e.to ?? e.p].color });
          break;
        case 'meteorHit':
          this.fx.push({ k: 'boom', x: e.x, y: e.y, t0: now, d: 1400, r: 5 });
          this.fx.push({ k: 'smoke', x: e.x, y: e.y, t0: now, d: 8000, r: 3 });
          this.decals.push({ k: 'crater', x: e.x, y: e.y, r: 3, t0: now, d: 90000 });
          for (let i = 0; i < 40; i++) {
            const a = Math.random() * TAU, s = 3 + Math.random() * 6;
            this.part({ k: 'debris', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 4, g: 10, drag: 1, life: 1200, r0: Math.random() * 6, col: '#3b2f28', layer: 1 });
          }
          if (this.onScreen(e.x, e.y, 20)) this.shake = Math.max(this.shake, 14);
          break;
        case 'critter':
          if (seen) this.burst(e.x, e.y, e.mutant ? '#7dff3a' : '#ffffff', 12, 2, 0.06);
          break;
        case 'mutate':
          if (seen) { this.fx.push({ k: 'ring', x: e.x, y: e.y, t0: now, d: 1000, color: '#7dff3a' }); this.burst(e.x, e.y, '#7dff3a', 20, 3); }
          break;
        case 'crate':
          if (seen) this.burst(e.x, e.y, '#ffd700', 24, 3.5, 0.06);
          break;
        case 'promote':
          this.burst(e.x, e.y, '#ffd700', 18, 2.5, 0.05);
          break;
        case 'age': {
          const city = w.s.blds.find((b) => b.owner === e.p && b.type === 'city');
          if (city && this.isVisible(city.x + 1.5, city.y + 1.5)) this.fireworks(city.x + 1.5, city.y + 1.5, 4);
          break;
        }
      }
    }
    if (this.fx.length > 1500) this.fx.splice(0, this.fx.length - 1500);
  }

  // How dark it is: 0 = day, 1 = deepest night. Uses game ticks so it's the same for everyone.
  nightAmount() {
    if (this.noNight) return 0;
    const ph = ((this.world.s.tick + DAY * 0.1) % DAY) / DAY;
    if (ph < 0.55) return 0;
    if (ph < 0.65) return sstep((ph - 0.55) / 0.1);
    if (ph < 0.88) return 1;
    return 1 - sstep((ph - 0.88) / 0.12);
  }
  // 'dawn', 'day', 'dusk', 'night' for the HUD.
  dayPhase() {
    const ph = ((this.world.s.tick + DAY * 0.1) % DAY) / DAY;
    return ph < 0.05 ? 'dawn' : ph < 0.55 ? 'day' : ph < 0.65 ? 'dusk' : ph < 0.88 ? 'night' : 'dawn';
  }

  // ---------- main draw ----------
  // ui: { sel:Set, hover, box, ghost, alpha, targetMode }
  draw(ui) {
    const ctx = this.ctx, w = this.world, z = this.cam.z, dpr = this.dpr;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    this.frame++;
    this.updateTerritory();
    if (this.frame % 6 === 1) this.updateFog();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, this.vw, this.vh);

    let shx = 0, shy = 0;
    if (this.shake > 0.3) { shx = (Math.random() - 0.5) * this.shake; shy = (Math.random() - 0.5) * this.shake; this.shake *= 0.93; }
    ctx.save();
    ctx.translate(shx, shy);

    const x0 = Math.max(0, Math.floor(this.cam.x)), y0 = Math.max(0, Math.floor(this.cam.y));
    const x1 = Math.min(w.W - 1, Math.floor(this.cam.x + this.vw / z)), y1 = Math.min(w.H - 1, Math.floor(this.cam.y + this.vh / z));

    // terrain chunks (build at most a couple of new ones per frame to avoid stutter)
    ctx.imageSmoothingEnabled = true;
    let built = 0;
    for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) {
      for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
        const key = cy * 1000 + cx;
        if (!this.chunks.has(key) && built >= 3 && this.frame > 2) continue;
        if (!this.chunks.has(key)) built++;
        const [sx, sy] = this.toScreen(cx * CHUNK, cy * CHUNK);
        ctx.drawImage(this.chunk(cx, cy), Math.floor(sx), Math.floor(sy), Math.ceil(CHUNK * z) + 1, Math.ceil(CHUNK * z) + 1);
      }
    }
    this.drawWater(ctx, x0, y0, x1, y1, now);
    // territory tint + borders
    ctx.imageSmoothingEnabled = false;
    {
      const [sx, sy] = this.toScreen(0, 0);
      ctx.drawImage(this.terrCanvas, sx, sy, w.W * z, w.H * z);
    }
    this.drawBorders(ctx, x0, y0, x1, y1, now);

    this.drawDeposits(ctx, x0, y0, x1, y1);
    this.drawDecals(ctx, now);

    // fallout zones
    for (const f of w.s.fallout) {
      const [sx, sy] = this.toScreen(f.x, f.y);
      const left = (f.until - w.s.tick) * DT;
      const a = Math.min(1, left / 10);
      const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, f.r * z);
      gr.addColorStop(0, `rgba(160,255,40,${0.28 * a})`); gr.addColorStop(1, `rgba(120,200,20,${0.05 * a})`);
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(sx, sy, f.r * z, 0, TAU); ctx.fill();
      ctx.font = `${Math.round(z * 0.8)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.5 * a;
      for (let i = 0; i < 6; i++) {
        const ang = now / 3000 + i * 1.047;
        ctx.fillText('☢️', sx + Math.cos(ang) * f.r * z * 0.6, sy + Math.sin(ang) * f.r * z * 0.6);
      }
      ctx.globalAlpha = 1;
    }

    // corpses / rubble under units
    this.drawFx(ctx, now, true);

    // crates
    for (const c of w.s.crates || []) {
      if (!this.onScreen(c.x, c.y, 1) || !this.isExplored(c.x, c.y)) continue;
      this.drawCrate(ctx, c, now);
    }

    // buildings, units and cows, sorted top to bottom so tall things overlap properly
    const sel = ui.sel, a = ui.alpha;
    const list = [];
    for (const b of w.s.blds) {
      if (b.x > x1 + 1 || b.y > y1 + 3 || b.x + b.size < x0 - 1 || b.y + b.size < y0 - 1) continue;
      const mine = w.ally(this.me, b.owner);
      if (!mine && !this.isExplored(b.x + b.size / 2, b.y + b.size / 2)) continue;
      list.push({ k: 0, e: b, y: b.y + b.size - 0.01 });
    }
    const happy = w.s.mods && w.s.mods.speed;
    const air = [];
    for (const u of w.s.units) {
      let x = u.px + (u.x - u.px) * a, y = u.py + (u.y - u.py) * a;
      if (x < x0 - 2 || y < y0 - 1 || x > x1 + 3 || y > y1 + 4) continue;
      if (!w.ally(this.me, u.owner) && !this.isVisible(x, y)) continue;
      if (UNITS[u.type].air) { air.push({ e: u, x, y }); continue; }
      if (x < x0 - 1 || x > x1 + 2 || y > y1 + 2) continue;
      if (happy) x += Math.sin(now / 260 + u.id) * 0.12; // happy hour: nobody walks straight
      list.push({ k: 1, e: u, x, y });
    }
    for (const c of w.s.critters || []) {
      const x = c.px + (c.x - c.px) * a, y = c.py + (c.y - c.py) * a;
      if (x < x0 - 1 || y < y0 - 1 || x > x1 + 2 || y > y1 + 2) continue;
      if (!this.isVisible(x, y)) continue;
      list.push({ k: 2, e: c, x, y });
    }
    list.sort((p, q) => p.y - q.y);
    this.lit = [];
    for (const it of list) {
      if (it.k === 0) this.drawBld(ctx, it.e, sel.has(it.e.id), ui.hover === it.e.id, now);
      else if (it.k === 1) this.drawUnit(ctx, it.e, it.x, it.y, sel.has(it.e.id), ui.hover === it.e.id, now);
      else this.drawCow(ctx, it.e, it.x, it.y, sel.has(it.e.id), ui.hover === it.e.id, now);
    }

    // meteors falling
    this.drawMeteors(ctx, a, now);

    // effects on top
    this.drawFx(ctx, now, false);
    this.ambient(dt, now, x0, y0, x1, y1);
    this.updateParts(dt, now);
    this.drawParts(ctx, now, 0);
    this.drawParts(ctx, now, 1);
    this.drawPlanes(ctx, air, sel, ui.hover, now, dt);
    this.drawDoomSky(ctx, now, dt);

    // night
    const night = this.nightAmount();
    if (night > 0.01) {
      ctx.fillStyle = `rgba(10,16,52,${0.45 * night})`;
      ctx.fillRect(-20, -20, this.vw + 40, this.vh + 40);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = night;
      for (const [img, sx, sy, ww, hh] of this.lit) ctx.drawImage(img, sx, sy, ww, hh);
      ctx.globalAlpha = 1;
      // warm glow around cities
      for (const b of w.s.blds) {
        if (b.type !== 'city' || !b.done || !this.onScreen(b.x, b.y, 8)) continue;
        const [sx, sy] = this.toScreen(b.x + 1.5, b.y + 1.5);
        const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, z * 4);
        gr.addColorStop(0, `rgba(255,190,110,${0.18 * night})`); gr.addColorStop(1, 'rgba(255,190,110,0)');
        ctx.fillStyle = gr; ctx.fillRect(sx - z * 4, sy - z * 4, z * 8, z * 8);
      }
      ctx.globalCompositeOperation = 'source-over';
    } else if (this.dayPhase() === 'dawn') {
      ctx.fillStyle = 'rgba(255,170,90,0.06)'; ctx.fillRect(-20, -20, this.vw + 40, this.vh + 40);
    }

    // fog
    if (this.fogMode === 'on') {
      ctx.imageSmoothingEnabled = true;
      const [sx, sy] = this.toScreen(0, 0);
      ctx.drawImage(this.fogCanvas, sx, sy, w.W * z, w.H * z);
    }
    this.drawParts(ctx, now, 2);

    // rally points of selected buildings
    for (const id of sel) {
      const b = w.get(id);
      if (!b || b.kind !== 'b' || !b.rally || b.owner !== this.me) continue;
      let rx = b.rally.x, ry = b.rally.y;
      if (b.rally.t) { const t = w.get(b.rally.t); if (!t) continue; [rx, ry] = w.centre(t); }
      const [ax, ay] = this.toScreen(b.x + b.size / 2, b.y + b.size / 2);
      const [bx, by] = this.toScreen(rx, ry);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
      ctx.lineDashOffset = -now / 50;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      ctx.font = `${Math.round(z * 0.7)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('🚩', bx + z * 0.15, by);
    }

    // order markers (move clicks)
    this.drawMarkers(ctx, now);

    // missiles and their targets: everyone can see these
    this.drawMissiles(ctx, a, now);

    this.drawFloats(ctx, now);
    this.drawBubbles(ctx, now, a);

    // placement ghost
    if (ui.ghost) this.drawGhost(ctx, ui.ghost);

    ctx.restore();

    // selection box
    if (ui.box) {
      const { x0: bx0, y0: by0, x1: bx1, y1: by1 } = ui.box;
      ctx.strokeStyle = '#7ee787'; ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(126,231,135,0.08)';
      ctx.fillRect(Math.min(bx0, bx1), Math.min(by0, by1), Math.abs(bx1 - bx0), Math.abs(by1 - by0));
      ctx.strokeRect(Math.min(bx0, bx1) + 0.5, Math.min(by0, by1) + 0.5, Math.abs(bx1 - bx0), Math.abs(by1 - by0));
    }
    if (ui.targetMode) {
      ctx.fillStyle = ui.targetMode === 'nuke' ? 'rgba(255,0,0,0.9)' : 'rgba(255,200,0,0.9)';
      ctx.font = 'bold 16px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(ui.targetMode === 'nuke' ? '☢ Click a target to launch. Right-click or Esc to cancel.' : 'Attack-move: click a destination', this.vw / 2, 70);
    }
  }

  drawDecals(ctx, now) {
    const z = this.cam.z;
    this.decals = this.decals.filter((d) => now - d.t0 < d.d);
    for (const d of this.decals) {
      const t = (now - d.t0) / d.d;
      if (t < 0) continue;
      const [sx, sy] = this.toScreen(d.x, d.y);
      const r = d.r * z;
      const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      gr.addColorStop(0, `rgba(25,18,12,${0.85 * (1 - t)})`); gr.addColorStop(0.6, `rgba(45,32,22,${0.6 * (1 - t)})`); gr.addColorStop(1, 'rgba(45,32,22,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
    }
  }

  drawBld(ctx, b, selected, hovered, now) {
    const w = this.world, z = this.cam.z, d = BLDS[b.type];
    const pl = w.s.players[b.owner];
    const [sx, sy] = this.toScreen(b.x, b.y);
    const S = b.size * z;
    const spr = bldSprite(b.type, pl.color, pl.age);
    const top = spr.top * z;
    // selection / hover ring on the ground
    if (selected || hovered) {
      ctx.strokeStyle = selected ? 'rgba(126,231,135,0.95)' : w.enemy(this.me, b.owner) ? 'rgba(255,123,114,0.9)' : 'rgba(255,230,128,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(sx + S / 2, sy + S / 2, S * 0.66, S * 0.6, 0, 0, TAU); ctx.stroke();
    }
    if (!b.done) {
      const frac = Math.max(0.05, b.prog / d.time);
      // foundations
      ctx.fillStyle = 'rgba(120,100,70,0.6)'; ctx.fillRect(sx + S * 0.04, sy + S * 0.04, S * 0.92, S * 0.92);
      ctx.save();
      ctx.beginPath(); ctx.rect(sx - z, sy + S - (S + top) * frac, S + 2 * z, (S + top) * frac + 2); ctx.clip();
      ctx.globalAlpha = 0.85;
      ctx.drawImage(spr.img, sx, sy - top, S, S + top);
      ctx.restore();
      // scaffolding
      ctx.strokeStyle = 'rgba(200,160,100,0.9)'; ctx.lineWidth = Math.max(1, z * 0.04);
      const hh = (S + top) * Math.min(1, frac + 0.15);
      ctx.beginPath();
      for (let i = 0; i <= 4; i++) { const x = sx + (S * i) / 4; ctx.moveTo(x, sy + S); ctx.lineTo(x, sy + S - hh); }
      for (let j = 1; j * z * 0.5 < hh; j++) { const y = sy + S - j * z * 0.5; ctx.moveTo(sx, y); ctx.lineTo(sx + S, y); }
      ctx.stroke();
      this.bar(ctx, sx + S * 0.06, sy + S - z * 0.2, S * 0.88, Math.max(3, z * 0.1), b.prog / d.time, '#e3b341');
    } else {
      ctx.drawImage(spr.img, sx, sy - top, S, S + top);
      if (spr.lit) this.lit.push([spr.lit, sx, sy - top, S, S + top]);
      if (spr.pump) this.drawPump(ctx, b, spr, sx, sy, S, now);
      // burn marks when badly damaged
      const f = b.hp / w.maxHp(b);
      if (f < 0.5) {
        ctx.fillStyle = `rgba(20,15,10,${(0.5 - f) * 0.9})`;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(sx + S * hash2(b.id, i, 1), sy + S * hash2(b.id, i, 2), S * 0.18, 0, TAU); ctx.fill(); }
      }
    }
    // labels
    if (b.type === 'city' && z >= 18) {
      const label = b.name || 'City';
      ctx.font = `bold ${Math.max(10, Math.round(z * 0.34))}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const th = Math.max(14, z * 0.48), fh = th * 0.62, fw = fh * 1.5;
      const tw = ctx.measureText(label).width + 14 + fw;
      const lx = sx + S / 2, ly = sy - top - th * 0.2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; this.roundRect(ctx, lx - tw / 2, ly - th / 2, tw, th, th / 2); ctx.fill();
      ctx.strokeStyle = pl.color; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.drawImage(flagCanvas(pl.nation), lx - tw / 2 + th * 0.35, ly - fh / 2, fw, fh);
      ctx.fillStyle = '#fff'; ctx.fillText(label, lx + fw / 2 + 2, ly + 1);
    }
    if (b.type === 'silo' && b.stock > 0) {
      ctx.font = `bold ${Math.round(z * 0.45)}px system-ui`; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillStyle = '#000'; ctx.fillText(`☢×${b.stock}`, sx + S + 1, sy + 3);
      ctx.fillStyle = Math.floor(now / 400) % 2 ? '#ff4040' : '#ffd000'; ctx.fillText(`☢×${b.stock}`, sx + S, sy + 2);
    }
    const maxHp = w.maxHp(b);
    if (b.done && (b.hp < maxHp || selected || hovered)) this.bar(ctx, sx + S * 0.06, sy - top * 0.15 - z * 0.15, S * 0.88, Math.max(3, z * 0.1), b.hp / maxHp, null);
    if (b.done && b.q.length && w.ally(this.me, b.owner)) {
      const it = b.q[0];
      this.bar(ctx, sx + S * 0.06, sy + S - z * 0.1, S * 0.88, Math.max(2, z * 0.07), 1 - it.t / it.total, it.blocked ? '#ff7b72' : '#58a6ff');
    }
    if (d.gather && b.done && w.ally(this.me, b.owner) && (selected || z >= 30)) {
      const n = (w.workerCount && w.workerCount.get(b.id)) || 0;
      ctx.font = `bold ${Math.max(9, Math.round(z * 0.3))}px system-ui`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(sx + 2, sy + 2, z * 0.62, z * 0.36);
      ctx.fillStyle = n ? '#7ee787' : '#ffb3ad';
      ctx.fillText(`${n}/${w.slots(b)}`, sx + 4, sy + 3);
    }
    if (b.lvl && b.done && z >= 14) this.levelBadge(ctx, b.lvl, sx + S - z * 0.32, sy + z * 0.3, z);
  }

  // Gold badge with chevrons for upgraded gather buildings.
  levelBadge(ctx, lvl, x, y, z) {
    const r = Math.max(6, z * 0.24);
    ctx.fillStyle = '#1a1405'; ctx.beginPath(); ctx.arc(x + 1, y + 1, r, 0, TAU); ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
    g.addColorStop(0, '#fff2a8'); g.addColorStop(1, '#d19a12');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#6b4a00'; ctx.lineWidth = Math.max(1, r * 0.18);
    const n = Math.min(4, lvl), step = r * 0.32, top = y - ((n - 1) * step) / 2 - r * 0.1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const yy = top + i * step; ctx.moveTo(x - r * 0.5, yy + r * 0.25); ctx.lineTo(x, yy - r * 0.08); ctx.lineTo(x + r * 0.5, yy + r * 0.25); }
    ctx.stroke();
  }

  // ---------- planes ----------
  // Planes are drawn after everything on the ground, ALT tiles up, with a shadow underneath.
  // Idle planes circle around their spot. This is only for looks: the game itself keeps them still.
  drawPlanes(ctx, list, sel, hover, now, dt) {
    const w = this.world, z = this.cam.z;
    this.planeAt.clear();
    if (this.frame % 120 === 0) for (const [id, p] of this.planes) if (this.frame - p.seen > 120) this.planes.delete(id);
    const items = [];
    for (const it of list) {
      const u = it.e, d = UNITS[u.type];
      const moving = Math.abs(u.x - u.px) + Math.abs(u.y - u.py) > 0.0005;
      const dir = u.id % 2 ? 1 : -1;
      let p = this.planes.get(u.id);
      if (!p) { p = { iw: moving ? 0 : 1, hx: u.fx || 1, hy: u.fy || 0, trail: [], tt: 0 }; this.planes.set(u.id, p); }
      p.seen = this.frame;
      p.iw += ((moving ? 0 : 1) - p.iw) * Math.min(1, dt * 1.5);
      const R = d.bomb ? 1.3 : 0.9, ang = (now / 1000) * (d.bomb ? 0.8 : 1.4) * dir + u.id;
      const wx = it.x + Math.cos(ang) * R * p.iw, wy = it.y + Math.sin(ang) * R * p.iw;
      // heading: where it's going, or along the circle when idle
      let hx = (u.fx || 0) * (1 - p.iw) - Math.sin(ang) * dir * p.iw, hy = (u.fy || 0) * (1 - p.iw) + Math.cos(ang) * dir * p.iw;
      const hl = Math.hypot(hx, hy) || 1;
      const k = Math.min(1, dt * 6);
      p.hx += (hx / hl - p.hx) * k; p.hy += (hy / hl - p.hy) * k;
      const pl2 = Math.hypot(p.hx, p.hy) || 1; p.hx /= pl2; p.hy /= pl2;
      // contrail: remember where the tail was
      p.tt += dt;
      if (p.tt > 0.05) {
        p.tt = 0;
        p.trail.push([wx - p.hx * d.radius * 1.2, wy - ALT - p.hy * d.radius * 1.2, now]);
        if (p.trail.length > 16) p.trail.shift();
      }
      this.planeAt.set(u.id, [wx, wy - ALT]);
      items.push({ u, d, p, wx, wy });
    }
    // shadows
    for (const { u, d, p, wx, wy } of items) {
      const [sx, sy] = this.toScreen(wx + 0.35, wy + 0.2);
      ctx.save(); ctx.globalAlpha = 0.22;
      this.planeShape(ctx, u.type, sx, sy, d.radius * z * 0.85, p.hx, p.hy, '#000', '#000', w.s.players[u.owner].age, now, true);
      ctx.restore();
      if (sel.has(u.id)) {
        ctx.strokeStyle = 'rgba(126,231,135,0.8)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.ellipse(sx, sy, d.radius * z * 1.6, d.radius * z * 0.9, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // contrails
    ctx.lineCap = 'round';
    // Two strokes per plane (older half fainter) keeps this cheap even with lots of planes.
    ctx.lineWidth = Math.max(1.5, z * 0.1);
    for (const { p } of items) {
      const tr = p.trail.filter((q) => now - q[2] < 900);
      if (tr.length < 2) continue;
      const mid = tr.length >> 1;
      for (const [from, to, al] of [[0, mid, 0.12], [mid, tr.length - 1, 0.28]]) {
        if (to <= from) continue;
        ctx.strokeStyle = `rgba(255,255,255,${al})`;
        ctx.beginPath();
        for (let i = from; i <= to; i++) { const [sx, sy] = this.toScreen(tr[i][0], tr[i][1]); if (i === from) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy); }
        ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
    // the planes
    for (const { u, d, p, wx, wy } of items) {
      const pl = w.s.players[u.owner];
      const [sx, sy] = this.toScreen(wx, wy - ALT);
      const r = d.radius * z;
      this.planeShape(ctx, u.type, sx, sy, r, p.hx, p.hy, pl.color, shade(pl.color, -0.45), pl.age, now, false);
      if (sel.has(u.id)) { ctx.strokeStyle = '#7ee787'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, r * 1.9, 0, TAU); ctx.stroke(); }
      if (hover === u.id) { ctx.strokeStyle = w.enemy(this.me, u.owner) ? '#ff7b72' : '#ffe680'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(sx, sy, r * 2, 0, TAU); ctx.stroke(); }
      if (u.rank) {
        ctx.font = `bold ${Math.max(8, Math.round(z * 0.28))}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#000'; ctx.fillText('★'.repeat(u.rank), sx + 1, sy - r * 2.1 + 1);
        ctx.fillStyle = '#ffd700'; ctx.fillText('★'.repeat(u.rank), sx, sy - r * 2.1);
      }
      if (d.bomb && !u.ammo && w.ally(this.me, u.owner) && z >= 16) {
        ctx.font = `bold ${Math.round(z * 0.26)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(255,220,120,0.9)'; ctx.fillText('reloading', sx, sy + r * 1.3);
      }
      const max = w.maxHp(u);
      if (u.hp < max * 0.999 || sel.has(u.id) || hover === u.id) this.bar(ctx, sx - r * 1.2, sy - r * 1.9, r * 2.4, Math.max(2, z * 0.07), u.hp / max, null);
      // damaged planes trail smoke
      if (u.hp < max * 0.5 && Math.random() < dt * 12) this.part({ k: 'smoke', x: wx - p.hx * r / z, y: wy - ALT - p.hy * r / z, vx: 0, vy: -0.1, life: 900, size: 0.12, layer: 1 });
    }
  }

  // Draws one plane pointing along (hx, hy). Local x is "forward".
  planeShape(ctx, type, sx, sy, r, hx, hy, col, dark, age, now, shadow) {
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(Math.atan2(hy, hx));
    const body = shadow ? '#000' : col;
    const metal = shadow ? '#000' : age >= 4 ? '#5d646b' : '#7a8270';
    ctx.lineWidth = Math.max(1, r * 0.08); ctx.strokeStyle = shadow ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,0.55)';
    const poly = (pts, fill) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(pts[0] * r, pts[1] * r); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * r, pts[i + 1] * r); ctx.closePath(); ctx.fill(); ctx.stroke(); };
    if (type === 'fighter') {
      if (age >= 4) {
        // jet: delta wing, twin tails, afterburner
        if (!shadow) { const fl = 0.6 + Math.random() * 0.5; ctx.fillStyle = 'rgba(255,170,60,0.85)'; ctx.beginPath(); ctx.moveTo(-1.15 * r, -0.12 * r); ctx.lineTo(-(1.4 + fl) * r, 0); ctx.lineTo(-1.15 * r, 0.12 * r); ctx.fill(); }
        poly([0.3, 0, -0.9, -1.15, -1.05, -1.1, -0.85, 0, -1.05, 1.1, -0.9, 1.15], metal);
        poly([1.4, 0, 0.9, -0.16, -1.15, -0.18, -1.15, 0.18, 0.9, 0.16], body);
        poly([-0.6, -0.22, -1.1, -0.5, -1.15, -0.22], metal); poly([-0.6, 0.22, -1.1, 0.5, -1.15, 0.22], metal);
        if (!shadow) { ctx.fillStyle = '#8fd3ff'; ctx.beginPath(); ctx.ellipse(0.75 * r, 0, 0.28 * r, 0.09 * r, 0, 0, TAU); ctx.fill(); }
      } else {
        // propeller fighter
        poly([0.15, -1.25, 0.45, -1.2, 0.4, 1.2, 0.15, 1.25], metal);
        poly([1.1, 0, 0.9, -0.2, -1.0, -0.12, -1.0, 0.12, 0.9, 0.2], body);
        poly([-0.75, -0.5, -0.6, -0.5, -0.6, 0.5, -0.75, 0.5], metal);
        if (!shadow) {
          ctx.fillStyle = '#8fd3ff'; ctx.beginPath(); ctx.ellipse(0.35 * r, 0, 0.2 * r, 0.1 * r, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(0.3 * r, -0.85 * r, 0.12 * r, 0, TAU); ctx.arc(0.3 * r, 0.85 * r, 0.12 * r, 0, TAU); ctx.fill();
          const a = now / 25;
          ctx.fillStyle = 'rgba(40,40,40,0.35)'; ctx.beginPath(); ctx.ellipse(1.15 * r, 0, 0.06 * r, 0.42 * r, 0, 0, TAU); ctx.fill();
          ctx.strokeStyle = '#222'; ctx.lineWidth = Math.max(1, r * 0.06);
          ctx.beginPath(); ctx.moveTo(1.15 * r, -Math.cos(a) * 0.42 * r); ctx.lineTo(1.15 * r, Math.cos(a) * 0.42 * r); ctx.stroke();
        }
      }
    } else if (age >= 4) {
      // stealth bomber: flying wing with a zigzag back edge
      poly([0.9, 0, -0.2, -1.9, -0.45, -1.7, -0.25, -1.1, -0.55, -0.6, -0.35, 0, -0.55, 0.6, -0.25, 1.1, -0.45, 1.7, -0.2, 1.9], shadow ? '#000' : '#30353a');
      if (!shadow) {
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, r * 0.12);
        ctx.beginPath(); ctx.moveTo(0.55 * r, -0.65 * r); ctx.lineTo(0.85 * r, 0); ctx.lineTo(0.55 * r, 0.65 * r); ctx.stroke();
        ctx.fillStyle = '#4a5560'; ctx.beginPath(); ctx.ellipse(0.45 * r, 0, 0.18 * r, 0.1 * r, 0, 0, TAU); ctx.fill();
      }
    } else {
      // four-engine bomber
      poly([0.25, -2.0, 0.55, -1.95, 0.55, 1.95, 0.25, 2.0], metal);
      poly([1.25, 0, 1.05, -0.24, -1.3, -0.16, -1.3, 0.16, 1.05, 0.24], body);
      poly([-0.95, -0.75, -0.75, -0.75, -0.75, 0.75, -0.95, 0.75], metal);
      if (!shadow) {
        ctx.fillStyle = '#8fd3ff'; ctx.beginPath(); ctx.ellipse(1.0 * r, 0, 0.16 * r, 0.12 * r, 0, 0, TAU); ctx.fill();
        const a = now / 30;
        for (const e of [-1.4, -0.75, 0.75, 1.4]) {
          ctx.fillStyle = dark; ctx.fillRect(0.45 * r, (e - 0.1) * r, 0.4 * r, 0.2 * r);
          ctx.strokeStyle = '#222'; ctx.lineWidth = Math.max(1, r * 0.05);
          ctx.beginPath(); ctx.moveTo(0.88 * r, (e - Math.cos(a + e) * 0.3) * r); ctx.lineTo(0.88 * r, (e + Math.cos(a + e) * 0.3) * r); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // Late game: as the Doomsday Clock gets close to midnight the sky turns red and ash falls.
  drawDoomSky(ctx, now, dt) {
    const w = this.world, lim = w.settings.doomsday | 0;
    if (!lim || !w.s.doom) return;
    const f = Math.min(1, w.s.doom / lim);
    if (f < 0.34) return;
    const k = (f - 0.34) / 0.66;
    ctx.fillStyle = `rgba(150,30,10,${0.05 + 0.13 * k + 0.03 * Math.sin(now / 700)})`;
    ctx.fillRect(-20, -20, this.vw + 40, this.vh + 40);
    // ash
    const n = Math.floor(30 * k * dt * 60);
    for (let i = 0; i < n; i++) {
      const [x, y] = this.toWorld(Math.random() * this.vw, Math.random() * this.vh * 0.3);
      this.part({ k: 'spark', x, y, vx: 0.4 + Math.random() * 0.4, vy: 0.8 + Math.random() * 0.6, life: 3000, col: Math.random() < 0.15 ? '#ff8a3a' : '#9a958e', size: 0.03, layer: 2 });
    }
  }

  drawPump(ctx, b, spr, sx, sy, S, now) {
    const w = this.world, z = this.cam.z;
    const working = (w.workerCount && w.workerCount.get(b.id)) || 0;
    const ang = working ? Math.sin(now / 500 + b.id) * 0.32 : 0.1;
    const px = sx + spr.pump[0] * S, py = sy + spr.pump[1] * S;
    const L = S * 0.36;
    ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
    ctx.fillStyle = '#2b2b2b'; ctx.fillRect(-L, -z * 0.05, L * 1.7, z * 0.1);
    ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.moveTo(-L, -z * 0.18); ctx.quadraticCurveTo(-L - z * 0.22, 0, -L, z * 0.18); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#333'; ctx.fillRect(L * 0.55, -z * 0.12, z * 0.2, z * 0.24);
    ctx.restore();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(px, py, z * 0.06, 0, TAU); ctx.fill();
  }

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
  }

  bar(ctx, x, y, w, h, f, color) {
    f = Math.max(0, Math.min(1, f));
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = color || (f > 0.6 ? '#3fb950' : f > 0.3 ? '#e3b341' : '#f85149');
    ctx.fillRect(x, y, w * f, h);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x, y, w * f, Math.max(1, h * 0.35));
  }

  drawUnit(ctx, u, x, y, selected, hovered, now) {
    const w = this.world, z = this.cam.z, d = UNITS[u.type];
    const pl = w.s.players[u.owner];
    const age = pl.age;
    let [sx, sy] = this.toScreen(x, y);
    const r = d.radius * z;
    // smooth the facing direction a bit
    let f = this.facing.get(u.id);
    if (!f) { f = { x: u.fx, y: u.fy }; this.facing.set(u.id, f); }
    f.x += (u.fx - f.x) * 0.25; f.y += (u.fy - f.y) * 0.25;
    const fl = Math.hypot(f.x, f.y) || 1;
    const fx = f.x / fl, fy = f.y / fl;
    const col = pl.color, dark = shade(col, -0.45), light = shade(col, 0.35);
    const moving = Math.abs(u.x - u.px) + Math.abs(u.y - u.py) > 0.001;

    // selection / shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(sx + 1.5, sy + r * 0.65, r * 1.05, r * 0.5, 0, 0, TAU); ctx.fill();
    if (selected) {
      ctx.strokeStyle = '#7ee787'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(sx, sy + r * 0.55, r * 1.4, r * 0.8, 0, 0, TAU); ctx.stroke();
    }
    if (hovered) {
      ctx.strokeStyle = w.enemy(this.me, u.owner) ? '#ff7b72' : '#ffe680'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy, r * 1.5, 0, TAU); ctx.stroke();
    }
    // walking bounce / working bob
    if (moving && d.cls !== 'sie' && !(d.cls === 'cav' && age >= 3)) sy -= Math.abs(Math.sin(now / 90 + u.id)) * z * 0.06;
    const bob = u.working ? Math.sin(now / 150 + u.id) * z * 0.04 : 0;

    ctx.lineWidth = Math.max(1, z * 0.05);
    ctx.strokeStyle = dark;
    const st = w.stats(u.owner, u.type);
    const special = st.uniq === 2 ? u.type : st.uniq === 1 ? `${pl.nation}:${u.type}` : null;
    if (!(special && this.drawSpecial(ctx, special, u, sx, sy, r, fx, fy, col, dark, light, age, moving, now))) switch (d.cls) {
      case 'cit': {
        ctx.fillStyle = light;
        ctx.beginPath(); ctx.arc(sx, sy + bob, r, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#e8c39e';
        ctx.beginPath(); ctx.arc(sx, sy - r * 0.15 + bob, r * 0.45, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c9a45a'; // straw hat
        ctx.beginPath(); ctx.ellipse(sx, sy - r * 0.35 + bob, r * 0.55, r * 0.25, 0, 0, TAU); ctx.fill();
        // tool swings while working
        const sw = u.working ? Math.sin(now / 120 + u.id) * 0.8 : 0;
        const tx = fx * Math.cos(sw) - fy * Math.sin(sw), ty = fx * Math.sin(sw) + fy * Math.cos(sw);
        ctx.strokeStyle = '#8b5a2b'; ctx.lineWidth = Math.max(1, z * 0.06);
        ctx.beginPath(); ctx.moveTo(sx + tx * r * 0.3, sy + ty * r * 0.3 + bob); ctx.lineTo(sx + tx * r * 1.4, sy + ty * r * 1.4 + bob); ctx.stroke();
        ctx.fillStyle = '#aaa'; ctx.beginPath(); ctx.arc(sx + tx * r * 1.45, sy + ty * r * 1.45 + bob, Math.max(1, r * 0.18), 0, TAU); ctx.fill();
        break;
      }
      case 'inf': {
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = age >= 2 ? '#333' : '#c0c0c0'; ctx.lineWidth = Math.max(1.5, z * 0.07);
        ctx.beginPath(); ctx.moveTo(sx - fy * r * 0.6, sy + fx * r * 0.6); ctx.lineTo(sx - fy * r * 0.6 + fx * r * 1.9, sy + fx * r * 0.6 + fy * r * 1.9); ctx.stroke();
        if (age < 2) { ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.arc(sx - fy * r * 0.6 + fx * r * 1.95, sy + fx * r * 0.6 + fy * r * 1.95, Math.max(1, r * 0.15), 0, TAU); ctx.fill(); }
        ctx.fillStyle = age >= 3 ? '#4b5320' : age >= 1 ? '#8a8f96' : dark;
        ctx.beginPath(); ctx.arc(sx, sy, r * 0.5, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(sx - r * 0.15, sy - r * 0.15, r * 0.2, 0, TAU); ctx.fill();
        break;
      }
      case 'rng': {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(sx + fx * r * 1.2, sy + fy * r * 1.2);
        ctx.lineTo(sx - fx * r * 0.8 - fy * r, sy - fy * r * 0.8 + fx * r);
        ctx.lineTo(sx - fx * r * 0.8 + fy * r, sy - fy * r * 0.8 - fx * r);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        if (age < 2) { // bow
          ctx.strokeStyle = '#6b4423'; ctx.lineWidth = Math.max(1, z * 0.05);
          ctx.beginPath(); ctx.arc(sx + fx * r * 0.4, sy + fy * r * 0.4, r * 0.8, Math.atan2(fy, fx) - 1.2, Math.atan2(fy, fx) + 1.2); ctx.stroke();
        }
        ctx.fillStyle = age >= 3 ? '#4b5320' : light;
        ctx.beginPath(); ctx.arc(sx, sy, r * 0.36, 0, TAU); ctx.fill();
        break;
      }
      case 'cav': {
        if (age >= 3) {
          // tank: hull, tracks, turret, barrel
          const L = r * 1.25, Wd = r * 0.9;
          ctx.save(); ctx.translate(sx, sy); ctx.rotate(Math.atan2(fy, fx));
          ctx.fillStyle = '#222'; ctx.fillRect(-L, -Wd - r * 0.2, L * 2, r * 0.35); ctx.fillRect(-L, Wd - r * 0.15, L * 2, r * 0.35);
          if (moving) { ctx.fillStyle = '#555'; const o = (now / 40) % 4; for (let i = -L + o; i < L; i += 4) { ctx.fillRect(i, -Wd - r * 0.2, 1, r * 0.35); ctx.fillRect(i, Wd - r * 0.15, 1, r * 0.35); } }
          ctx.fillStyle = dark; ctx.fillRect(-L, -Wd, L * 2, Wd * 2);
          ctx.fillStyle = col; ctx.fillRect(-L * 0.8, -Wd * 0.75, L * 1.6, Wd * 1.5);
          ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, TAU); ctx.fill();
          ctx.fillStyle = '#333'; ctx.fillRect(r * 0.3, -r * 0.12, r * 1.5, r * 0.24);
          ctx.restore();
        } else {
          ctx.save(); ctx.translate(sx, sy); ctx.rotate(Math.atan2(fy, fx));
          const gallop = moving ? Math.sin(now / 70 + u.id) * r * 0.25 : 0;
          ctx.strokeStyle = '#5a3a1d'; ctx.lineWidth = Math.max(1, z * 0.05);
          ctx.beginPath(); ctx.moveTo(r * 0.6, 0); ctx.lineTo(r * 0.6 + gallop, r * 0.7); ctx.moveTo(-r * 0.7, 0); ctx.lineTo(-r * 0.7 - gallop, r * 0.7); ctx.stroke();
          ctx.fillStyle = '#7a4e2d';
          ctx.beginPath(); ctx.ellipse(0, 0, r * 1.2, r * 0.6, 0, 0, TAU); ctx.fill();
          ctx.beginPath(); ctx.ellipse(r * 1.05, -r * 0.1, r * 0.42, r * 0.3, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#3a2410'; ctx.fillRect(-r * 1.4, -r * 0.1, r * 0.3, r * 0.2);
          ctx.fillStyle = col; ctx.strokeStyle = dark;
          ctx.beginPath(); ctx.arc(-r * 0.1, 0, r * 0.55, 0, TAU); ctx.fill(); ctx.stroke();
          ctx.restore();
        }
        break;
      }
      case 'sie': {
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(Math.atan2(fy, fx));
        ctx.fillStyle = age >= 3 ? '#3b4030' : '#6b4a2b';
        ctx.fillRect(-r * 1.0, -r * 0.8, r * 1.8, r * 1.6);
        ctx.fillStyle = col; ctx.fillRect(-r * 0.8, -r * 0.55, r * 1.2, r * 1.1);
        ctx.fillStyle = '#222';
        if (age >= 4) { for (let i = -1; i <= 1; i++) ctx.fillRect(-r * 0.2, i * r * 0.3 - r * 0.1, r * 1.3, r * 0.2); }
        else if (age >= 2) ctx.fillRect(0, -r * 0.16, r * 1.7, r * 0.32);
        else { ctx.strokeStyle = '#4a3020'; ctx.lineWidth = Math.max(1, z * 0.08); ctx.beginPath(); ctx.moveTo(-r * 0.6, 0); ctx.lineTo(r * 1.4, -r * 0.4); ctx.stroke(); }
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.arc(-r * 0.6, r * 0.85, r * 0.25, 0, TAU); ctx.arc(r * 0.5, r * 0.85, r * 0.25, 0, TAU); ctx.fill();
        ctx.restore();
        break;
      }
    }
    if (special) this.specialExtras(ctx, special, u, sx, sy, r, fx, fy, pl.nation, now);
    // being healed by a jeepney
    if (u.healT && w.s.tick - u.healT < 12 && z >= 16) {
      ctx.fillStyle = 'rgba(80,255,120,0.9)'; ctx.font = `bold ${Math.round(z * 0.3)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('+', sx - r * 1.2, sy - r * (0.8 + ((now / 600) % 1) * 0.6));
    }
    // veteran stars
    if (u.rank) {
      ctx.font = `bold ${Math.max(8, Math.round(z * 0.28))}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#000'; ctx.fillText('★'.repeat(u.rank), sx + 1, sy - r * 1.75 + 1);
      ctx.fillStyle = '#ffd700'; ctx.fillText('★'.repeat(u.rank), sx, sy - r * 1.75);
    }
    // health bar
    const max = w.maxHp(u);
    if (u.hp < max * 0.999 || selected || hovered) this.bar(ctx, sx - r * 1.2, sy - r * 1.7, r * 2.4, Math.max(2, z * 0.07), u.hp / max, null);
    // attrition hint
    if (u.attr && w.s.tick - u.attr < 12 && z >= 20 && w.ally(this.me, u.owner)) {
      ctx.fillStyle = 'rgba(255,90,90,0.9)'; ctx.font = `${Math.round(z * 0.3)}px system-ui`; ctx.textAlign = 'center';
      ctx.fillText('↓', sx + r * 1.3, sy - r);
    }
  }

  // Nation units with their own look. Returns false to use the normal drawing.
  drawSpecial(ctx, k, u, sx, sy, r, fx, fy, col, dark, light, age, moving, now) {
    const z = this.cam.z, ang = Math.atan2(fy, fx);
    const lw = Math.max(1, z * 0.05);
    switch (k) {
      case 'oompah': {
        // a band member with a huge brass tuba (or a DJ with headphones in the Atomic Age)
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#e8c39e'; ctx.beginPath(); ctx.arc(sx, sy - r * 0.15, r * 0.42, 0, TAU); ctx.fill();
        if (age >= 4) {
          ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1.5, z * 0.07);
          ctx.beginPath(); ctx.arc(sx, sy - r * 0.2, r * 0.55, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
          ctx.fillStyle = '#111'; ctx.fillRect(sx - r * 0.65, sy - r * 0.3, r * 0.22, r * 0.35); ctx.fillRect(sx + r * 0.43, sy - r * 0.3, r * 0.22, r * 0.35);
          // turntable in front
          const tx = sx + fx * r * 1.1, ty = sy + fy * r * 1.1 + r * 0.2;
          ctx.fillStyle = '#333'; ctx.fillRect(tx - r * 0.6, ty - r * 0.25, r * 1.2, r * 0.5);
          ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(tx, ty, r * 0.22, 0, TAU); ctx.fill();
          ctx.strokeStyle = `hsl(${(now / 5) % 360},90%,60%)`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(tx, ty, r * 0.22, now / 100, now / 100 + 1); ctx.stroke();
        } else {
          // Tyrolean hat with a feather
          ctx.fillStyle = '#2f5d34'; ctx.beginPath(); ctx.ellipse(sx, sy - r * 0.45, r * 0.55, r * 0.2, 0, 0, TAU); ctx.fill();
          ctx.fillRect(sx - r * 0.28, sy - r * 0.8, r * 0.56, r * 0.35);
          ctx.strokeStyle = '#fff'; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(sx + r * 0.2, sy - r * 0.7); ctx.quadraticCurveTo(sx + r * 0.7, sy - r * 1.3, sx + r * 0.5, sy - r * 1.5); ctx.stroke();
          // tuba: gold bell beside them, pumping in time
          const pump = 1 + Math.sin(now / 160 + u.id) * 0.08;
          const bx = sx - fy * r * 0.9, by = sy + fx * r * 0.9 - r * 0.6;
          ctx.strokeStyle = '#b8860b'; ctx.lineWidth = Math.max(2, z * 0.1);
          ctx.beginPath(); ctx.arc(sx - fy * r * 0.5, sy + fx * r * 0.5, r * 0.55, 0, TAU); ctx.stroke();
          const g = ctx.createRadialGradient(bx, by, 0, bx, by, r * 0.7 * pump);
          g.addColorStop(0, '#5a4000'); g.addColorStop(0.5, '#ffd700'); g.addColorStop(1, '#b8860b');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, r * 0.7 * pump, 0, TAU); ctx.fill();
        }
        return true;
      }
      case 'scooter': {
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang);
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.ellipse(r * 0.95, 0, r * 0.35, r * 0.18, 0, 0, TAU); ctx.ellipse(-r * 0.95, 0, r * 0.35, r * 0.18, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = col; ctx.strokeStyle = dark; ctx.lineWidth = lw;
        ctx.beginPath(); ctx.ellipse(0, 0, r * 1.05, r * 0.38, 0, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ccc'; ctx.fillRect(r * 0.75, -r * 0.55, r * 0.12, r * 1.1); // handlebar
        ctx.fillStyle = light; ctx.beginPath(); ctx.arc(-r * 0.15, 0, r * 0.45, 0, TAU); ctx.fill(); ctx.stroke(); // helmet
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(r * 0.05, -r * 0.2, r * 0.15, r * 0.4);
        ctx.restore();
        if (moving && Math.random() < 0.15) this.part({ k: 'smoke', x: u.x - fx * 0.35, y: u.y - fy * 0.35, vx: -fx * 0.3, vy: -0.2, life: 500, size: 0.07, col: 'rgba(200,200,200,A)', layer: 1 });
        return true;
      }
      case 'jeepney': {
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang);
        const L = r * 1.5, Wd = r * 0.75;
        ctx.fillStyle = '#111'; for (const [wx, wy] of [[L * 0.6, -Wd], [L * 0.6, Wd], [-L * 0.6, -Wd], [-L * 0.6, Wd]]) { ctx.beginPath(); ctx.ellipse(wx, wy, r * 0.25, r * 0.12, 0, 0, TAU); ctx.fill(); }
        ctx.fillStyle = '#d7dadd'; ctx.strokeStyle = '#555'; ctx.lineWidth = lw;
        ctx.beginPath(); ctx.rect(-L, -Wd, L * 2, Wd * 2); ctx.fill(); ctx.stroke();
        // stripes in every colour, plus yours
        const stripes = ['#e63946', '#ffd60a', '#1d4ed8', col, '#2a9d8f'];
        stripes.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(-L * 0.95, -Wd + (i + 0.5) * (Wd * 2) / (stripes.length + 1), L * 1.5, Wd * 0.18); });
        ctx.fillStyle = col; ctx.fillRect(-L * 0.9, -Wd * 0.55, L * 1.4, Wd * 1.1); // roof
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-L * 0.9, -Wd * 0.55, L * 1.4, Wd * 0.25);
        ctx.fillStyle = '#9aa0a6'; ctx.fillRect(L * 0.55, -Wd * 0.9, L * 0.4, Wd * 1.8); // bonnet
        ctx.fillStyle = '#ffd700'; ctx.beginPath(); ctx.arc(L * 0.8, 0, r * 0.13, 0, TAU); ctx.fill(); // the chrome horse. Well, a gold blob.
        ctx.fillStyle = '#fff'; ctx.fillRect(L * 0.95, -Wd * 0.75, r * 0.1, r * 0.2); ctx.fillRect(L * 0.95, Wd * 0.75 - r * 0.2, r * 0.1, r * 0.2);
        ctx.restore();
        return true;
      }
      case 'bowler': {
        // cricket whites, a cap in team colour, and a red ball in hand
        ctx.fillStyle = '#f4f4f0'; ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, z * 0.07);
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#e8c39e'; ctx.beginPath(); ctx.arc(sx, sy - r * 0.1, r * 0.42, 0, TAU); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sx, sy - r * 0.3, r * 0.42, Math.PI, TAU); ctx.fill();
        ctx.fillRect(sx + (fx >= 0 ? 0 : -r * 0.7), sy - r * 0.34, r * 0.7, r * 0.12);
        const cdLeft = u.cd / this.world.stats(u.owner, u.type).cd;
        const swing = cdLeft > 0.85 ? (1 - cdLeft) / 0.15 * Math.PI : 0; // windmill arm right after a throw
        const ax = sx - fy * r * 0.8, ay = sy + fx * r * 0.8;
        const hx = ax + Math.cos(ang - Math.PI / 2 + swing) * r * 0.7, hy = ay + Math.sin(ang - Math.PI / 2 + swing) * r * 0.7;
        ctx.strokeStyle = '#e8c39e'; ctx.lineWidth = Math.max(1.5, z * 0.07); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(hx, hy); ctx.stroke();
        if (cdLeft < 0.5) { ctx.fillStyle = '#c0141c'; ctx.beginPath(); ctx.arc(hx, hy, Math.max(1.5, r * 0.2), 0, TAU); ctx.fill(); }
        return true;
      }
      case 'germany:infantry': {
        // Landsknecht: puffy striped clothes, a giant feathered hat and a sword taller than him
        const sw = Math.sin(now / 200 + u.id) * 0.15;
        const sa = ang + 0.5 + sw;
        ctx.strokeStyle = '#d8dde3'; ctx.lineWidth = Math.max(2, z * 0.09);
        ctx.beginPath(); ctx.moveTo(sx - Math.cos(sa) * r * 0.5, sy - Math.sin(sa) * r * 0.5); ctx.lineTo(sx + Math.cos(sa) * r * 2.4, sy + Math.sin(sa) * r * 2.4); ctx.stroke();
        ctx.strokeStyle = '#6b4423'; ctx.beginPath(); ctx.moveTo(sx - Math.cos(sa + 1.57) * r * 0.4 + Math.cos(sa) * r * 0.3, sy - Math.sin(sa + 1.57) * r * 0.4 + Math.sin(sa) * r * 0.3); ctx.lineTo(sx + Math.cos(sa + 1.57) * r * 0.4 + Math.cos(sa) * r * 0.3, sy + Math.sin(sa + 1.57) * r * 0.4 + Math.sin(sa) * r * 0.3); ctx.stroke();
        for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#ffce00' : col; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.arc(sx, sy, r, (i / 6) * TAU, ((i + 1) / 6) * TAU); ctx.fill(); }
        ctx.strokeStyle = dark; ctx.lineWidth = Math.max(1, z * 0.04); ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.stroke();
        ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(sx, sy - r * 0.2, r * 0.75, r * 0.38, -0.2, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.5, z * 0.06);
        ctx.beginPath(); ctx.moveTo(sx + r * 0.2, sy - r * 0.4); ctx.quadraticCurveTo(sx + r * 1.0, sy - r * 1.2, sx + r * 0.2, sy - r * 1.5); ctx.stroke();
        ctx.strokeStyle = '#e63946'; ctx.beginPath(); ctx.moveTo(sx - r * 0.1, sy - r * 0.4); ctx.quadraticCurveTo(sx + r * 0.4, sy - r * 1.4, sx - r * 0.4, sy - r * 1.4); ctx.stroke();
        return true;
      }
      case 'pakistan:siege': {
        // Jingle truck: a cab, a tall painted crest, chains of bells, and a gun on the back
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang);
        const L = r * 1.35, Wd = r * 0.75;
        ctx.fillStyle = '#111'; for (const wx of [L * 0.6, -L * 0.2, -L * 0.7]) for (const wy of [-Wd, Wd]) { ctx.beginPath(); ctx.ellipse(wx, wy, r * 0.22, r * 0.11, 0, 0, TAU); ctx.fill(); }
        // cargo bed with painted panels
        const cols = ['#e63946', '#ffd60a', '#06d6a0', '#118ab2', '#ef476f', col];
        for (let i = 0; i < 6; i++) { ctx.fillStyle = cols[(i + u.id) % 6]; ctx.fillRect(-L + (i * L * 1.4) / 6, -Wd, (L * 1.4) / 6 + 0.5, Wd * 2); }
        ctx.strokeStyle = '#ffd700'; ctx.lineWidth = Math.max(1, z * 0.04); ctx.strokeRect(-L, -Wd, L * 1.4, Wd * 2);
        // the crest over the cab
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(L * 0.4, -Wd * 1.05); ctx.lineTo(L * 0.62, 0); ctx.lineTo(L * 0.4, Wd * 1.05); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#2a9d8f'; ctx.fillRect(L * 0.45, -Wd * 0.8, L * 0.55, Wd * 1.6); // cab
        ctx.fillStyle = '#9fd3ff'; ctx.fillRect(L * 0.8, -Wd * 0.6, L * 0.12, Wd * 1.2);
        // bells along the sides
        ctx.fillStyle = '#ffd700';
        for (let i = 0; i < 7; i++) { const bx = -L + (i * L * 1.4) / 6, j = Math.sin(now / 90 + i + u.id) * r * 0.05; ctx.beginPath(); ctx.arc(bx, -Wd - r * 0.1 + j, r * 0.07, 0, TAU); ctx.arc(bx, Wd + r * 0.1 - j, r * 0.07, 0, TAU); ctx.fill(); }
        // weapon
        ctx.fillStyle = '#333';
        if (age >= 4) { for (let i = -1; i <= 1; i++) ctx.fillRect(-L * 0.7, i * r * 0.28 - r * 0.09, r * 1.1, r * 0.18); }
        else ctx.fillRect(-L * 0.6, -r * 0.13, r * 1.4, r * 0.26);
        ctx.restore();
        return true;
      }
    }
    return false; // Leopard, Bubble Tea Gunner, Mactan Warrior: normal body, extras added after
  }

  // Small extras on top of nation units: a tiny flag, and a prop.
  specialExtras(ctx, k, u, sx, sy, r, fx, fy, nation, now) {
    const z = this.cam.z;
    if (k === 'taiwan:ranged') { // a bubble tea in hand
      const cx = sx - fy * r * 0.9, cy = sy + fx * r * 0.9;
      ctx.fillStyle = 'rgba(230,200,160,0.95)'; ctx.fillRect(cx - r * 0.2, cy - r * 0.35, r * 0.4, r * 0.55);
      ctx.fillStyle = '#2b1a10'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(cx - r * 0.1 + i * r * 0.1, cy + r * 0.12, Math.max(1, r * 0.06), 0, TAU); ctx.fill(); }
      ctx.strokeStyle = '#e63946'; ctx.lineWidth = Math.max(1, z * 0.04); ctx.beginPath(); ctx.moveTo(cx + r * 0.05, cy - r * 0.35); ctx.lineTo(cx + r * 0.15, cy - r * 0.65); ctx.stroke();
    }
    if (k === 'philippines:infantry') { // red headband, tails flying
      ctx.strokeStyle = '#e63946'; ctx.lineWidth = Math.max(1.5, z * 0.06);
      ctx.beginPath(); ctx.arc(sx, sy, r * 0.5, 0, TAU); ctx.stroke();
      const wv = Math.sin(now / 120 + u.id) * r * 0.2;
      ctx.beginPath(); ctx.moveTo(sx - fx * r * 0.5, sy - fy * r * 0.5); ctx.lineTo(sx - fx * r * 1.1 - fy * wv, sy - fy * r * 1.1 + fx * wv); ctx.stroke();
    }
    if (z >= 22) { // a tiny national flag on a stick
      const fh = Math.max(5, z * 0.16), fw = fh * 1.5, px = sx + r * 0.9, py = sy - r * 1.9;
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, sy - r * 0.6); ctx.lineTo(px, py); ctx.stroke();
      ctx.drawImage(flagCanvas(nation), px, py, fw, fh);
    }
  }

  drawCow(ctx, c, x, y, selected, hovered, now) {
    const z = this.cam.z;
    const [sx, sy0] = this.toScreen(x, y);
    const big = c.mutant ? 1.45 : 1;
    const r = 0.34 * z * big;
    const moving = Math.abs(c.x - c.px) + Math.abs(c.y - c.py) > 0.001;
    const sy = sy0 - (moving ? Math.abs(Math.sin(now / 110 + c.id)) * z * 0.04 : 0);
    const dir = c.fx < 0 ? -1 : 1;
    if (c.mutant) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 200 + c.id);
      const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 2.4);
      gr.addColorStop(0, `rgba(120,255,60,${0.35 + pulse * 0.2})`); gr.addColorStop(1, 'rgba(120,255,60,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(sx, sy, r * 2.4, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(sx + 1.5, sy + r * 0.75, r * 1.2, r * 0.4, 0, 0, TAU); ctx.fill();
    if (selected || hovered) {
      ctx.strokeStyle = selected ? '#7ee787' : '#ffe680'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(sx, sy + r * 0.5, r * 1.6, r * 0.8, 0, 0, TAU); ctx.stroke();
    }
    ctx.save(); ctx.translate(sx, sy); ctx.scale(dir, 1);
    const body = c.mutant ? '#9bd36a' : '#f4f1ea', spot = c.mutant ? '#3f7a24' : '#2a2a2a';
    // legs
    const step = moving ? Math.sin(now / 80 + c.id) * r * 0.25 : 0;
    ctx.strokeStyle = c.mutant ? '#2f5a1a' : '#555'; ctx.lineWidth = Math.max(1, z * 0.06);
    ctx.beginPath();
    for (const [lx, s] of [[-0.6, 1], [-0.35, -1], [0.45, 1], [0.7, -1]]) { ctx.moveTo(lx * r, r * 0.2); ctx.lineTo(lx * r + step * s, r * 0.75); }
    if (c.mutant) { ctx.moveTo(0.1 * r, r * 0.2); ctx.lineTo(0.1 * r - step, r * 0.8); } // fifth leg. Don't ask.
    ctx.stroke();
    // body
    ctx.fillStyle = body; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 1.05, r * 0.6, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = spot;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse((hash2(c.id, i, 1) - 0.5) * r * 1.3, (hash2(c.id, i, 2) - 0.5) * r * 0.6, r * 0.25, r * 0.18, hash2(c.id, i, 3) * 3, 0, TAU); ctx.fill(); }
    // tail
    ctx.strokeStyle = spot; ctx.beginPath(); ctx.moveTo(-r, -r * 0.2); ctx.quadraticCurveTo(-r * 1.4, -r * 0.1 + Math.sin(now / 200 + c.id) * r * 0.3, -r * 1.25, r * 0.4); ctx.stroke();
    // head
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(r * 1.1, -r * 0.35, r * 0.42, r * 0.36, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
    ctx.fillStyle = c.mutant ? '#c0ff80' : '#f0b8b0';
    ctx.beginPath(); ctx.ellipse(r * 1.38, -r * 0.25, r * 0.2, r * 0.16, 0, 0, TAU); ctx.fill();
    // horns
    ctx.strokeStyle = '#e8dcc0'; ctx.lineWidth = Math.max(1, z * 0.04);
    ctx.beginPath(); ctx.moveTo(r * 1.0, -r * 0.65); ctx.lineTo(r * 0.92, -r * 0.85); ctx.moveTo(r * 1.2, -r * 0.65); ctx.lineTo(r * 1.28, -r * 0.85); ctx.stroke();
    // eyes (three for the mutants)
    if (c.mutant) {
      ctx.fillStyle = '#ff2020';
      for (const ex of [0.98, 1.13, 1.28]) { ctx.beginPath(); ctx.arc(r * ex, -r * 0.48, Math.max(1, r * 0.08), 0, TAU); ctx.fill(); }
    } else { ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(r * 1.15, -r * 0.45, Math.max(0.8, r * 0.07), 0, TAU); ctx.fill(); }
    ctx.restore();
    const max = c.mutant ? 450 : 60;
    if (c.hp < max || selected || hovered) this.bar(ctx, sx - r, sy - r * 1.4, r * 2, Math.max(2, z * 0.06), c.hp / max, null);
  }

  drawCrate(ctx, c, now) {
    const z = this.cam.z;
    const [sx, sy0] = this.toScreen(c.x, c.y);
    const sy = sy0 - Math.abs(Math.sin(now / 400 + c.id)) * z * 0.08;
    const s = z * 0.36;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(sx + 2, sy0 + s * 0.9, s * 1.1, s * 0.4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#b07a3a'; ctx.fillRect(sx - s, sy - s, s * 2, s * 2);
    ctx.fillStyle = '#d29a52'; ctx.fillRect(sx - s, sy - s - s * 0.4, s * 2, s * 0.4);
    ctx.strokeStyle = '#6b4423'; ctx.lineWidth = Math.max(1, z * 0.04);
    ctx.strokeRect(sx - s, sy - s - s * 0.4, s * 2, s * 2.4);
    ctx.beginPath(); ctx.moveTo(sx - s, sy - s); ctx.lineTo(sx + s, sy + s); ctx.moveTo(sx + s, sy - s); ctx.lineTo(sx - s, sy + s); ctx.stroke();
    ctx.fillStyle = '#ffd700'; ctx.font = `bold ${Math.round(z * 0.42)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', sx, sy - s * 1.6 - Math.sin(now / 300) * 2);
    const ph = (now / 1500 + c.id * 0.37) % 1;
    if (ph < 0.15) {
      const a = Math.sin((ph / 0.15) * Math.PI);
      ctx.strokeStyle = `rgba(255,255,200,${a})`; ctx.lineWidth = 1.5;
      const gx = sx + s * 0.6, gy = sy - s * 0.8, rr = z * 0.25 * a;
      ctx.beginPath(); ctx.moveTo(gx - rr, gy); ctx.lineTo(gx + rr, gy); ctx.moveTo(gx, gy - rr); ctx.lineTo(gx, gy + rr); ctx.stroke();
    }
  }

  drawMeteors(ctx, a, now) {
    const w = this.world, z = this.cam.z;
    for (const m of w.s.meteors || []) {
      const t = Math.min(1, (m.t + a * DT) / m.dur);
      const [tx, ty] = this.toScreen(m.x, m.y);
      const pulse = 0.5 + 0.5 * Math.sin(now / 100);
      ctx.strokeStyle = `rgba(255,80,0,${0.6 + pulse * 0.4})`; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.arc(tx, ty, m.r * z, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = `rgba(255,60,0,${0.08 + t * 0.2})`; ctx.beginPath(); ctx.arc(tx, ty, m.r * z, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(0,0,0,${0.15 + t * 0.4})`; ctx.beginPath(); ctx.ellipse(tx, ty, z * (0.4 + t * 1.2), z * (0.2 + t * 0.6), 0, 0, TAU); ctx.fill();
      ctx.font = `bold ${Math.max(12, Math.round(z * 0.6))}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffb000'; ctx.fillText(`☄️ ${Math.max(0, m.dur - m.t).toFixed(1)}s`, tx, ty + m.r * z + 12);
      // the rock itself, coming in from the top right
      const e = t * t;
      const mx = tx + (1 - e) * z * 22, my = ty - (1 - e) * z * 34;
      const rr = z * (0.5 + e * 0.5);
      for (let i = 1; i <= 8; i++) {
        const k = i / 8;
        ctx.fillStyle = `rgba(255,${(180 - i * 15) | 0},40,${0.5 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(mx + k * z * 3, my - k * z * 4.6, rr * (1 - k * 0.6), 0, TAU); ctx.fill();
      }
      ctx.fillStyle = '#4a3b30'; ctx.beginPath(); ctx.arc(mx, my, rr, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ff8a2a'; ctx.beginPath(); ctx.arc(mx - rr * 0.3, my + rr * 0.3, rr * 0.5, 0, TAU); ctx.fill();
    }
  }

  drawFloats(ctx, now) {
    const z = this.cam.z;
    this.floats = this.floats.filter((f) => now - f.t0 < 2000);
    for (const f of this.floats) {
      const t = (now - f.t0) / 2000;
      const [sx, sy] = this.toScreen(f.x, f.y);
      const y = sy - z * 0.6 - t * z * 1.4;
      const size = f.big ? Math.max(16, z * 0.6) : Math.max(11, z * 0.38);
      ctx.font = `bold ${Math.round(size * (t < 0.1 ? 0.6 + t * 4 : 1))}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(f.text, sx, y);
      ctx.fillStyle = f.color; ctx.fillText(f.text, sx, y);
      ctx.globalAlpha = 1;
    }
  }

  drawBubbles(ctx, now, a) {
    const w = this.world, z = this.cam.z;
    for (const [id, b] of this.bubbles) {
      const e = w.get(id);
      if (!e || now - b.t0 > b.ms) { this.bubbles.delete(id); continue; }
      let x, y;
      if (e.kind === 'b') { x = e.x + e.size / 2; y = e.y - 0.6; } else { x = e.px + (e.x - e.px) * a; y = e.py + (e.y - e.py) * a - 0.5; }
      if (!this.onScreen(x, y, 2)) continue;
      const [sx, sy] = this.toScreen(x, y);
      ctx.font = `${Math.max(11, Math.round(z * 0.36))}px system-ui`;
      const tw = Math.min(260, ctx.measureText(b.text).width) + 14, th = Math.max(18, z * 0.6);
      const bx = sx - tw / 2, by = sy - th - 12;
      const t = (now - b.t0) / b.ms;
      ctx.globalAlpha = t > 0.85 ? (1 - t) / 0.15 : 1;
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5;
      this.roundRect(ctx, bx, by, tw, th, 8); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx - 5, by + th - 1); ctx.lineTo(sx, by + th + 8); ctx.lineTo(sx + 5, by + th - 1); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(sx - 5, by + th); ctx.lineTo(sx, by + th + 8); ctx.lineTo(sx + 5, by + th); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.text, sx, by + th / 2 + 1, 250);
      ctx.globalAlpha = 1;
    }
  }

  drawFx(ctx, now, ground) {
    const z = this.cam.z;
    const keep = [];
    for (const f of this.fx) {
      const t = (now - f.t0) / f.d;
      if (t >= 1) {
        if (f.boom && !f.done) {
          f.done = true;
          const big = f.k === 'bombfall';
          keep.push({ k: 'boom', x: f.x2, y: f.y2, t0: now, d: big ? 600 : 400, r: big ? 1.3 : f.k === 'ball' || f.k === 'rocket' ? 0.9 : 0.5 });
          if (big) for (let i = 0; i < 5; i++) { const a = Math.random() * TAU, s = 2 + Math.random() * 3; this.part({ k: 'debris', x: f.x2, y: f.y2, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 3, g: 9, drag: 1, life: 700, r0: Math.random() * 6, layer: 1 }); }
        }
        continue;
      }
      keep.push(f);
      if (t < 0) continue; // not started yet
      const isGround = f.k === 'die' || f.k === 'smoke';
      if (isGround !== ground) continue;
      const [sx, sy] = this.toScreen(f.x, f.y);
      if (sx < -400 || sy < -400 || sx > this.vw + 400 || sy > this.vh + 400) continue;
      switch (f.k) {
        case 'arrow': case 'bullet': case 'shell': case 'ball': case 'rocket': {
          const [tx, ty] = this.toScreen(f.x2, f.y2);
          const arc = f.k === 'ball' ? z * 1.5 : f.k === 'rocket' ? z * 2.2 : f.k === 'arrow' ? z * 0.5 : 0;
          const px = sx + (tx - sx) * t, py = sy + (ty - sy) * t - Math.sin(t * Math.PI) * arc;
          if (f.k === 'arrow') {
            const dx = tx - sx, dy = ty - sy - Math.cos(t * Math.PI) * arc * Math.PI, l = Math.hypot(dx, dy) || 1;
            ctx.strokeStyle = '#d2b48c'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - dx / l * z * 0.4, py - dy / l * z * 0.4); ctx.stroke();
          } else if (f.k === 'bullet') {
            ctx.strokeStyle = 'rgba(255,240,150,0.9)'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(sx + (tx - sx) * Math.max(0, t - 0.3), sy + (ty - sy) * Math.max(0, t - 0.3)); ctx.lineTo(px, py); ctx.stroke();
            if (t < 0.3) { ctx.fillStyle = 'rgba(255,220,100,0.9)'; ctx.beginPath(); ctx.arc(sx, sy, z * 0.12, 0, TAU); ctx.fill(); }
          } else if (f.k === 'shell') {
            ctx.strokeStyle = 'rgba(255,200,80,1)'; ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.moveTo(sx + (tx - sx) * Math.max(0, t - 0.2), sy + (ty - sy) * Math.max(0, t - 0.2)); ctx.lineTo(px, py); ctx.stroke();
          } else if (f.k === 'rocket') {
            ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.arc(px, py, z * 0.1, 0, TAU); ctx.fill();
            if (Math.random() < 0.6) this.part({ k: 'smoke', x: this.toWorld(px, py)[0], y: this.toWorld(px, py)[1], vx: 0, vy: -0.2, life: 600, size: 0.1, col: 'rgba(200,200,200,A)', layer: 1 });
          } else {
            ctx.fillStyle = f.age >= 2 ? '#222' : '#776655';
            ctx.beginPath(); ctx.arc(px, py, z * 0.15, 0, TAU); ctx.fill();
          }
          break;
        }
        case 'cricket': { // a red cricket ball that bounces once before it hits
          const [tx, ty] = this.toScreen(f.x2, f.y2);
          const bt = 0.7, h = t < bt ? Math.sin((t / bt) * Math.PI) * z * 0.6 : Math.sin(((t - bt) / (1 - bt)) * Math.PI) * z * 0.35;
          const px = sx + (tx - sx) * t, py = sy + (ty - sy) * t - h;
          ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(sx + (tx - sx) * t, sy + (ty - sy) * t, z * 0.1, z * 0.05, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#c0141c'; ctx.beginPath(); ctx.arc(px, py, Math.max(2, z * 0.1), 0, TAU); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(px, py, Math.max(2, z * 0.1), -0.6, 0.6); ctx.stroke();
          break;
        }
        case 'pearls': { // tapioca pearls
          const [tx, ty] = this.toScreen(f.x2, f.y2);
          ctx.fillStyle = '#2b1a10';
          for (let i = 0; i < 3; i++) {
            const tt = Math.max(0, Math.min(1, t * 1.2 - i * 0.1));
            ctx.beginPath(); ctx.arc(sx + (tx - sx) * tt, sy + (ty - sy) * tt - Math.sin(tt * Math.PI) * z * 0.2, Math.max(1.5, z * 0.07), 0, TAU); ctx.fill();
          }
          break;
        }
        case 'spark': {
          ctx.strokeStyle = `rgba(255,255,220,${1 - t})`; ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let i = 0; i < 4; i++) { const a = i * 1.57 + f.t0; ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(a) * z * 0.3 * t, sy + Math.sin(a) * z * 0.3 * t); }
          ctx.stroke();
          break;
        }
        case 'die': {
          ctx.globalAlpha = Math.min(1, (1 - t) * 3);
          ctx.fillStyle = f.cls === 'cav' ? '#3a2a1a' : '#5a1010';
          ctx.beginPath(); ctx.ellipse(sx, sy + z * 0.1, z * 0.3, z * 0.18, f.r0 || 0, 0, TAU); ctx.fill();
          // a little cross for the fallen
          if (t > 0.05 && z >= 18) {
            ctx.strokeStyle = 'rgba(230,230,230,0.6)'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(sx, sy - z * 0.25); ctx.lineTo(sx, sy + z * 0.05); ctx.moveTo(sx - z * 0.1, sy - z * 0.15); ctx.lineTo(sx + z * 0.1, sy - z * 0.15); ctx.stroke();
          }
          if (t < 0.05) { ctx.fillStyle = `rgba(200,200,200,${0.5 - t * 10})`; ctx.beginPath(); ctx.arc(sx, sy, z * (0.3 + t * 8), 0, TAU); ctx.fill(); }
          ctx.globalAlpha = 1;
          break;
        }
        case 'boom': {
          const r = f.r * z * (0.4 + t * 0.8);
          const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
          g.addColorStop(0, `rgba(255,255,200,${1 - t})`); g.addColorStop(0.4, `rgba(255,140,0,${0.9 * (1 - t)})`); g.addColorStop(1, 'rgba(120,20,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
          break;
        }
        case 'smoke': {
          for (let i = 0; i < 4; i++) {
            const tt = (t * 3 + i / 4) % 1;
            ctx.fillStyle = `rgba(60,60,60,${0.35 * (1 - tt) * (1 - t)})`;
            ctx.beginPath(); ctx.arc(sx + Math.sin(i * 2.1) * z * 0.4 + tt * z * 0.6, sy - tt * z * 1.6, z * (0.3 + tt * 0.5) * f.r * 0.5, 0, TAU); ctx.fill();
          }
          ctx.fillStyle = `rgba(40,30,20,${0.6 * (1 - t)})`;
          ctx.fillRect(sx - f.r * z * 0.45, sy - f.r * z * 0.45, f.r * z * 0.9, f.r * z * 0.9);
          break;
        }
        case 'ring': {
          ctx.strokeStyle = f.color; ctx.globalAlpha = 1 - t; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(sx, sy, z * (1 + t * 4), 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
          break;
        }
        case 'nuke': this.drawNukeFx(ctx, sx, sy, t, f.d); break;
        case 'bombfall': { // a bomb dropping from a plane, with a whistle trail
          const [tx, ty] = this.toScreen(f.x2, f.y2);
          const py = sy + (ty - sy) * t * t;
          ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, py); ctx.stroke();
          ctx.fillStyle = '#222'; ctx.beginPath(); ctx.ellipse(tx, py, Math.max(1.5, z * 0.06), Math.max(2.5, z * 0.13), 0, 0, TAU); ctx.fill();
          break;
        }
        case 'flak': { // a tracer up into the sky, then a black puff with a flash
          const [tx, ty] = this.toScreen(f.x2, f.y2);
          const ft = 0.25;
          if (t < ft) {
            const q = t / ft;
            ctx.strokeStyle = 'rgba(255,220,120,0.95)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(sx + (tx - sx) * Math.max(0, q - 0.4), sy + (ty - sy) * Math.max(0, q - 0.4)); ctx.lineTo(sx + (tx - sx) * q, sy + (ty - sy) * q); ctx.stroke();
          } else {
            const q = (t - ft) / (1 - ft);
            if (q < 0.15) { ctx.fillStyle = `rgba(255,200,80,${1 - q / 0.15})`; ctx.beginPath(); ctx.arc(tx, ty, z * 0.35, 0, TAU); ctx.fill(); }
            ctx.fillStyle = `rgba(30,30,30,${0.75 * (1 - q)})`;
            for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(tx + Math.cos(i * 2.1 + f.t0) * z * 0.15, ty + Math.sin(i * 2.1 + f.t0) * z * 0.12 - q * z * 0.2, z * (0.15 + q * 0.3), 0, TAU); ctx.fill(); }
          }
          break;
        }
      }
    }
    this.fx = keep;
  }

  drawNukeFx(ctx, sx, sy, t, dur) {
    const z = this.cam.z;
    const secs = t * dur / 1000;
    // flash
    if (secs < 0.4) { ctx.fillStyle = `rgba(255,255,240,${0.6 * (1 - secs / 0.4)})`; ctx.fillRect(-50, -50, this.vw + 100, this.vh + 100); }
    // shockwave
    if (secs < 2) {
      const r = NUKE.blastRadius * z * (secs / 1.2);
      ctx.strokeStyle = `rgba(255,255,255,${Math.max(0, 1 - secs / 2)})`; ctx.lineWidth = z * 0.4;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.stroke();
    }
    // fireball
    const fb = Math.max(0, 1 - secs / 3);
    if (fb > 0) {
      const r = NUKE.killRadius * z * (0.5 + (1 - fb) * 0.7);
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, `rgba(255,255,255,${fb})`); g.addColorStop(0.3, `rgba(255,230,120,${fb})`);
      g.addColorStop(0.7, `rgba(255,100,0,${fb * 0.8})`); g.addColorStop(1, 'rgba(150,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
    }
    // mushroom cloud
    const rise = Math.min(1, secs / 3);
    const fade = secs > 5 ? Math.max(0, 1 - (secs - 5) / 4) : 1;
    if (fade > 0) {
      const top = sy - rise * z * 7;
      const sg = ctx.createLinearGradient(sx - z * 0.8, 0, sx + z * 0.8, 0);
      sg.addColorStop(0, `rgba(140,110,95,${0.75 * fade})`); sg.addColorStop(1, `rgba(80,65,60,${0.75 * fade})`);
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.moveTo(sx - z * 1.2, sy); ctx.lineTo(sx - z * 0.6, top); ctx.lineTo(sx + z * 0.6, top); ctx.lineTo(sx + z * 1.2, sy); ctx.fill();
      for (let i = 0; i < 11; i++) {
        const a = i * 0.57 + secs * 0.3;
        const rr = z * (1.4 + rise * 1.6);
        const cx = sx + Math.cos(a) * rr * 0.85, cy = top + Math.sin(a) * rr * 0.35;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
        g.addColorStop(0, `rgba(255,${Math.max(60, 150 - secs * 20) | 0},60,${0.8 * fade * Math.max(0.2, 1 - secs / 4)})`);
        g.addColorStop(0.5, `rgba(120,100,90,${0.6 * fade})`);
        g.addColorStop(1, 'rgba(80,70,70,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.fill();
      }
    }
  }

  drawMissiles(ctx, a, now) {
    const w = this.world, z = this.cam.z;
    for (const m of w.s.missiles) {
      const [tx, ty] = this.toScreen(m.x, m.y);
      // target warning
      const pulse = 0.5 + 0.5 * Math.sin(now / 120);
      ctx.strokeStyle = `rgba(255,30,30,${0.5 + pulse * 0.5})`; ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.arc(tx, ty, NUKE.blastRadius * z, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(255,0,0,${0.08 + pulse * 0.1})`;
      ctx.beginPath(); ctx.arc(tx, ty, NUKE.killRadius * z, 0, TAU); ctx.fill();
      ctx.font = `${Math.round(z * 1.4)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('☢️', tx, ty);
      const left = Math.max(0, m.dur - m.t);
      ctx.font = `bold ${Math.max(12, Math.round(z * 0.6))}px system-ui`; ctx.fillStyle = '#ff4040';
      ctx.fillText(left.toFixed(1) + 's', tx, ty + z * 1.2);
      // missile on an arc
      const f = Math.min(1, (m.t + a * DT) / m.dur);
      const [ox, oy] = this.toScreen(m.sx, m.sy);
      const dist = Math.hypot(m.x - m.sx, m.y - m.sy);
      const hgt = Math.min(dist * 0.35, 18) * z;
      const P = (ff) => [ox + (tx - ox) * ff, oy + (ty - oy) * ff - Math.sin(ff * Math.PI) * hgt];
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k <= 20; k++) { const ff = f * k / 20; const [px, py] = P(ff); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.stroke();
      const [mx, my] = P(f), [nx, ny] = P(Math.min(1, f + 0.01));
      const ang = Math.atan2(ny - my, nx - mx);
      ctx.save(); ctx.translate(mx, my); ctx.rotate(ang);
      ctx.fillStyle = '#eee'; ctx.fillRect(-z * 0.6, -z * 0.12, z * 1.0, z * 0.24);
      ctx.fillStyle = '#d00'; ctx.beginPath(); ctx.moveTo(z * 0.4, -z * 0.12); ctx.lineTo(z * 0.7, 0); ctx.lineTo(z * 0.4, z * 0.12); ctx.fill();
      ctx.fillStyle = `rgba(255,${150 + Math.random() * 100},0,0.9)`; ctx.beginPath(); ctx.moveTo(-z * 0.6, -z * 0.1); ctx.lineTo(-z * (0.9 + Math.random() * 0.4), 0); ctx.lineTo(-z * 0.6, z * 0.1); ctx.fill();
      ctx.restore();
      if (Math.random() < 0.5) { const [wx, wy] = this.toWorld(mx, my); this.part({ k: 'smoke', x: wx, y: wy, vx: 0, vy: 0, life: 1500, size: 0.15, col: 'rgba(220,220,220,A)', layer: 1 }); }
      // shadow
      const sxp = ox + (tx - ox) * f, syp = oy + (ty - oy) * f;
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(sxp, syp, z * 0.4, z * 0.15, 0, 0, TAU); ctx.fill();
    }
  }

  addMarker(x, y, color) { (this.markers ||= []).push({ x, y, color, t0: performance.now() }); }
  drawMarkers(ctx, now) {
    if (!this.markers) return;
    const z = this.cam.z;
    this.markers = this.markers.filter((m) => now - m.t0 < 500);
    for (const m of this.markers) {
      const t = (now - m.t0) / 500;
      const [sx, sy] = this.toScreen(m.x, m.y);
      ctx.strokeStyle = m.color; ctx.globalAlpha = 1 - t; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(sx, sy, z * 0.5 * (1 - t * 0.6), z * 0.3 * (1 - t * 0.6), 0, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx, sy - z * 0.6 * (1 - t)); ctx.lineTo(sx, sy); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  drawGhost(ctx, g) {
    const w = this.world, z = this.cam.z, d = BLDS[g.type];
    const [sx, sy] = this.toScreen(g.x, g.y);
    const S = d.size * z;
    if (g.type === 'city') {
      const r = cityRadius(w.s.players[this.me].age);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx + S / 2, sy + S / 2, r * z, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.fillStyle = g.ok ? 'rgba(80,220,100,0.25)' : 'rgba(240,60,60,0.3)';
    ctx.fillRect(sx, sy, S, S);
    const pl = w.s.players[this.me];
    const spr = bldSprite(g.type, pl.color, pl.age);
    ctx.globalAlpha = 0.65;
    ctx.drawImage(spr.img, sx, sy - spr.top * z, S, S + spr.top * z);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = g.ok ? '#7ee787' : '#ff7b72'; ctx.lineWidth = 2;
    ctx.strokeRect(sx, sy, S, S);
    if (!g.ok && g.why) {
      ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = '#000'; ctx.fillText(g.why, sx + S / 2 + 1, sy + S + 5);
      ctx.fillStyle = '#ff7b72'; ctx.fillText(g.why, sx + S / 2, sy + S + 4);
    }
  }

  // ---------- minimap ----------
  drawMinimap(mm) {
    const w = this.world, g = mm.getContext('2d');
    const W = w.W, H = w.H;
    if (!this.mmBase) {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const cg = c.getContext('2d'); const img = cg.createImageData(W, H);
      for (let i = 0; i < W * H; i++) {
        const x = i % W, y = (i / W) | 0;
        let c3 = this.groundColor(x + 0.5, y + 0.5);
        if (w.map.tiles[i] === T.FOREST) c3 = [30, 62, 28];
        if (w.map.dep[i] === DEP.METAL) c3 = [200, 200, 210];
        if (w.map.dep[i] === DEP.OIL) c3 = [10, 10, 10];
        img.data[i * 4] = c3[0]; img.data[i * 4 + 1] = c3[1]; img.data[i * 4 + 2] = c3[2]; img.data[i * 4 + 3] = 255;
      }
      cg.putImageData(img, 0, 0);
      this.mmBase = c;
    }
    const sc = mm.width / W;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.mmBase, 0, 0, mm.width, mm.height);
    g.imageSmoothingEnabled = false;
    // territory tint is faint, so draw it a few times to make it stronger on the minimap
    for (let i = 0; i < 3; i++) g.drawImage(this.terrCanvas, 0, 0, mm.width, mm.height);
    for (const b of w.s.blds) {
      if (!w.ally(this.me, b.owner) && !this.isExplored(b.x, b.y)) continue;
      g.fillStyle = w.s.players[b.owner].color;
      g.fillRect(b.x * sc - 1, b.y * sc - 1, b.size * sc + 2, b.size * sc + 2);
      g.strokeStyle = '#000'; g.lineWidth = 1; g.strokeRect(b.x * sc - 1, b.y * sc - 1, b.size * sc + 2, b.size * sc + 2);
    }
    for (const u of w.s.units) {
      if (!w.ally(this.me, u.owner) && !this.isVisible(u.x, u.y)) continue;
      g.fillStyle = w.s.players[u.owner].color;
      g.fillRect(u.x * sc - 1, u.y * sc - 1, 2.5, 2.5);
    }
    for (const c of w.s.critters || []) {
      if (!this.isVisible(c.x, c.y)) continue;
      g.fillStyle = c.mutant ? '#7dff3a' : '#f4f1ea';
      g.fillRect(c.x * sc - 1, c.y * sc - 1, 2, 2);
    }
    if (this.fogMode === 'on') { g.imageSmoothingEnabled = true; g.drawImage(this.fogCanvas, 0, 0, mm.width, mm.height); }
    const blink = Math.floor(performance.now() / 300) % 2;
    for (const c of w.s.crates || []) {
      if (!this.isExplored(c.x, c.y)) continue;
      g.fillStyle = blink ? '#ffd700' : '#b07a3a';
      g.fillRect(c.x * sc - 1.5, c.y * sc - 1.5, 3, 3);
    }
    for (const m of w.s.missiles) {
      g.strokeStyle = blink ? '#ff0000' : '#ffffff'; g.lineWidth = 2;
      g.beginPath(); g.arc(m.x * sc, m.y * sc, NUKE.blastRadius * sc, 0, TAU); g.stroke();
    }
    for (const m of w.s.meteors || []) {
      g.strokeStyle = blink ? '#ff8000' : '#ffffff'; g.lineWidth = 2;
      g.beginPath(); g.arc(m.x * sc, m.y * sc, m.r * sc + 2, 0, TAU); g.stroke();
    }
    if (this.pings) {
      const now = performance.now();
      this.pings = this.pings.filter((p) => now - p.t0 < 2500);
      for (const p of this.pings) {
        const t = (now - p.t0) / 2500;
        g.strokeStyle = p.color ? p.color : `rgba(255,60,60,${1 - t})`; g.globalAlpha = 1 - t; g.lineWidth = 2;
        g.beginPath(); g.arc(p.x * sc, p.y * sc, 4 + (t * 3 % 1) * 10, 0, TAU); g.stroke();
        g.globalAlpha = 1;
      }
    }
    // camera rectangle
    g.strokeStyle = '#fff'; g.lineWidth = 1;
    g.strokeRect(this.cam.x * sc, (this.cam.y + 34 / this.cam.z) * sc, (this.vw / this.cam.z) * sc, ((this.vh - 246) / this.cam.z) * sc);
  }
  ping(x, y, color) { (this.pings ||= []).push({ x, y, color, t0: performance.now() }); }
}
