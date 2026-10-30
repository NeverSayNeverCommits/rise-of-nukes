// Draws the game on a canvas. Nothing in here changes the game state.
import { T, DEP } from './sim/map.js';
import { hash2 } from './sim/rng.js';
import { UNITS, BLDS, NUKE, cityRadius } from './sim/data.js';
import { DT } from './sim/sim.js';

const TS = 32;     // pixels per tile in the cached terrain chunks
const CHUNK = 16;  // tiles per chunk side

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export class Renderer {
  constructor(canvas, world, me) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.me = me;
    this.cam = { x: 0, y: 0, z: 32 };
    this.chunks = new Map();
    this.fx = [];
    this.shake = 0;
    this.frame = 0;
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
  chunk(cx, cy) {
    const key = cy * 1000 + cx;
    let c = this.chunks.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = CHUNK * TS;
    const g = c.getContext('2d');
    const w = this.world, m = w.map;
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const x = cx * CHUNK + tx, y = cy * CHUNK + ty;
        if (x >= w.W || y >= w.H) continue;
        this.drawTile(g, m, x, y, tx * TS, ty * TS);
      }
    }
    this.chunks.set(key, c);
    return c;
  }

  drawTile(g, m, x, y, px, py) {
    const t = m.tiles[y * m.w + x];
    const h = hash2(x, y, 7), h2 = hash2(x, y, 13), h3 = hash2(x, y, 29);
    const at = (ax, ay) => (ax < 0 || ay < 0 || ax >= m.w || ay >= m.h ? T.MOUNTAIN : m.tiles[ay * m.w + ax]);
    // grass base everywhere (forest and shores sit on it)
    g.fillStyle = `hsl(${92 + h * 18}, ${34 + h2 * 10}%, ${27 + h3 * 5}%)`;
    g.fillRect(px, py, TS, TS);
    if (t === T.GRASS || t === T.FOREST) {
      g.fillStyle = 'rgba(0,0,0,0.08)';
      for (let i = 0; i < 3; i++) g.fillRect(px + hash2(x, y, 40 + i) * TS, py + hash2(x, y, 50 + i) * TS, 2, 2);
      g.fillStyle = 'rgba(255,255,200,0.06)';
      for (let i = 0; i < 2; i++) g.fillRect(px + hash2(x, y, 60 + i) * TS, py + hash2(x, y, 70 + i) * TS, 2, 2);
    }
    if (t === T.WATER) {
      g.fillStyle = `hsl(208, 55%, ${26 + h * 4}%)`;
      g.fillRect(px, py, TS, TS);
      // shoreline
      g.fillStyle = 'rgba(210,190,130,0.55)';
      if (at(x, y - 1) !== T.WATER) g.fillRect(px, py, TS, 4);
      if (at(x, y + 1) !== T.WATER) g.fillRect(px, py + TS - 4, TS, 4);
      if (at(x - 1, y) !== T.WATER) g.fillRect(px, py, 4, TS);
      if (at(x + 1, y) !== T.WATER) g.fillRect(px + TS - 4, py, 4, TS);
      g.strokeStyle = 'rgba(255,255,255,0.12)';
      g.lineWidth = 1.5;
      g.beginPath();
      const wy = py + 8 + h2 * 16, wx = px + 4 + h3 * 10;
      g.moveTo(wx, wy); g.quadraticCurveTo(wx + 5, wy - 3, wx + 10, wy); g.stroke();
    } else if (t === T.MOUNTAIN) {
      g.fillStyle = `hsl(30, 10%, ${30 + h * 6}%)`;
      g.fillRect(px, py, TS, TS);
      const peaks = 1 + Math.floor(h2 * 2);
      for (let i = 0; i < peaks; i++) {
        const bx = px + 3 + hash2(x, y, 80 + i) * 10 + i * 8, base = py + TS - 2, ph = 16 + hash2(x, y, 90 + i) * 10, pw = 13 + h3 * 5;
        g.fillStyle = '#7d756b';
        g.beginPath(); g.moveTo(bx, base); g.lineTo(bx + pw / 2, base - ph); g.lineTo(bx + pw, base); g.fill();
        g.fillStyle = '#5c554d';
        g.beginPath(); g.moveTo(bx + pw / 2, base - ph); g.lineTo(bx + pw, base); g.lineTo(bx + pw * 0.6, base); g.fill();
        g.fillStyle = '#e8e8e8';
        g.beginPath(); g.moveTo(bx + pw / 2, base - ph); g.lineTo(bx + pw * 0.38, base - ph * 0.72); g.lineTo(bx + pw * 0.62, base - ph * 0.72); g.fill();
      }
    } else if (t === T.FOREST) {
      g.fillStyle = 'rgba(10,40,10,0.35)';
      g.fillRect(px, py, TS, TS);
      const n = 2 + Math.floor(h * 2);
      for (let i = 0; i < n; i++) {
        const tx = px + 5 + hash2(x, y, 100 + i) * (TS - 10), ty = py + 6 + hash2(x, y, 110 + i) * (TS - 10);
        const r = 6 + hash2(x, y, 120 + i) * 4;
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.beginPath(); g.ellipse(tx + 2, ty + 3, r, r * 0.7, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = `hsl(${120 + hash2(x, y, 130 + i) * 25}, 45%, ${17 + hash2(x, y, 140 + i) * 8}%)`;
        g.beginPath(); g.arc(tx, ty, r, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(160,220,120,0.18)';
        g.beginPath(); g.arc(tx - r * 0.3, ty - r * 0.3, r * 0.45, 0, Math.PI * 2); g.fill();
      }
    }
  }

  drawDeposits(ctx, x0, y0, x1, y1) {
    const w = this.world, m = w.map, z = this.cam.z;
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
            ctx.fillStyle = '#4a4f55';
            ctx.beginPath(); ctx.arc(sx + ox, sy + oy + 2, r, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#9aa3ad';
            ctx.beginPath(); ctx.arc(sx + ox, sy + oy, r, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#d6dde4';
            ctx.beginPath(); ctx.arc(sx + ox - r * 0.3, sy + oy - r * 0.3, r * 0.35, 0, Math.PI * 2); ctx.fill();
          }
        } else {
          ctx.fillStyle = '#0a0a0a';
          ctx.beginPath(); ctx.ellipse(sx, sy, z * 0.75, z * 0.5, 0, 0, Math.PI * 2); ctx.fill();
          const gr = ctx.createLinearGradient(sx - z * 0.5, sy - z * 0.3, sx + z * 0.5, sy + z * 0.3);
          gr.addColorStop(0, 'rgba(120,60,200,0.35)'); gr.addColorStop(0.5, 'rgba(40,200,180,0.25)'); gr.addColorStop(1, 'rgba(220,180,40,0.3)');
          ctx.fillStyle = gr;
          ctx.beginPath(); ctx.ellipse(sx - z * 0.1, sy - z * 0.08, z * 0.4, z * 0.22, 0, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
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
      img.data[i * 4] = cols[o][0]; img.data[i * 4 + 1] = cols[o][1]; img.data[i * 4 + 2] = cols[o][2]; img.data[i * 4 + 3] = 38;
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
    // fog image
    const d = this.fogImg.data;
    for (let i = 0; i < W * H; i++) {
      d[i * 4] = 8; d[i * 4 + 1] = 10; d[i * 4 + 2] = 14;
      d[i * 4 + 3] = vis[i] ? 0 : this.explored[i] ? 120 : 255;
    }
    this.fogCanvas.getContext('2d').putImageData(this.fogImg, 0, 0);
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
          if (e.melee) { this.fx.push({ k: 'spark', x: e.x2, y: e.y2, t0: now, d: 200 }); break; }
          if (e.cls === 'sie') this.fx.push({ k: 'ball', x: e.x, y: e.y, x2: e.x2, y2: e.y2, t0: now, d: 550, boom: true, age: e.age });
          else if (e.cls === 'cav' && e.age >= 3) this.fx.push({ k: 'shell', x: e.x, y: e.y, x2: e.x2, y2: e.y2, t0: now, d: 160, boom: true });
          else if (e.age >= 2) this.fx.push({ k: 'bullet', x: e.x, y: e.y, x2: e.x2, y2: e.y2, t0: now, d: 120 });
          else this.fx.push({ k: 'arrow', x: e.x, y: e.y, x2: e.x2, y2: e.y2, t0: now, d: 300 });
          break;
        case 'die':
          if (seen) this.fx.push({ k: 'die', x: e.x, y: e.y, t0: now, d: 4000, cls: e.cls });
          break;
        case 'destroyed':
          if (seen) {
            this.fx.push({ k: 'boom', x: e.x, y: e.y, t0: now, d: 900, r: e.size * 0.9 });
            this.fx.push({ k: 'smoke', x: e.x, y: e.y, t0: now, d: 5000, r: e.size });
          }
          break;
        case 'nuke':
          this.fx.push({ k: 'nuke', x: e.x, y: e.y, t0: now, d: 9000 });
          this.shake = Math.max(this.shake, 18);
          break;
        case 'intercept':
          this.fx.push({ k: 'boom', x: e.x, y: e.y, t0: now, d: 1200, r: 2.5, sky: true });
          break;
        case 'captured':
        case 'convert':
          this.fx.push({ k: 'ring', x: e.x, y: e.y, t0: now, d: 1200, color: w.s.players[e.to ?? e.p].color });
          break;
      }
    }
    if (this.fx.length > 1500) this.fx.splice(0, this.fx.length - 1500);
  }

  // ---------- main draw ----------
  // ui: { sel:Set, hover, box, ghost, alpha, targetMode }
  draw(ui) {
    const ctx = this.ctx, w = this.world, z = this.cam.z, dpr = this.dpr;
    this.frame++;
    this.updateTerritory();
    if (this.frame % 6 === 1) this.updateFog();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, this.vw, this.vh);

    let shx = 0, shy = 0;
    if (this.shake > 0.3) { shx = (Math.random() - 0.5) * this.shake; shy = (Math.random() - 0.5) * this.shake; this.shake *= 0.94; }
    ctx.save();
    ctx.translate(shx, shy);

    const x0 = Math.max(0, Math.floor(this.cam.x)), y0 = Math.max(0, Math.floor(this.cam.y));
    const x1 = Math.min(w.W - 1, Math.floor(this.cam.x + this.vw / z)), y1 = Math.min(w.H - 1, Math.floor(this.cam.y + this.vh / z));

    // terrain chunks
    ctx.imageSmoothingEnabled = z < TS;
    for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) {
      for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
        const [sx, sy] = this.toScreen(cx * CHUNK, cy * CHUNK);
        ctx.drawImage(this.chunk(cx, cy), Math.floor(sx), Math.floor(sy), Math.ceil(CHUNK * z) + 1, Math.ceil(CHUNK * z) + 1);
      }
    }
    // territory tint + borders
    ctx.imageSmoothingEnabled = false;
    {
      const [sx, sy] = this.toScreen(0, 0);
      ctx.drawImage(this.terrCanvas, sx, sy, w.W * z, w.H * z);
    }
    ctx.lineWidth = 2;
    this.borders.forEach((segs, p) => {
      if (!segs.length) return;
      ctx.strokeStyle = rgba(w.s.players[p].color, 0.85);
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (let i = 0; i < segs.length; i += 4) {
        if (segs[i + 2] < x0 - 1 || segs[i] > x1 + 2 || segs[i + 3] < y0 - 1 || segs[i + 1] > y1 + 2) continue;
        const [ax, ay] = this.toScreen(segs[i], segs[i + 1]);
        const [bx, by] = this.toScreen(segs[i + 2], segs[i + 3]);
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      }
      ctx.stroke();
    });
    ctx.setLineDash([]);

    this.drawDeposits(ctx, x0, y0, x1, y1);

    // fallout zones
    const now = performance.now();
    for (const f of w.s.fallout) {
      const [sx, sy] = this.toScreen(f.x, f.y);
      const left = (f.until - w.s.tick) * DT;
      const a = Math.min(1, left / 10);
      const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, f.r * z);
      gr.addColorStop(0, `rgba(160,255,40,${0.28 * a})`); gr.addColorStop(1, `rgba(120,200,20,${0.05 * a})`);
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(sx, sy, f.r * z, 0, Math.PI * 2); ctx.fill();
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

    // buildings
    const sel = ui.sel;
    for (const b of w.s.blds) {
      if (b.x > x1 + 1 || b.y > y1 + 1 || b.x + b.size < x0 - 1 || b.y + b.size < y0 - 1) continue;
      const mine = w.ally(this.me, b.owner);
      if (!mine && !this.isExplored(b.x + b.size / 2, b.y + b.size / 2)) continue;
      this.drawBld(ctx, b, sel.has(b.id), ui.hover === b.id);
    }

    // units
    const a = ui.alpha;
    for (const u of w.s.units) {
      const x = u.px + (u.x - u.px) * a, y = u.py + (u.y - u.py) * a;
      if (x < x0 - 1 || y < y0 - 1 || x > x1 + 2 || y > y1 + 2) continue;
      if (!w.ally(this.me, u.owner) && !this.isVisible(x, y)) continue;
      this.drawUnit(ctx, u, x, y, sel.has(u.id), ui.hover === u.id);
    }

    // effects on top
    this.drawFx(ctx, now, false);

    // fog
    if (this.fogMode === 'on') {
      ctx.imageSmoothingEnabled = true;
      const [sx, sy] = this.toScreen(0, 0);
      ctx.drawImage(this.fogCanvas, sx, sy, w.W * z, w.H * z);
    }

    // rally points of selected buildings
    for (const id of sel) {
      const b = w.get(id);
      if (!b || b.kind !== 'b' || !b.rally || b.owner !== this.me) continue;
      let rx = b.rally.x, ry = b.rally.y;
      if (b.rally.t) { const t = w.get(b.rally.t); if (!t) continue; [rx, ry] = w.centre(t); }
      const [ax, ay] = this.toScreen(b.x + b.size / 2, b.y + b.size / 2);
      const [bx, by] = this.toScreen(rx, ry);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = `${Math.round(z * 0.7)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('🚩', bx + z * 0.15, by);
    }

    // order markers (move clicks)
    this.drawMarkers(ctx, now);

    // missiles and their targets: everyone can see these
    this.drawMissiles(ctx, a, now);

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

  drawBld(ctx, b, selected, hovered) {
    const w = this.world, z = this.cam.z, d = BLDS[b.type];
    const pl = w.s.players[b.owner];
    const [sx, sy] = this.toScreen(b.x, b.y);
    const S = b.size * z;
    const pad = z * 0.08;
    ctx.save();
    if (!b.done) ctx.globalAlpha = 0.6;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(sx + pad + z * 0.12, sy + pad + z * 0.15, S - pad * 2, S - pad * 2);
    // ground plate
    ctx.fillStyle = b.type === 'farm' ? '#6b5a2e' : '#4a4338';
    ctx.fillRect(sx + pad, sy + pad, S - pad * 2, S - pad * 2);
    if (b.type === 'farm') {
      ctx.strokeStyle = b.done ? '#c9b347' : '#8a7a3a'; ctx.lineWidth = Math.max(1, z * 0.08);
      ctx.beginPath();
      for (let i = 1; i < 6; i++) { const yy = sy + pad + (S - pad * 2) * i / 6; ctx.moveTo(sx + pad * 2, yy); ctx.lineTo(sx + S - pad * 2, yy); }
      ctx.stroke();
    }
    // body
    const inset = b.type === 'farm' ? S * 0.32 : b.type === 'city' ? S * 0.14 : S * 0.16;
    ctx.fillStyle = shade(pl.color, -0.35);
    ctx.fillRect(sx + inset, sy + inset, S - inset * 2, S - inset * 2);
    ctx.fillStyle = pl.color;
    ctx.fillRect(sx + inset, sy + inset, S - inset * 2, (S - inset * 2) * 0.55);
    if (b.type === 'city') {
      // corner towers
      const tr = z * 0.32;
      ctx.fillStyle = shade(pl.color, -0.5);
      for (const [cx, cy] of [[sx + inset, sy + inset], [sx + S - inset, sy + inset], [sx + inset, sy + S - inset], [sx + S - inset, sy + S - inset]]) {
        ctx.beginPath(); ctx.arc(cx, cy, tr, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.strokeStyle = selected ? '#fff' : hovered ? (w.enemy(this.me, b.owner) ? '#ff7b72' : '#ffe680') : 'rgba(0,0,0,0.6)';
    ctx.lineWidth = selected || hovered ? 2 : 1;
    ctx.strokeRect(sx + inset, sy + inset, S - inset * 2, S - inset * 2);
    // icon
    ctx.font = `${Math.round(Math.min(S * 0.5, z * (b.size === 1 ? 0.75 : 1.1)))}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(d.icon, sx + S / 2, sy + S / 2 + z * 0.04);
    if (!b.done) {
      // scaffolding
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(230,200,140,0.8)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = -b.size; i <= b.size; i += 0.5) { ctx.moveTo(sx + Math.max(0, i) * z, sy + Math.max(0, -i) * z); ctx.lineTo(sx + Math.min(b.size, b.size + i) * z, sy + Math.min(b.size, b.size - i) * z); }
      ctx.stroke();
      this.bar(ctx, sx + pad, sy + S - z * 0.22, S - pad * 2, z * 0.12, b.prog / d.time, '#e3b341');
    }
    ctx.restore();
    // labels
    if (b.type === 'city' && z >= 18) {
      ctx.font = `bold ${Math.max(10, Math.round(z * 0.36))}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#000'; ctx.fillText(b.name || 'City', sx + S / 2 + 1, sy + 1);
      ctx.fillStyle = '#fff'; ctx.fillText(b.name || 'City', sx + S / 2, sy);
    }
    if (b.type === 'silo' && b.stock > 0) {
      ctx.font = `bold ${Math.round(z * 0.4)}px system-ui`; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillStyle = '#ff4040'; ctx.fillText(`☢×${b.stock}`, sx + S, sy + 2);
    }
    const maxHp = d.hp;
    if (b.done && (b.hp < maxHp || selected || hovered)) this.bar(ctx, sx + pad, sy - z * 0.18, S - pad * 2, z * 0.1, b.hp / maxHp, null);
    if (b.done && b.q.length && w.ally(this.me, b.owner)) {
      const it = b.q[0];
      this.bar(ctx, sx + pad, sy + S - z * 0.12, S - pad * 2, z * 0.08, 1 - it.t / it.total, it.blocked ? '#ff7b72' : '#58a6ff');
    }
    if (d.gather && b.done && w.ally(this.me, b.owner) && (selected || z >= 30)) {
      const n = (w.workerCount && w.workerCount.get(b.id)) || 0;
      ctx.font = `bold ${Math.max(9, Math.round(z * 0.3))}px system-ui`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = n ? '#7ee787' : '#ffb3ad';
      ctx.fillText(`${n}/${d.slots}`, sx + pad + 2, sy + pad + 1);
    }
  }

  bar(ctx, x, y, w, h, f, color) {
    f = Math.max(0, Math.min(1, f));
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = color || (f > 0.6 ? '#3fb950' : f > 0.3 ? '#e3b341' : '#f85149');
    ctx.fillRect(x, y, w * f, h);
  }

  drawUnit(ctx, u, x, y, selected, hovered) {
    const w = this.world, z = this.cam.z, d = UNITS[u.type];
    const pl = w.s.players[u.owner];
    const age = pl.age;
    const [sx, sy] = this.toScreen(x, y);
    const r = d.radius * z;
    // smooth the facing direction a bit
    let f = this.facing.get(u.id);
    if (!f) { f = { x: u.fx, y: u.fy }; this.facing.set(u.id, f); }
    f.x += (u.fx - f.x) * 0.25; f.y += (u.fy - f.y) * 0.25;
    const fl = Math.hypot(f.x, f.y) || 1;
    const fx = f.x / fl, fy = f.y / fl;
    const col = pl.color, dark = shade(col, -0.45), light = shade(col, 0.35);

    // selection / shadow
    if (selected) {
      ctx.strokeStyle = '#7ee787'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(sx, sy + r * 0.55, r * 1.35, r * 0.75, 0, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(sx + 1, sy + r * 0.6, r * 1.05, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (hovered) {
      ctx.strokeStyle = w.enemy(this.me, u.owner) ? '#ff7b72' : '#ffe680'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy, r * 1.5, 0, Math.PI * 2); ctx.stroke();
    }
    // working bob
    const bob = u.working ? Math.sin(performance.now() / 150 + u.id) * z * 0.04 : 0;

    ctx.lineWidth = Math.max(1, z * 0.05);
    ctx.strokeStyle = dark;
    switch (d.cls) {
      case 'cit': {
        ctx.fillStyle = light;
        ctx.beginPath(); ctx.arc(sx, sy + bob, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#e8c39e';
        ctx.beginPath(); ctx.arc(sx, sy - r * 0.15 + bob, r * 0.45, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#8b5a2b'; ctx.lineWidth = Math.max(1, z * 0.06);
        ctx.beginPath(); ctx.moveTo(sx + fx * r * 0.3, sy + fy * r * 0.3 + bob); ctx.lineTo(sx + fx * r * 1.4, sy + fy * r * 1.4 + bob); ctx.stroke();
        break;
      }
      case 'inf': {
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = age >= 2 ? '#333' : '#c0c0c0'; ctx.lineWidth = Math.max(1.5, z * 0.07);
        ctx.beginPath(); ctx.moveTo(sx - fy * r * 0.6, sy + fx * r * 0.6); ctx.lineTo(sx - fy * r * 0.6 + fx * r * 1.9, sy + fx * r * 0.6 + fy * r * 1.9); ctx.stroke();
        ctx.fillStyle = age >= 3 ? '#4b5320' : dark;
        ctx.beginPath(); ctx.arc(sx, sy, r * 0.45, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'rng': {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(sx + fx * r * 1.2, sy + fy * r * 1.2);
        ctx.lineTo(sx - fx * r * 0.8 - fy * r, sy - fy * r * 0.8 + fx * r);
        ctx.lineTo(sx - fx * r * 0.8 + fy * r, sy - fy * r * 0.8 - fx * r);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = light;
        ctx.beginPath(); ctx.arc(sx, sy, r * 0.32, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'cav': {
        if (age >= 3) {
          // tank: hull, turret, barrel
          const L = r * 1.25, Wd = r * 0.9;
          ctx.save(); ctx.translate(sx, sy); ctx.rotate(Math.atan2(fy, fx));
          ctx.fillStyle = '#222'; ctx.fillRect(-L, -Wd - r * 0.2, L * 2, r * 0.35); ctx.fillRect(-L, Wd - r * 0.15, L * 2, r * 0.35);
          ctx.fillStyle = dark; ctx.fillRect(-L, -Wd, L * 2, Wd * 2);
          ctx.fillStyle = col; ctx.fillRect(-L * 0.8, -Wd * 0.75, L * 1.6, Wd * 1.5);
          ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#333'; ctx.fillRect(r * 0.3, -r * 0.12, r * 1.5, r * 0.24);
          ctx.restore();
        } else {
          ctx.save(); ctx.translate(sx, sy); ctx.rotate(Math.atan2(fy, fx));
          ctx.fillStyle = '#7a4e2d';
          ctx.beginPath(); ctx.ellipse(0, 0, r * 1.2, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(r * 1.0, 0, r * 0.4, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = col; ctx.strokeStyle = dark;
          ctx.beginPath(); ctx.arc(-r * 0.1, 0, r * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
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
        ctx.beginPath(); ctx.arc(-r * 0.6, r * 0.85, r * 0.25, 0, Math.PI * 2); ctx.arc(r * 0.5, r * 0.85, r * 0.25, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }
    }
    // health bar
    const max = w.stats(u.owner, u.type).hp;
    if (u.hp < max * 0.999 || selected || hovered) this.bar(ctx, sx - r * 1.2, sy - r * 1.7, r * 2.4, Math.max(2, z * 0.07), u.hp / max, null);
    // attrition hint
    if (u.attr && w.s.tick - u.attr < 12 && z >= 20 && w.ally(this.me, u.owner)) {
      ctx.fillStyle = 'rgba(255,90,90,0.9)'; ctx.font = `${Math.round(z * 0.3)}px system-ui`; ctx.textAlign = 'center';
      ctx.fillText('↓', sx + r * 1.3, sy - r);
    }
  }

  drawFx(ctx, now, ground) {
    const z = this.cam.z;
    const keep = [];
    for (const f of this.fx) {
      const t = (now - f.t0) / f.d;
      if (t >= 1) {
        if (f.boom && !f.done) { f.done = true; keep.push({ k: 'boom', x: f.x2, y: f.y2, t0: now, d: 400, r: f.k === 'ball' ? 0.9 : 0.5 }); }
        continue;
      }
      keep.push(f);
      const isGround = f.k === 'die' || f.k === 'smoke';
      if (isGround !== ground) continue;
      const [sx, sy] = this.toScreen(f.x, f.y);
      if (sx < -400 || sy < -400 || sx > this.vw + 400 || sy > this.vh + 400) continue;
      switch (f.k) {
        case 'arrow': case 'bullet': case 'shell': case 'ball': {
          const [tx, ty] = this.toScreen(f.x2, f.y2);
          const px = sx + (tx - sx) * t, py = sy + (ty - sy) * t - (f.k === 'ball' ? Math.sin(t * Math.PI) * z * 1.5 : f.k === 'arrow' ? Math.sin(t * Math.PI) * z * 0.5 : 0);
          if (f.k === 'arrow') {
            const dx = tx - sx, dy = ty - sy, l = Math.hypot(dx, dy) || 1;
            ctx.strokeStyle = '#d2b48c'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - dx / l * z * 0.4, py - dy / l * z * 0.4); ctx.stroke();
          } else if (f.k === 'bullet') {
            ctx.strokeStyle = 'rgba(255,240,150,0.9)'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(sx + (tx - sx) * Math.max(0, t - 0.3), sy + (ty - sy) * Math.max(0, t - 0.3)); ctx.lineTo(px, py); ctx.stroke();
            if (t < 0.3) { ctx.fillStyle = 'rgba(255,220,100,0.9)'; ctx.beginPath(); ctx.arc(sx, sy, z * 0.12, 0, Math.PI * 2); ctx.fill(); }
          } else if (f.k === 'shell') {
            ctx.strokeStyle = 'rgba(255,200,80,1)'; ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.moveTo(sx + (tx - sx) * Math.max(0, t - 0.2), sy + (ty - sy) * Math.max(0, t - 0.2)); ctx.lineTo(px, py); ctx.stroke();
          } else {
            ctx.fillStyle = f.age >= 2 ? '#222' : '#776655';
            ctx.beginPath(); ctx.arc(px, py, z * 0.15, 0, Math.PI * 2); ctx.fill();
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
          ctx.globalAlpha = 1 - t;
          ctx.fillStyle = f.cls === 'cav' ? '#3a2a1a' : '#5a1010';
          ctx.beginPath(); ctx.ellipse(sx, sy + z * 0.1, z * 0.3, z * 0.18, 0, 0, Math.PI * 2); ctx.fill();
          if (t < 0.1) { ctx.fillStyle = `rgba(200,200,200,${0.5 - t * 5})`; ctx.beginPath(); ctx.arc(sx, sy, z * (0.3 + t * 4), 0, Math.PI * 2); ctx.fill(); }
          ctx.globalAlpha = 1;
          break;
        }
        case 'boom': {
          const r = f.r * z * (0.4 + t * 0.8);
          const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
          g.addColorStop(0, `rgba(255,255,200,${1 - t})`); g.addColorStop(0.4, `rgba(255,140,0,${0.9 * (1 - t)})`); g.addColorStop(1, 'rgba(120,20,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'smoke': {
          for (let i = 0; i < 4; i++) {
            const tt = (t * 3 + i / 4) % 1;
            ctx.fillStyle = `rgba(60,60,60,${0.35 * (1 - tt) * (1 - t)})`;
            ctx.beginPath(); ctx.arc(sx + Math.sin(i * 2.1) * z * 0.4 + tt * z * 0.6, sy - tt * z * 1.6, z * (0.3 + tt * 0.5) * f.r * 0.5, 0, Math.PI * 2); ctx.fill();
          }
          ctx.fillStyle = `rgba(40,30,20,${0.6 * (1 - t)})`;
          ctx.fillRect(sx - f.r * z * 0.45, sy - f.r * z * 0.45, f.r * z * 0.9, f.r * z * 0.9);
          break;
        }
        case 'ring': {
          ctx.strokeStyle = f.color; ctx.globalAlpha = 1 - t; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(sx, sy, z * (1 + t * 4), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
          break;
        }
        case 'nuke': this.drawNukeFx(ctx, sx, sy, t, f.d); break;
      }
    }
    this.fx = keep;
  }

  drawNukeFx(ctx, sx, sy, t, dur) {
    const z = this.cam.z;
    const secs = t * dur / 1000;
    // shockwave
    if (secs < 2) {
      const r = NUKE.blastRadius * z * (secs / 1.2);
      ctx.strokeStyle = `rgba(255,255,255,${Math.max(0, 1 - secs / 2)})`; ctx.lineWidth = z * 0.4;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
    }
    // scorched ground
    const g0 = ctx.createRadialGradient(sx, sy, 0, sx, sy, NUKE.killRadius * z * 1.1);
    g0.addColorStop(0, `rgba(30,15,5,${0.85 * (1 - t)})`); g0.addColorStop(1, 'rgba(30,15,5,0)');
    ctx.fillStyle = g0; ctx.beginPath(); ctx.arc(sx, sy, NUKE.killRadius * z * 1.1, 0, Math.PI * 2); ctx.fill();
    // fireball
    const fb = Math.max(0, 1 - secs / 3);
    if (fb > 0) {
      const r = NUKE.killRadius * z * (0.5 + (1 - fb) * 0.7);
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, `rgba(255,255,255,${fb})`); g.addColorStop(0.3, `rgba(255,230,120,${fb})`);
      g.addColorStop(0.7, `rgba(255,100,0,${fb * 0.8})`); g.addColorStop(1, 'rgba(150,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
    }
    // mushroom cloud
    const rise = Math.min(1, secs / 3);
    const fade = secs > 5 ? Math.max(0, 1 - (secs - 5) / 4) : 1;
    if (fade > 0) {
      const top = sy - rise * z * 7;
      ctx.fillStyle = `rgba(110,90,80,${0.7 * fade})`;
      ctx.fillRect(sx - z * 0.7, top, z * 1.4, sy - top);
      for (let i = 0; i < 9; i++) {
        const a = i * 0.7 + secs * 0.3;
        const rr = z * (1.4 + rise * 1.6);
        const cx = sx + Math.cos(a) * rr * 0.8, cy = top + Math.sin(a) * rr * 0.35;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
        g.addColorStop(0, `rgba(255,${150 - secs * 20},60,${0.8 * fade * Math.max(0.2, 1 - secs / 4)})`);
        g.addColorStop(0.5, `rgba(120,100,90,${0.6 * fade})`);
        g.addColorStop(1, 'rgba(80,70,70,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.fill();
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
      ctx.beginPath(); ctx.arc(tx, ty, NUKE.blastRadius * z, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(255,0,0,${0.08 + pulse * 0.1})`;
      ctx.beginPath(); ctx.arc(tx, ty, NUKE.killRadius * z, 0, Math.PI * 2); ctx.fill();
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
      // shadow
      const sxp = ox + (tx - ox) * f, syp = oy + (ty - oy) * f;
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(sxp, syp, z * 0.4, z * 0.15, 0, 0, Math.PI * 2); ctx.fill();
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
      ctx.beginPath(); ctx.ellipse(sx, sy, z * 0.5 * (1 - t * 0.6), z * 0.3 * (1 - t * 0.6), 0, 0, Math.PI * 2); ctx.stroke();
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
      ctx.beginPath(); ctx.arc(sx + S / 2, sy + S / 2, r * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.fillStyle = g.ok ? 'rgba(80,220,100,0.35)' : 'rgba(240,60,60,0.35)';
    ctx.fillRect(sx, sy, S, S);
    ctx.strokeStyle = g.ok ? '#7ee787' : '#ff7b72'; ctx.lineWidth = 2;
    ctx.strokeRect(sx, sy, S, S);
    ctx.font = `${Math.round(Math.min(S * 0.6, z * 1.1))}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.8; ctx.fillText(d.icon, sx + S / 2, sy + S / 2); ctx.globalAlpha = 1;
    if (!g.ok && g.why) {
      ctx.font = 'bold 13px system-ui'; ctx.textBaseline = 'top';
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
      const pal = { [T.GRASS]: [62, 94, 44], [T.FOREST]: [28, 58, 26], [T.WATER]: [30, 70, 110], [T.MOUNTAIN]: [100, 92, 82] };
      for (let i = 0; i < W * H; i++) {
        let c3 = pal[w.map.tiles[i]];
        if (w.map.dep[i] === DEP.METAL) c3 = [200, 200, 210];
        if (w.map.dep[i] === DEP.OIL) c3 = [10, 10, 10];
        img.data[i * 4] = c3[0]; img.data[i * 4 + 1] = c3[1]; img.data[i * 4 + 2] = c3[2]; img.data[i * 4 + 3] = 255;
      }
      cg.putImageData(img, 0, 0);
      this.mmBase = c;
    }
    const sc = mm.width / W;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.mmBase, 0, 0, mm.width, mm.height);
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
    if (this.fogMode === 'on') { g.imageSmoothingEnabled = true; g.drawImage(this.fogCanvas, 0, 0, mm.width, mm.height); }
    const blink = Math.floor(performance.now() / 300) % 2;
    for (const m of w.s.missiles) {
      g.strokeStyle = blink ? '#ff0000' : '#ffffff'; g.lineWidth = 2;
      g.beginPath(); g.arc(m.x * sc, m.y * sc, NUKE.blastRadius * sc, 0, Math.PI * 2); g.stroke();
    }
    if (this.pings) {
      const now = performance.now();
      this.pings = this.pings.filter((p) => now - p.t0 < 2500);
      for (const p of this.pings) {
        const t = (now - p.t0) / 2500;
        g.strokeStyle = `rgba(255,60,60,${1 - t})`; g.lineWidth = 2;
        g.beginPath(); g.arc(p.x * sc, p.y * sc, 4 + (t * 3 % 1) * 10, 0, Math.PI * 2); g.stroke();
      }
    }
    // camera rectangle
    g.strokeStyle = '#fff'; g.lineWidth = 1;
    g.strokeRect(this.cam.x * sc, (this.cam.y + 34 / this.cam.z) * sc, (this.vw / this.cam.z) * sc, ((this.vh - 246) / this.cam.z) * sc);
  }
  ping(x, y) { (this.pings ||= []).push({ x, y, t0: performance.now() }); }
}
