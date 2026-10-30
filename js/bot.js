// Computer players. A bot only runs on the host's browser. It reads the game and sends the same
// commands a human would, through the normal lockstep turns, so other players stay in sync.
// (This file isn't part of the simulation, so it may use Math.random.)
import { UNITS, BLDS, TECHS, AGES, AGE_UP, NUKE, RES, UPGRADE, WONDERS, upgradeCost, cityLimit, forNation, techCost, techMissing, commerceLevel, gatherCap, tradeRate, MARKET } from './sim/data.js';
import { NATIONS } from './sim/nations.js';
import { DEP, T } from './sim/map.js';

export const BOT_LEVELS = {
  easy: {
    name: 'Easy', think: 60, workers: [12, 16, 22, 28, 32], army: [3, 6, 10, 14, 18], firstAttack: 540, waveEvery: 240, armyShare: 0.45,
    ageDelay: 120, techs: 0.35, cities: 0.5, wonders: false, nukes: false, upgrades: false,
  },
  normal: {
    name: 'Normal', think: 30, workers: [18, 26, 36, 46, 54], army: [6, 12, 18, 26, 34], firstAttack: 330, waveEvery: 150, armyShare: 0.6,
    ageDelay: 15, techs: 0.75, cities: 0.8, wonders: true, nukes: true, upgrades: true,
  },
  hard: {
    name: 'Hard', think: 20, workers: [22, 34, 48, 60, 70], army: [8, 16, 26, 36, 48], firstAttack: 240, waveEvery: 100, armyShare: 0.75,
    ageDelay: 0, techs: 1, cities: 1, wonders: true, nukes: true, upgrades: true,
  },
};

// A name that suits the nation. Lobby names are limited to 16 letters.
const BOT_NAMES = {
  germany: ['Kaiser Klaus', 'Frau Ordnung', 'Otto Mattic'],
  taiwan: ['Auntie Chen', 'Chip Wang', 'Boba Lin'],
  philippines: ['Tito Boy', 'Lola Remedios', 'Kuya Lapu'],
  pakistan: ['Captain Imran', 'Wasim the Wall', 'Uncle Shoaib'],
  random: ['Bot Commander', 'General Nuisance', 'Admiral Beep', 'Major Glitch'],
};
export function botName(nation, used) {
  const list = BOT_NAMES[nation] || BOT_NAMES.random;
  const all = list.concat(BOT_NAMES.random);
  return all.find((n) => !used.includes(n)) || `Bot ${used.length + 1}`;
}

// How many workers each resource should get, by age. Shares don't need to add up to 1.
const WANT = [
  { food: 0.6, wood: 0.4, metal: 0, oil: 0 },
  { food: 0.45, wood: 0.3, metal: 0.25, oil: 0 },
  { food: 0.4, wood: 0.25, metal: 0.35, oil: 0 },
  { food: 0.32, wood: 0.15, metal: 0.3, oil: 0.23 },
  { food: 0.3, wood: 0.12, metal: 0.32, oil: 0.26 },
];
const GATHER_BLD = { food: 'farm', wood: 'lumber', metal: 'mine', oil: 'oilwell' };
// What each building should make, by age. The bot picks from these with some variety.
const MIX = {
  barracks: (a) => (a < 2 ? ['infantry', 'ranged', 'ranged'] : ['infantry', 'infantry', 'ranged']),
  stable: () => ['cavalry'],
  workshop: (a) => (a >= 3 ? ['siege', 'siege', 'aagun'] : ['siege']),
  airfield: () => ['bomber', 'fighter', 'fighter'],
};
const SIGNATURE = { germany: ['barracks', 'oompah', 1], taiwan: ['stable', 'scooter', 3], philippines: ['stable', 'jeepney', 2], pakistan: ['barracks', 'bowler', 3] };

export class Bot {
  constructor(world, p, level = 'normal') {
    this.w = world;
    this.p = p;
    this.lv = BOT_LEVELS[level] || BOT_LEVELS.normal;
    this.level = level;
    this.offset = (p * 7) % this.lv.think;
    this.lastWave = 0;
    this.wave = new Set();
    this.taunts = [];    // numbers of taunts waiting to be said
    this.spotCache = {}; // type -> tick when we last failed to find a spot
    this.nextNuke = 0;
    this.nextLaser = 0;
    this.nextDefend = 0;
    this.ageReady = 0;
    this.personality = Math.random(); // < 0.5 likes wonders earlier, >= 0.5 likes war earlier
  }

  get s() { return this.w.s; }
  get pl() { return this.s.players[this.p]; }

  // Called every tick on the host. Returns the commands to send.
  tick(world) {
    if (world) this.w = world;
    const s = this.s;
    if (!this.pl || !this.pl.alive || s.over) return [];
    if ((s.tick + this.offset) % this.lv.think !== 0) return [];
    this.cmds = [];
    this.budget = { ...this.pl.res };
    this.look();
    this.economy();
    this.research();
    this.buildings();
    this.military();
    this.superWeapons();
    return this.cmds.map((c) => ({ ...c, p: this.p }));
  }

  send(c) { this.cmds.push(c); }

  // Can we pay this out of what's left this round? If so, take it off the budget.
  afford(cost, reserve = null) {
    for (const k in cost) if (this.budget[k] - (reserve ? reserve[k] || 0 : 0) < cost[k]) return false;
    for (const k in cost) this.budget[k] -= cost[k];
    return true;
  }

  // Note down what we have.
  look() {
    const w = this.w, p = this.p;
    this.units = this.s.units.filter((u) => u.owner === p);
    this.blds = this.s.blds.filter((b) => b.owner === p);
    this.cits = this.units.filter((u) => u.type === 'citizen');
    this.army = this.units.filter((u) => u.type !== 'citizen');
    this.cities = this.blds.filter((b) => b.type === 'city' && b.done);
    this.count = {};
    for (const b of this.blds) this.count[b.type] = (this.count[b.type] || 0) + 1;
    this.pop = this.units.length;
    this.cap = w.popCap(p);
    this.age = this.pl.age;
    // What we're saving for this round: leave enough for it before spending on lesser things.
    this.saving = null;
  }

  has(type) { return (this.count[type] || 0) > 0; }
  doneCount(type) { return this.blds.filter((b) => b.type === type && b.done).length; }

  // ---------- economy ----------
  economy() {
    const w = this.w, lv = this.lv;
    const target = lv.workers[this.age];
    // Train citizens.
    if (this.cits.length < target && this.pop < this.cap) {
      for (const c of this.cities) {
        if (c.q.filter((it) => it.k === 'unit').length >= 1) continue;
        const st = w.stats(this.p, 'citizen');
        if (this.afford(st.cost)) this.send({ c: 'train', b: c.id, type: 'citizen' });
      }
    }
    // Work out who's doing what.
    const working = { food: 0, wood: 0, metal: 0, oil: 0 };
    const room = { food: 0, wood: 0, metal: 0, oil: 0 };
    const spot = { food: [], wood: [], metal: [], oil: [] };
    const counts = w.workerCount || new Map();
    for (const b of this.blds) {
      const g = BLDS[b.type].gather;
      if (!g) continue;
      if (!b.done) { room[g] += BLDS[b.type].slots; continue; }
      const n = counts.get(b.id) || 0;
      working[g] += n;
      const free = w.slots(b) - n;
      if (free > 0) { room[g] += free; spot[g].push({ b, free }); }
    }
    // Fewer workers on what we have plenty of, more on what we're out of.
    const want = { ...WANT[this.age] };
    for (const k of RES) {
      const r = this.pl.res[k];
      want[k] *= r > 2000 ? 0.15 : r > 1000 ? 0.45 : r > 500 ? 0.8 : r < 100 ? 1.5 : 1;
    }
    const sum = RES.reduce((a, k) => a + want[k], 0) || 1;
    for (const k of RES) want[k] /= sum;
    const total = Math.max(1, this.cits.length);
    // Which resource is most short of workers? Skip what we can't use yet or what is at its limit.
    const short = () => {
      let best = null, bs = -1e9;
      for (const k of RES) {
        if (!want[k]) continue;
        const score = want[k] - working[k] / total;
        if (score > bs) { bs = score; best = k; }
      }
      return best;
    };
    // Idle citizens get a job.
    const idle = this.cits.filter((u) => !u.ord);
    for (const u of idle) {
      let k = short(), tries = 0;
      while (k && !spot[k].length && tries++ < 3) {
        const save = want[k]; want[k] = 0; const nx = short(); want[k] = save;
        if (nx === k) break;
        if (!spot[nx] || !spot[nx].length) { k = nx; continue; }
        k = nx;
      }
      if (!k || !spot[k].length) continue;
      const near = spot[k].slice().sort((a, b) => w.edgeDist(u.x, u.y, a.b) - w.edgeDist(u.x, u.y, b.b))[0];
      this.send({ c: 'work', ids: [u.id], t: near.b.id });
      near.free--; working[k]++;
      if (near.free <= 0) spot[k].splice(spot[k].indexOf(near), 1);
    }
    // Move a few workers from far too many to far too few (this is how the mix changes with the ages).
    if (this.s.tick % (this.lv.think * 6) < this.lv.think) {
      let over = null, ov = 0.08;
      for (const k of RES) { const e = working[k] / total - want[k]; if (e > ov) { ov = e; over = k; } }
      const lack = short();
      if (over && lack && lack !== over && spot[lack].length) {
        const movers = this.cits.filter((u) => {
          if (!u.ord || u.ord.k !== 'work') return false;
          const b = w.get(u.ord.t);
          return b && b.done && BLDS[b.type].gather === over;
        }).slice(0, 3);
        for (const u of movers) { if (!spot[lack].length) break; this.send({ c: 'work', ids: [u.id], t: spot[lack][0].b.id }); }
      }
    }
    // Build more gather buildings where we're short of room.
    for (const k of RES) {
      if (!want[k]) continue;
      if (k === 'oil' && this.age < 3) continue;
      const need = Math.ceil(want[k] * Math.max(target, this.cits.length));
      if (working[k] + room[k] < need) {
        const type = GATHER_BLD[k];
        const unfinished = this.blds.some((b) => b.type === type && !b.done);
        if (unfinished) continue;
        if (this.tryBuild(type)) break;
      }
    }
    // Upgrade gather buildings as far as we can.
    if (this.lv.upgrades) {
      const com = commerceLevel(this.pl);
      for (const b of this.blds) {
        if (!b.done || !UPGRADE[b.type]) continue;
        const lvl = (b.lvl || 0) + 1;
        if (lvl > this.age || lvl > com || b.q.length) continue;
        if (!counts.get(b.id)) continue;
        // Upgrades pay for themselves, so metal and oil ones go ahead of saving for the next age.
        const scarce = b.type === 'mine' || b.type === 'oilwell';
        if (this.afford(upgradeCost(b.type, lvl), scarce ? null : this.ageCost())) { this.send({ c: 'upgrade', b: b.id }); break; }
      }
    }
    // Market: turn a big pile of one thing into what we lack.
    if (this.doneCount('market')) {
      const r = this.pl.res;
      const most = RES.reduce((a, b) => (r[a] > r[b] ? a : b));
      const least = RES.filter((k) => (k !== 'oil' || this.age >= 3)).reduce((a, b) => (r[a] < r[b] ? a : b));
      if (r[most] > 500 && r[least] < 200 && most !== least) this.send({ c: 'trade', from: most, to: least });
      // Saving for the next age and short of one thing: buy it.
      const up = this.ageCost();
      if (up) for (const k in up) if (r[k] < up[k] && r[most] > (up[most] || 0) + 300 && most !== k) { this.send({ c: 'trade', from: most, to: k }); break; }
    }
  }

  ageCost() {
    return this.age < AGES.length - 1 ? AGE_UP[this.age].cost : null;
  }

  // Find somewhere to put a building, and send a citizen. Returns true if we did.
  tryBuild(type, reserve = null, helpers = 1) {
    const d = BLDS[type];
    const w = this.w;
    if (this.pl.age < d.age || (d.needTech && !this.pl.techs[d.needTech])) return false;
    const r = reserve ? { ...reserve } : null;
    for (const k in d.cost) if (this.budget[k] - (r ? r[k] || 0 : 0) < d.cost[k]) return false;
    if (this.spotCache[type] && this.s.tick - this.spotCache[type] < 100) return false;
    const spot = this.findSpot(type);
    if (!spot) { this.spotCache[type] = this.s.tick; return false; }
    const free = this.cits.filter((u) => !u.ord || (u.ord.k === 'work' && !this.usedForBuild?.has(u.id)));
    if (!free.length) return false;
    // Nearest citizens build it.
    free.sort((a, b) => dist2(a, spot) - dist2(b, spot));
    const ids = free.slice(0, helpers).map((u) => u.id);
    this.usedForBuild = this.usedForBuild || new Set();
    ids.forEach((id) => this.usedForBuild.add(id));
    for (const k in d.cost) this.budget[k] -= d.cost[k];
    this.count[type] = (this.count[type] || 0) + 1;
    this.send({ c: 'build', ids, type, x: spot.x, y: spot.y });
    return true;
  }

  findSpot(type) {
    const w = this.w, p = this.p, d = BLDS[type];
    if (!this.cities.length) return null;
    if (type === 'city') return this.citySpot();
    // Deposits and forests: look over all our land, nearest to a city first.
    const scan = type === 'mine' || type === 'oilwell' || type === 'lumber';
    const maxR = scan ? 16 : d.wonder ? 14 : 11;
    let best = null, bd = 1e9;
    for (const c of this.cities) {
      const cx = c.x + 1, cy = c.y + 1;
      const minR = scan ? 2 : d.wonder ? 4 : type === 'farm' ? 2 : 3;
      for (let r = minR; r <= maxR; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = cx + dx, y = cy + dy;
            if (scan && !this.quickFits(type, x, y)) continue;
            // Leave gaps between most buildings so nobody gets boxed in.
            if (!scan && (x + y) % 2 !== 0) continue;
            if (w.canPlace(p, type, x, y).ok && (scan || this.roomAround(x, y, d.size))) {
              const dd = dx * dx + dy * dy;
              if (dd < bd) { bd = dd; best = { x, y }; }
              if (!scan) break;
            }
          }
          if (best && !scan) break;
        }
        if (best && !scan) break;
      }
      if (best && !scan) break;
    }
    return best;
  }

  // Quick check before the slower canPlace, for the buildings that must sit on something.
  quickFits(type, x, y) {
    const w = this.w;
    if (x < 1 || y < 1 || x >= w.W - 2 || y >= w.H - 2) return false;
    if (type === 'lumber') {
      const i = y * w.W + x;
      return w.map.tiles[i] === T.GRASS;
    }
    const dep = type === 'mine' ? DEP.METAL : DEP.OIL;
    for (let ty = y; ty < y + 2; ty++) for (let tx = x; tx < x + 2; tx++) if (w.map.dep[ty * w.W + tx] === dep) return true;
    return false;
  }

  // Keep a walkable gap around a new building, so workers and armies can get through.
  roomAround(x, y, size) {
    const w = this.w;
    for (let i = -1; i <= size; i++) {
      if (w.blockId[(y - 1) * w.W + x + i] || w.blockId[(y + size) * w.W + x + i]) return false;
      if (w.blockId[(y + i) * w.W + x - 1] || w.blockId[(y + i) * w.W + x + size]) return false;
    }
    return true;
  }

  // New cities: as close as allowed to one of ours, preferring spots near metal, oil and forest.
  citySpot() {
    const w = this.w, p = this.p;
    let best = null, bs = -1e9;
    for (const c of this.cities) {
      for (let k = 0; k < 40; k++) {
        const a = Math.random() * Math.PI * 2, r = 13 + Math.random() * 7;
        const x = Math.floor(c.x + 1 + Math.cos(a) * r), y = Math.floor(c.y + 1 + Math.sin(a) * r);
        if (!w.canPlace(p, 'city', x, y).ok) continue;
        let score = 0;
        for (let dy = -7; dy <= 7; dy += 2) for (let dx = -7; dx <= 7; dx += 2) {
          const tx = x + 1 + dx, ty = y + 1 + dy;
          if (tx < 0 || ty < 0 || tx >= w.W || ty >= w.H) continue;
          const i = ty * w.W + tx;
          if (w.map.dep[i] === DEP.METAL) score += 4;
          if (w.map.dep[i] === DEP.OIL) score += 6;
          if (w.map.tiles[i] === T.FOREST) score += 0.4;
          if (w.terr[i] === p) score -= 0.6;
        }
        if (score > bs) { bs = score; best = { x, y }; }
      }
    }
    return best;
  }

  // ---------- research ----------
  research() {
    const pl = this.pl, lv = this.lv;
    const libs = this.blds.filter((b) => b.type === 'library' && b.done);
    if (!libs.length) return;
    const free = libs.filter((b) => b.q.length === 0);
    // Priority list: Science and Commerce first, then gathering, then the rest.
    const order = [];
    const next = (prefix, n) => { for (let i = 1; i <= n; i++) { const k = `${prefix}${i}`; if (!pl.techs[k]) return k; } return null; };
    order.push(next('sci', 4), next('com', 5));
    if (this.age >= 4 && lv.nukes) order.push('manhattan');
    order.push(next('agri', 3), next('wood', 3));
    if (this.age >= 1) order.push(next('metal', 3));
    if (this.age >= 3) order.push(next('oil', 3));
    order.push('civics', next('weap', 2), next('armor', 2), 'civics2', 'logistics', NATIONS[pl.nation].tech);
    if (this.age >= 4 && lv.nukes) order.push('manhattan', 'sdi');
    for (const k of order) {
      if (!free.length) return;
      if (!k || pl.techs[k] || pl.pending[k]) continue;
      const t = TECHS[k];
      if (!t || pl.age < t.age || techMissing(pl, t).length || !forNation(pl, t)) continue;
      // Easy bots skip a lot of it (but they always learn Science, or they'd never age up).
      if (t.line !== 'sci' && t.line !== 'com' && (hashish(this.p, k) > lv.techs)) continue;
      if (!this.afford(techCost(pl, k), t.line === 'sci' ? null : this.ageCost())) {
        // Science is what's in the way of everything else. Save for it.
        if (t.line === 'sci') return;
        continue;
      }
      this.send({ c: 'research', b: free.pop().id, tech: k });
    }
  }

  // ---------- buildings ----------
  buildings() {
    const pl = this.pl, lv = this.lv, a = this.age, w = this.w;
    const n = this.cits.length;
    const reserve = this.ageCost();
    // First the things everyone needs.
    if (!this.has('library') && n >= 7) { this.tryBuild('library'); }
    if (!this.has('barracks') && n >= 9) { this.tryBuild('barracks', null, 2); }
    // Age up when we can.
    if (a < AGES.length - 1 && !pl.pending.age && pl.techs[AGE_UP[a].needs]) {
      if (!this.ageReady) this.ageReady = this.s.tick + lv.ageDelay * 20;
      const up = AGE_UP[a];
      if (this.s.tick >= this.ageReady && n >= lv.workers[a] * 0.6) {
        if (this.afford(up.cost)) {
          const c = this.cities[0];
          if (c) { this.send({ c: 'research', b: c.id, tech: 'age' }); this.ageReady = 0; }
        } else this.saving = up.cost;
      }
    }
    const res = this.saving || reserve;
    // Out of room: a new city comes before everything else except the next age.
    const lim = cityLimit(pl);
    const cityCount = this.blds.filter((b) => b.type === 'city').length;
    const building = this.blds.some((b) => b.type === 'city' && !b.done);
    const crowded = this.pop >= this.cap - 4;
    if (crowded && cityCount < lim && !building) {
      if (!this.tryBuild('city', null, 3) && !this.saving) this.saving = BLDS.city.cost;
    }
    if (!this.has('stable') && this.doneCount('barracks') && n >= 14) this.tryBuild('stable', res);
    if (a >= 1 && !this.has('workshop') && n >= 16) this.tryBuild('workshop', res);
    if (a >= 1 && !this.has('market') && n >= 18) this.tryBuild('market', res);
    if (a >= 2 && (this.count.barracks || 0) < 2 && lv.armyShare >= 0.6) this.tryBuild('barracks', res);
    if (a >= 3 && !this.has('airfield') && n >= 25) this.tryBuild('airfield', res, 2);
    if (a >= 2 && (this.count.tower || 0) < this.cities.length && lv.armyShare >= 0.6 && Math.random() < 0.2) this.tryBuild('tower', res);
    // More cities.
    const wantCities = Math.max(1, Math.round(lim * lv.cities));
    if (cityCount < wantCities && n >= 12 && !building) this.tryBuild('city', res, 3);
    if (a >= 4 && lv.nukes && pl.techs.manhattan && !this.has('silo')) this.tryBuild('silo', res, 3);
    // Wonders, when rich.
    if (lv.wonders && this.s.tick > 20 * 300 && w.settings.wonders !== false) {
      if (!this.blds.some((b) => BLDS[b.type].wonder && !b.done)) {
        for (const k of WONDERS) {
          const d = BLDS[k];
          if (this.has(k) || a < d.age || (d.needTech && !pl.techs[d.needTech])) continue;
          if (this.s.blds.some((b) => b.type === k)) continue;
          // Only spend on a wonder with a bit left over.
          const left = {}; for (const r of RES) left[r] = 150;
          if (this.tryBuild(k, left, 5)) break;
        }
      }
    }
  }

  // ---------- military ----------
  military() {
    const w = this.w, lv = this.lv, a = this.age;
    const secs = this.s.tick / 20;
    const peace = secs < lv.firstAttack * 0.5;
    const wantArmy = lv.army[a] + Math.floor(secs / 60) * (this.level === 'hard' ? 3 : this.level === 'normal' ? 2 : 1);
    if (this.pop < this.cap && this.army.length < wantArmy && !(peace && this.cits.length < lv.workers[a] * 0.7)) {
      const reserve = this.saving || null;
      for (const b of this.blds) {
        if (!b.done || !MIX[b.type] || b.q.length >= 2) continue;
        const list = MIX[b.type](a).slice();
        const sig = SIGNATURE[this.pl.nation];
        if (sig && sig[0] === b.type && this.units.filter((u) => u.type === sig[1]).length < sig[2]) list.unshift(sig[1]);
        const type = list[Math.floor(Math.random() * list.length)];
        const ud = UNITS[type];
        if (a < ud.age || !forNation(this.pl, ud)) continue;
        const st = w.stats(this.p, type);
        if (this.afford(st.cost, reserve)) this.send({ c: 'train', b: b.id, type });
      }
    }
    // Bring home anyone who's gone off on their own.
    const ground = this.army.filter((u) => !UNITS[u.type].air && UNITS[u.type].support !== 'band' || UNITS[u.type].support === 'band');
    // Someone's attacking us: everyone nearby goes to help.
    const threat = this.findThreat();
    if (threat && this.s.tick >= this.nextDefend) {
      this.nextDefend = this.s.tick + 100;
      const home = ground.filter((u) => !this.wave.has(u.id));
      if (home.length) this.send({ c: 'move', ids: home.map((u) => u.id), x: threat.x, y: threat.y, am: true });
      const fighters = this.army.filter((u) => u.type === 'fighter');
      if (fighters.length) this.send({ c: 'move', ids: fighters.map((u) => u.id), x: threat.x, y: threat.y, am: true });
      return;
    }
    // Gather the army near the front city.
    const target = this.pickTarget();
    if (!target) return;
    for (const id of this.wave) if (!w.get(id)) this.wave.delete(id);
    const free = ground.filter((u) => !this.wave.has(u.id));
    const sinceLast = secs - this.lastWave;
    if (secs >= lv.firstAttack && sinceLast >= lv.waveEvery && free.length >= Math.max(4, lv.army[a] * 0.6)) {
      this.lastWave = secs;
      const [tx, ty] = w.centre(target);
      for (const u of free) this.wave.add(u.id);
      this.send({ c: 'move', ids: free.map((u) => u.id), x: tx, y: ty, am: true });
      if (Math.random() < 0.5) this.taunts.push(pick([1, 2, 3, 5, 8, 11, 14, 22]));
    }
    // A wave that has run out of things to do moves on to the next target.
    const waveIdle = [...this.wave].map((id) => w.get(id)).filter((u) => u && !u.ord);
    if (waveIdle.length >= 3) {
      const [tx, ty] = w.centre(target);
      this.send({ c: 'move', ids: waveIdle.map((u) => u.id), x: tx, y: ty, am: true });
    }
    // Planes: bombers go for buildings, fighters go with them.
    const bombers = this.army.filter((u) => u.type === 'bomber' && u.ammo && (!u.ord || u.ord.k === 'move'));
    if (bombers.length >= 2 && secs >= lv.firstAttack) {
      const b = this.bombTarget(target);
      if (b) this.send({ c: 'attack', ids: bombers.map((u) => u.id), t: b.id });
    }
    const fighters = this.army.filter((u) => u.type === 'fighter' && !u.ord);
    if (fighters.length >= 3 && sinceLast < 30) {
      const [tx, ty] = w.centre(target);
      this.send({ c: 'move', ids: fighters.map((u) => u.id), x: tx, y: ty, am: true });
    }
  }

  // Enemy soldiers near one of our cities.
  findThreat() {
    const w = this.w;
    let found = null, n = 0;
    for (const u of this.s.units) {
      if (!w.enemy(this.p, u.owner) || UNITS[u.type].cls === 'cit' || UNITS[u.type].air) continue;
      if (this.terrOf(u) !== this.p) continue;
      n++;
      found = found || { x: u.x, y: u.y };
    }
    return n >= 2 ? found : null;
  }

  terrOf(u) { return this.w.terrAt(u.x, u.y); }

  // Attack the enemy city closest to us. Ignores the fog: bots have good spies.
  pickTarget() {
    const w = this.w;
    if (!this.cities.length) return null;
    const c0 = this.cities[0];
    let best = null, bd = 1e18;
    for (const b of this.s.blds) {
      if (!w.enemy(this.p, b.owner)) continue;
      // Wonders first, and especially a Moon Rocket: everyone must stop that.
      const urgent = b.type === 'rocket' && b.done;
      if (b.type !== 'city' && !urgent) continue;
      const d = dist2(c0, b) - (urgent ? 1e9 : 0);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  bombTarget(near) {
    const w = this.w;
    let best = null, bd = 1e18;
    for (const b of this.s.blds) {
      if (!w.enemy(this.p, b.owner)) continue;
      const score = dist2(near, b) - (BLDS[b.type].wonder ? 500 : b.type === 'silo' ? 800 : 0);
      if (score < bd) { bd = score; best = b; }
    }
    return best;
  }

  // ---------- nukes and lasers ----------
  superWeapons() {
    const w = this.w, s = this.s;
    if (!this.lv.nukes) return;
    for (const b of this.blds) {
      if (!b.done) continue;
      if (b.type === 'silo') {
        if (b.q.length + b.stock < 1 && this.afford(NUKE.cost, this.saving)) this.send({ c: 'train', b: b.id, type: 'nuke' });
        const lim = w.settings.doomsday | 0;
        // Never the nuke that ends the world: bots want to win, not tie.
        if (b.stock > 0 && s.tick >= this.nextNuke && (lim === 0 || s.doom + s.missiles.length < lim - 1)) {
          const t = this.bestStrike();
          if (t) {
            this.nextNuke = s.tick + 20 * (this.level === 'hard' ? 150 : 240);
            this.send({ c: 'launch', b: b.id, x: t.x, y: t.y });
            this.taunts.push(pick([11, 14, 22]));
          }
        }
      }
      if (b.type === 'laser' && (b.ready || 0) <= s.tick && s.tick >= this.nextLaser) {
        const t = this.bestStrike();
        if (t) { this.nextLaser = s.tick + 20; this.send({ c: 'laser', b: b.id, x: t.x, y: t.y }); }
      }
    }
  }

  // The enemy spot with the most stuff around it.
  bestStrike() {
    const w = this.w;
    let best = null, bs = 0;
    for (const b of this.s.blds) {
      if (!w.enemy(this.p, b.owner) || b.type !== 'city') continue;
      const [x, y] = w.centre(b);
      let score = 5;
      for (const u of this.s.units) if (w.enemy(this.p, u.owner) && dist2(u, { x, y }) < 36) score++;
      if (score > bs) { bs = score; best = { x, y }; }
    }
    return best;
  }
}

const dist2 = (a, b) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
// A steady 0-1 value for this player and tech, so an Easy bot always skips the same techs.
function hashish(p, k) {
  let h = 7 + p * 31;
  for (let i = 0; i < k.length; i++) h = (h * 33 + k.charCodeAt(i)) & 0xffff;
  return (h % 100) / 100;
}
