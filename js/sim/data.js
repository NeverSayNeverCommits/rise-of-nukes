// Game rules and numbers. Everything balance-related lives here.
// Times are in seconds, distances in tiles, rates per second.
// Nation-specific units, techs and bonuses are in nations.js.
import { NATION_UNITS, NATION_TECHS, nbonus } from './nations.js';

export const RES = ['food', 'wood', 'metal', 'oil'];
export const RES_ICON = { food: '🌾', wood: '🪵', metal: '⛏️', oil: '🛢️' };

export const AGES = ['Ancient', 'Classical', 'Gunpowder', 'Industrial', 'Atomic'];

// Cost and time to reach the NEXT age (index = current age).
export const AGE_UP = [
  { cost: { food: 300, wood: 200 }, time: 30 },
  { cost: { food: 600, wood: 400, metal: 200 }, time: 40 },
  { cost: { food: 1000, wood: 600, metal: 600 }, time: 50 },
  { cost: { food: 1600, metal: 1200, oil: 600 }, time: 60 },
];

// Gather rate per working citizen.
export const GATHER_RATE = { food: 0.55, wood: 0.5, metal: 0.4, oil: 0.35 };
export const CITY_INCOME = { food: 0.5, wood: 0.3 };
export const BUILD_RATE = 1;      // build-seconds per citizen per second
export const POP_MAX = 200;
export const CITY_MIN_DIST = 12;  // between city centres
export const ATTRITION = 0.01;    // share of max hp lost per second in enemy land
export const FALLOUT_DMG = 0.04;  // share of max hp lost per second in fallout

// Damage multipliers: MULT[attackerClass][targetClass]
// cit = citizen, inf = infantry, rng = ranged, cav = cavalry/armour, sie = siege, bld = building,
// air = planes, aa = anti-air guns, bomb = bombs dropped by bombers.
// A 0 in the air column means that class can't shoot at planes at all.
export const MULT = {
  cit: { cit: 1, inf: 1, rng: 1, cav: 1, sie: 1, bld: 0.3, air: 0, aa: 1 },
  inf: { cit: 1.5, inf: 1, rng: 1, cav: 2, sie: 1.5, bld: 0.6, air: 0.35, aa: 1.5 },
  rng: { cit: 1.5, inf: 1.5, rng: 1, cav: 0.7, sie: 1, bld: 0.25, air: 0.9, aa: 1.5 },
  cav: { cit: 2, inf: 0.8, rng: 1.75, cav: 1, sie: 2, bld: 0.4, air: 0, aa: 2 },
  sie: { cit: 0.8, inf: 0.8, rng: 0.8, cav: 0.5, sie: 1, bld: 4, air: 0, aa: 1.5 },
  bld: { cit: 1, inf: 1, rng: 1, cav: 0.8, sie: 1.2, bld: 0, air: 1.2, aa: 1 },
  air: { cit: 1.2, inf: 0.8, rng: 0.8, cav: 0.5, sie: 1, bld: 0.3, air: 2, aa: 0.8 },
  aa: { cit: 0.3, inf: 0.3, rng: 0.3, cav: 0.2, sie: 0.3, bld: 0.1, air: 2.5, aa: 0.3 },
  bomb: { cit: 1.2, inf: 1, rng: 1, cav: 0.8, sie: 1.2, bld: 3, air: 0, aa: 1 },
};

// Unit "lines". A line upgrades automatically when its owner reaches a new age.
// Arrays are indexed by age.
export const UNITS = {
  citizen: {
    cls: 'cit', from: 'city', key: 'C', age: 0, icon: '👷',
    names: ['Citizen', 'Citizen', 'Citizen', 'Citizen', 'Citizen'],
    hp: [40, 45, 50, 55, 60], atk: [3, 3, 4, 4, 5], range: [0.4, 0.4, 0.4, 0.4, 0.4],
    cd: [1.5, 1.5, 1.5, 1.5, 1.5], speed: [2.3, 2.3, 2.4, 2.5, 2.6], sight: 6, radius: 0.28,
    cost: [{ food: 50 }, { food: 50 }, { food: 50 }, { food: 55 }, { food: 60 }],
    time: [10, 10, 9, 9, 8],
    desc: 'Gathers resources and builds. Right-click a farm, camp, mine or well to work there.',
  },
  infantry: {
    cls: 'inf', from: 'barracks', key: 'I', age: 0, icon: '🗡️',
    names: ['Spearman', 'Pikeman', 'Musketeer', 'Rifleman', 'Assault Infantry'],
    hp: [75, 95, 105, 125, 155], atk: [7, 9, 12, 15, 20], range: [0.5, 0.5, 4, 5, 5],
    cd: [1.2, 1.2, 1.6, 1.4, 1.0], speed: [2.1, 2.1, 2.1, 2.2, 2.4], sight: 7, radius: 0.3,
    cost: [{ food: 50, wood: 20 }, { food: 55, wood: 25, metal: 10 }, { food: 60, metal: 30 },
           { food: 70, metal: 40 }, { food: 80, metal: 50, oil: 10 }],
    time: [12, 12, 13, 13, 14],
    desc: 'Cheap all-rounder. Strong against cavalry and tanks.',
  },
  ranged: {
    cls: 'rng', from: 'barracks', key: 'R', age: 0, icon: '🏹',
    names: ['Archer', 'Crossbowman', 'Sharpshooter', 'Machine Gunner', 'Heavy MG Team'],
    hp: [45, 55, 70, 85, 100], atk: [6, 8, 11, 14, 18], range: [5, 5, 5.5, 5.5, 6],
    cd: [1.5, 1.5, 1.6, 1.0, 0.8], speed: [2.0, 2.0, 2.0, 2.1, 2.2], sight: 8, radius: 0.28,
    cost: [{ food: 30, wood: 40 }, { food: 35, wood: 45 }, { food: 40, wood: 30, metal: 20 },
           { food: 50, metal: 40 }, { food: 60, metal: 50, oil: 10 }],
    time: [12, 12, 13, 13, 14],
    desc: 'Shoots from range. Strong against infantry.',
  },
  cavalry: {
    cls: 'cav', from: 'stable', key: 'V', age: 0, icon: '🐎',
    names: ['Horseman', 'Knight', 'Dragoon', 'Tank', 'Battle Tank'],
    hp: [100, 140, 150, 320, 420], atk: [9, 12, 14, 28, 36], range: [0.5, 0.5, 3.5, 5, 5.5],
    cd: [1.3, 1.3, 1.5, 2.0, 1.8], speed: [3.4, 3.2, 3.2, 2.6, 2.9], sight: 8, radius: 0.36,
    cost: [{ food: 60, metal: 40 }, { food: 70, metal: 60 }, { food: 80, metal: 70 },
           { metal: 120, oil: 60 }, { metal: 150, oil: 80 }],
    time: [15, 15, 16, 20, 22],
    desc: 'Fast and tough. Strong against ranged units, siege and citizens. Becomes tanks in the Industrial Age.',
  },
  siege: {
    cls: 'sie', from: 'workshop', key: 'G', age: 1, icon: '💣',
    names: ['Catapult', 'Trebuchet', 'Cannon', 'Artillery', 'Rocket Artillery'],
    hp: [90, 110, 140, 160, 180], atk: [30, 40, 45, 55, 70], range: [7, 8, 8, 10, 11],
    cd: [4, 4.5, 4, 3.5, 3], speed: [1.3, 1.2, 1.5, 1.7, 2.0], sight: 9, radius: 0.4, splash: 1.0,
    cost: [{ wood: 100, metal: 60 }, { wood: 120, metal: 80 }, { wood: 80, metal: 120 },
           { metal: 150, oil: 40 }, { metal: 180, oil: 70 }],
    time: [20, 20, 22, 24, 26],
    desc: 'Long range. Wrecks buildings and hits groups. Weak up close.',
  },
  // ----- Industrial and Atomic Age air force and anti-air -----
  fighter: {
    cls: 'air', from: 'airfield', key: 'F', age: 3, icon: '✈️', air: true,
    names: ['Fighter', 'Fighter', 'Fighter', 'Fighter Plane', 'Jet Fighter'],
    hp: [200, 200, 200, 200, 240], atk: [12, 12, 12, 12, 16], range: [3.5, 3.5, 3.5, 3.5, 4],
    cd: [1, 1, 1, 1, 0.8], speed: [6.5, 6.5, 6.5, 6.5, 8.5], sight: 10, radius: 0.45,
    cost: [{ metal: 120, oil: 80 }, { metal: 120, oil: 80 }, { metal: 120, oil: 80 }, { metal: 120, oil: 80 }, { metal: 140, oil: 100 }],
    time: [22, 22, 22, 22, 22],
    desc: 'Fast plane. Hunts enemy planes and can strafe ground units. Flies over anything.',
  },
  bomber: {
    cls: 'air', from: 'airfield', key: 'B', age: 3, icon: '🛩️', air: true, bomb: true, rearm: 10,
    names: ['Bomber', 'Bomber', 'Bomber', 'Bomber', 'Stealth Bomber'],
    hp: [360, 360, 360, 360, 420], atk: [140, 140, 140, 140, 190], range: [0.6, 0.6, 0.6, 0.6, 0.6],
    cd: [1, 1, 1, 1, 1], speed: [5, 5, 5, 5, 6.5], sight: 9, radius: 0.55, splash: 2.2,
    cost: [{ metal: 220, oil: 160 }, { metal: 220, oil: 160 }, { metal: 220, oil: 160 }, { metal: 220, oil: 160 }, { metal: 260, oil: 200 }],
    time: [30, 30, 30, 30, 30],
    desc: 'Flies to the target, drops a load of bombs, then flies home to an Airfield or city to reload. Wrecks buildings.',
  },
  aagun: {
    cls: 'aa', from: 'workshop', key: 'Q', age: 3, icon: '🎯', aaOnly: true,
    names: ['Flak Cannon', 'Flak Cannon', 'Flak Cannon', 'Flak Cannon', 'SAM Launcher'],
    hp: [160, 160, 160, 160, 190], atk: [22, 22, 22, 22, 30], range: [7, 7, 7, 7, 8.5],
    cd: [1.2, 1.2, 1.2, 1.2, 1.5], speed: [2, 2, 2, 2, 2.4], sight: 10, radius: 0.38,
    cost: [{ metal: 100, oil: 30 }, { metal: 100, oil: 30 }, { metal: 100, oil: 30 }, { metal: 100, oil: 30 }, { metal: 120, oil: 50 }],
    time: [20, 20, 20, 20, 20],
    desc: 'Anti-air. Shreds planes. Only shoots at planes.',
  },
};

// Building footprints are square: size x size tiles.
export const BLDS = {
  city: {
    size: 3, hp: 2500, cost: { food: 200, wood: 250 }, time: 60, key: 'C', icon: '🏛️', age: 0,
    names: ['City', 'City', 'City', 'City', 'City'], sight: 10,
    atk: 8, range: 6, cd: 1.5, pop: 25, trains: ['citizen'],
    desc: 'Claims territory, trains citizens and researches the next age. Build more to grow your borders.',
  },
  farm: {
    size: 2, hp: 400, cost: { wood: 60 }, time: 15, key: 'F', icon: '🌾', age: 0, sight: 3,
    names: ['Farm', 'Farm', 'Farm', 'Farm', 'Farm'], gather: 'food', slots: 5,
    desc: 'Up to 5 citizens make food. Must be near one of your cities.',
  },
  lumber: {
    size: 2, hp: 400, cost: { wood: 50 }, time: 15, key: 'L', icon: '🪓', age: 0, sight: 3,
    names: ['Woodcutter\'s Camp', 'Woodcutter\'s Camp', 'Lumber Mill', 'Lumber Mill', 'Lumber Mill'],
    gather: 'wood', slots: 5,
    desc: 'Up to 5 citizens cut wood. Must be next to a forest.',
  },
  mine: {
    size: 2, hp: 500, cost: { wood: 80 }, time: 18, key: 'M', icon: '⛏️', age: 0, sight: 3,
    names: ['Mine', 'Mine', 'Mine', 'Mine', 'Mine'], gather: 'metal', slots: 5,
    desc: 'Up to 5 citizens dig metal. Must be built on a metal deposit (grey rocks).',
  },
  oilwell: {
    size: 2, hp: 500, cost: { wood: 120, metal: 80 }, time: 20, key: 'O', icon: '🛢️', age: 3, sight: 3,
    names: ['Oil Well', 'Oil Well', 'Oil Well', 'Oil Well', 'Oil Well'], gather: 'oil', slots: 5,
    desc: 'Up to 5 citizens pump oil. Must be built on an oil deposit (black pools).',
  },
  barracks: {
    size: 2, hp: 900, cost: { wood: 120 }, time: 25, key: 'B', icon: '⚔️', age: 0, sight: 5,
    names: ['Barracks', 'Barracks', 'Barracks', 'Barracks', 'Barracks'], trains: ['infantry', 'ranged', 'oompah', 'bowler'],
    desc: 'Trains infantry and ranged units.',
  },
  stable: {
    size: 2, hp: 900, cost: { wood: 140, food: 60 }, time: 25, key: 'T', icon: '🐴', age: 0, sight: 5,
    names: ['Stable', 'Stable', 'Stable', 'Tank Factory', 'Tank Factory'], trains: ['cavalry', 'scooter', 'jeepney'],
    desc: 'Trains cavalry. Makes tanks from the Industrial Age.',
  },
  workshop: {
    size: 2, hp: 900, cost: { wood: 150, metal: 80 }, time: 30, key: 'W', icon: '⚙️', age: 1, sight: 5,
    names: ['Siege Workshop', 'Siege Workshop', 'Foundry', 'Arms Factory', 'Arms Factory'], trains: ['siege', 'aagun'],
    desc: 'Builds siege weapons and artillery.',
  },
  library: {
    size: 2, hp: 800, cost: { wood: 150 }, time: 25, key: 'Y', icon: '📚', age: 0, sight: 4,
    names: ['Library', 'Library', 'Library', 'University', 'Research Lab'], research: true,
    desc: 'Researches technologies, including the Manhattan Project.',
  },
  tower: {
    size: 1, hp: 700, cost: { wood: 80, metal: 60 }, time: 20, key: 'R', icon: '🗼', age: 1, sight: 9,
    names: ['Tower', 'Tower', 'Fort Tower', 'Flak Bunker', 'Flak Bunker'], atk: 12, range: 7, cd: 1.5,
    desc: 'Shoots at enemies nearby, including planes.',
  },
  airfield: {
    size: 3, hp: 1600, cost: { wood: 250, metal: 250 }, time: 40, key: 'P', icon: '🛫', age: 3, sight: 6,
    names: ['Airfield', 'Airfield', 'Airfield', 'Airfield', 'Air Base'], trains: ['fighter', 'bomber'],
    desc: 'Builds fighters and bombers. Bombers come back here to reload.',
  },
  silo: {
    size: 2, hp: 1500, cost: { metal: 600, oil: 400 }, time: 45, key: 'N', icon: '☢️', age: 4, sight: 4,
    names: ['Missile Silo', 'Missile Silo', 'Missile Silo', 'Missile Silo', 'Missile Silo'],
    needTech: 'manhattan', nukes: true,
    desc: 'Builds and launches nuclear missiles. Needs the Manhattan Project.',
  },
};

export const BUILD_ORDER = ['city', 'farm', 'lumber', 'mine', 'oilwell', 'barracks', 'stable', 'workshop', 'library', 'tower', 'airfield', 'silo'];

// Gather buildings can be upgraded once per age (up to level 4 in the Atomic Age).
// Each level: +1 worker slot and +20% gathering per worker. Cost = cost x new level.
export const UPGRADE = {
  rate: 0.2, slots: 1,
  farm: { cost: { wood: 80, food: 40 }, names: ['Farm', 'Irrigated Farm', 'Plantation', 'Mechanised Farm', 'Agribusiness'] },
  lumber: { cost: { food: 80, wood: 40 }, names: ['Woodcutter\'s Camp', 'Sawpit', 'Lumber Mill', 'Steam Sawmill', 'Timber Corporation'] },
  mine: { cost: { wood: 120, food: 80 }, names: ['Mine', 'Deep Mine', 'Shaft Mine', 'Strip Mine', 'Mega Mine'] },
  oilwell: { cost: { wood: 100, metal: 100 }, names: ['Oil Well', 'Pumpjack', 'Oil Derrick', 'Refinery', 'Mega Refinery'] },
};
export function upgradeCost(type, lvl) {
  const c = UPGRADE[type].cost, out = {};
  for (const k in c) out[k] = c[k] * lvl;
  return out;
}
export const upgradeTime = (lvl) => 15 + 5 * lvl;

export const NUKE = {
  cost: { metal: 800, oil: 800 }, time: 45, maxStock: 3,
  speed: 7,          // tiles per second in flight
  minFlight: 4,      // seconds
  killRadius: 5,     // everything dies
  blastRadius: 9,    // heavy damage
  blastDmg: 0.6,     // share of max hp
  falloutRadius: 8,
  falloutTime: 40,
  sdiChance: 0.5,
};

// Technologies researched at the Library.
// eff: gather = { res: bonus }, hp/atk = bonus to military, popPerCity, cityLimit, attrition, speed
export const TECHS = {
  agri1: { name: 'Agriculture', age: 0, cost: { food: 100, wood: 100 }, time: 25, eff: { gather: { food: 0.2 } }, desc: '+20% food.' },
  wood1: { name: 'Forestry', age: 0, cost: { food: 100, wood: 80 }, time: 25, eff: { gather: { wood: 0.2 } }, desc: '+20% wood.' },
  metal1: { name: 'Mining', age: 1, cost: { food: 150, wood: 150 }, time: 30, eff: { gather: { metal: 0.2 } }, desc: '+20% metal.' },
  civics: { name: 'Civics', age: 1, cost: { food: 200, wood: 200 }, time: 35, eff: { popPerCity: 15, cityLimit: 1 }, desc: '+15 population per city and +1 city limit.' },
  weap1: { name: 'Weaponsmithing', age: 1, cost: { food: 150, metal: 150 }, time: 35, eff: { atk: 0.15 }, desc: '+15% attack for military units.' },
  armor1: { name: 'Armor', age: 1, cost: { food: 150, metal: 150 }, time: 35, eff: { hp: 0.15 }, desc: '+15% hit points for military units.' },
  agri2: { name: 'Irrigation', age: 2, req: 'agri1', cost: { food: 300, wood: 300 }, time: 35, eff: { gather: { food: 0.2 } }, desc: '+20% more food.' },
  wood2: { name: 'Sawmills', age: 2, req: 'wood1', cost: { food: 300, metal: 150 }, time: 35, eff: { gather: { wood: 0.2 } }, desc: '+20% more wood.' },
  logistics: { name: 'Logistics', age: 2, cost: { food: 300, metal: 300 }, time: 40, eff: { attrition: 0.5, speed: 0.1 }, desc: 'Half damage from enemy territory. +10% unit speed.' },
  metal2: { name: 'Deep Mining', age: 3, req: 'metal1', cost: { food: 400, wood: 400 }, time: 40, eff: { gather: { metal: 0.25 } }, desc: '+25% more metal.' },
  agri3: { name: 'Fertiliser', age: 3, req: 'agri2', cost: { food: 500, wood: 300, metal: 200 }, time: 40, eff: { gather: { food: 0.25 } }, desc: '+25% more food.' },
  wood3: { name: 'Chainsaws', age: 3, req: 'wood2', cost: { food: 500, metal: 300 }, time: 40, eff: { gather: { wood: 0.25 } }, desc: '+25% more wood.' },
  oil1: { name: 'Refining', age: 3, cost: { food: 400, metal: 300 }, time: 40, eff: { gather: { oil: 0.25 } }, desc: '+25% oil.' },
  weap2: { name: 'Ballistics', age: 3, req: 'weap1', cost: { food: 400, metal: 400 }, time: 45, eff: { atk: 0.15 }, desc: '+15% more attack.' },
  armor2: { name: 'Composite Armor', age: 3, req: 'armor1', cost: { food: 400, metal: 400 }, time: 45, eff: { hp: 0.15 }, desc: '+15% more hit points.' },
  civics2: { name: 'Nationalism', age: 3, req: 'civics', cost: { food: 600, wood: 400, metal: 400 }, time: 45, eff: { popPerCity: 15, cityLimit: 1 }, desc: '+15 population per city and +1 city limit.' },
  oil2: { name: 'Cracking Towers', age: 3, req: 'oil1', cost: { food: 500, wood: 500, metal: 300 }, time: 45, eff: { gather: { oil: 0.25 } }, desc: '+25% more oil.' },
  metal3: { name: 'Strip Mining', age: 4, req: 'metal2', cost: { food: 800, wood: 800 }, time: 45, eff: { gather: { metal: 0.3 } }, desc: '+30% more metal.' },
  oil3: { name: 'Fracking', age: 4, req: 'oil2', cost: { food: 800, wood: 600, metal: 400 }, time: 45, eff: { gather: { oil: 0.3 } }, desc: '+30% more oil. Nobody asks where it comes from.' },
  manhattan: { name: 'Manhattan Project', age: 4, cost: { food: 1000, metal: 1500, oil: 1000 }, time: 60, eff: {}, desc: 'Unlocks the Missile Silo. Everyone will be told.' },
  sdi: { name: 'Missile Defense', age: 4, cost: { metal: 1200, oil: 1200 }, time: 50, eff: {}, desc: '50% chance to shoot down nukes aimed at your territory.' },
};

Object.assign(UNITS, NATION_UNITS);
Object.assign(TECHS, NATION_TECHS);

export const TECH_ORDER = Object.keys(TECHS);

// Can this player use this unit type / tech? (signature units and national techs are for one nation)
export const forNation = (player, d) => !d.nation || d.nation === player.nation;

// Library tech cost and time for this player (Taiwan gets a discount).
export function techCost(player, key) {
  const c = TECHS[key].cost, f = 1 - nbonus(player, 'techCost'), out = {};
  for (const k in c) out[k] = Math.floor(c[k] * f);
  return out;
}
export function techTime(player, key) { return TECHS[key].time * (1 - nbonus(player, 'techTime')); }

export const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ecf0f1'];

export const START_RES = {
  low: { food: 150, wood: 150, metal: 0, oil: 0 },
  normal: { food: 300, wood: 300, metal: 100, oil: 0 },
  high: { food: 2000, wood: 2000, metal: 1500, oil: 1000 },
  insane: { food: 20000, wood: 20000, metal: 20000, oil: 20000 },
};

export const MAP_SIZES = { small: 96, normal: 128, large: 160 };

export function cityLimit(player) {
  return 2 + player.age + techSum(player, 'cityLimit');
}

export function cityRadius(age) {
  return 8 + age;
}

export function techSum(player, key) {
  let s = 0;
  for (const t of TECH_ORDER) {
    if (player.techs[t] && TECHS[t].eff[key]) s += TECHS[t].eff[key];
  }
  return s;
}

export function gatherMult(player, res) {
  const ng = nbonus(player, 'gather');
  let s = 1 + ((ng && ng[res]) || 0);
  for (const t of TECH_ORDER) {
    const g = player.techs[t] && TECHS[t].eff.gather;
    if (g && g[res]) s += g[res];
  }
  return s;
}
