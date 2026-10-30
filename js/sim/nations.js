// The four nations. Like Rise of Nations: everyone plays the same game, but each nation has
// a national power (passive bonuses), a unique version of some normal units, one signature
// unit nobody else gets, and one national tech at the Library.
// This file must not import data.js (data.js imports this one).

export const NATION_KEYS = ['germany', 'taiwan', 'philippines', 'pakistan'];

// bonus fields (all optional):
//   bldHp      extra building health (0.3 = +30%)
//   trainTime  share of training time saved (0.2 = 20% faster)
//   buildSpeed extra construction speed (0.5 = 50% faster)
//   techCost / techTime  share of Library tech cost / time saved
//   cityIncome multiplier for the free food and wood every city makes
//   popPerCity extra population per city
//   cowFood    multiplier for food from cows
//   gather     { res: bonus } like the gather techs
//   attrition  share of enemy-territory damage avoided
export const NATIONS = {
  germany: {
    name: 'Germany', short: 'GER', motto: 'Ordnung muss sein.',
    power: [
      ['Deutsche Qualität', 'Buildings have +30% health.'],
      ['Pünktlichkeit', 'Units train 20% faster. Always on time.'],
      ['Ruhrgebiet', 'Mines make 25% more metal.'],
    ],
    bonus: { bldHp: 0.3, trainTime: 0.2, gather: { metal: 0.25 } },
    unique: ['Landsknecht (Gunpowder infantry): a huge two-handed sword that hits everyone nearby.', 'Leopard tanks (Industrial and Atomic): tougher and faster.'],
    signature: 'oompah', tech: 'autobahn',
    cities: ['Berlin', 'Hamburg', 'München', 'Köln', 'Frankfurt', 'Stuttgart', 'Bielefeld (allegedly)', 'Düsseldorf', 'Wanne-Eickel', 'Castrop-Rauxel'],
    first: ['Klaus', 'Jürgen', 'Helga', 'Uwe', 'Dieter', 'Gisela', 'Wolfgang', 'Heike', 'Lukas', 'Sabine', 'Horst', 'Ingrid', 'Günther', 'Ursula'],
    last: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Wagner', 'Becker', 'Hoffmann', 'Zimmermann', 'Krause', 'Bratwurst', 'Kartoffel', 'Pünktlich'],
  },
  taiwan: {
    name: 'Taiwan', short: 'TWN', motto: 'Small island. Very big chips.',
    power: [
      ['Semiconductors', 'Library techs cost 15% less and finish 25% faster.'],
      ['Night Markets', 'Cities make 25% more free food and wood.'],
    ],
    bonus: { techCost: 0.15, techTime: 0.25, cityIncome: 1.25 },
    unique: ['Bubble Tea Gunners (Industrial and Atomic ranged): fire tapioca pearls 18% faster.'],
    signature: 'scooter', tech: 'seven11',
    cities: ['Taipei', 'Kaohsiung', 'Taichung', 'Tainan', 'Hsinchu', 'Keelung', 'Hualien', 'Jiufen', 'Taitung', 'Chiayi'],
    first: ['Wei', 'Mei-Ling', 'Chia-Hao', 'Yu-Ting', 'Kevin', 'Vivian', 'A-Hui', 'Jerry', 'Tina', 'Ming', 'Jason', 'Pei-Shan', 'Cherry', 'A-Bing'],
    last: ['Chen', 'Lin', 'Huang', 'Chang', 'Lee', 'Wang', 'Wu', 'Liu', 'Tsai', 'Yang', 'Hsu', 'Cheng'],
  },
  philippines: {
    name: 'Philippines', short: 'PHL', motto: 'Bayanihan: we carry the house together.',
    power: [
      ['Bayanihan', 'Citizens build 50% faster. The neighbours help.'],
      ['Big Families', '+10 population per city.'],
      ['Lechon Masters', 'Cows give double food.'],
      ['Rice Terraces', 'Farms make 10% more food, camps 15% more wood, mines 10% more metal.'],
    ],
    bonus: { buildSpeed: 0.5, popPerCity: 10, cowFood: 2, gather: { food: 0.1, wood: 0.15, metal: 0.1 } },
    unique: ['Mactan Warriors (Ancient and Classical infantry): +30% attack, +10% speed. Ask Magellan.'],
    signature: 'jeepney', tech: 'karaoke',
    cities: ['Manila', 'Cebu', 'Davao', 'Quezon City', 'Iloilo', 'Baguio', 'Vigan', 'Boracay', 'Bacolod', 'Zamboanga'],
    first: ['Jun-Jun', 'Dingdong', 'Bong', 'Inday', 'Maricel', 'Rodel', 'Jovelyn', 'Marites', 'Dodong', 'Princess', 'Jhun', 'Lovely', 'Joy', 'Bimbo'],
    last: ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Dela Cruz', 'Garcia', 'Mendoza', 'Ramos', 'Villanueva', 'Aquino', 'Castillo', 'Pacquing'],
  },
  pakistan: {
    name: 'Pakistan', short: 'PAK', motto: 'Bowled over since the Indus Valley.',
    power: [
      ['Indus Valley', 'Farms make 20% more food. Five thousand years of practice.'],
      ['K2 Climbers', 'Units take half damage in enemy territory.'],
    ],
    bonus: { gather: { food: 0.2 }, attrition: 0.5 },
    unique: ['Jingle Truck Artillery (Industrial and Atomic siege): tougher, faster, with a bigger blast. And bells.'],
    signature: 'bowler', tech: 'tigers',
    cities: ['Islamabad', 'Lahore', 'Karachi', 'Peshawar', 'Multan', 'Quetta', 'Faisalabad', 'Sialkot', 'Hunza', 'Gwadar'],
    first: ['Ahmed', 'Bilal', 'Ayesha', 'Fatima', 'Usman', 'Hamza', 'Zainab', 'Sana', 'Faisal', 'Ali', 'Hira', 'Shoaib', 'Mahnoor', 'Wasim'],
    last: ['Khan', 'Malik', 'Qureshi', 'Chaudhry', 'Sheikh', 'Raza', 'Mirza', 'Siddiqui', 'Hussain', 'Abbasi', 'Rana', 'Javed'],
  },
};

// Unique versions of normal units. NATION_UNIQUE[nation][line][age] = changes.
// mul: multiply these stats. set: replace these stats.
export const NATION_UNIQUE = {
  germany: {
    infantry: {
      2: { name: 'Landsknecht', mul: { atk: 1.6, hp: 1.15, speed: 1.1 }, set: { range: 0.5, cd: 1.3, splash: 0.8 },
        desc: 'German unique. Fights up close with a sword taller than he is. Hits everyone around the target.' },
    },
    cavalry: {
      3: { name: 'Leopard Tank', mul: { hp: 1.15, speed: 1.15 }, desc: 'German unique. Precision engineered. +15% health and speed.' },
      4: { name: 'Leopard 2 (Autobahn Edition)', mul: { hp: 1.15, speed: 1.2 }, desc: 'German unique. No speed limit. +15% health, +20% speed.' },
    },
  },
  taiwan: {
    ranged: {
      3: { name: 'Bubble Tea Gunner', mul: { cd: 0.85 }, desc: 'Taiwanese unique. Fires tapioca pearls. Very fast. Half sugar, full auto.' },
      4: { name: 'Tapioca Minigun Team', mul: { cd: 0.85 }, desc: 'Taiwanese unique. Extra pearls. Less ice. More bullets.' },
    },
  },
  philippines: {
    infantry: {
      0: { name: 'Mactan Warrior', mul: { atk: 1.3, speed: 1.1 }, desc: 'Filipino unique. Ask Magellan how this goes. +30% attack, +10% speed.' },
      1: { name: 'Kampilan Warrior', mul: { atk: 1.3, speed: 1.1 }, desc: 'Filipino unique. Swings a very long sword. +30% attack, +10% speed.' },
    },
  },
  pakistan: {
    siege: {
      3: { name: 'Jingle Truck Artillery', mul: { hp: 1.25, speed: 1.25, splash: 1.6 }, desc: 'Pakistani unique. A cannon on the most beautiful truck you have ever seen. Bigger blast. Bells included.' },
      4: { name: 'Jingle Truck Rocket Battery', mul: { hp: 1.25, speed: 1.25, splash: 1.6 }, desc: 'Pakistani unique. Rockets, chrome, mirrors, poetry and 400 tiny bells.' },
    },
  },
};

// Signature units. Merged into UNITS by data.js. Arrays are indexed by age.
export const NATION_UNITS = {
  oompah: {
    nation: 'germany', cls: 'inf', from: 'barracks', key: 'O', age: 1, icon: '🎺', support: 'band',
    names: ['Oompah Band', 'Oompah Band', 'Oompah Band', 'Brass Band', 'Berlin Techno DJ'],
    hp: [60, 60, 70, 85, 100], atk: [2, 2, 3, 3, 4], range: [0.5, 0.5, 0.5, 0.5, 0.5],
    cd: [2, 2, 2, 2, 2], speed: [2.1, 2.1, 2.2, 2.3, 2.4], sight: 6, radius: 0.32,
    cost: [{ food: 60, wood: 40 }, { food: 60, wood: 40 }, { food: 80, metal: 40 }, { food: 90, metal: 50 }, { food: 100, metal: 60, oil: 20 }],
    time: [15, 15, 15, 16, 16],
    desc: 'German signature unit. Does not fight. Plays music: your units near the band attack 25% faster.',
  },
  scooter: {
    nation: 'taiwan', cls: 'cav', from: 'stable', key: 'Q', age: 3, icon: '🛵', batch: 3,
    names: ['Scooter Swarm', 'Scooter Swarm', 'Scooter Swarm', 'Scooter Swarm', 'Electric Scooter Swarm'],
    hp: [70, 70, 70, 75, 90], atk: [6, 6, 6, 7, 9], range: [2.5, 2.5, 2.5, 2.5, 2.5],
    cd: [0.9, 0.9, 0.9, 0.9, 0.8], speed: [4.6, 4.6, 4.6, 4.6, 5], sight: 8, radius: 0.26,
    cost: [{ food: 120, oil: 45 }, { food: 120, oil: 45 }, { food: 120, oil: 45 }, { food: 120, oil: 45 }, { food: 130, oil: 55 }],
    time: [14, 14, 14, 14, 14],
    desc: 'Taiwanese signature unit. You get THREE per order. Very fast, fragile, great at raiding citizens.',
  },
  jeepney: {
    nation: 'philippines', cls: 'cav', from: 'stable', key: 'J', age: 3, icon: '🚐', support: 'heal',
    names: ['Battle Jeepney', 'Battle Jeepney', 'Battle Jeepney', 'Battle Jeepney', 'Turbo Jeepney'],
    hp: [260, 260, 260, 260, 330], atk: [9, 9, 9, 10, 13], range: [3, 3, 3, 3, 3.5],
    cd: [1, 1, 1, 1, 0.9], speed: [3.3, 3.3, 3.3, 3.4, 3.6], sight: 8, radius: 0.4,
    cost: [{ food: 100, metal: 80, oil: 30 }, { food: 100, metal: 80, oil: 30 }, { food: 100, metal: 80, oil: 30 }, { food: 100, metal: 80, oil: 30 }, { food: 120, metal: 100, oil: 40 }],
    time: [20, 20, 20, 20, 20],
    desc: 'Filipino signature unit. Passengers shoot out of the windows. Brings lunch: heals your units nearby. Very loud.',
  },
  bowler: {
    nation: 'pakistan', cls: 'rng', from: 'barracks', key: 'B', age: 0, icon: '🏏',
    names: ['Fast Bowler', 'Fast Bowler', 'Fast Bowler', 'Swing Bowler', 'Express Bowler'],
    hp: [40, 50, 60, 75, 90], atk: [10, 13, 17, 22, 29], range: [6.5, 6.5, 7, 7.5, 8],
    cd: [2.6, 2.6, 2.6, 2.4, 2.2], speed: [2.2, 2.2, 2.2, 2.3, 2.4], sight: 9, radius: 0.28,
    cost: [{ food: 40, wood: 55 }, { food: 45, wood: 60 }, { food: 50, wood: 40, metal: 25 }, { food: 60, metal: 55 }, { food: 70, metal: 65, oil: 10 }],
    time: [13, 13, 14, 14, 15],
    desc: 'Pakistani signature unit. Bowls cricket balls at 150 km/h. Longest range of any soldier. Hits hard, reloads slowly.',
  },
};

// National techs. Merged into TECHS by data.js. Only that nation sees them.
export const NATION_TECHS = {
  autobahn: { nation: 'germany', name: 'Autobahn', age: 3, cost: { food: 300, metal: 300, oil: 100 }, time: 40, eff: {}, desc: 'Your units move 40% faster inside your own borders. No speed limit.' },
  seven11: { nation: 'taiwan', name: '7-Eleven on Every Corner', age: 2, cost: { food: 250, wood: 250 }, time: 35, eff: {}, desc: 'Your units slowly heal inside your own borders. Snacks are always near.' },
  karaoke: { nation: 'philippines', name: 'Karaoke Night', age: 2, cost: { food: 250, wood: 250 }, time: 35, eff: {}, desc: 'Your cities play power ballads all night. Enemy units in your land move 25% slower and take double damage from your territory.' },
  tigers: { nation: 'pakistan', name: 'Cornered Tigers', age: 2, cost: { food: 250, metal: 200 }, time: 35, eff: {}, desc: 'Your units deal 50% more damage when below half health. Never count them out.' },
};

export const nationOf = (pl) => NATIONS[pl.nation] || NATIONS.germany;
export const nbonus = (pl, k) => { const n = NATIONS[pl.nation]; return (n && n.bonus[k]) || 0; };
