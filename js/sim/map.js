// Map generation. Fully deterministic from the seed (no trig, only + - * / and integer hashing).
import { hash2, makeRand } from './rng.js';

export const T = { GRASS: 0, FOREST: 1, WATER: 2, MOUNTAIN: 3 };
export const DEP = { NONE: 0, METAL: 1, OIL: 2 };

function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise(x, y, cell, seed) {
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  const fx = smooth(x / cell - gx), fy = smooth(y / cell - gy);
  const a = hash2(gx, gy, seed), b = hash2(gx + 1, gy, seed);
  const c = hash2(gx, gy + 1, seed), d = hash2(gx + 1, gy + 1, seed);
  const top = a + (b - a) * fx, bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

function fractal(x, y, seed, base) {
  return (valueNoise(x, y, base, seed) * 0.6 +
          valueNoise(x, y, base / 2, seed + 101) * 0.3 +
          valueNoise(x, y, base / 4, seed + 202) * 0.1);
}

// Start positions as fractions of the map: 4 corners first, then edge middles.
const START_SPOTS = [
  [0.17, 0.17], [0.83, 0.83], [0.83, 0.17], [0.17, 0.83],
  [0.5, 0.12], [0.5, 0.88], [0.12, 0.5], [0.88, 0.5],
];

export function genMap(seed, nPlayers, sizeTiles) {
  const w = sizeTiles, h = sizeTiles;
  const tiles = new Uint8Array(w * h);
  const dep = new Uint8Array(w * h);
  const rand = makeRand(seed ^ 0x5bd1e995);
  const idx = (x, y) => y * w + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < w && y < h;

  // Base terrain from noise.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = fractal(x, y, seed, 24);
      const f = fractal(x, y, seed + 7, 12);
      let t = T.GRASS;
      if (n < 0.28) t = T.WATER;
      else if (n > 0.76) t = T.MOUNTAIN;
      else if (f > 0.6) t = T.FOREST;
      // map edge: a thin ring of mountains looks tidy and stops units at the border
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) t = T.MOUNTAIN;
      tiles[idx(x, y)] = t;
    }
  }

  const cx = w / 2, cy = h / 2;
  const starts = [];
  for (let i = 0; i < nPlayers; i++) {
    const s = START_SPOTS[i % START_SPOTS.length];
    starts.push([Math.floor(s[0] * w), Math.floor(s[1] * h)]);
  }

  const disc = (x0, y0, r, fn) => {
    const ri = Math.ceil(r);
    for (let y = y0 - ri; y <= y0 + ri; y++) {
      for (let x = x0 - ri; x <= x0 + ri; x++) {
        if (!inb(x, y) || x === 0 || y === 0 || x === w - 1 || y === h - 1) continue;
        const dx = x - x0, dy = y - y0;
        if (dx * dx + dy * dy <= r * r) fn(x, y);
      }
    }
  };

  // Corridors from each start to the centre so nobody is walled in.
  const carve = (x0, y0, x1, y1, width) => {
    const dx = x1 - x0, dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + (dx * i) / steps), y = Math.round(y0 + (dy * i) / steps);
      disc(x, y, width, (px, py) => { tiles[idx(px, py)] = T.GRASS; });
    }
  };
  for (const [sx, sy] of starts) carve(sx, sy, Math.floor(cx), Math.floor(cy), 1.5);
  // Ring between neighbouring starts too, so there are several routes.
  for (let i = 0; i < starts.length; i++) {
    const a = starts[i], b = starts[(i + 1) % starts.length];
    if (starts.length > 1 && i % 2 === 0) carve(a[0], a[1], b[0], b[1], 1);
  }

  // Clear and decorate each start area.
  for (const [sx, sy] of starts) {
    disc(sx, sy, 9, (x, y) => { tiles[idx(x, y)] = T.GRASS; });
    const dx = sx < cx ? 1 : -1, dy = sy < cy ? 1 : -1;
    // forests behind the city
    disc(sx - dx * 8, sy + dy * 1, 3, (x, y) => { tiles[idx(x, y)] = T.FOREST; });
    disc(sx + dx * 2, sy - dy * 8, 2.5, (x, y) => { tiles[idx(x, y)] = T.FOREST; });
    // three metal deposits close by
    dep[idx(sx + dx * 6, sy - dy * 3)] = DEP.METAL;
    dep[idx(sx - dx * 3, sy + dy * 6)] = DEP.METAL;
    dep[idx(sx + dx * 5, sy + dy * 5)] = DEP.METAL;
    // one oil deposit towards the centre, just inside the borders of the Industrial Age
    const ox = sx + dx * 9, oy = sy + dy * 4;
    disc(ox, oy, 1.6, (x, y) => { tiles[idx(x, y)] = T.GRASS; });
    carve(sx, sy, ox, oy, 1);
    dep[idx(ox, oy)] = DEP.OIL;
  }

  // Flood fill to find tiles reachable from player 1.
  const reach = new Uint8Array(w * h);
  const stack = [idx(starts[0][0], starts[0][1])];
  reach[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i - x) / w;
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [ox, oy] of nb) {
      const nx = x + ox, ny = y + oy;
      if (!inb(nx, ny)) continue;
      const j = idx(nx, ny);
      if (!reach[j] && tiles[j] === T.GRASS) { reach[j] = 1; stack.push(j); }
    }
  }
  // Fill unreachable grass pockets with forest, so nothing is stranded.
  for (let i = 0; i < w * h; i++) if (tiles[i] === T.GRASS && !reach[i]) tiles[i] = T.FOREST;

  // Extra deposits scattered across the map, not too close to starts or each other.
  const farFromStarts = (x, y, d) => starts.every(([sx, sy]) => (x - sx) * (x - sx) + (y - sy) * (y - sy) >= d * d);
  const placed = [];
  const farFromPlaced = (x, y, d) => placed.every(([px, py]) => (x - px) * (x - px) + (y - py) * (y - py) >= d * d);
  const scatter = (count, type, minStartDist) => {
    let tries = 0, n = 0;
    while (n < count && tries < 4000) {
      tries++;
      const x = 2 + Math.floor(rand() * (w - 4)), y = 2 + Math.floor(rand() * (h - 4));
      const i = idx(x, y);
      if (!reach[i] || dep[i] || tiles[i] !== T.GRASS) continue;
      if (!farFromStarts(x, y, minStartDist) || !farFromPlaced(x, y, 6)) continue;
      // need room for a 2x2 building around it
      let room = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (tiles[idx(x + ox, y + oy)] === T.GRASS) room++;
      if (room < 7) continue;
      dep[i] = type; placed.push([x, y]); n++;
    }
  };
  const scale = (w * h) / (128 * 128);
  scatter(Math.round((5 + nPlayers * 2) * scale), DEP.METAL, 12);
  scatter(Math.round((4 + nPlayers * 2) * scale), DEP.OIL, 13);

  return { w, h, tiles, dep, starts };
}
