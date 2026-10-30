// The game simulation. Every player runs this exact code with the exact same commands,
// so it must be deterministic: no Math.random, no Date, no trig in here.
import {
  RES, AGES, AGE_UP, GATHER_RATE, CITY_INCOME, BUILD_RATE, POP_MAX, CITY_MIN_DIST, ATTRITION,
  FALLOUT_DMG, MULT, UNITS, BLDS, TECHS, NUKE, START_RES, MAP_SIZES, cityLimit, cityRadius, techSum, gatherMult,
  forNation, techCost, techTime, UPGRADE, upgradeCost, upgradeTime,
} from './data.js';
import { NATIONS, NATION_KEYS, NATION_UNIQUE, nationOf, nbonus } from './nations.js';
import { genMap, T, DEP } from './map.js';
import { PathFinder } from './path.js';
import { nextRand } from './rng.js';
import { initExtras, updateExtras, findMutant, COW, MUTANT } from './extras.js';

export const TICK_MS = 50;
export const DT = TICK_MS / 1000;
const CELL = 2; // spatial bucket size in tiles

export function defaultSettings() {
  return { mapSize: 'normal', resources: 'normal', startAge: 0, doomsday: 8, fog: 'on', silly: true };
}

export class World {
  // setup: { seed, players: [{ name, color, team, nation }], settings }
  constructor(setup, savedState = null) {
    this.setup = setup;
    const st = { ...defaultSettings(), ...(setup.settings || {}) };
    this.settings = st;
    const size = MAP_SIZES[st.mapSize] || 128;
    this.map = genMap(setup.seed, setup.players.length, size);
    this.W = this.map.w; this.H = this.map.h;
    this.pf = new PathFinder(this.W, this.H);
    this.events = [];
    if (savedState) this.load(savedState);
    else this.init();
  }

  // ---------- setup / load ----------

  init() {
    const st = this.settings;
    const res = START_RES[st.resources] || START_RES.normal;
    this.s = {
      tick: 0, nextId: 1, rng: (this.setup.seed ^ 0x9e3779b9) | 0,
      players: this.setup.players.map((p, i) => ({
        name: p.name, color: p.color, team: p.team ?? i, age: Math.max(0, Math.min(4, st.startAge | 0)),
        nation: NATIONS[p.nation] ? p.nation : NATION_KEYS[i % NATION_KEYS.length], cityN: 1,
        res: { ...res }, techs: {}, pending: {}, alive: true, nukes: 0, kills: 0, lost: 0,
        st: { gath: { food: 0, wood: 0, metal: 0, oil: 0 }, built: 0, cows: 0, crates: 0, caps: 0, razed: 0, promos: 0 },
      })),
      units: [], blds: [], missiles: [], fallout: [], doom: 0, over: null,
    };
    this.rebuild();
    this.map.starts.forEach(([sx, sy], p) => {
      const c = this.addBld('city', p, sx - 1, sy - 1, true);
      c.name = nationOf(this.s.players[p]).cities[0];
      for (let k = 0; k < 4; k++) {
        const spot = this.freeSpotNear(sx, sy + 2, 1);
        this.addUnit('citizen', p, spot[0], spot[1]);
      }
      const spot = this.freeSpotNear(sx + 2, sy, 1);
      this.addUnit('infantry', p, spot[0], spot[1]);
    });
    initExtras(this);
    this.recalcTerritory();
  }

  load(state) {
    this.s = JSON.parse(JSON.stringify(state));
    this.rebuild();
  }

  serialize() { return this.s; }

  // Rebuild everything that is derived from state (lookups, blocking grid, territory).
  rebuild() {
    const W = this.W, H = this.H;
    this.byId = new Map();
    for (const u of this.s.units) this.byId.set(u.id, u);
    for (const b of this.s.blds) this.byId.set(b.id, b);
    for (const c of this.s.critters || []) this.byId.set(c.id, c);
    this.pass = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) this.pass[i] = this.map.tiles[i] === T.GRASS ? 1 : 0;
    this.blockId = new Int32Array(W * H);
    for (const b of this.s.blds) this.markBld(b, true);
    this.terr = new Int8Array(W * H).fill(-1);
    this.terrVersion = (this.terrVersion || 0) + 1;
    this.statCache = this.s.players.map(() => null);
    this.recalcTerritory(true);
    this.cellsW = Math.ceil(W / CELL); this.cellsH = Math.ceil(H / CELL);
    this.rates = this.s.players.map(() => ({ food: 0, wood: 0, metal: 0, oil: 0 }));
  }

  // ---------- helpers ----------

  newId() { return this.s.nextId++; }
  rand() { return nextRand(this.s); }
  get(id) { return this.byId.get(id); }
  enemy(a, b) { return a !== b && a >= 0 && b >= 0 && this.s.players[a].team !== this.s.players[b].team; }
  ally(a, b) { return a === b || (a >= 0 && b >= 0 && this.s.players[a].team === this.s.players[b].team); }
  // Can player p attack entity t? (critters can always be attacked)
  hostile(p, t) { return t.kind === 'c' || this.enemy(p, t.owner); }
  clsOf(t) { return t.kind === 'u' ? UNITS[t.type].cls : t.kind === 'c' ? 'inf' : 'bld'; }
  radiusOf(e) { return e.kind === 'u' ? UNITS[e.type].radius : e.kind === 'c' ? (e.mutant ? MUTANT.radius : COW.radius) : 0; }
  // Veteran units (rank 1-3) get +15% attack and health per rank.
  rankMul(u) { return 1 + 0.15 * (u.rank || 0); }
  uMax(u) { return this.stats(u.owner, u.type).hp * this.rankMul(u); }
  passable(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H && this.pass[y * this.W + x] === 1; }
  terrAt(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return -1;
    return this.terr[ty * this.W + tx];
  }
  event(e) { e.tick = this.s.tick; this.events.push(e); if (this.events.length > 2000) this.events.splice(0, 1000); }

  // Stats for a unit line given its owner's age and techs. Cached per player.
  stats(p, type) {
    let c = this.statCache[p];
    if (!c) {
      c = this.statCache[p] = {};
      const pl = this.s.players[p];
      const hpB = 1 + techSum(pl, 'hp'), atkB = 1 + techSum(pl, 'atk'), spB = 1 + techSum(pl, 'speed');
      const trainF = 1 - nbonus(pl, 'trainTime');
      const uniq = NATION_UNIQUE[pl.nation] || {};
      for (const k in UNITS) {
        const d = UNITS[k], a = pl.age, mil = d.cls !== 'cit';
        const st = {
          name: d.names[a], cls: d.cls, hp: d.hp[a], atk: d.atk[a],
          range: d.range[a], cd: d.cd[a], speed: d.speed[a], sight: d.sight, radius: d.radius,
          splash: d.splash || 0, cost: d.cost[a], time: d.time[a], desc: d.desc, uniq: d.nation ? 2 : 0,
        };
        // Nation unique version of this unit in this age.
        const un = uniq[k] && uniq[k][a];
        if (un) {
          st.name = un.name; st.desc = un.desc; st.uniq = 1;
          for (const f in un.mul || {}) st[f] *= un.mul[f];
          Object.assign(st, un.set || {});
        }
        st.hp *= mil ? hpB : 1; st.atk *= mil ? atkB : 1; st.speed *= spB; st.time *= trainF;
        // Who can shoot at planes: classes with an air multiplier, and foot soldiers only once they have guns.
        st.air = !!d.air; st.bomb = !!d.bomb; st.aaOnly = !!d.aaOnly;
        st.aa = !d.bomb && MULT[d.cls].air > 0 && (a >= 2 || (d.cls !== 'inf' && d.cls !== 'rng'));
        c[k] = st;
      }
    }
    return c[type];
  }

  bldMaxHp(b) { return this.bldHp(b.type, b.owner); }
  // Worker slots and gather speed of a gather building, after upgrades.
  slots(b) { return BLDS[b.type].slots + UPGRADE.slots * (b.lvl || 0); }
  lvlMul(b) { return 1 + UPGRADE.rate * (b.lvl || 0); }
  isAir(e) { return e.kind === 'u' && !!UNITS[e.type].air; }
  // Can unit u (with stats st) shoot at target t?
  canHit(st, t) { const air = this.isAir(t); return air ? st.aa : !st.aaOnly; }
  bldHp(type, owner) { return BLDS[type].hp * (1 + nbonus(this.s.players[owner], 'bldHp')); }
  maxHp(e) { return e.kind === 'u' ? this.uMax(e) : e.kind === 'c' ? (e.mutant ? MUTANT.hp : COW.hp) : this.bldMaxHp(e); }

  // Called when age or tech changes: keep each unit's health share the same.
  refreshStats(p) {
    const old = {};
    for (const u of this.s.units) if (u.owner === p) old[u.id] = u.hp / this.stats(p, u.type).hp;
    this.statCache[p] = null;
    for (const u of this.s.units) if (u.owner === p) u.hp = old[u.id] * this.stats(p, u.type).hp;
  }

  pop(p) {
    let n = 0;
    for (const u of this.s.units) if (u.owner === p) n++;
    return n;
  }
  popCap(p) {
    const pl = this.s.players[p];
    let n = 0;
    const per = BLDS.city.pop + techSum(pl, 'popPerCity') + nbonus(pl, 'popPerCity');
    for (const b of this.s.blds) if (b.owner === p && b.type === 'city' && b.done) n += per;
    return Math.min(POP_MAX, n);
  }
  cityCount(p) {
    let n = 0;
    for (const b of this.s.blds) if (b.owner === p && b.type === 'city') n++;
    return n;
  }

  canAfford(p, cost) {
    const r = this.s.players[p].res;
    for (const k in cost) if ((r[k] || 0) < cost[k]) return false;
    return true;
  }
  pay(p, cost) { const r = this.s.players[p].res; for (const k in cost) r[k] -= cost[k]; }
  refund(p, cost) { const r = this.s.players[p].res; for (const k in cost) r[k] += cost[k]; }

  // ---------- entities ----------

  addUnit(type, owner, x, y) {
    const u = {
      kind: 'u', id: this.newId(), type, owner, x, y, px: x, py: y, hp: 0, cd: 0,
      ord: null, path: [], pi: 0, scan: 0, rep: 0, working: false, fx: 0, fy: 1,
    };
    u.hp = this.stats(owner, type).hp;
    if (UNITS[type].bomb) u.ammo = 1;
    this.s.units.push(u);
    this.byId.set(u.id, u);
    return u;
  }

  addBld(type, owner, x, y, done = false) {
    const d = BLDS[type];
    const b = {
      kind: 'b', id: this.newId(), type, owner, x, y, size: d.size,
      hp: this.bldHp(type, owner) * (done ? 1 : 0.1), prog: done ? d.time : 0, done, q: [], rally: null,
      stock: 0, cd: 0, tgt: 0, lastAtk: -1, scan: 0, lvl: 0,
    };
    this.s.blds.push(b);
    this.byId.set(b.id, b);
    this.markBld(b, true);
    // Push units out of the footprint.
    for (const u of this.s.units) {
      if (u.x >= x && u.x < x + d.size && u.y >= y && u.y < y + d.size) {
        const s = this.freeSpotNear(Math.floor(u.x), Math.floor(u.y), 0);
        u.x = u.px = s[0]; u.y = u.py = s[1];
        u.path = []; u.pi = 0;
      }
    }
    return b;
  }

  markBld(b, on) {
    for (let y = b.y; y < b.y + b.size; y++) {
      for (let x = b.x; x < b.x + b.size; x++) {
        const i = y * this.W + x;
        this.blockId[i] = on ? b.id : 0;
        this.pass[i] = on ? 0 : (this.map.tiles[i] === T.GRASS ? 1 : 0);
      }
    }
  }

  // Nearest walkable tile centre to (tx, ty), searching outward in rings.
  freeSpotNear(tx, ty, avoidUnits) {
    for (let r = 0; r < 30; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx, y = ty + dy;
          if (!this.passable(x, y)) continue;
          if (avoidUnits && r < 4 && this.s.units.some((u) => Math.floor(u.x) === x && Math.floor(u.y) === y)) continue;
          return [x + 0.5, y + 0.5];
        }
      }
    }
    return [tx + 0.5, ty + 0.5];
  }

  // Distance from a point to an entity's edge (units are circles, buildings are squares).
  edgeDist(x, y, e) {
    if (e.kind !== 'b') {
      const dx = e.x - x, dy = e.y - y;
      return Math.sqrt(dx * dx + dy * dy) - this.radiusOf(e);
    }
    const dx = Math.max(e.x - x, 0, x - (e.x + e.size));
    const dy = Math.max(e.y - y, 0, y - (e.y + e.size));
    return Math.sqrt(dx * dx + dy * dy);
  }

  centre(e) { return e.kind !== 'b' ? [e.x, e.y] : [e.x + e.size / 2, e.y + e.size / 2]; }

  // ---------- placement rules (also used by the UI for the green/red ghost) ----------

  canPlace(p, type, x, y) {
    const d = BLDS[type];
    if (!d) return { ok: false, why: 'Unknown building' };
    const pl = this.s.players[p];
    if (pl.age < d.age) return { ok: false, why: `Needs the ${AGES[d.age]} Age` };
    if (d.needTech && !pl.techs[d.needTech]) return { ok: false, why: `Needs ${TECHS[d.needTech].name}` };
    const W = this.W;
    let hasMetal = false, hasOil = false;
    for (let ty = y; ty < y + d.size; ty++) {
      for (let tx = x; tx < x + d.size; tx++) {
        if (tx < 1 || ty < 1 || tx >= this.W - 1 || ty >= this.H - 1) return { ok: false, why: 'Off the map' };
        const i = ty * W + tx;
        if (this.map.tiles[i] !== T.GRASS) return { ok: false, why: 'Must be on open ground' };
        if (this.blockId[i]) return { ok: false, why: 'Something is in the way' };
        const dep = this.map.dep[i];
        if (dep === DEP.METAL) hasMetal = true;
        if (dep === DEP.OIL) hasOil = true;
        const own = this.terr[i];
        if (type === 'city') {
          if (own >= 0 && own !== p) return { ok: false, why: 'Cannot build in foreign territory' };
        } else if (own !== p) return { ok: false, why: 'Must be inside your territory' };
      }
    }
    if ((hasMetal && type !== 'mine') || (hasOil && type !== 'oilwell')) {
      return { ok: false, why: 'Keep deposits free for mines and oil wells' };
    }
    const cx = x + d.size / 2, cy = y + d.size / 2;
    if (type === 'city') {
      if (this.cityCount(p) >= cityLimit(pl)) return { ok: false, why: `City limit reached (${cityLimit(pl)}). Advance an age or research Civics.` };
      for (const b of this.s.blds) {
        if (b.type !== 'city') continue;
        const dx = b.x + 1.5 - cx, dy = b.y + 1.5 - cy;
        if (dx * dx + dy * dy < CITY_MIN_DIST * CITY_MIN_DIST) return { ok: false, why: 'Too close to another city' };
      }
    }
    if (type === 'farm') {
      let near = false;
      for (const b of this.s.blds) {
        if (b.type === 'city' && b.owner === p && this.edgeDist(cx, cy, b) <= 6) { near = true; break; }
      }
      if (!near) return { ok: false, why: 'Farms must be close to one of your cities' };
    }
    if (type === 'lumber') {
      let n = 0;
      for (let ty = y - 2; ty < y + d.size + 2; ty++) {
        for (let tx = x - 2; tx < x + d.size + 2; tx++) {
          if (tx >= 0 && ty >= 0 && tx < this.W && ty < this.H && this.map.tiles[ty * W + tx] === T.FOREST) n++;
        }
      }
      if (n < 4) return { ok: false, why: 'Must be next to a forest' };
    }
    if (type === 'mine' && !hasMetal) return { ok: false, why: 'Must cover a metal deposit' };
    if (type === 'oilwell' && !hasOil) return { ok: false, why: 'Must cover an oil deposit' };
    return { ok: true };
  }

  // ---------- territory ----------

  recalcTerritory(silent = false) {
    const W = this.W, H = this.H;
    const terr = new Int8Array(W * H).fill(-1);
    const best = new Float64Array(W * H).fill(1e9);
    for (const b of this.s.blds) {
      if (b.type !== 'city' || !b.done) continue;
      const r = cityRadius(this.s.players[b.owner].age);
      const cx = b.x + 1.5, cy = b.y + 1.5;
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 > r * r) continue;
          const i = y * W + x;
          if (d2 < best[i]) { best[i] = d2; terr[i] = b.owner; }
        }
      }
    }
    this.terr = terr;
    this.terrVersion = (this.terrVersion || 0) + 1;
    if (silent) return;
    // Buildings that end up in enemy territory switch sides.
    for (const b of this.s.blds) {
      if (b.type === 'city') continue;
      const o = terr[Math.floor(b.y + b.size / 2) * W + Math.floor(b.x + b.size / 2)];
      if (o >= 0 && this.enemy(o, b.owner)) {
        const was = b.owner;
        b.owner = o; b.q = []; b.rally = null;
        b.hp = Math.min(b.hp, this.bldMaxHp(b));
        this.event({ type: 'convert', id: b.id, from: was, to: o, x: b.x + b.size / 2, y: b.y + b.size / 2 });
      }
    }
  }

  // ---------- commands ----------

  // cmd: { p, c, ... } where p is the player index (set by the host, not trusted from clients)
  apply(cmd) {
    const p = cmd.p;
    const pl = this.s.players[p];
    if (!pl || !pl.alive || this.s.over) return;
    const ownUnits = () => (cmd.ids || []).map((id) => this.get(id)).filter((u) => u && u.kind === 'u' && u.owner === p && u.hp > 0);
    const ownBld = () => { const b = this.get(cmd.b); return b && b.kind === 'b' && b.owner === p && b.hp > 0 ? b : null; };

    switch (cmd.c) {
      case 'move': {
        const us = ownUnits();
        this.groupMove(us, cmd.x, cmd.y, !!cmd.am);
        break;
      }
      case 'attack': {
        const t = this.get(cmd.t);
        if (!t || t.hp <= 0) break;
        for (const u of ownUnits()) if (this.canHit(this.stats(p, u.type), t)) this.setOrder(u, { k: 'attack', t: t.id });
        break;
      }
      case 'work': {
        const b = this.get(cmd.t);
        if (!b || b.kind !== 'b' || b.owner !== p) break;
        for (const u of ownUnits()) if (u.type === 'citizen') this.setOrder(u, { k: 'work', t: b.id });
        break;
      }
      case 'stop': {
        for (const u of ownUnits()) this.setOrder(u, null);
        break;
      }
      case 'build': {
        const d = BLDS[cmd.type];
        if (!d) break;
        const us = ownUnits().filter((u) => u.type === 'citizen');
        const ok = this.canPlace(p, cmd.type, cmd.x | 0, cmd.y | 0);
        if (!ok.ok) { this.event({ type: 'error', p, msg: ok.why }); break; }
        if (!this.canAfford(p, d.cost)) { this.event({ type: 'error', p, msg: 'Not enough resources' }); break; }
        this.pay(p, d.cost);
        const b = this.addBld(cmd.type, p, cmd.x | 0, cmd.y | 0, false);
        for (const u of us) this.setOrder(u, { k: 'work', t: b.id });
        this.event({ type: 'placed', p, id: b.id });
        break;
      }
      case 'train': {
        const b = ownBld();
        if (!b || !b.done) break;
        const d = BLDS[b.type];
        if (cmd.type === 'nuke') {
          if (!d.nukes) break;
          if (b.q.length + b.stock >= NUKE.maxStock) { this.event({ type: 'error', p, msg: 'Silo is full' }); break; }
          if (!this.canAfford(p, NUKE.cost)) { this.event({ type: 'error', p, msg: 'Not enough resources' }); break; }
          this.pay(p, NUKE.cost);
          b.q.push({ k: 'nuke', type: 'nuke', t: NUKE.time, total: NUKE.time, cost: NUKE.cost });
          break;
        }
        const ud = UNITS[cmd.type];
        if (!ud || !d.trains || !d.trains.includes(cmd.type)) break;
        if (pl.age < ud.age || !forNation(pl, ud)) break;
        if (b.q.length >= 8) break;
        const st = this.stats(p, cmd.type);
        if (!this.canAfford(p, st.cost)) { this.event({ type: 'error', p, msg: 'Not enough resources' }); break; }
        this.pay(p, st.cost);
        b.q.push({ k: 'unit', type: cmd.type, t: st.time, total: st.time, cost: st.cost });
        break;
      }
      case 'research': {
        const b = ownBld();
        if (!b || !b.done) break;
        if (cmd.tech === 'age') {
          if (b.type !== 'city' || pl.age >= AGES.length - 1 || pl.pending.age) break;
          const up = AGE_UP[pl.age];
          if (!this.canAfford(p, up.cost)) { this.event({ type: 'error', p, msg: 'Not enough resources' }); break; }
          this.pay(p, up.cost);
          pl.pending.age = 1;
          b.q.push({ k: 'age', type: 'age', t: up.time, total: up.time, cost: up.cost });
          break;
        }
        const t = TECHS[cmd.tech];
        if (!t || !BLDS[b.type].research || pl.techs[cmd.tech] || pl.pending[cmd.tech]) break;
        if (pl.age < t.age || (t.req && !pl.techs[t.req]) || !forNation(pl, t)) break;
        const tc = techCost(pl, cmd.tech), tt = techTime(pl, cmd.tech);
        if (!this.canAfford(p, tc)) { this.event({ type: 'error', p, msg: 'Not enough resources' }); break; }
        this.pay(p, tc);
        pl.pending[cmd.tech] = 1;
        b.q.push({ k: 'tech', type: cmd.tech, t: tt, total: tt, cost: tc });
        break;
      }
      case 'upgrade': {
        const b = ownBld();
        if (!b || !b.done || !UPGRADE[b.type]) break;
        const lvl = (b.lvl || 0) + 1;
        if (lvl > pl.age || b.q.some((it) => it.k === 'upg')) break;
        const cost = upgradeCost(b.type, lvl);
        if (!this.canAfford(p, cost)) { this.event({ type: 'error', p, msg: 'Not enough resources' }); break; }
        this.pay(p, cost);
        const t = upgradeTime(lvl);
        b.q.push({ k: 'upg', type: 'upg', t, total: t, cost });
        break;
      }
      case 'cancel': {
        const b = ownBld();
        if (!b || !b.q.length) break;
        const i = cmd.i == null ? b.q.length - 1 : cmd.i;
        const item = b.q[i];
        if (!item) break;
        b.q.splice(i, 1);
        this.refund(p, item.cost);
        if (item.k === 'age') delete pl.pending.age;
        if (item.k === 'tech') delete pl.pending[item.type];
        break;
      }
      case 'rally': {
        const b = ownBld();
        if (!b) break;
        b.rally = cmd.t ? { t: cmd.t } : { x: cmd.x, y: cmd.y };
        break;
      }
      case 'launch': {
        const b = ownBld();
        if (!b || b.type !== 'silo' || b.stock <= 0) break;
        b.stock--;
        const sx = b.x + 1, sy = b.y + 1;
        const dx = cmd.x - sx, dy = cmd.y - sy;
        const dur = Math.max(NUKE.minFlight, Math.sqrt(dx * dx + dy * dy) / NUKE.speed);
        this.s.missiles.push({ id: this.newId(), owner: p, sx, sy, x: cmd.x, y: cmd.y, t: 0, dur });
        pl.nukes++;
        this.event({ type: 'launch', p, x: cmd.x, y: cmd.y, dur });
        break;
      }
      case 'resign': {
        this.eliminate(p, 'resigned');
        break;
      }
      case 'delete': {
        for (const u of ownUnits()) { u.hp = 0; }
        const b = ownBld();
        if (b) b.hp = 0;
        break;
      }
    }
  }

  setOrder(u, ord) {
    u.ord = ord; u.path = []; u.pi = 0; u.working = false; u.rep = 0;
  }

  groupMove(us, x, y, am) {
    if (!us.length) return;
    // Give each unit its own spot around the target, spreading outward.
    const tx = Math.floor(x), ty = Math.floor(y);
    const spots = [];
    const need = us.length;
    for (let r = 0; r < 20 && spots.length < need; r++) {
      for (let dy = -r; dy <= r && spots.length < need; dy++) {
        for (let dx = -r; dx <= r && spots.length < need; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this.passable(tx + dx, ty + dy)) spots.push([tx + dx + 0.5, ty + dy + 0.5]);
        }
      }
    }
    if (!spots.length) spots.push([x, y]);
    // Sort units so the ones nearest the target take the nearest spots (keeps the group tidy).
    const sorted = us.slice().sort((a, b) => {
      const da = (a.x - x) * (a.x - x) + (a.y - y) * (a.y - y);
      const db = (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y);
      return da - db || a.id - b.id;
    });
    sorted.forEach((u, i) => {
      const s = i === 0 && us.length === 1 ? [x, y] : spots[i % spots.length];
      this.setOrder(u, { k: 'move', x: s[0], y: s[1], am });
    });
  }

  // ---------- main step ----------

  step(cmds) {
    const s = this.s;
    if (s.over) return;
    for (const c of cmds) this.apply(c);
    s.tick++;
    this.rates = s.players.map(() => ({ food: 0, wood: 0, metal: 0, oil: 0 }));

    this.pathBudget = 24;
    const m = s.mods || {};
    this.spdMul = m.speed ? m.speed.mul : 1;
    this.gathMul = { food: 1, wood: 1, metal: 1, oil: 1 };
    if (m.gather) for (const k in this.gathMul) this.gathMul[k] *= m.gather.mul;
    if (m.food) this.gathMul.food *= m.food.mul;
    this.buildBuckets();
    this.nationTick();
    this.assignWorkers();
    for (const u of s.units) if (u.hp > 0) this.updateUnit(u);
    this.separate();
    updateExtras(this);
    this.popNow = s.players.map((_, p) => 0);
    for (const u of s.units) if (u.hp > 0) this.popNow[u.owner]++;
    this.capNow = s.players.map((_, p) => this.popCap(p));
    for (const b of s.blds) if (b.hp > 0) this.updateBld(b);
    this.updateMissiles();
    this.cityIncome();
    this.hazards();
    this.cleanup();
    this.checkEnd();
  }

  // Per-tick nation effects that other code reads: national techs, and which units hear a band.
  nationTick() {
    const s = this.s;
    this.autobahn = s.players.map((pl) => !!pl.techs.autobahn);
    this.karaoke = s.players.map((pl) => !!pl.techs.karaoke);
    this.tigers = s.players.map((pl) => !!pl.techs.tigers);
    this.buffed = null;
    for (const u of s.units) {
      if (u.hp <= 0 || UNITS[u.type].support !== 'band') continue;
      if (!this.buffed) this.buffed = new Set();
      this.unitsNear(u.x, u.y, 4, (o) => {
        const dx = o.x - u.x, dy = o.y - u.y;
        if (o.owner === u.owner && o !== u && dx * dx + dy * dy <= 16) this.buffed.add(o.id);
      });
    }
  }

  buildBuckets() {
    const n = this.cellsW * this.cellsH;
    if (!this.buckets || this.buckets.length !== n) this.buckets = Array.from({ length: n }, () => []);
    for (const b of this.buckets) b.length = 0;
    for (const u of this.s.units) {
      if (u.hp <= 0) continue;
      const cx = Math.min(this.cellsW - 1, Math.max(0, Math.floor(u.x / CELL)));
      const cy = Math.min(this.cellsH - 1, Math.max(0, Math.floor(u.y / CELL)));
      this.buckets[cy * this.cellsW + cx].push(u);
    }
  }

  unitsNear(x, y, r, fn) {
    const c0x = Math.max(0, Math.floor((x - r) / CELL)), c1x = Math.min(this.cellsW - 1, Math.floor((x + r) / CELL));
    const c0y = Math.max(0, Math.floor((y - r) / CELL)), c1y = Math.min(this.cellsH - 1, Math.floor((y + r) / CELL));
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const arr = this.buckets[cy * this.cellsW + cx];
        for (let i = 0; i < arr.length; i++) fn(arr[i]);
      }
    }
  }

  // Find the closest enemy (unit or building) within range r of (x, y).
  // air: 'yes' = any unit, 'no' = skip planes, 'only' = planes only.
  findEnemy(p, x, y, r, unitsOnly = false, air = 'yes') {
    let best = null, bd = 1e9;
    this.unitsNear(x, y, r, (u) => {
      if (u.hp <= 0 || !this.enemy(p, u.owner)) return;
      if (air !== 'yes' && (air === 'only') !== !!UNITS[u.type].air) return;
      const dx = u.x - x, dy = u.y - y, d = dx * dx + dy * dy;
      if (d <= r * r && (d < bd || (d === bd && u.id < best.id))) { bd = d; best = u; }
    });
    if (best || unitsOnly || air === 'only') return best;
    for (const b of this.s.blds) {
      if (b.hp <= 0 || !this.enemy(p, b.owner)) continue;
      const d = this.edgeDist(x, y, b);
      if (d <= r && d * d < bd) { bd = d * d; best = b; }
    }
    return best;
  }

  assignWorkers() {
    // Count workers per gather building. Extra workers move to another building of the same type.
    const count = new Map();
    for (const u of this.s.units) {
      if (u.hp <= 0 || !u.ord || u.ord.k !== 'work') continue;
      const b = this.get(u.ord.t);
      if (!b || b.hp <= 0 || b.owner !== u.owner) { this.setOrder(u, null); continue; }
      if (!b.done) continue;
      const d = BLDS[b.type];
      if (!d.gather) continue;
      const n = count.get(b.id) || 0;
      if (n < this.slots(b)) { count.set(b.id, n + 1); continue; }
      // full: find nearest other building of this type with room
      let best = null, bd = 1e9;
      for (const o of this.s.blds) {
        if (o.type !== b.type || o.owner !== u.owner || !o.done || o.hp <= 0 || o.id === b.id) continue;
        if ((count.get(o.id) || 0) >= this.slots(o)) continue;
        const dd = this.edgeDist(u.x, u.y, o);
        if (dd < bd) { bd = dd; best = o; }
      }
      if (best) { count.set(best.id, (count.get(best.id) || 0) + 1); this.setOrder(u, { k: 'work', t: best.id }); }
      else { this.setOrder(u, null); this.event({ type: 'error', p: u.owner, msg: `${d.names[0]} is full (${this.slots(b)} workers). Upgrade it for more room.` }); }
    }
    this.workerCount = count;
  }

  // Walk the current path. Returns true when the end is reached.
  walk(u, speed) {
    let rem = speed * this.spdMul * DT;
    const here = this.terr[Math.floor(u.y) * this.W + Math.floor(u.x)];
    if (here === u.owner) { if (this.autobahn[u.owner]) rem *= 1.4; }
    else if (here >= 0 && this.karaoke[here] && this.enemy(here, u.owner)) rem *= 0.75;
    // Stuck check: if we barely moved in the last second, skip the current waypoint.
    if (this.s.tick % 20 === u.id % 20) {
      const mx = u.x - (u.sx ?? u.x), my = u.y - (u.sy ?? u.y);
      if (u.sx != null && mx * mx + my * my < 0.04 && u.pi < u.path.length) u.pi += 2;
      u.sx = u.x; u.sy = u.y;
    }
    while (rem > 0 && u.pi < u.path.length) {
      const wx = u.path[u.pi], wy = u.path[u.pi + 1];
      const dx = wx - u.x, dy = wy - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      // Corners along the way don't need to be hit exactly (stops units piling up on them).
      if (u.pi + 2 < u.path.length && d < 0.35) { u.pi += 2; continue; }
      if (d > 1e-6) { u.fx = dx / d; u.fy = dy / d; }
      const step = d <= rem ? 1 : rem / d;
      const nx = u.x + dx * step, ny = u.y + dy * step;
      const ctx = Math.floor(nx), cty = Math.floor(ny);
      if ((ctx !== Math.floor(u.x) || cty !== Math.floor(u.y)) && !this.passable(ctx, cty)) {
        // Something was built in the way: drop the path so a new one is planned.
        u.path = []; u.pi = 0; u.blocked = 1;
        return false;
      }
      u.x = nx; u.y = ny;
      if (d <= rem) { u.pi += 2; rem -= d; } else rem = 0;
    }
    return u.pi >= u.path.length;
  }

  // Returns null if we're out of path-finding budget this tick (try again next tick).
  pathTo(u, rect, tol, exact) {
    if (this.pathBudget <= 0) return null;
    this.pathBudget--;
    const r = this.pf.find(this.pass, u.x, u.y, rect, tol, exact);
    u.path = r.pts; u.pi = 0;
    return r.reached;
  }

  // Move toward an entity until within `range`. Returns true when in range.
  approach(u, t, range, st) {
    const d = this.edgeDist(u.x, u.y, t) - st.radius;
    if (d <= range) { u.path = []; u.pi = 0; return true; }
    if (u.rep > 0) u.rep--;
    const done = u.pi >= u.path.length;
    const moved = t.kind !== 'b' && (Math.abs(u.gx - t.x) + Math.abs(u.gy - t.y) > 1.5);
    if (u.rep === 0 && (done || moved) && this.pathBudget > 0) {
      if (t.kind !== 'b') {
        const tx = Math.floor(t.x), ty = Math.floor(t.y);
        this.pathTo(u, [tx, ty, tx + 1, ty + 1], Math.max(0, range - 0.5), [t.x, t.y]);
        u.gx = t.x; u.gy = t.y;
      } else {
        // Stop at a tile whose centre is already in range, so we never end a path just short.
        this.pathTo(u, [t.x, t.y, t.x + t.size, t.y + t.size], Math.max(0.55, range + st.radius - 0.05), null);
      }
      u.rep = 10;
    }
    if (u.pi < u.path.length) this.walk(u, st.speed);
    else if (d < 3) {
      // Path used up but still not quite there (crowding): step straight at the target.
      let px, py;
      if (t.kind !== 'b') { px = t.x; py = t.y; }
      else { px = Math.max(t.x, Math.min(t.x + t.size, u.x)); py = Math.max(t.y, Math.min(t.y + t.size, u.y)); }
      const dx = px - u.x, dy = py - u.y, dd = Math.sqrt(dx * dx + dy * dy);
      if (dd > 1e-6) {
        const step = Math.min(dd, st.speed * DT);
        this.nudge(u, (dx / dd) * step, (dy / dd) * step);
      }
    }
    return false;
  }

  attack(u, t, st) {
    if (u.cd > 0) return;
    u.cd = this.buffed && this.buffed.has(u.id) ? st.cd * 0.75 : st.cd;
    const [tx, ty] = this.centre(t);
    const dx = tx - u.x, dy = ty - u.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1e-6) { u.fx = dx / d; u.fy = dy / d; }
    this.event({ type: 'shot', p: u.owner, cls: st.cls, age: this.s.players[u.owner].age, x: u.x, y: u.y, x2: tx, y2: ty, melee: st.range < 1, ut: u.type, uq: st.uniq, fa: st.air ? 1 : 0, ta: this.isAir(t) ? 1 : 0 });
    let atk = st.atk * this.rankMul(u);
    if (this.tigers[u.owner] && u.hp < this.uMax(u) * 0.5) atk *= 1.5;
    this.damage(t, atk * MULT[st.cls][this.clsOf(t)], u.owner, u.id);
    if (st.splash > 0) {
      this.unitsNear(tx, ty, st.splash + 0.5, (o) => {
        if (o === t || o.hp <= 0 || !this.enemy(u.owner, o.owner) || UNITS[o.type].air) return;
        const ex = o.x - tx, ey = o.y - ty;
        if (ex * ex + ey * ey <= st.splash * st.splash) this.damage(o, atk * 0.5 * MULT[st.cls][UNITS[o.type].cls], u.owner, u.id);
      });
    }
  }

  damage(t, amount, by, src = 0) {
    if (t.hp <= 0) return;
    t.hp -= amount;
    if (t.kind === 'b') t.lastAtk = by;
    if (src) t.hitU = src;
    if (t.kind === 'c') {
      t.hitBy = by;
      // Cows run away from whoever hit them. Mutant cows get angry instead.
      const a = src ? this.get(src) : null;
      if (a) {
        if (t.mutant) t.tgt = a.id;
        else {
          const dx = t.x - a.x, dy = t.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
          t.fx = dx / d; t.fy = dy / d; t.flee = 30;
        }
      }
      return;
    }
    if (by >= 0 && t.owner !== by) {
      t.hitBy = by;
      const [cx, cy] = this.centre(t);
      // Let the victim's owner know (UI throttles these).
      this.event({ type: 'attacked', p: t.owner, x: cx, y: cy });
      // Idle units that are hit fight back.
      if (t.kind === 'u' && !t.ord && UNITS[t.type].cls !== 'cit' && !UNITS[t.type].air) {
        const ts = this.stats(t.owner, t.type);
        const att = this.findEnemy(t.owner, t.x, t.y, 10, true, ts.aaOnly ? 'only' : ts.aa ? 'yes' : 'no');
        if (att) { t.ord = { k: 'attack', t: att.id, auto: true, hx: t.x, hy: t.y }; t.path = []; t.pi = 0; t.rep = 0; }
      }
    }
  }

  updateUnit(u) {
    const st = this.stats(u.owner, u.type);
    u.px = u.x; u.py = u.y;
    if (u.cd > 0) u.cd -= DT;
    u.working = false;
    if (st.air) { this.updateAir(u, st); return; }
    const o = u.ord;
    const mil = st.cls !== 'cit' && UNITS[u.type].support !== 'band';

    // Idle or attack-moving soldiers look for fights.
    if (mil && (!o || (o.k === 'move' && o.am))) {
      u.scan--;
      if (u.scan <= 0) {
        u.scan = 8 + (u.id % 5);
        const e = this.findEnemy(u.owner, u.x, u.y, st.sight, st.aaOnly, st.aaOnly ? 'only' : st.aa ? 'yes' : 'no') || (st.aaOnly ? null : findMutant(this, u.x, u.y, st.sight));
        if (e) {
          const resume = o && o.k === 'move' ? { ...o } : null;
          u.ord = { k: 'attack', t: e.id, auto: true, resume, hx: u.x, hy: u.y };
          u.path = []; u.pi = 0;
          return;
        }
      }
    }

    if (!o) return;
    if (o.k === 'move') {
      if (!u.path.length) {
        if (u.rep > 0) { u.rep--; return; }
        const reached = this.pathTo(u, [Math.floor(o.x), Math.floor(o.y), Math.floor(o.x) + 1, Math.floor(o.y) + 1], 0, [o.x, o.y]);
        if (reached === null) return;
        u.rep = 10;
        if (!u.path.length) { u.ord = null; return; }
        if (!reached) o.partial = 1;
      }
      if (this.walk(u, st.speed)) { u.ord = null; u.path = []; u.pi = 0; }
      return;
    }
    if (o.k === 'attack') {
      const t = this.get(o.t);
      const lost = !t || t.hp <= 0 || !this.hostile(u.owner, t) || !this.canHit(st, t);
      // Auto targets: give up if they lead us too far away.
      const tooFar = t && o.auto && !o.resume && o.hx != null && ((t.kind !== 'b' ? (t.x - o.hx) * (t.x - o.hx) + (t.y - o.hy) * (t.y - o.hy) : 0) > (st.sight + 5) * (st.sight + 5));
      if (lost || tooFar) {
        const next = o.resume || null;
        this.setOrder(u, next);
        if (!next && mil) u.scan = 0;
        return;
      }
      if (this.approach(u, t, st.range, st)) this.attack(u, t, st);
      return;
    }
    if (o.k === 'work') {
      const b = this.get(o.t);
      if (!b || b.hp <= 0 || b.owner !== u.owner) { this.setOrder(u, null); return; }
      if (!this.approach(u, b, 0.9, st)) return;
      u.working = true;
      const d = BLDS[b.type];
      const [bx, by] = this.centre(b);
      const dx = bx - u.x, dy = by - u.y, dd = Math.sqrt(dx * dx + dy * dy);
      if (dd > 1e-6) { u.fx = dx / dd; u.fy = dy / dd; }
      const bmax = this.bldMaxHp(b);
      if (!b.done) {
        const rate = BUILD_RATE * (1 + nbonus(this.s.players[u.owner], 'buildSpeed')) * DT;
        b.prog += rate;
        b.hp = Math.min(bmax, b.hp + (bmax * 0.9 * rate) / d.time);
        if (b.prog >= d.time) this.finishBld(b);
      } else if (d.gather) {
        const pl = this.s.players[u.owner];
        const amt = GATHER_RATE[d.gather] * gatherMult(pl, d.gather) * this.gathMul[d.gather] * this.lvlMul(b);
        pl.res[d.gather] += amt * DT;
        pl.st.gath[d.gather] += amt * DT;
        this.rates[u.owner][d.gather] += amt;
      } else if (b.hp < bmax) {
        b.hp = Math.min(bmax, b.hp + 15 * DT); // repair
      } else {
        this.setOrder(u, null);
      }
    }
  }

  // ---------- planes ----------
  // Planes fly in straight lines over anything. They don't push each other around.
  fly(u, x, y, speed, tol) {
    const dx = x - u.x, dy = y - u.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d <= tol + 1e-6) return true;
    u.fx = dx / d; u.fy = dy / d;
    const step = speed * this.spdMul * DT;
    if (step >= d - tol) { u.x = x - u.fx * tol; u.y = y - u.fy * tol; return true; }
    u.x += u.fx * step; u.y += u.fy * step;
    return false;
  }

  // Nearest own airfield (or city) to land at and reload.
  homeBase(u) {
    let best = null, bd = 1e18;
    for (const b of this.s.blds) {
      if (b.owner !== u.owner || !b.done || b.hp <= 0 || (b.type !== 'airfield' && b.type !== 'city')) continue;
      const [cx, cy] = this.centre(b);
      const d = (cx - u.x) * (cx - u.x) + (cy - u.y) * (cy - u.y) + (b.type === 'city' ? 400 : 0); // prefer airfields
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  updateAir(u, st) {
    let o = u.ord;
    // Fighters look for enemy planes when idle or attack-moving.
    if (!st.bomb && (!o || (o.k === 'move' && o.am))) {
      u.scan--;
      if (u.scan <= 0) {
        u.scan = 8 + (u.id % 5);
        const e = this.findEnemy(u.owner, u.x, u.y, st.sight, true, 'only');
        if (e) { u.ord = { k: 'attack', t: e.id, auto: true, resume: o && o.k === 'move' ? { ...o } : null }; o = u.ord; }
      }
    }
    if (!o) {
      if (st.bomb && !u.ammo) u.ord = { k: 'rearm' };
      return;
    }
    if (o.k === 'move') { if (this.fly(u, o.x, o.y, st.speed, 0)) u.ord = null; return; }
    if (o.k === 'rearm') {
      const base = this.homeBase(u);
      if (!base) { u.ord = null; return; } // nowhere to land: circle around, out of bombs
      const [bx, by] = this.centre(base);
      if (!this.fly(u, bx, by, st.speed, 0.6)) { u.rt = 0; return; }
      u.rt = (u.rt || 0) + DT;
      if (u.rt >= UNITS[u.type].rearm) {
        u.ammo = 1; u.rt = 0;
        const r = o.resume, t = r && this.get(r.t);
        u.ord = t && t.hp > 0 && this.hostile(u.owner, t) ? r : null;
      }
      return;
    }
    if (o.k === 'attack') {
      const t = this.get(o.t);
      if (!t || t.hp <= 0 || !this.hostile(u.owner, t) || !this.canHit(st, t)) { this.setOrder(u, o.resume || null); return; }
      const [tx, ty] = this.centre(t);
      if (st.bomb) {
        if (!u.ammo) { u.ord = { k: 'rearm', resume: { k: 'attack', t: t.id } }; return; }
        if (this.fly(u, tx, ty, st.speed, 0.2)) {
          this.dropBombs(u, st, tx, ty);
          u.ammo = 0;
          u.ord = { k: 'rearm', resume: { k: 'attack', t: t.id } };
        }
        return;
      }
      if (this.edgeDist(u.x, u.y, t) - st.radius > st.range) this.fly(u, tx, ty, st.speed, 0);
      else this.attack(u, t, st);
    }
  }

  // A bomber's whole load lands around (x, y): heavy damage to buildings, and hurts units nearby.
  dropBombs(u, st, x, y) {
    const r = st.splash, atk = st.atk * this.rankMul(u) * (this.tigers[u.owner] && u.hp < this.uMax(u) * 0.5 ? 1.5 : 1);
    this.event({ type: 'bomb', p: u.owner, x, y, r, age: this.s.players[u.owner].age });
    this.unitsNear(x, y, r + 0.5, (o) => {
      if (o.hp <= 0 || !this.enemy(u.owner, o.owner) || UNITS[o.type].air) return;
      const dx = o.x - x, dy = o.y - y;
      if (dx * dx + dy * dy <= r * r) this.damage(o, atk * 0.6 * MULT.bomb[UNITS[o.type].cls], u.owner, u.id);
    });
    for (const b of this.s.blds) {
      if (b.hp <= 0 || !this.enemy(u.owner, b.owner)) continue;
      if (this.edgeDist(x, y, b) <= r * 0.5) this.damage(b, atk * MULT.bomb.bld, u.owner, u.id);
    }
    for (const c of this.s.critters) {
      const dx = c.x - x, dy = c.y - y;
      if (dx * dx + dy * dy <= r * r) this.damage(c, atk * 0.6, u.owner, u.id);
    }
  }

  finishBld(b) {
    const d = BLDS[b.type];
    b.done = true; b.prog = d.time;
    this.s.players[b.owner].st.built++;
    this.event({ type: 'built', p: b.owner, id: b.id, btype: b.type, x: b.x + b.size / 2, y: b.y + b.size / 2 });
    if (b.type === 'city') {
      const pl = this.s.players[b.owner], list = nationOf(pl).cities;
      const n = pl.cityN || 1;
      b.name = n < list.length ? list[n] : `${list[n % list.length]} ${Math.floor(n / list.length) + 1}`;
      pl.cityN = n + 1;
      this.recalcTerritory();
    }
    // Builders of non-gather buildings move on to the nearest unfinished building, or go idle.
    // Gather builders keep working there.
    if (!d.gather) {
      for (const u of this.s.units) {
        if (!u.ord || u.ord.k !== 'work' || u.ord.t !== b.id) continue;
        const next = this.nearestUnfinished(u);
        this.setOrder(u, next ? { k: 'work', t: next.id } : null);
      }
    }
  }

  nearestUnfinished(u) {
    let best = null, bd = 12;
    for (const o of this.s.blds) {
      if (o.done || o.owner !== u.owner || o.hp <= 0) continue;
      const d = this.edgeDist(u.x, u.y, o);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // Push overlapping units apart a little each tick.
  separate() {
    for (const u of this.s.units) {
      if (u.hp <= 0 || UNITS[u.type].air) continue;
      const ru = UNITS[u.type].radius;
      this.unitsNear(u.x, u.y, 1, (o) => {
        if (o.id <= u.id || o.hp <= 0 || UNITS[o.type].air) return;
        const ro = UNITS[o.type].radius;
        let dx = o.x - u.x, dy = o.y - u.y;
        let d2 = dx * dx + dy * dy;
        const min = ru + ro;
        if (d2 >= min * min) return;
        if (d2 < 1e-8) { dx = ((u.id * 7 + o.id) % 11) / 11 - 0.5; dy = 0.3; d2 = dx * dx + dy * dy; }
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.4;
        const nx = dx / d, ny = dy / d;
        // Moving units shove through standing ones: they get pushed much less.
        const wu = u.pi < u.path.length ? 0.25 : 1, wo = o.pi < o.path.length ? 0.25 : 1;
        const fu = (push * wu) / (wu + wo), fo = (push * wo) / (wu + wo);
        this.nudge(u, -nx * fu, -ny * fu);
        this.nudge(o, nx * fo, ny * fo);
      });
    }
  }

  nudge(u, dx, dy) {
    const nx = u.x + dx, ny = u.y + dy;
    if (this.passable(Math.floor(nx), Math.floor(ny))) { u.x = nx; u.y = ny; }
  }

  updateBld(b) {
    const d = BLDS[b.type];
    if (!b.done) return;
    const p = b.owner, pl = this.s.players[p];

    // Production queue: only the first item makes progress.
    if (b.q.length) {
      const it = b.q[0];
      if (it.k === 'unit' && this.popNow[p] >= this.capNow[p]) {
        it.blocked = 1;
      } else {
        it.blocked = 0;
        it.t -= DT;
        if (it.t <= 0) {
          b.q.shift();
          this.finishItem(b, it);
        }
      }
    }

    // Cities and towers shoot.
    if (d.atk) {
      if (b.cd > 0) b.cd -= DT;
      let t = b.tgt ? this.get(b.tgt) : null;
      const cx = b.x + b.size / 2, cy = b.y + b.size / 2;
      if (t && (t.hp <= 0 || this.edgeDist(cx, cy, t) > d.range + b.size / 2)) t = null;
      if (!t) {
        b.scan--;
        if (b.scan <= 0) {
          b.scan = 6;
          t = this.findEnemy(p, cx, cy, d.range + b.size / 2, true) || findMutant(this, cx, cy, d.range + b.size / 2);
        }
      }
      b.tgt = t ? t.id : 0;
      if (t && b.cd <= 0) {
        b.cd = d.cd;
        const mul = MULT.bld[this.clsOf(t)] * (1 + 0.25 * pl.age);
        this.event({ type: 'shot', p, cls: 'bld', age: pl.age, x: cx, y: cy, x2: t.x, y2: t.y, melee: false, ta: this.isAir(t) ? 1 : 0 });
        this.damage(t, d.atk * mul, p);
      }
    }
  }

  finishItem(b, it) {
    const p = b.owner, pl = this.s.players[p];
    if (it.k === 'unit') {
      const n = UNITS[it.type].batch || 1; // Taiwan's scooters come three at a time
      for (let i = 0; i < n; i++) this.spawnUnit(b, it.type);
    } else if (it.k === 'age') {
      pl.age++;
      delete pl.pending.age;
      this.refreshStats(p);
      this.recalcTerritory();
      this.event({ type: 'age', p, age: pl.age });
    } else if (it.k === 'tech') {
      pl.techs[it.type] = 1;
      delete pl.pending[it.type];
      this.refreshStats(p);
      this.event({ type: 'tech', p, tech: it.type });
    } else if (it.k === 'upg') {
      b.lvl = (b.lvl || 0) + 1;
      this.event({ type: 'upgraded', p, id: b.id, btype: b.type, lvl: b.lvl, x: b.x + b.size / 2, y: b.y + b.size / 2 });
    } else if (it.k === 'nuke') {
      b.stock++;
      this.event({ type: 'nukeReady', p, id: b.id });
    }
  }

  spawnUnit(b, type) {
    const p = b.owner;
    const spot = this.spawnSpot(b);
    const u = this.addUnit(type, p, spot[0], spot[1]);
    this.popNow[p]++;
    if (b.rally) {
      const rt = b.rally.t ? this.get(b.rally.t) : null;
      if (rt && rt.hp > 0) {
        if (rt.kind === 'b' && rt.owner === p && u.type === 'citizen') u.ord = { k: 'work', t: rt.id };
        else if (this.enemy(p, rt.owner)) u.ord = { k: 'attack', t: rt.id };
      } else if (b.rally.x != null) {
        u.ord = { k: 'move', x: b.rally.x, y: b.rally.y, am: u.type !== 'citizen' };
      }
    }
    this.event({ type: 'trained', p, id: u.id, utype: u.type });
  }

  spawnSpot(b) {
    // Prefer the side facing the rally point, else below the building.
    let tx = b.x + Math.floor(b.size / 2), ty = b.y + b.size;
    if (b.rally && b.rally.x != null) {
      const cx = b.x + b.size / 2, cy = b.y + b.size / 2;
      const dx = b.rally.x - cx, dy = b.rally.y - cy;
      if (Math.abs(dx) > Math.abs(dy)) { tx = dx > 0 ? b.x + b.size : b.x - 1; ty = b.y + Math.floor(b.size / 2); }
      else { ty = dy > 0 ? b.y + b.size : b.y - 1; }
    }
    return this.freeSpotNear(tx, ty, 1);
  }

  cityIncome() {
    for (const b of this.s.blds) {
      if (b.type !== 'city' || !b.done || b.hp <= 0) continue;
      const pl = this.s.players[b.owner], m = nbonus(pl, 'cityIncome') || 1;
      for (const k in CITY_INCOME) {
        pl.res[k] += CITY_INCOME[k] * m * DT;
        this.rates[b.owner][k] += CITY_INCOME[k] * m;
      }
    }
  }

  hazards() {
    const s = this.s;
    // Attrition in enemy territory (checked twice a second).
    if (s.tick % 10 === 0) {
      for (const u of s.units) {
        if (u.hp <= 0) continue;
        const o = this.terrAt(u.x, u.y);
        if (o >= 0 && this.enemy(o, u.owner)) {
          const pl = s.players[u.owner];
          // Logistics and K2 Climbers make it hurt less. Karaoke Night makes it hurt more.
          const mul = (1 - techSum(pl, 'attrition')) * (1 - nbonus(pl, 'attrition')) * (this.karaoke[o] ? 2 : 1);
          u.hp -= this.uMax(u) * ATTRITION * mul * 0.5;
          u.attr = s.tick;
        } else if (o === u.owner && s.players[o].techs.seven11) {
          // 7-Eleven on Every Corner: heal 1.5% a second at home.
          u.hp = Math.min(this.uMax(u), u.hp + this.uMax(u) * 0.0075);
        }
      }
      // Battle Jeepneys bring lunch: nearby own units heal 3% a second.
      for (const j of s.units) {
        if (j.hp <= 0 || UNITS[j.type].support !== 'heal') continue;
        this.unitsNear(j.x, j.y, 3.5, (o) => {
          if (o.owner !== j.owner || o === j || o.hp <= 0) return;
          const dx = o.x - j.x, dy = o.y - j.y;
          if (dx * dx + dy * dy <= 12.25) { const m = this.uMax(o); if (o.hp < m) { o.hp = Math.min(m, o.hp + m * 0.015); o.healT = s.tick; } }
        });
      }
    }
    // Fallout zones.
    if (s.fallout.length) {
      s.fallout = s.fallout.filter((f) => f.until > s.tick);
      if (s.tick % 10 === 0) {
        for (const f of s.fallout) {
          this.unitsNear(f.x, f.y, f.r, (u) => {
            const dx = u.x - f.x, dy = u.y - f.y;
            if (dx * dx + dy * dy <= f.r * f.r) u.hp -= this.stats(u.owner, u.type).hp * FALLOUT_DMG * 0.5;
          });
        }
      }
    }
  }

  updateMissiles() {
    const s = this.s;
    if (!s.missiles.length) return;
    const keep = [];
    for (const m of s.missiles) {
      m.t += DT;
      if (m.t < m.dur) { keep.push(m); continue; }
      this.detonate(m);
    }
    s.missiles = keep;
  }

  detonate(m) {
    const s = this.s;
    s.doom++;
    // Missile defence: the owner of the target territory may shoot it down.
    const o = this.terrAt(m.x, m.y);
    if (o >= 0 && this.enemy(o, m.owner) && s.players[o].techs.sdi && this.rand() < NUKE.sdiChance) {
      this.event({ type: 'intercept', p: m.owner, victim: o, x: m.x, y: m.y });
      return;
    }
    this.event({ type: 'nuke', p: m.owner, x: m.x, y: m.y });
    const kr = NUKE.killRadius, br = NUKE.blastRadius;
    for (const u of s.units) {
      if (u.hp <= 0) continue;
      const dx = u.x - m.x, dy = u.y - m.y, d2 = dx * dx + dy * dy;
      if (d2 <= kr * kr) { u.hp = 0; u.hitBy = m.owner; }
      else if (d2 <= br * br) this.damage(u, this.stats(u.owner, u.type).hp * NUKE.blastDmg, m.owner);
    }
    for (const c of s.critters) {
      const dx = c.x - m.x, dy = c.y - m.y;
      if (dx * dx + dy * dy <= kr * kr && !c.mutant) c.hp = 0;
    }
    for (const b of s.blds) {
      if (b.hp <= 0) continue;
      const d = this.edgeDist(m.x, m.y, b);
      const maxHp = this.bldMaxHp(b);
      if (d <= kr) {
        if (b.type === 'city') { b.hp = Math.min(b.hp, 1); b.lastAtk = m.owner; b.nuked = 1; }
        else { b.hp = 0; b.lastAtk = m.owner; }
      } else if (d <= br) {
        if (b.type === 'city') b.hp = Math.max(1, b.hp - maxHp * NUKE.blastDmg);
        else this.damage(b, maxHp * NUKE.blastDmg, m.owner);
      }
    }
    s.fallout.push({ x: m.x, y: m.y, r: NUKE.falloutRadius, until: s.tick + Math.round(NUKE.falloutTime / DT) });
    const lim = this.settings.doomsday | 0;
    if (lim > 0 && s.doom >= lim) {
      s.over = { armageddon: true, tick: s.tick };
      this.event({ type: 'armageddon' });
    }
  }

  cleanup() {
    const s = this.s;
    let terrChanged = false;
    // Dead units.
    if (s.units.some((u) => u.hp <= 0)) {
      const alive = [];
      for (const u of s.units) {
        if (u.hp > 0) { alive.push(u); continue; }
        this.byId.delete(u.id);
        s.players[u.owner].lost++;
        const by = u.hitBy != null && u.hitBy >= 0 && u.hitBy !== u.owner ? u.hitBy : -1;
        if (by >= 0) {
          s.players[by].kills++;
          // The unit that landed the last hit may get promoted.
          const k = u.hitU ? this.get(u.hitU) : null;
          if (k && k.kind === 'u' && k.hp > 0 && k.owner === by) {
            k.kills = (k.kills || 0) + 1;
            const rank = k.kills >= 15 ? 3 : k.kills >= 7 ? 2 : k.kills >= 3 ? 1 : 0;
            if (rank > (k.rank || 0)) {
              const f = k.hp / this.uMax(k);
              k.rank = rank;
              k.hp = f * this.uMax(k);
              s.players[by].st.promos++;
              this.event({ type: 'promote', p: by, id: k.id, rank, x: k.x, y: k.y, utype: k.type });
            }
          }
        }
        this.event({ type: 'die', p: u.owner, by, x: u.x, y: u.y, utype: u.type, cls: UNITS[u.type].cls });
      }
      s.units = alive;
    }
    // Dead buildings. Cities get captured instead of destroyed.
    if (s.blds.some((b) => b.hp <= 0)) {
      const keep = [];
      for (const b of s.blds) {
        if (b.hp > 0) { keep.push(b); continue; }
        if (b.type === 'city' && b.done && this.tryCapture(b)) { keep.push(b); terrChanged = true; continue; }
        if (b.type === 'city' && b.done) { b.hp = 1; keep.push(b); continue; }
        this.markBld(b, false);
        this.byId.delete(b.id);
        if (b.lastAtk >= 0 && b.lastAtk !== b.owner && s.players[b.lastAtk]) s.players[b.lastAtk].st.razed++;
        this.event({ type: 'destroyed', p: b.owner, x: b.x + b.size / 2, y: b.y + b.size / 2, size: b.size, btype: b.type });
        if (b.type === 'city') terrChanged = true;
      }
      s.blds = keep;
    }
    if (terrChanged) this.recalcTerritory();
  }

  tryCapture(b) {
    const by = b.lastAtk;
    if (by < 0 || !this.enemy(by, b.owner) || !this.s.players[by].alive) return false;
    // Need a land unit of the attacker nearby to take the city.
    let near = false;
    const cx = b.x + 1.5, cy = b.y + 1.5;
    this.unitsNear(cx, cy, 7, (u) => {
      if (u.owner === by && u.hp > 0 && UNITS[u.type].cls !== 'cit' && !UNITS[u.type].air) {
        const dx = u.x - cx, dy = u.y - cy;
        if (dx * dx + dy * dy <= 49) near = true;
      }
    });
    if (!near) return false;
    const was = b.owner;
    this.s.players[by].st.caps++;
    b.owner = by; b.hp = this.bldHp('city', by) * 0.25; b.q = []; b.rally = null; b.tgt = 0; b.lastAtk = -1;
    // Anyone queued in the old owner's research is lost; clear pending flags they owned.
    this.event({ type: 'captured', p: by, from: was, id: b.id, x: cx, y: cy, name: b.name });
    // Stop the old owner's citizens working there.
    for (const u of this.s.units) if (u.ord && u.ord.t === b.id && u.owner === was) this.setOrder(u, null);
    this.fixPending(was);
    return true;
  }

  // Recompute 'pending' research flags from what is actually queued.
  fixPending(p) {
    const pl = this.s.players[p];
    const pend = {};
    for (const b of this.s.blds) {
      if (b.owner !== p) continue;
      for (const it of b.q) if (it.k === 'age') pend.age = 1; else if (it.k === 'tech') pend[it.type] = 1;
    }
    pl.pending = pend;
  }

  eliminate(p, why) {
    const pl = this.s.players[p];
    if (!pl.alive) return;
    pl.alive = false;
    for (const u of this.s.units) if (u.owner === p) u.hp = 0;
    for (const b of this.s.blds) if (b.owner === p) { b.hp = 0; b.type === 'city' && (b.done = false); }
    this.event({ type: 'eliminated', p, why });
    this.cleanup();
  }

  checkEnd() {
    const s = this.s;
    if (s.tick % 20 !== 0) return;
    for (let p = 0; p < s.players.length; p++) {
      if (s.players[p].alive && this.cityCount(p) === 0) this.eliminate(p, 'lost all cities');
    }
    const teams = new Set(s.players.map((p) => p.team));
    if (teams.size < 2) return; // practice games never end
    const aliveTeams = new Set(s.players.filter((p) => p.alive).map((p) => p.team));
    if (aliveTeams.size <= 1) {
      s.over = { winnerTeam: aliveTeams.size ? [...aliveTeams][0] : null, tick: s.tick };
      this.event({ type: 'victory', team: s.over.winnerTeam });
    }
  }

  // Small checksum used to catch players getting out of sync.
  hash() {
    let h = 2166136261 >>> 0;
    const mix = (v) => { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; };
    const s = this.s;
    mix(s.tick); mix(s.nextId); mix(s.rng); mix(s.units.length); mix(s.blds.length);
    for (const u of s.units) { mix(u.id); mix(Math.round(u.x * 1000)); mix(Math.round(u.y * 1000)); mix(Math.round(u.hp * 100)); }
    for (const b of s.blds) { mix(b.id); mix(b.owner); mix(Math.round(b.hp * 100)); mix(b.q.length); mix(b.lvl || 0); }
    for (const p of s.players) for (const k of RES) mix(Math.round(p.res[k] * 100));
    for (const c of s.critters) { mix(c.id); mix(Math.round(c.x * 1000)); mix(Math.round(c.y * 1000)); mix(Math.round(c.hp * 100)); }
    mix(s.crates.length); mix(s.meteors.length);
    return h;
  }
}
