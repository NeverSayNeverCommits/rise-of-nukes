// The silly stuff: cows, mutant cows, supply crates, random events and meteors.
// This is part of the simulation, so the same rules apply: deterministic only (use w.rand()).
import { T } from './map.js';
import { UNITS, TECHS, TECH_ORDER, forNation } from './data.js';
import { nbonus } from './nations.js';

const DT = 0.05;
const SEC = 20; // ticks per second

export const COW = { hp: 60, speed: 0.7, food: 120, radius: 0.35 };
export const MUTANT = { hp: 450, speed: 1.8, atk: 18, cd: 1.2, reach: 0.5, sight: 7, food: 300, radius: 0.5 };

export const SILLY = {
  frogs: { title: '🐸 Plague of frogs!', text: 'Food production halved for 30 seconds. Ribbit.' },
  happy: { title: '🍺 Happy hour!', text: 'Everyone moves 40% faster for 40 seconds. Nobody walks straight.' },
  tax: { title: '💸 Tax audit!', text: '' },
  stampede: { title: '🐄 Cow stampede!', text: 'A herd of cows has wandered in. Free steak.' },
  drop: { title: '🎁 Supply drop!', text: 'A crate has landed near the middle of the map. Go get it!' },
  meteor: { title: '☄️ Meteor incoming!', text: 'Something big is falling from the sky. Get out of the red circle!' },
  boom: { title: '📈 Economic boom!', text: 'All gathering doubled for 25 seconds.' },
};

export function initExtras(w) {
  const s = w.s;
  s.critters = []; s.crates = []; s.meteors = []; s.mods = {};
  s.nextSilly = w.settings.silly === false ? -1 : Math.round((240 + w.rand() * 120) * SEC);
  // A few cows near each start, and more spread around the map.
  for (const [sx, sy] of w.map.starts) {
    for (let i = 0; i < 3; i++) { const p = randomSpot(w, sx, sy, 7, 13); if (p) addCritter(w, p[0], p[1]); }
  }
  const extra = Math.round((w.W * w.H) / 1100);
  for (let i = 0; i < extra; i++) { const p = randomSpot(w, w.W / 2, w.H / 2, 0, w.W / 2); if (p && farFromStarts(w, p, 14)) addCritter(w, p[0], p[1]); }
  // Crates (like the ruins in Rise of Nations), away from the starts.
  const crates = Math.round(((w.W * w.H) / (128 * 128)) * (4 + w.map.starts.length * 2));
  for (let i = 0, tries = 0; i < crates && tries < 200; tries++) {
    const p = randomSpot(w, w.W / 2, w.H / 2, 0, w.W / 2);
    if (p && farFromStarts(w, p, 16)) { addCrate(w, p[0], p[1]); i++; }
  }
}

function farFromStarts(w, p, d) {
  return w.map.starts.every(([sx, sy]) => (p[0] - sx) * (p[0] - sx) + (p[1] - sy) * (p[1] - sy) >= d * d);
}

export function randomSpot(w, cx, cy, rmin, rmax) {
  for (let i = 0; i < 60; i++) {
    const x = Math.floor(cx + (w.rand() * 2 - 1) * rmax), y = Math.floor(cy + (w.rand() * 2 - 1) * rmax);
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    if (dx * dx + dy * dy < rmin * rmin) continue;
    if (w.passable(x, y)) return [x + 0.5, y + 0.5];
  }
  return null;
}

export function addCritter(w, x, y, mutant = 0) {
  const c = { kind: 'c', id: w.newId(), type: 'cow', owner: -1, x, y, px: x, py: y, hp: mutant ? MUTANT.hp : COW.hp, mutant, tx: x, ty: y, wt: 0, cd: 0, tgt: 0, flee: 0, fx: 1, fy: 0 };
  w.s.critters.push(c);
  w.byId.set(c.id, c);
  return c;
}

export function addCrate(w, x, y) {
  w.s.crates.push({ id: w.newId(), x, y });
}

function towards(w, c, x, y, speed) {
  const dx = x - c.x, dy = y - c.y, d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.05) return true;
  const step = Math.min(d, speed * DT);
  c.fx = dx / d; c.fy = dy / d;
  const nx = c.x + (dx / d) * step, ny = c.y + (dy / d) * step;
  if (w.passable(Math.floor(nx), Math.floor(ny))) { c.x = nx; c.y = ny; return false; }
  return true; // blocked: count as arrived so we pick a new target
}

export function findMutant(w, x, y, r) {
  let best = null, bd = r * r;
  for (const c of w.s.critters) {
    if (!c.mutant || c.hp <= 0) continue;
    const dx = c.x - x, dy = c.y - y, d = dx * dx + dy * dy;
    if (d <= bd) { bd = d; best = c; }
  }
  return best;
}

export function updateExtras(w) {
  const s = w.s;
  const spd = w.spdMul;
  // ----- critters -----
  for (const c of s.critters) {
    if (c.hp <= 0) continue;
    c.px = c.x; c.py = c.y;
    if (c.cd > 0) c.cd -= DT;
    // Cows that wander into fallout become something else.
    if (!c.mutant) {
      for (const f of s.fallout) {
        const dx = c.x - f.x, dy = c.y - f.y;
        if (dx * dx + dy * dy <= f.r * f.r) {
          c.mutant = 1; c.hp = MUTANT.hp; c.tgt = 0;
          w.event({ type: 'mutate', x: c.x, y: c.y });
          break;
        }
      }
    }
    if (c.mutant) {
      let t = c.tgt ? w.get(c.tgt) : null;
      if (t && (t.hp <= 0 || (t.x - c.x) * (t.x - c.x) + (t.y - c.y) * (t.y - c.y) > (MUTANT.sight + 3) * (MUTANT.sight + 3))) t = null;
      if (!t && (s.tick + c.id) % 10 === 0) {
        let bd = MUTANT.sight * MUTANT.sight;
        w.unitsNear(c.x, c.y, MUTANT.sight, (u) => {
          const dx = u.x - c.x, dy = u.y - c.y, d = dx * dx + dy * dy;
          if (u.hp > 0 && d < bd) { bd = d; t = u; }
        });
      }
      c.tgt = t ? t.id : 0;
      if (t) {
        const dx = t.x - c.x, dy = t.y - c.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d - UNITS[t.type].radius - MUTANT.radius <= MUTANT.reach) {
          if (c.cd <= 0) {
            c.cd = MUTANT.cd;
            w.event({ type: 'shot', p: -1, cls: 'cow', age: 0, x: c.x, y: c.y, x2: t.x, y2: t.y, melee: true });
            t.hp -= MUTANT.atk;
            w.event({ type: 'attacked', p: t.owner, x: t.x, y: t.y });
          }
        } else towards(w, c, t.x, t.y, MUTANT.speed * spd);
        continue;
      }
    }
    if (c.flee > 0) {
      c.flee--;
      if (towards(w, c, c.x + c.fx, c.y + c.fy, (c.mutant ? MUTANT.speed : COW.speed * 3) * spd)) c.flee = 0;
      continue;
    }
    c.wt--;
    if (c.wt <= 0) {
      c.wt = 60 + Math.floor(w.rand() * 140);
      const p = randomSpot(w, c.x, c.y, 0, 3);
      if (p) { c.tx = p[0]; c.ty = p[1]; }
    }
    towards(w, c, c.tx, c.ty, (c.mutant ? MUTANT.speed * 0.5 : COW.speed) * spd);
  }
  // Dead critters give food to whoever killed them.
  if (s.critters.some((c) => c.hp <= 0)) {
    const keep = [];
    for (const c of s.critters) {
      if (c.hp > 0) { keep.push(c); continue; }
      w.byId.delete(c.id);
      const by = c.hitBy;
      let food = 0;
      if (by != null && by >= 0 && s.players[by]) {
        food = (c.mutant ? MUTANT.food : COW.food) * (nbonus(s.players[by], 'cowFood') || 1);
        s.players[by].res.food += food;
        s.players[by].st.cows++;
      }
      w.event({ type: 'critter', x: c.x, y: c.y, mutant: c.mutant, by, food });
    }
    s.critters = keep;
  }
  // Top up the cow population now and then.
  if (s.tick % (45 * SEC) === 0 && s.critters.length < Math.round((w.W * w.H) / 900)) {
    const p = randomSpot(w, w.W / 2, w.H / 2, 0, w.W / 2);
    if (p && w.terrAt(p[0], p[1]) < 0) addCritter(w, p[0], p[1]);
  }

  // ----- crates -----
  if (s.tick % 5 === 0 && s.crates.length) {
    s.crates = s.crates.filter((cr) => {
      let finder = null;
      w.unitsNear(cr.x, cr.y, 1, (u) => {
        if (finder || u.hp <= 0) return;
        const dx = u.x - cr.x, dy = u.y - cr.y;
        if (dx * dx + dy * dy <= 0.8) finder = u;
      });
      if (!finder) return true;
      openCrate(w, cr, finder.owner);
      return false;
    });
  }

  // ----- meteors -----
  if (s.meteors.length) {
    s.meteors = s.meteors.filter((m) => {
      m.t += DT;
      if (m.t < m.dur) return true;
      meteorImpact(w, m);
      return false;
    });
  }

  // ----- timed modifiers and random events -----
  for (const k in s.mods) if (s.mods[k].until <= s.tick) delete s.mods[k];
  if (s.nextSilly > 0 && s.tick >= s.nextSilly) {
    s.nextSilly = s.tick + Math.round((150 + w.rand() * 120) * SEC);
    sillyEvent(w);
  }
}

function openCrate(w, cr, p) {
  const s = w.s, pl = s.players[p];
  pl.st.crates++;
  const r = w.rand();
  const e = { type: 'crate', p, x: cr.x, y: cr.y };
  if (r < 0.45) {
    const opts = pl.age >= 3 ? ['food', 'wood', 'metal', 'oil'] : ['food', 'wood', 'metal'];
    const res = opts[Math.floor(w.rand() * opts.length)];
    const amt = 150 + Math.floor(w.rand() * 26) * 10;
    pl.res[res] += amt;
    Object.assign(e, { kind: 'res', res, amt });
  } else if (r < 0.65) {
    const lines = ['infantry', 'ranged', 'cavalry'];
    const type = lines[Math.floor(w.rand() * lines.length)];
    for (let i = 0; i < 2; i++) {
      const spot = w.freeSpotNear(Math.floor(cr.x), Math.floor(cr.y), 1);
      w.addUnit(type, p, spot[0], spot[1]);
    }
    Object.assign(e, { kind: 'units', utype: type });
  } else if (r < 0.75) {
    const opts = TECH_ORDER.filter((t) => !pl.techs[t] && !pl.pending[t] && TECHS[t].age <= pl.age && (!TECHS[t].req || pl.techs[TECHS[t].req]) && forNation(pl, TECHS[t]) && t !== 'manhattan' && t !== 'sdi');
    if (opts.length) {
      const t = opts[Math.floor(w.rand() * opts.length)];
      pl.techs[t] = 1;
      w.refreshStats(p);
      Object.assign(e, { kind: 'tech', tech: t });
    } else {
      pl.res.food += 200;
      Object.assign(e, { kind: 'res', res: 'food', amt: 200 });
    }
  } else if (r < 0.85) {
    for (let i = 0; i < 3; i++) { const sp = randomSpot(w, cr.x, cr.y, 0, 2); if (sp) addCritter(w, sp[0], sp[1]); }
    Object.assign(e, { kind: 'cows' });
  } else if (r < 0.9) {
    Object.assign(e, { kind: 'map' });
  } else {
    Object.assign(e, { kind: 'dud', n: Math.floor(w.rand() * 8) });
  }
  w.event(e);
}

function sillyEvent(w) {
  const s = w.s;
  const alive = s.players.map((p, i) => i).filter((i) => s.players[i].alive);
  const kinds = Object.keys(SILLY).filter((k) => k !== 'tax' || alive.length >= 2);
  const kind = kinds[Math.floor(w.rand() * kinds.length)];
  const e = { type: 'silly', kind };
  switch (kind) {
    case 'frogs': s.mods.food = { mul: 0.5, until: s.tick + 30 * SEC }; break;
    case 'happy': s.mods.speed = { mul: 1.4, until: s.tick + 40 * SEC }; break;
    case 'boom': s.mods.gather = { mul: 2, until: s.tick + 25 * SEC }; break;
    case 'tax': {
      let rich = alive[0], best = -1;
      for (const i of alive) {
        const r = s.players[i].res, v = r.food + r.wood + r.metal + r.oil;
        if (v > best) { best = v; rich = i; }
      }
      const others = alive.filter((i) => i !== rich);
      let total = 0;
      for (const k of ['food', 'wood', 'metal', 'oil']) {
        const cut = Math.floor(s.players[rich].res[k] * 0.15);
        s.players[rich].res[k] -= cut;
        total += cut;
        for (const o of others) s.players[o].res[k] += Math.floor(cut / others.length);
      }
      e.p = rich; e.amt = total;
      break;
    }
    case 'stampede': {
      const c = randomSpot(w, w.W / 2, w.H / 2, 0, w.W * 0.35);
      if (c) { for (let i = 0; i < 8; i++) { const p = randomSpot(w, c[0], c[1], 0, 3); if (p) addCritter(w, p[0], p[1]); } e.x = c[0]; e.y = c[1]; }
      break;
    }
    case 'drop': {
      const c = randomSpot(w, w.W / 2, w.H / 2, 0, 8);
      if (c) { addCrate(w, c[0], c[1]); e.x = c[0]; e.y = c[1]; }
      break;
    }
    case 'meteor': {
      // Aim somewhere that has stuff in it: near a random building.
      const blds = s.blds.filter((b) => b.done);
      const b = blds.length ? blds[Math.floor(w.rand() * blds.length)] : null;
      const x = b ? b.x + b.size / 2 + (w.rand() * 2 - 1) * 4 : w.W / 2, y = b ? b.y + b.size / 2 + (w.rand() * 2 - 1) * 4 : w.H / 2;
      s.meteors.push({ x, y, t: 0, dur: 8, r: 3.5 });
      e.x = x; e.y = y;
      break;
    }
  }
  w.event(e);
}

function meteorImpact(w, m) {
  const s = w.s;
  w.event({ type: 'meteorHit', x: m.x, y: m.y });
  for (const u of s.units) {
    const dx = u.x - m.x, dy = u.y - m.y;
    if (dx * dx + dy * dy <= m.r * m.r) u.hp -= w.uMax(u) * 0.75;
  }
  for (const c of s.critters) {
    const dx = c.x - m.x, dy = c.y - m.y;
    if (dx * dx + dy * dy <= m.r * m.r) c.hp = 0;
  }
  for (const b of s.blds) {
    if (w.edgeDist(m.x, m.y, b) <= m.r) {
      const max = w.maxHp(b);
      b.hp = b.type === 'city' ? Math.max(1, b.hp - max * 0.3) : b.hp - max * 0.5;
    }
  }
}
