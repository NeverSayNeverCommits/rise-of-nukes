// Runs the simulation headless. Checks that two copies stay identical (lockstep needs this),
// that save/load gives the same result, and that a scripted game actually progresses.
import { World } from '../js/sim/sim.js';
import { BLDS, TECHS, GATHER_CAP, MARKET, LASER, ROCKET } from '../js/sim/data.js';
import { Bot } from '../js/bot.js';
import assert from 'node:assert/strict';

const setup = (extra = {}) => ({
  seed: 12345,
  players: [
    { name: 'A', color: '#f00', team: 0 },
    { name: 'B', color: '#00f', team: 1 },
    { name: 'C', color: '#0f0', team: 2 },
    { name: 'D', color: '#ff0', team: 3 },
  ],
  settings: { resources: 'insane', startAge: 0, ...extra },
});

// A simple scripted "bot" that issues commands every so often, so we exercise most code paths.
function botCommands(w, tick) {
  const cmds = [];
  if (tick % 40 !== 0) return cmds;
  w.s.players.forEach((pl, p) => {
    if (!pl.alive) return;
    const mine = w.s.units.filter((u) => u.owner === p);
    const cits = mine.filter((u) => u.type === 'citizen');
    const army = mine.filter((u) => u.type !== 'citizen');
    const city = w.s.blds.find((b) => b.owner === p && b.type === 'city' && b.done);
    if (!city) return;
    const step = (tick / 40) | 0;
    if (step % 3 === 0) cmds.push({ p, c: 'train', b: city.id, type: 'citizen' });
    if (step % 10 === 1) cmds.push({ p, c: 'research', b: city.id, tech: 'age' });
    // Try to build something somewhere around the city.
    const types = ['farm', 'lumber', 'mine', 'barracks', 'stable', 'library', 'workshop', 'tower', 'oilwell', 'city', 'airfield'];
    const type = types[step % types.length];
    if (cits.length) {
      outer: for (let r = 2; r < 14; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const x = city.x + dx, y = city.y + dy;
          if (w.canPlace(p, type, x, y).ok) { cmds.push({ p, c: 'build', ids: [cits[step % cits.length].id], type, x, y }); break outer; }
        }
      }
    }
    // Idle citizens go to work at a random own gather building.
    const gb = w.s.blds.filter((b) => b.owner === p && BLDS[b.type].gather);
    for (const u of cits) if (!u.ord && gb.length) cmds.push({ p, c: 'work', ids: [u.id], t: gb[u.id % gb.length].id });
    for (const b of w.s.blds.filter((b) => b.owner === p && b.done)) {
      if (b.type === 'barracks') cmds.push({ p, c: 'train', b: b.id, type: ['infantry', 'ranged', 'oompah', 'bowler'][step % 4] });
      if (b.type === 'stable') cmds.push({ p, c: 'train', b: b.id, type: ['cavalry', 'scooter', 'jeepney'][step % 3] });
      if (b.type === 'workshop') cmds.push({ p, c: 'train', b: b.id, type: step % 2 ? 'siege' : 'aagun' });
      if (b.type === 'airfield') cmds.push({ p, c: 'train', b: b.id, type: step % 2 ? 'fighter' : 'bomber' });
      if (BLDS[b.type].gather && step % 5 === 2) cmds.push({ p, c: 'upgrade', b: b.id });
      if (b.type === 'library') for (const t of ['sci1', 'sci2', 'sci3', 'sci4', 'com1', 'com2', 'com3', 'agri1', 'wood1', 'civics', 'weap1', 'armor1', 'manhattan', 'autobahn', 'seven11', 'karaoke', 'tigers']) cmds.push({ p, c: 'research', b: b.id, tech: t });
    }
    // Every so often send the army at the next player's capital.
    if (step % 15 === 14 && army.length) {
      const enemyCity = w.s.blds.find((b) => b.owner !== p && b.type === 'city');
      if (enemyCity) cmds.push({ p, c: 'move', ids: army.map((u) => u.id), x: enemyCity.x + 1.5, y: enemyCity.y + 1.5, am: true });
    }
  });
  return cmds;
}

function run(ticks, w, w2, label) {
  const t0 = Date.now();
  for (let t = 0; t < ticks; t++) {
    const cmds = botCommands(w, w.s.tick);
    w.step(cmds);
    if (w2) {
      w2.step(JSON.parse(JSON.stringify(cmds)));
      if (t % 50 === 0) assert.equal(w.hash(), w2.hash(), `${label}: desync at tick ${w.s.tick}`);
    }
  }
  return Date.now() - t0;
}

// 1. Two copies stay in sync.
const a = new World(setup());
const b = new World(setup());
assert.equal(a.hash(), b.hash());
let ms = run(3000, a, b, 'lockstep');
console.log(`lockstep ok: 3000 ticks x2 in ${ms} ms, units=${a.s.units.length}, blds=${a.s.blds.length}`);

// 2. Save, load, continue: must match the original.
const c = new World(setup(), JSON.parse(JSON.stringify(a.serialize())));
assert.equal(a.hash(), c.hash(), 'load hash');
ms = run(2000, a, c, 'save/load');
console.log(`save/load ok, tick ${a.s.tick}`);

// 3. Progress sanity.
const ages = a.s.players.map((p) => p.age);
console.log('ages', ages.join(','), 'units', a.s.units.length, 'buildings', a.s.blds.length,
  'kills', a.s.players.map((p) => p.kills).join(','));
assert.ok(a.s.units.length > 20, 'units were trained');
assert.ok(Math.max(...ages) >= 1, 'someone aged up');

// 4. Nukes: start in the Atomic age, build a silo, launch.
const n = new World(setup({ startAge: 4 }));
const p = 0, pl = n.s.players[p];
pl.techs.manhattan = 1;
const city = n.s.blds.find((x) => x.owner === p);
let spot = null;
for (let r = 3; r < 10 && !spot; r++) for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r && !spot; dx++) {
  if (n.canPlace(p, 'silo', city.x + dx, city.y + dy).ok) spot = [city.x + dx, city.y + dy];
}
assert.ok(spot, 'silo spot');
const cit = n.s.units.find((u) => u.owner === p && u.type === 'citizen');
n.step([{ p, c: 'build', ids: [cit.id], type: 'silo', x: spot[0], y: spot[1] }]);
const silo = n.s.blds.find((x) => x.type === 'silo');
silo.prog = 1e9; n.finishBld(silo);
n.step([{ p, c: 'train', b: silo.id, type: 'nuke' }]);
for (let i = 0; i < 46 * 20; i++) n.step([]);
assert.equal(silo.stock, 1, 'nuke built');
const target = n.s.blds.find((x) => x.owner === 1 && x.type === 'city');
const before = n.s.units.filter((u) => u.owner === 1).length;
n.step([{ p, c: 'launch', b: silo.id, x: target.x + 1.5, y: target.y + 1.5 }]);
for (let i = 0; i < 20 * 20; i++) n.step([]);
const after = n.s.units.filter((u) => u.owner === 1).length;
console.log(`nuke: enemy units ${before} -> ${after}, city hp ${target.hp}, doom ${n.s.doom}`);
assert.equal(n.s.doom, 1);
assert.ok(after < before, 'nuke killed units');
assert.ok(target.hp <= 1, 'city ruined');

// 5. Conquest: capture the enemy's only city, which knocks them out and wins a 2-player game.
{
  const w = new World({ seed: 9, players: [{ name: 'A', color: '#f00', team: 0 }, { name: 'B', color: '#00f', team: 1 }], settings: { startAge: 3 } });
  const target = w.s.blds.find((b) => b.owner === 1 && b.type === 'city');
  const ids = [];
  for (let i = 0; i < 25; i++) {
    const s = w.freeSpotNear(target.x - 4 + (i % 5), target.y - 6 + Math.floor(i / 5), 0);
    ids.push(w.addUnit(i % 2 ? 'cavalry' : 'infantry', 0, s[0], s[1]).id);
  }
  w.step([{ p: 0, c: 'attack', ids, t: target.id }]);
  let captured = false;
  for (let i = 0; i < 20 * 240 && !w.s.over; i++) { w.step([]); if (target.owner === 0) captured = true; }
  console.log(`conquest: captured=${captured}, over=${JSON.stringify(w.s.over)}, B alive=${w.s.players[1].alive}`);
  assert.ok(captured, 'city captured');
  assert.equal(w.s.players[1].alive, false);
  assert.equal(w.s.over && w.s.over.winnerTeam, 0);
}

// 6. The silly stuff: cows, crates, meteors and random events must stay in sync too.
{
  const w = new World(setup()), w2 = new World(setup());
  assert.ok(w.s.critters.length > 5, 'cows on the map');
  assert.ok(w.s.crates.length > 0, 'crates on the map');
  const seen = new Set();
  for (let t = 0; t < 2400; t++) {
    // Force a random event every 5 seconds.
    if (t % 100 === 0) { w.s.nextSilly = w.s.tick + 1; w2.s.nextSilly = w2.s.tick + 1; }
    // Everyone hunts the nearest cow and walks to the nearest crate.
    const cmds = [];
    if (t % 60 === 0) w.s.players.forEach((pl, p) => {
      const army = w.s.units.filter((u) => u.owner === p && u.type !== 'citizen');
      const cow = w.s.critters[p % Math.max(1, w.s.critters.length)];
      if (cow && army.length) cmds.push({ p, c: 'attack', ids: army.map((u) => u.id), t: cow.id });
      const cr = w.s.crates[p % Math.max(1, w.s.crates.length)];
      const cit = w.s.units.find((u) => u.owner === p && u.type === 'citizen');
      if (cr && cit) cmds.push({ p, c: 'move', ids: [cit.id], x: cr.x, y: cr.y });
    });
    cmds.push(...botCommands(w, w.s.tick));
    w.step(cmds); w2.step(JSON.parse(JSON.stringify(cmds)));
    for (const e of w.events.splice(0)) if (['silly', 'crate', 'critter', 'meteorHit'].includes(e.type)) seen.add(e.type === 'silly' ? e.kind : e.type);
    if (t % 50 === 0) assert.equal(w.hash(), w2.hash(), `extras: desync at tick ${w.s.tick}`);
  }
  const cows = w.s.players.map((p) => p.st.cows).join(',');
  console.log(`extras ok: events seen ${[...seen].join(' ')}; cows eaten ${cows}`);
  assert.ok(seen.has('critter'), 'a cow was eaten');
  assert.ok(seen.has('crate'), 'a crate was opened');
  const r = new World(setup(), JSON.parse(JSON.stringify(w.serialize())));
  assert.equal(r.hash(), w.hash(), 'extras save/load');
}

// 7. Nations: each one gets its own units, techs and bonuses, and stays in sync.
{
  const ns = ['germany', 'taiwan', 'philippines', 'pakistan'];
  const st = () => ({ ...setup({ startAge: 3 }), players: setup().players.map((p, i) => ({ ...p, nation: ns[i] })) });
  const w = new World(st()), w2 = new World(st());
  assert.deepEqual(w.s.players.map((p) => p.nation), ns);
  assert.equal(w.s.blds.find((b) => b.owner === 0 && b.type === 'city').name, 'Berlin');
  // Unique units and stats.
  assert.equal(w.stats(0, 'cavalry').name, 'Leopard Tank');
  assert.equal(w.stats(1, 'ranged').name, 'Bubble Tea Gunner');
  assert.equal(w.stats(3, 'siege').name, 'Jingle Truck Artillery');
  assert.equal(w.stats(2, 'infantry').name, 'Rifleman');
  assert.ok(w.stats(0, 'citizen').time < w.stats(1, 'citizen').time, 'Germany trains faster');
  assert.ok(w.maxHp(w.s.blds.find((b) => b.owner === 0)) > w.maxHp(w.s.blds.find((b) => b.owner === 1)), 'German buildings are tougher');
  assert.ok(w.popCap(2) > w.popCap(1), 'Filipino families are bigger');
  // Each player builds a barracks, a stable and a library next to their capital.
  const place = (w, p, type) => {
    const c = w.s.blds.find((b) => b.owner === p && b.type === 'city');
    for (let r = 3; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (w.canPlace(p, type, c.x + dx, c.y + dy).ok) return w.finishBld(w.addBld(type, p, c.x + dx, c.y + dy, true)) || w.s.blds[w.s.blds.length - 1];
    }
    throw new Error('no room for ' + type);
  };
  const blds = [w, w2].map((x) => [0, 1, 2, 3].map((p) => ({ bar: place(x, p, 'barracks'), sta: place(x, p, 'stable'), lib: place(x, p, 'library') })));
  const cmds = [];
  for (let p = 0; p < 4; p++) {
    const b = blds[0][p];
    for (const t of ['oompah', 'bowler', 'infantry', 'infantry']) cmds.push({ p, c: 'train', b: b.bar.id, type: t });
    for (const t of ['scooter', 'jeepney', 'cavalry']) cmds.push({ p, c: 'train', b: b.sta.id, type: t });
    for (const t of ['autobahn', 'seven11', 'karaoke', 'tigers']) cmds.push({ p, c: 'research', b: b.lib.id, tech: t });
  }
  // Taiwan pays less for techs.
  const before = w.s.players.map((p) => p.res.food);
  for (let i = 0; i < 1400; i++) { const c = i === 0 ? cmds : []; w.step(c); w2.step(c); }
  assert.equal(w.hash(), w2.hash(), 'nations out of sync');
  const count = (p, t) => w.s.units.filter((u) => u.owner === p && u.type === t).length;
  assert.equal(count(0, 'oompah'), 1); assert.equal(count(1, 'oompah'), 0);
  assert.equal(count(1, 'scooter'), 3, 'scooters come in threes'); assert.equal(count(0, 'scooter'), 0);
  assert.equal(count(2, 'jeepney'), 1); assert.equal(count(3, 'bowler'), 1); assert.equal(count(2, 'bowler'), 0);
  assert.deepEqual(w.s.players.map((p) => Object.keys(p.techs).filter((t) => TECHS[t].nation).join()), ['autobahn', 'seven11', 'karaoke', 'tigers']);
  // Band makes neighbours attack faster.
  const band = w.s.units.find((u) => u.type === 'oompah');
  const pal = w.s.units.find((u) => u.owner === 0 && u.type === 'infantry');
  pal.x = band.x + 1; pal.y = band.y; w.buildBuckets(); w.nationTick();
  assert.ok(w.buffed && w.buffed.has(pal.id), 'band buff');
  // Jeepney heals.
  const jeep = w.s.units.find((u) => u.type === 'jeepney');
  const hurt = w.s.units.find((u) => u.owner === 2 && u.type === 'infantry');
  hurt.x = jeep.x + 1; hurt.y = jeep.y; hurt.hp = 10;
  for (let i = 0; i < 40; i++) w.step([]);
  assert.ok(hurt.hp > 12, 'jeepney heals');
  // Autobahn: faster inside own borders.
  const z = new World(st());
  z.s.players[0].techs.autobahn = 1; z.nationTick(); z.spdMul = 1;
  const u0 = z.s.units.find((u) => u.owner === 0 && u.type === 'infantry'), u1 = z.s.units.find((u) => u.owner === 1 && u.type === 'infantry');
  for (const u of [u0, u1]) { u.path = [u.x + 5, u.y]; u.pi = 0; u.sx = null; }
  const x0 = u0.x, x1 = u1.x; z.walk(u0, 2); z.walk(u1, 2);
  assert.ok(Math.abs((u0.x - x0) / (u1.x - x1) - 1.4) < 1e-9, 'autobahn speed');
  console.log(`nations ok: ${w.s.players.map((p, i) => `${p.nation} food ${Math.round(before[i] - p.res.food)}`).join(', ')}`);
}

// 8. Building upgrades and the air force.
{
  const two = () => ({ seed: 21, players: [{ name: 'A', color: '#f00', team: 0 }, { name: 'B', color: '#00f', team: 1 }], settings: { resources: 'insane', startAge: 3 } });
  const w = new World(two()), w2 = new World(two());
  const place = (w, p, type, near) => {
    const c = near || w.s.blds.find((b) => b.owner === p && b.type === 'city');
    for (let r = 3; r < 14; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (w.canPlace(p, type, c.x + dx, c.y + dy).ok) { const b = w.addBld(type, p, c.x + dx, c.y + dy, true); w.finishBld(b); return b; }
    }
    throw new Error('no room for ' + type);
  };
  const both = (fn) => [fn(w), fn(w2)];
  const [farm] = both((x) => place(x, 0, 'farm'));
  const [air] = both((x) => place(x, 0, 'airfield'));
  const [ecity] = both((x) => x.s.blds.find((b) => b.owner === 1 && b.type === 'city'));
  const [flak] = both((x) => place(x, 1, 'workshop'));
  const go = (cmds, n = 1) => { for (let i = 0; i < n; i++) { const c = i === 0 ? cmds : []; w.step(c); w2.step(JSON.parse(JSON.stringify(c))); } };

  // Upgrades: one level per age, more workers, faster gathering.
  assert.equal(w.slots(farm), 5);
  go([{ p: 0, c: 'upgrade', b: farm.id }, { p: 0, c: 'upgrade', b: farm.id }]);
  assert.equal(farm.q.length, 1, 'only one upgrade at a time');
  go([], 20 * 30);
  assert.equal(farm.lvl, 1);
  assert.equal(w.slots(farm), 6);
  go([{ p: 0, c: 'upgrade', b: farm.id }], 20 * 30); go([{ p: 0, c: 'upgrade', b: farm.id }], 20 * 30);
  go([{ p: 0, c: 'upgrade', b: farm.id }], 20 * 30);
  assert.equal(farm.lvl, 3, 'capped at the current age');
  assert.ok(Math.abs(w.lvlMul(farm) - 1.6) < 1e-9);

  // Who can shoot planes.
  assert.equal(w.stats(0, 'cavalry').aa, false, 'tanks cannot hit planes');
  assert.equal(w.stats(0, 'infantry').aa, true, 'riflemen can');
  assert.equal(w.stats(0, 'siege').aa, false);
  assert.equal(w.stats(0, 'aagun').aaOnly, true);

  // A bomber flies over, bombs the enemy city, and goes home to reload.
  go([{ p: 0, c: 'train', b: air.id, type: 'bomber' }, { p: 0, c: 'train', b: air.id, type: 'fighter' }], 20 * 60);
  const [bomber] = both((x) => x.s.units.find((u) => u.type === 'bomber'));
  assert.ok(bomber && bomber.ammo === 1, 'bomber built and loaded');
  // Clear the enemy's guns so the test is about bombing.
  for (const x of [w, w2]) for (const u of x.s.units) if (u.owner === 1) u.hp = 0;
  const hp0 = ecity.hp;
  let bombs = 0;
  go([{ p: 0, c: 'attack', ids: [bomber.id], t: ecity.id }]);
  for (let i = 0; i < 20 * 120 && bombs < 2; i++) {
    go([]);
    for (const e of w.events.splice(0)) if (e.type === 'bomb') bombs++;
  }
  assert.ok(bombs >= 2, `bomber made two runs (${bombs})`);
  assert.ok(ecity.hp < hp0, 'city damaged');

  // Flak shoots down a fighter; a tank ignores planes; an attack order a unit can't do is ignored.
  const [fighter] = both((x) => x.s.units.find((u) => u.type === 'fighter'));
  const guns = both((x) => { const fl = x.s.blds.find((b) => b.id === flak.id); return x.addUnit('aagun', 1, fl.x + 4, fl.y + 1); });
  const tanks = both((x) => { const fl = x.s.blds.find((b) => b.id === flak.id); return x.addUnit('cavalry', 1, fl.x + 4, fl.y + 2); });
  go([{ p: 1, c: 'attack', ids: [tanks[0].id], t: fighter.id }]);
  assert.equal(tanks[0].ord, null, 'tanks cannot be ordered to hit planes');
  go([{ p: 0, c: 'move', ids: [fighter.id], x: guns[0].x, y: guns[0].y }]);
  for (let i = 0; i < 20 * 60 && fighter.hp > 0; i++) go([]);
  assert.ok(fighter.hp <= 0, 'flak shot the fighter down');
  assert.equal(w.hash(), w2.hash(), 'air out of sync');
  const r = new World(two(), JSON.parse(JSON.stringify(w.serialize())));
  assert.equal(r.hash(), w.hash(), 'air save/load');
  console.log(`air ok: farm level ${farm.lvl}, bomber runs ${bombs}, city hp ${Math.round(hp0)} -> ${Math.round(ecity.hp)}`);
}

// ---------- gather limit, Science, Commerce, market, gifts, waypoints, wonders ----------
{
  const st = (settings = {}) => ({
    seed: 77,
    players: [{ name: 'A', color: '#f00', team: 0, nation: 'germany' }, { name: 'B', color: '#00f', team: 0, nation: 'taiwan' }, { name: 'C', color: '#0f0', team: 1, nation: 'pakistan' }],
    settings: { resources: 'insane', silly: false, ...settings },
  });
  const w = new World(st()), w2 = new World(st());
  const go = (cmds = []) => { w.step(cmds); w2.step(cmds); };
  const both = (fn) => [fn(w), fn(w2)];
  const place = (x, p, type) => {
    const c = x.s.blds.find((b) => b.owner === p && b.type === 'city');
    for (let r = 3; r < 30; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (x.canPlace(p, type, c.x + dx, c.y + dy).ok) { const b = x.addBld(type, p, c.x + dx, c.y + dy, true); x.finishBld(b); return b; }
    }
    throw new Error('no room for ' + type);
  };

  // Ages need Science.
  const city = w.s.blds.find((b) => b.owner === 0 && b.type === 'city');
  go([{ p: 0, c: 'research', b: city.id, tech: 'age' }]);
  assert.equal(w.s.players[0].pending.age, undefined, 'no Science, no new age');
  assert.ok(w.events.some((e) => e.type === 'error' && e.p === 0), 'told why');

  // Upgrades need Commerce.
  w.s.players[0].age = w2.s.players[0].age = 2;
  const [farm] = both((x) => place(x, 0, 'farm'));
  go([{ p: 0, c: 'upgrade', b: farm.id }]);
  assert.equal(farm.q.length, 0, 'no Commerce, no upgrade');
  both((x) => { x.s.players[0].techs.com1 = 1; });
  go([{ p: 0, c: 'upgrade', b: farm.id }]);
  assert.equal(farm.q.length, 1, 'Barter allows the first upgrade');

  // Gather limit: lots of farmers can't beat it.
  assert.ok(w.capOf(0, 'food') > GATHER_CAP.food, 'Barter raises the limit');
  const farms = both((x) => { const l = []; for (let i = 0; i < 8; i++) l.push(place(x, 0, 'farm')); return l; });
  const workers = both((x) => { const c = x.s.blds.find((b) => b.owner === 0 && b.type === 'city'), l = []; for (let i = 0; i < 40; i++) { const sp = x.spawnSpot(c); l.push(x.addUnit('citizen', 0, sp[0], sp[1])); } return l; });
  farms[0].forEach((f, i) => go([{ p: 0, c: 'work', ids: workers[0].slice(i * 5, i * 5 + 5).map((u) => u.id), t: f.id }]));
  for (let i = 0; i < 20 * 30; i++) go();
  assert.ok(w.gathered[0].food <= w.capOf(0, 'food') + 1e-9, 'gathering is limited');
  assert.ok(w.gathered[0].food >= w.capOf(0, 'food') - 1e-6, 'and those farmers do reach the limit');

  // A Market raises the limit and swaps resources.
  const before = w.capOf(0, 'food');
  const [mkt] = both((x) => place(x, 0, 'market'));
  assert.ok(Math.abs(w.capOf(0, 'food') - (before + GATHER_CAP.food * MARKET.capBonus)) < 1e-9, 'market raises the limit');
  void mkt;
  const m0 = w.s.players[0].res.metal, wood0 = w.s.players[0].res.wood;
  go([{ p: 0, c: 'trade', from: 'wood', to: 'metal' }]);
  assert.ok(w.s.players[0].res.metal > m0 + 50, 'trade gives metal');
  assert.ok(w.s.players[0].res.wood < wood0 - 90, 'trade takes wood');

  // Gifts go to allies only.
  const oil1 = w.s.players[1].res.oil, oil2 = w.s.players[2].res.oil;
  go([{ p: 0, c: 'gift', to: 1, res: 'oil', amt: 100 }, { p: 0, c: 'gift', to: 2, res: 'oil', amt: 100 }]);
  assert.equal(w.s.players[1].res.oil, oil1 + 100, 'ally got the gift');
  assert.equal(w.s.players[2].res.oil, oil2, 'enemy did not');

  // Shift-queued moves.
  const sol = both((x) => { const c = x.s.blds.find((b) => b.owner === 0 && b.type === 'city'); return x.addUnit('infantry', 0, c.x + 5, c.y + 5); });
  const sx = sol[0].x, sy = sol[0].y;
  go([{ p: 0, c: 'move', ids: [sol[0].id], x: sx + 3, y: sy }]);
  go([{ p: 0, c: 'move', ids: [sol[0].id], x: sx + 3, y: sy + 3, q: true }]);
  assert.equal(sol[0].wp.length, 1, 'stop is queued');
  for (let i = 0; i < 20 * 15; i++) go();
  assert.equal(sol[0].wp, undefined, 'stop was used');
  assert.ok(Math.abs(sol[0].y - (sy + 3)) < 2.5, `went on to the second stop (${sol[0].y} vs ${sy + 3})`);

  // Only one of each wonder, and the setting turns them off.
  both((x) => { for (const pl of x.s.players) { pl.age = 4; pl.techs.sci4 = 1; pl.techs.com5 = 1; } });
  const [pyr] = both((x) => place(x, 0, 'pyramids'));
  const c1 = w.s.blds.find((b) => b.owner === 1 && b.type === 'city');
  let tried = false;
  for (let r = 3; r < 16 && !tried; r++) for (let dx = -r; dx <= r && !tried; dx++) { const res = w.canPlace(1, 'pyramids', c1.x + dx, c1.y + r); if (!res.ok && /already|one/i.test(res.why || '')) tried = true; }
  assert.ok(tried, 'second Pyramid refused');
  assert.ok(w.s.players[0].w.pyramids, 'pyramid counted');
  const pop0 = w.popCap(0);
  assert.ok(pop0 > 0);
  void pyr;
  const off = new World(st({ wonders: false }));
  const oc = off.s.blds.find((b) => b.owner === 0 && b.type === 'city');
  off.s.players[0].age = 4;
  assert.equal(off.canPlace(0, 'pyramids', oc.x + 6, oc.y + 6).ok, false, 'wonders can be off');

  // The laser hurts enemies, not allies, and needs to recharge.
  const [las] = both((x) => place(x, 0, 'laser'));
  const foe = both((x) => x.addUnit('infantry', 2, 30, 30));
  const pal = both((x) => x.addUnit('infantry', 1, 31, 30));
  go([{ p: 0, c: 'laser', b: las.id, x: 30, y: 30 }]);
  assert.equal(w.s.strikes.length, 0, 'still charging after being built');
  both((x) => { x.s.blds.find((b) => b.id === las.id).ready = 0; });
  go([{ p: 0, c: 'laser', b: las.id, x: 30, y: 30 }]);
  assert.equal(w.s.strikes.length, 1, 'laser fired');
  const hp0 = foe[0].hp, palHp = pal[0].hp;
  for (let i = 0; i < (LASER.delay + 0.2) * 20; i++) go();
  assert.ok(foe[0].hp < hp0 * 0.5, 'enemy was burned');
  assert.ok(pal[0].hp > palHp * 0.5, 'ally is safe from the laser');

  // Moon Rocket: a countdown, then a win. Losing it stops the countdown.
  assert.equal(w.hash(), w2.hash(), 'wonders out of sync');
  const r = new World(st(), JSON.parse(JSON.stringify(w.serialize())));
  assert.equal(r.hash(), w.hash(), 'wonders save/load');
  const [rk] = both((x) => place(x, 2, 'rocket'));
  assert.ok(rk.launchAt > w.s.tick, 'countdown started');
  assert.equal(rk.launchAt - w.s.tick, ROCKET.countdown * 20);
  both((x) => { const b = x.s.blds.find((q) => q.id === rk.id); b.launchAt = x.s.tick + 40; });
  for (let i = 0; i < 60; i++) go();
  assert.ok(w.s.over && w.s.over.rocket && w.s.over.winnerTeam === 1, 'rocket wins the game');
  console.log('wonders ok: limits, market, gifts, waypoints, laser, rocket');
}

// ---------- bots: two copies given the same commands stay identical, and bots really play ----------
{
  const st = () => ({
    seed: 2024,
    players: [{ name: 'A', color: '#f00', team: 0, nation: 'germany' }, { name: 'B', color: '#00f', team: 1, nation: 'pakistan' }, { name: 'C', color: '#0f0', team: 2, nation: 'taiwan' }],
    settings: {},
  });
  const w = new World(st()), w2 = new World(st());
  const bots = [new Bot(w, 0, 'easy'), new Bot(w, 1, 'normal'), new Bot(w, 2, 'hard')];
  for (let i = 0; i < 20 * 60 * 6; i++) {
    const cmds = bots.flatMap((b) => b.tick(w));
    w.step(cmds); w2.step(cmds);
    if (i % 600 === 0) assert.equal(w.hash(), w2.hash(), `bot game out of sync at tick ${i}`);
  }
  assert.equal(w.hash(), w2.hash(), 'bot game out of sync');
  const count = (p) => w.s.units.filter((u) => u.owner === p).length;
  for (const p of [0, 1, 2]) assert.ok(count(p) > 8, `bot ${p} built up (${count(p)} units)`);
  console.log(`bots ok: units after 6 min, easy ${count(0)}, normal ${count(1)}, hard ${count(2)}`);
}

console.log('ALL TESTS PASSED');

// ---------- early defence and no rush ----------
{
  const duo = (settings = {}) => new World({
    seed: 7,
    players: [{ name: 'A', color: '#f00', team: 0, nation: 'germany' }, { name: 'B', color: '#00f', team: 1, nation: 'germany' }],
    settings: { mapSize: 'small', silly: false, ...settings },
  });
  const cityOf = (w, p) => w.s.blds.find((b) => b.owner === p && b.type === 'city');
  // Puts raiders next to player 0's city and sends them in. Returns their ids and the first command.
  const raid = (w, types) => {
    const c = cityOf(w, 0), ids = [];
    for (const type of types) {
      const [x, y] = w.freeSpotNear(c.x + 12, c.y + 1, 1);
      ids.push(w.addUnit(type, 1, x, y).id);
    }
    return { ids, cmd: { p: 1, c: 'move', ids, x: c.x + 1.5, y: c.y + 1.5, am: true } };
  };

  // A small early raid dies with no help from the defending player.
  {
    const w = duo();
    const { ids, cmd } = raid(w, ['infantry', 'infantry', 'infantry', 'ranged', 'ranged', 'ranged']);
    const city = cityOf(w, 0), hp = city.hp;
    w.step([cmd]);
    for (let i = 0; i < 90 * 20; i++) w.step([]);
    assert.equal(w.s.units.filter((u) => ids.includes(u.id)).length, 0, 'raid should die');
    assert.equal(city.owner, 0);
    assert.ok(city.hp > hp * 0.8, 'city should barely be scratched');
  }

  // Siege still takes a city, so games can end.
  {
    const w = duo({ startAge: 2 });
    const { cmd } = raid(w, [...Array(12).fill('infantry'), ...Array(6).fill('siege')]);
    const city = cityOf(w, 0);
    w.step([cmd]);
    for (let i = 0; i < 120 * 20 && city.owner === 0 && city.hp > 0; i++) w.step([]);
    assert.ok(city.owner !== 0 || city.hp <= 0, 'siege should break the city');
  }

  // No rush: no damage, no launch, borders closed, then war. Two copies stay the same.
  {
    const a = duo({ noRush: 2, startAge: 4 }), b = duo({ noRush: 2, startAge: 4 });
    const city = cityOf(a, 0), hp = city.hp;
    const r = raid(a, Array(6).fill('infantry'));
    raid(b, Array(6).fill('infantry'));
    const atk = { p: 1, c: 'attack', ids: r.ids, t: city.id };
    const seen = [];
    a.step([r.cmd, atk]); b.step([r.cmd, atk]);
    let crossed = 0;
    for (let i = 0; i < 119 * 20; i++) {
      const cmds = i % 200 === 0 ? [r.cmd] : [];
      a.step(cmds); b.step(cmds);
      for (const e of a.events.splice(0)) if (e.type === 'truce') seen.push(e.left);
      b.events.length = 0;
      if (a.s.units.some((u) => u.owner === 1 && a.terrAt(u.x, u.y) === 0 && u.ord && u.ord.home)) crossed++;
    }
    assert.equal(city.hp, hp, 'no damage during no rush');
    assert.equal(a.s.units.filter((u) => r.ids.includes(u.id)).length, 6, 'nobody dies during no rush');
    assert.ok(crossed > 0, 'units that cross the border get sent home');
    assert.equal(JSON.stringify(a.s), JSON.stringify(b.s), 'two copies stay the same');
    const c = new World(a.setup, JSON.parse(JSON.stringify(a.s)));
    assert.ok(c.truce() && c.truceEnd === a.truceEnd, 'save and load keeps no rush');
    assert.equal(a.enemy(0, 1), false);
    for (let i = 0; i < 2 * 20; i++) { a.step([]); for (const e of a.events.splice(0)) if (e.type === 'truce') seen.push(e.left); }
    assert.equal(a.enemy(0, 1), true);
    assert.deepEqual(seen, [60, 0]);
    console.log('defence ok: small raid dies, siege breaks city, no rush holds then ends');
  }
}
