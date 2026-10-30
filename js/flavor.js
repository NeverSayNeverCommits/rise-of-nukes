// Silly words: unit names, voice lines, taunts and end-of-game awards.
// UI only. Nothing here changes the game.
import { NATIONS } from './sim/nations.js';

const FIRST = ['Gerald', 'Brenda', 'Kevin', 'Doris', 'Nigel', 'Agnes', 'Barry', 'Mildred', 'Trevor', 'Ingrid', 'Dave', 'Gertrude',
  'Clive', 'Ursula', 'Derek', 'Phyllis', 'Rodney', 'Bjorn', 'Sven', 'Olga', 'Chad', 'Karen', 'Steve', 'Bartholomew', 'Wendy',
  'Gary', 'Hilda', 'Reginald', 'Svetlana', 'Boris', 'Jean-Claude', 'Dolores', 'Norbert', 'Esmeralda', 'Kyle', 'Beatrice'];
const LAST = ['Bumbleton', 'McFlurry', 'Snodgrass', 'Wobblesworth', 'Pickles', 'Crumpet', 'Fiddlesticks', 'Noodle', 'von Bratwurst',
  'Smith', 'Butterfingers', 'Puddlejump', 'Gravy', 'Thundercrust', 'Applewhite', 'Marmalade', 'Spatula', 'Cabbage', 'Teapot',
  'Kettle', 'Biscuit', 'Haggis', 'Sprocket', 'Wigglesworth'];
const NICK = ['Toast', 'The Hammer', 'Sparkles', 'Two Socks', 'Meatball', 'Mad Dog', 'Tiny', 'Big Tiny', 'Lucky', 'Unlucky',
  'Biscuits', 'The Brick', 'Snake Eyes', 'Turbo', 'Mumbles', 'Grandma', 'Dynamite', 'Noodles', 'Captain Obvious', 'Spud'];
const COW_NAMES = ['Daisy', 'Bessie', 'Moodonna', 'Sir Loin', 'Cowabunga', 'Milkshake', 'Mooriarty', 'Steak-ira', 'Clarabelle',
  'Patty', 'Moolan', 'Buttercup', 'Udderly Fabulous', 'Brisket', 'Angus Young', 'Taco', 'Wagyu Wendy', 'Beefy Joe'];
const RANKS = ['', 'Corporal', 'Sergeant', 'Legendary'];
const RANK_ICON = ['', '★', '★★', '★★★'];

function h(id, salt) {
  let x = (id * 2654435761 + salt * 974711) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13;
  return x >>> 0; // keep it positive, or % gives negative list positions
}
const pickBy = (arr, id, salt) => arr[h(id, salt) % arr.length];
export const rankIcon = (r) => RANK_ICON[r || 0];

// nation: the owner's nation key. Most soldiers get a local name, some get a silly one.
export function unitName(u, nation) {
  if (u.kind === 'c') return u.mutant ? `${pickBy(COW_NAMES, u.id, 1)} the Abomination` : pickBy(COW_NAMES, u.id, 1);
  const n = NATIONS[nation], local = n && h(u.id, 5) % 5 !== 0;
  const first = pickBy(local ? n.first : FIRST, u.id, 1), last = pickBy(local && h(u.id, 6) % 4 !== 0 ? n.last : LAST, u.id, 2);
  const nick = h(u.id, 3) % 4 === 0 || u.rank ? ` "${pickBy(NICK, u.id, 4)}"` : '';
  const rank = RANKS[u.rank || 0];
  return `${rank ? rank + ' ' : ''}${first}${nick} ${last}`;
}

export function cowMood(c) {
  if (c.mutant) return pickBy(['Hungry for brains. Or grass. Hard to say.', 'Glows in the dark. Do not milk.', 'Has three eyes and a grudge.', 'Was a normal cow. Then you happened.'], c.id, 9);
  return pickBy(['Thinking about grass.', 'Plotting something.', 'Has seen things.', 'Just vibing.', 'Delicious, probably.', 'Would like to speak to your manager.', 'Is a better general than you.', 'Moo.'], c.id, 9);
}

const LINES = {
  cit: {
    select: ['Yes?', 'Hmm?', 'Ready to work.', 'What now?', 'I have a family, you know.', 'Is it lunch yet?', 'Need something built?'],
    move: ['Okay.', 'On my way.', 'Right-o.', 'If I must.', 'Walking, walking.', 'Fine.'],
    work: ['Back to work.', 'Chop chop.', 'Hi ho!', 'Another day, another coin.', 'Measure twice, cut once.', 'I love my job. I love my job.'],
    attack: ['Me? Fight?', 'With this shovel?', 'I am not paid enough for this!'],
  },
  inf: {
    select: ['Sir!', 'Awaiting orders.', 'Ready!', 'Reporting.', 'What is the plan?'],
    move: ['Moving out!', 'Yes sir!', 'On the double!', 'Marching.', 'Left, right, left.'],
    attack: ['Charge!', 'For glory!', 'Have at them!', 'Into the breach!', 'Get some!', 'Leeroy Jenkins!'],
  },
  rng: {
    select: ['Eyes sharp.', 'Ready to fire.', 'Target?', 'Locked and loaded.'],
    move: ['Repositioning.', 'Moving.', 'Got it.'],
    attack: ['Fire at will!', 'Loose!', 'Pew pew!', 'Light them up!'],
  },
  cav: {
    select: ['Saddled up.', 'Ready to ride.', 'Neigh.', 'Rolling.'],
    move: ['Giddy up!', 'Riding out.', 'Full speed!', 'Vroom.'],
    attack: ['Run them down!', 'Charge!', 'Tally ho!', 'Fire in the hole!'],
  },
  sie: {
    select: ['Artillery ready.', 'Big gun standing by.', 'Need something knocked down?'],
    move: ['Rolling slowly.', 'Moving the big one.', 'This thing is heavy, you know.'],
    attack: ['Bombs away!', 'Lob it!', 'Fire!', 'Knock knock!'],
  },
};
// Lines for nation units. Keys: signature unit type, or 'nation:line' for unique versions.
const SPECIAL = {
  oompah: {
    select: ['Oom-pah-pah!', 'Ein Prosit!', 'Requests? We only know one song.', 'Unce unce unce.', 'Tuba ready.'],
    move: ['Marching band, march!', 'One, two, oom, pah!', 'To the next festival!'],
    attack: ['We are musicians, not soldiers!', 'I will hit them with the tuba.', 'Louder!'],
  },
  scooter: {
    select: ['Beep beep!', 'Ten of us, one lane.', 'Helmet on!', 'Where to?'],
    move: ['Coming through!', 'Beep beep, move!', 'Shortcut!', 'Hold my bubble tea.'],
    attack: ['Swarm them!', 'Zoom zoom!', 'Beep beep, bang bang!'],
  },
  jeepney: {
    select: ['Sakay na! All aboard!', 'Room for one more!', 'Bayad po!', 'Lunch is in the back.'],
    move: ['Para! Wait, no, keep going.', 'Biyahe na!', 'Next stop, the front line!'],
    attack: ['Disco time!', 'Everybody shoot out the window!', 'Honk honk!'],
  },
  bowler: {
    select: ['Pitch looks dry today.', 'Ready to bowl.', 'New ball, please.', 'Watch the swing.'],
    move: ['Walking back to my mark.', 'Long run up.', 'Fielding position!'],
    attack: ['Howzat!', 'Bouncer!', 'Middle stump!', 'Clean bowled!', 'Out! Definitely out!'],
  },
  'germany:infantry': {
    select: ['Jawohl!', 'My sword is bigger than yours.', 'Zweihänder ready.'],
    move: ['Marching. On time.', 'Jawohl.', 'Precisely.'],
    attack: ['Zweihänder time!', 'Nice pike. Shame if it got cut.', 'Make room, I need to swing!'],
  },
  'germany:cavalry': {
    select: ['Precision engineered.', 'Fully inspected.', 'Right on schedule.'],
    move: ['No speed limit!', 'Autobahn mode.', 'Rolling. Efficiently.'],
    attack: ['Engineered for victory!', 'Fire, on schedule!', 'Quality German shells!'],
  },
  'taiwan:ranged': {
    select: ['Half sugar, full auto.', 'Extra pearls loaded.', 'Less ice, please.'],
    move: ['Moving. Keep the tea cold.', 'On my way.', 'Night market later?'],
    attack: ['Pearls away!', 'Tapioca time!', 'Have a drink!'],
  },
  'philippines:infantry': {
    select: ['Magellan who?', 'For Lapu-Lapu!', 'Ready, boss!'],
    move: ['Tara na! Let us go!', 'On the way, boss.', 'Sige!'],
    attack: ['Remember Mactan!', 'Laban!', 'Fight!'],
  },
  'pakistan:siege': {
    select: ['Jingle jingle!', 'Look at my beautiful truck.', 'New paint, new bells.'],
    move: ['Delivery on the way!', 'Mind the bells!', 'Honk honk!'],
    attack: ['Special delivery!', 'Jingle all the way!', 'Fire! Gently, the paint.'],
  },
};
export const specialLine = (key, kind) => { const l = SPECIAL[key]; return l && l[kind] ? pickRand(l[kind]) : null; };

const POKE = ['Stop poking me!', 'I am busy!', 'Do you mind?', 'Is this how you treat a war hero?', 'I bruise easily.',
  'I am going to report you to the union.', 'Click me one more time. I dare you.', 'My mother warned me about commanders like you.',
  'Okay, okay, I am selected! Jeez.', 'Are you trying to start a mutiny?', 'Personal space, please!', 'That tickles.',
  'I have a sword, you know.', 'Are you lost?'];
const CITY_POKE = ['Yes, it is a city. Well spotted.', 'The mayor is in a meeting.', 'Please stop clicking the town hall.',
  'Our citizens are complaining about the clicking.', 'Do you want a souvenir?', 'Tourist information is closed.'];

const pickRand = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const lineFor = (cls, kind) => pickRand((LINES[cls] || LINES.inf)[kind] || LINES.inf.select);
export const pokeLine = () => pickRand(POKE);
export const cityPokeLine = () => pickRand(CITY_POKE);

// Type a number in chat to say one of these out loud (like Age of Empires).
export const TAUNTS = {
  1: 'Yes.', 2: 'No.', 3: 'Food, please.', 4: 'Wood, please.', 5: 'Metal, please.', 6: 'Oil, please.', 7: 'Ahhhh!',
  8: 'I need a minute.', 9: 'Nice town. I will take it.', 10: 'Ha ha ha ha ha!', 11: 'Do not make me nuke you.',
  12: 'That was an accident.', 13: 'It is not a bug, it is a feature.', 14: 'Moo.', 15: 'Have you tried turning it off and on again?',
  16: 'Gee, thanks.', 17: 'Nice economy. Shame if something happened to it.', 18: 'Ready when you are.',
  19: 'Wololo.', 20: 'Surprise!', 21: 'I am not angry, just disappointed.', 22: 'All your base are belong to us.',
  23: 'Peace and love. Mostly love.', 24: 'Who keeps eating the cows?', 25: 'Rush! Rush!',
  26: 'Prost!', 27: 'Bubble tea break!', 28: 'Kain tayo! Let us eat!', 29: 'Howzat!',
};

export const CRATE_TEXT = {
  res: (e) => `Found ${e.amt} ${e.res}!`,
  units: () => 'Some lost mercenaries joined you!',
  tech: (e, t) => `Ancient scroll: free ${t}!`,
  cows: () => 'The crate was full of cows. Somehow.',
  map: () => 'A treasure map! Too bad it is a map of a different game.',
  dud: (e) => ['An empty crate. Classic.', 'A crate of rubber chickens.', 'A crate of very old socks.', 'A note: "IOU one treasure".',
    'A crate of glitter. It will never come out.', 'A single sad potato.', 'A crate full of smaller crates. All empty.', 'A mime. He leaves silently.'][e.n % 8],
};

export const STREAK = [[3, 'Triple kill!'], [5, 'Killing spree!'], [8, 'Rampage!'], [12, 'Unstoppable!'], [18, 'Godlike!'], [25, 'Somebody stop them!']];

// End-of-game awards. Each finds the player with the best score.
const AWARDS = [
  { title: 'Most Likely to Start World War 3', icon: '☢️', val: (p) => p.nukes, fmt: (v) => `${v} nuke${v > 1 ? 's' : ''} launched` },
  { title: 'The Butcher', icon: '🔪', val: (p) => p.kills, fmt: (v) => `${v} kills` },
  { title: 'Cannon Fodder Enthusiast', icon: '⚰️', val: (p) => p.lost, fmt: (v) => `lost ${v} units` },
  { title: 'Steak Enthusiast', icon: '🥩', val: (p) => p.st.cows, fmt: (v) => `ate ${v} cow${v > 1 ? 's' : ''}` },
  { title: 'Farmer of the Year', icon: '🌾', val: (p) => Math.floor(p.st.gath.food), fmt: (v) => `${v.toLocaleString('en')} food` },
  { title: 'Lumberjack, and OK', icon: '🪓', val: (p) => Math.floor(p.st.gath.wood), fmt: (v) => `${v.toLocaleString('en')} wood` },
  { title: 'Heavy Metal', icon: '🤘', val: (p) => Math.floor(p.st.gath.metal), fmt: (v) => `${v.toLocaleString('en')} metal` },
  { title: 'Oil Baron', icon: '🛢️', val: (p) => Math.floor(p.st.gath.oil), fmt: (v) => `${v.toLocaleString('en')} oil` },
  { title: 'Real Estate Mogul', icon: '🏗️', val: (p) => p.st.built, fmt: (v) => `${v} buildings` },
  { title: 'Treasure Goblin', icon: '🎁', val: (p) => p.st.crates, fmt: (v) => `${v} crate${v > 1 ? 's' : ''} opened` },
  { title: 'Heartbreaker', icon: '💔', val: (p) => p.st.caps, fmt: (v) => `stole ${v} cit${v > 1 ? 'ies' : 'y'}` },
  { title: 'Demolition Expert', icon: '🧨', val: (p) => p.st.razed, fmt: (v) => `knocked down ${v} buildings` },
  { title: 'Drill Sergeant', icon: '🎖️', val: (p) => p.st.promos, fmt: (v) => `${v} promotion${v > 1 ? 's' : ''}` },
  { title: 'Dragon on a Hoard', icon: '🐉', val: (p) => Math.floor(p.res.food + p.res.wood + p.res.metal + p.res.oil), fmt: (v) => `${v.toLocaleString('en')} resources unspent` },
];

export function awards(players) {
  const list = [];
  for (const a of AWARDS) {
    let best = -1, bv = 0, tie = false;
    players.forEach((p, i) => {
      const v = a.val(p);
      if (v > bv) { bv = v; best = i; tie = false; } else if (v === bv && v > 0) tie = true;
    });
    if (best >= 0 && !tie) list.push({ ...a, p: best, text: a.fmt(bv) });
  }
  // The pacifist: nobody else gets this one by accident.
  if (players.length > 1) {
    const paci = players.findIndex((p) => p.kills === 0 && p.st.built > 3);
    if (paci >= 0) list.push({ title: 'Conscientious Objector', icon: '🕊️', p: paci, text: 'killed absolutely nobody' });
  }
  return list;
}
