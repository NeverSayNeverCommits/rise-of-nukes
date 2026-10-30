// Runs the simulation headless. Checks that two copies stay identical (lockstep needs this),
// that save/load gives the same result, and that a scripted game actually progresses.
import { World } from '../js/sim/sim.js';
import { BLDS } from '../js/sim/data.js';
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
    const types = ['farm', 'lumber', 'mine', 'barracks', 'stable', 'library', 'workshop', 'tower', 'oilwell', 'city'];
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
      if (b.type === 'barracks') cmds.push({ p, c: 'train', b: b.id, type: step % 2 ? 'infantry' : 'ranged' });
      if (b.type === 'stable') cmds.push({ p, c: 'train', b: b.id, type: 'cavalry' });
      if (b.type === 'workshop') cmds.push({ p, c: 'train', b: b.id, type: 'siege' });
      if (b.type === 'library') for (const t of ['agri1', 'wood1', 'civics', 'weap1', 'armor1', 'manhattan']) cmds.push({ p, c: 'research', b: b.id, tech: t });
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
assert.ok(Math.max(...ages) >= 2, 'someone aged up');

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

console.log('ALL TESTS PASSED');
