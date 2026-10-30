// A* path finding on the tile grid (8 directions, no corner cutting).
// Deterministic: same inputs always give the same path.

const SQRT2 = Math.SQRT2;
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [-1, 1, SQRT2], [1, -1, SQRT2], [-1, -1, SQRT2]];

export class PathFinder {
  constructor(w, h) {
    this.w = w; this.h = h;
    const n = w * h;
    this.g = new Float64Array(n);
    this.f = new Float64Array(n);
    this.from = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.done = new Uint32Array(n);
    this.gen = 0;
    this.heap = new Int32Array(n + 8);
    this.hsize = 0;
  }

  push(i) {
    const heap = this.heap, f = this.f;
    let k = this.hsize++;
    heap[k] = i;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (f[heap[p]] < f[i] || (f[heap[p]] === f[i] && heap[p] < i)) break;
      heap[k] = heap[p]; k = p;
    }
    heap[k] = i;
  }

  pop() {
    const heap = this.heap, f = this.f;
    const top = heap[0];
    const last = heap[--this.hsize];
    let k = 0;
    const n = this.hsize;
    while (true) {
      let c = 2 * k + 1;
      if (c >= n) break;
      if (c + 1 < n && (f[heap[c + 1]] < f[heap[c]] || (f[heap[c + 1]] === f[heap[c]] && heap[c + 1] < heap[c]))) c++;
      if (f[last] < f[heap[c]] || (f[last] === f[heap[c]] && last < heap[c])) break;
      heap[k] = heap[c]; k = c;
    }
    heap[k] = last;
    return top;
  }

  // pass: Uint8Array, 1 = walkable.
  // rect: [x0, y0, x1, y1] goal area in tiles (x1/y1 exclusive), tol: accepted distance from it.
  // exact: optional [x, y] final point to walk to when the goal is reached.
  find(pass, sx, sy, rect, tol, exact, maxIter = 5000) {
    const w = this.w, h = this.h;
    this.gen++;
    if (this.gen > 4000000000) { this.gen = 1; this.seen.fill(0); this.done.fill(0); }
    const gen = this.gen;
    const stx = Math.min(w - 1, Math.max(0, Math.floor(sx)));
    const sty = Math.min(h - 1, Math.max(0, Math.floor(sy)));
    const start = sty * w + stx;
    const [rx0, ry0, rx1, ry1] = rect;

    const distRect = (x, y) => {
      const px = x + 0.5, py = y + 0.5;
      const dx = Math.max(rx0 - px, 0, px - rx1);
      const dy = Math.max(ry0 - py, 0, py - ry1);
      return [dx, dy];
    };
    const heur = (x, y) => {
      const [dx, dy] = distRect(x, y);
      const mn = dx < dy ? dx : dy, mx = dx < dy ? dy : dx;
      return mx + (SQRT2 - 1) * mn;
    };
    const isGoal = (x, y) => {
      const [dx, dy] = distRect(x, y);
      return dx * dx + dy * dy <= tol * tol;
    };

    this.hsize = 0;
    this.g[start] = 0;
    this.f[start] = heur(stx, sty);
    this.from[start] = -1;
    this.seen[start] = gen;
    this.push(start);

    let best = start, bestH = this.f[start], found = -1, iter = 0;
    while (this.hsize > 0 && iter < maxIter) {
      iter++;
      const cur = this.pop();
      if (this.done[cur] === gen) continue;
      this.done[cur] = gen;
      const cx = cur % w, cy = (cur - cx) / w;
      if (isGoal(cx, cy)) { found = cur; break; }
      const hc = this.f[cur] - this.g[cur];
      if (hc < bestH || (hc === bestH && this.g[cur] < this.g[best])) { best = cur; bestH = hc; }
      for (let d = 0; d < 8; d++) {
        const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (!pass[ni]) continue;
        if (d >= 4 && (!pass[cy * w + nx] || !pass[ny * w + cx])) continue;
        if (this.done[ni] === gen) continue;
        const ng = this.g[cur] + DIRS[d][2];
        if (this.seen[ni] === gen && ng >= this.g[ni]) continue;
        this.seen[ni] = gen;
        this.g[ni] = ng;
        this.f[ni] = ng + heur(nx, ny);
        this.from[ni] = cur;
        this.push(ni);
      }
    }

    const end = found >= 0 ? found : best;
    const tilesRev = [];
    for (let i = end; i !== -1; i = this.from[i]) tilesRev.push(i);
    tilesRev.reverse();
    const pts = [];
    for (let k = 1; k < tilesRev.length; k++) {
      const i = tilesRev[k];
      const x = i % w;
      pts.push(x + 0.5, (i - x) / w + 0.5);
    }
    if (found >= 0 && exact) {
      const ex = Math.floor(exact[0]), ey = Math.floor(exact[1]);
      if (ex >= 0 && ey >= 0 && ex < w && ey < h && pass[ey * w + ex]) {
        if (pts.length >= 2) { pts[pts.length - 2] = exact[0]; pts[pts.length - 1] = exact[1]; }
        else pts.push(exact[0], exact[1]);
      }
    }
    return { pts: smooth(pass, w, h, sx, sy, pts), reached: found >= 0 };
  }
}

// Walkable straight line check, with a small body radius.
export function lineClear(pass, w, h, x0, y0, x1, y1, r = 0.3) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(len / 0.25) + 1;
  for (let i = 0; i <= steps; i++) {
    const x = x0 + (dx * i) / steps, y = y0 + (dy * i) / steps;
    for (let c = 0; c < 4; c++) {
      const px = Math.floor(x + (c & 1 ? r : -r)), py = Math.floor(y + (c & 2 ? r : -r));
      if (px < 0 || py < 0 || px >= w || py >= h || !pass[py * w + px]) return false;
    }
  }
  return true;
}

function smooth(pass, w, h, sx, sy, pts) {
  if (pts.length <= 2) return pts;
  const out = [];
  let ax = sx, ay = sy;
  const n = pts.length / 2;
  let i = 0;
  while (i < n - 1) {
    // furthest point we can see from the anchor (look ahead a limited number)
    let j = i + 1, last = i;
    const lim = Math.min(n - 1, i + 12);
    for (; j <= lim; j++) {
      if (lineClear(pass, w, h, ax, ay, pts[2 * j], pts[2 * j + 1])) last = j;
      else break;
    }
    if (last === i) last = i; // can't skip; just go to i
    out.push(pts[2 * last], pts[2 * last + 1]);
    ax = pts[2 * last]; ay = pts[2 * last + 1];
    i = last === i ? i + 1 : last;
    if (last === n - 1) return out;
  }
  out.push(pts[2 * (n - 1)], pts[2 * (n - 1) + 1]);
  return out;
}
