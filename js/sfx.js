// All the game's sound. Everything is made on the fly with the Web Audio API, so there are no
// sound files to download. Also: background music that gets louder and faster in battle, and
// spoken lines using the browser's built-in text-to-speech.
//
// Nothing here touches the game state, so Math.random() is fine.

let ac = null;
let sfxBus, musicBus, master, noiseBuf, panOK = true;

const DEFAULTS = { vol: 0.85, music: 0.5, voice: true, muted: false };
const cfg = { ...DEFAULTS, ...safeJSON(localStorage.getItem('ron-audio')) };
if (localStorage.getItem('ron-muted') === '1') cfg.muted = true;

function safeJSON(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }
function save() { localStorage.setItem('ron-audio', JSON.stringify(cfg)); localStorage.removeItem('ron-muted'); }

function ctx() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    // Sounds -> compressor -> master. The compressor lets us play everything loud without
    // big explosions clipping.
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 5;
    comp.attack.value = 0.004; comp.release.value = 0.2;
    master = ac.createGain();
    sfxBus = ac.createGain();
    musicBus = ac.createGain();
    sfxBus.connect(comp); musicBus.connect(comp);
    comp.connect(master).connect(ac.destination);
    applyVolume();
    // One shared buffer of white noise for all the bangs and whooshes.
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    panOK = typeof ac.createStereoPanner === 'function';
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

function applyVolume() {
  if (!master) return;
  const t = ac.currentTime;
  master.gain.setTargetAtTime(cfg.muted ? 0 : cfg.vol * 2.2, t, 0.03);
  musicBus.gain.setTargetAtTime(cfg.music * 0.55, t, 0.3);
}

// ---------- settings ----------
export const audioSettings = () => ({ ...cfg });
export function setAudio(k, v) {
  cfg[k] = v; save(); applyVolume();
  if (k === 'music') music.check();
  if ((k === 'voice' && !v) || (k === 'muted' && v)) try { speechSynthesis.cancel(); } catch { /* no speech */ }
}
export function isMuted() { return cfg.muted; }
export function toggleMute() { setAudio('muted', !cfg.muted); return cfg.muted; }

// ---------- building blocks ----------
function out(pan, dest) {
  if (!pan || !panOK) return dest || sfxBus;
  const p = ac.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(dest || sfxBus);
  return p;
}

// A single note. o: { type, vol, when, slide, attack, pan, dest, vib }
function tone(freq, dur, o = {}) {
  const a = ctx(); if (!a) return;
  const t = a.currentTime + (o.when || 0);
  const osc = a.createOscillator(), g = a.createGain();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + (o.slideT || dur));
  if (o.vib) {
    const l = a.createOscillator(), lg = a.createGain();
    l.frequency.value = o.vib[0]; lg.gain.value = o.vib[1];
    l.connect(lg).connect(osc.frequency); l.start(t); l.stop(t + dur + 0.1);
  }
  const vol = Math.max(0.0002, o.vol ?? 0.2), at = o.attack || 0.005;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + at);
  if (o.hold) g.gain.setValueAtTime(vol, t + at + o.hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = osc.connect(g);
  if (o.lp) { const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = o.q || 1; node = node.connect(f); }
  node.connect(out(o.pan, o.dest));
  osc.start(t); osc.stop(t + dur + 0.05);
}

// A burst of filtered noise. o: { vol, when, type, freq, slide, q, pan, attack, dest }
function noise(dur, o = {}) {
  const a = ctx(); if (!a) return;
  const t = a.currentTime + (o.when || 0);
  const src = a.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  src.playbackRate.value = o.rate || 1;
  const f = a.createBiquadFilter();
  f.type = o.type || 'lowpass';
  f.frequency.setValueAtTime(o.freq || 1000, t);
  if (o.slide) f.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
  f.Q.value = o.q || 0.7;
  const g = a.createGain();
  const vol = Math.max(0.0002, o.vol ?? 0.3), at = o.attack || 0.002;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + at);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out(o.pan, o.dest));
  src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
}

const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- the sounds ----------
const S = {
  click: () => tone(1200, 0.04, { type: 'square', vol: 0.05 }),
  select: () => { tone(880, 0.06, { type: 'triangle', vol: 0.12 }); tone(1320, 0.08, { type: 'triangle', vol: 0.08, when: 0.04 }); },
  order: () => { tone(660, 0.06, { type: 'triangle', vol: 0.12 }); tone(990, 0.07, { type: 'triangle', vol: 0.1, when: 0.05 }); },
  error: () => { tone(180, 0.18, { type: 'square', vol: 0.12, lp: 900 }); tone(150, 0.2, { type: 'square', vol: 0.1, lp: 900, when: 0.09 }); },
  alarm: () => {
    for (let i = 0; i < 3; i++) {
      tone(440, 0.22, { type: 'sawtooth', vol: 0.22, lp: 1800, when: i * 0.26, hold: 0.12 });
      tone(554, 0.22, { type: 'sawtooth', vol: 0.18, lp: 1800, when: i * 0.26, hold: 0.12 });
    }
  },
  done: () => { tone(880, 0.12, { type: 'sine', vol: 0.22 }); tone(1320, 0.25, { type: 'sine', vol: 0.2, when: 0.09 }); },
  place: () => { noise(0.12, { freq: 400, vol: 0.5 }); tone(110, 0.15, { vol: 0.4, slide: 60 }); },
  hammer: (o = {}) => { for (let i = 0; i < 3; i++) { noise(0.05, { type: 'bandpass', freq: 2200, q: 3, vol: 0.4, when: i * 0.16, pan: o.pan }); tone(rnd(700, 900), 0.06, { type: 'square', vol: 0.06, when: i * 0.16, pan: o.pan }); } },
  built: () => { S.hammer(); [523, 659, 784].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.18, when: 0.5 + i * 0.08 })); },
  trained: () => { tone(587, 0.1, { type: 'triangle', vol: 0.14 }); tone(880, 0.16, { type: 'triangle', vol: 0.14, when: 0.08 }); },
  tech: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.3, { type: 'sine', vol: 0.16, when: i * 0.07 })),
  age: () => {
    // Brassy fanfare with a timpani roll.
    const brass = (f, when, dur) => { tone(f, dur, { type: 'sawtooth', vol: 0.16, lp: 2200, when, attack: 0.03, hold: dur * 0.5, vib: [5, 3] }); tone(f / 2, dur, { type: 'sawtooth', vol: 0.1, lp: 1200, when, attack: 0.03, hold: dur * 0.5 }); };
    [[392, 0, 0.18], [392, 0.2, 0.12], [392, 0.34, 0.12], [523, 0.5, 0.5], [659, 1.0, 0.25], [784, 1.25, 0.9]].forEach(([f, w, d]) => brass(f, w, d));
    for (let i = 0; i < 10; i++) tone(rnd(70, 80), 0.2, { vol: 0.3, when: 0.9 + i * 0.04, slide: 55 });
    noise(1.2, { freq: 6000, type: 'highpass', vol: 0.12, when: 1.25 });
  },
  capture: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, { type: 'square', vol: 0.09, lp: 3000, when: i * 0.1 })),
  sword: (o) => { tone(rnd(1800, 2600), 0.12, { type: 'square', vol: 0.05 * o.v, pan: o.pan, lp: 5000 }); tone(rnd(3100, 3600), 0.18, { vol: 0.06 * o.v, pan: o.pan }); noise(0.05, { type: 'highpass', freq: 3000, vol: 0.18 * o.v, pan: o.pan }); },
  bow: (o) => { tone(rnd(260, 320), 0.16, { type: 'triangle', vol: 0.25 * o.v, slide: 120, pan: o.pan }); noise(0.08, { type: 'bandpass', freq: 2500, q: 2, vol: 0.12 * o.v, pan: o.pan, when: 0.03 }); },
  gun: (o) => { noise(0.09, { type: 'highpass', freq: rnd(1200, 1800), vol: 0.45 * o.v, pan: o.pan }); noise(0.18, { freq: 500, vol: 0.35 * o.v, pan: o.pan }); },
  mg: (o) => { for (let i = 0; i < 4; i++) noise(0.05, { type: 'highpass', freq: 1500, vol: 0.32 * o.v, pan: o.pan, when: i * 0.07 }); },
  cannon: (o) => { noise(0.6, { freq: 500, slide: 120, vol: 0.7 * o.v, pan: o.pan }); tone(90, 0.4, { vol: 0.5 * o.v, slide: 40, pan: o.pan }); },
  catapult: (o) => { noise(0.3, { type: 'bandpass', freq: 300, q: 1, vol: 0.4 * o.v, pan: o.pan }); tone(180, 0.2, { type: 'triangle', vol: 0.2 * o.v, slide: 90, pan: o.pan }); },
  rocket: (o) => { noise(0.5, { type: 'bandpass', freq: 800, slide: 3000, q: 2, vol: 0.4 * o.v, pan: o.pan }); },
  tower: (o) => S.bow(o),
  hit: (o) => noise(0.06, { freq: 900, vol: 0.2 * o.v, pan: o.pan }),
  grunt: (o) => { const f = rnd(140, 220); tone(f, 0.22, { type: 'sawtooth', vol: 0.12 * o.v, slide: f * 0.6, lp: 900, q: 4, pan: o.pan }); },
  scream: (o) => { // the classic falling scream. Rare.
    tone(rnd(900, 1100), 1.0, { type: 'sawtooth', vol: 0.12 * o.v, slide: 300, lp: 2200, q: 6, vib: [7, 25], pan: o.pan, attack: 0.04 });
  },
  explode: (o = { v: 1 }) => { noise(0.9, { freq: 1200, slide: 100, vol: 0.9 * o.v, pan: o.pan }); tone(70, 0.6, { vol: 0.6 * o.v, slide: 30, pan: o.pan }); },
  collapse: (o = { v: 1 }) => {
    S.explode(o);
    for (let i = 0; i < 6; i++) noise(0.25, { type: 'bandpass', freq: rnd(200, 900), q: 1.5, vol: 0.35 * o.v, when: 0.2 + i * 0.12 + Math.random() * 0.1, pan: o.pan });
    noise(1.8, { freq: 250, vol: 0.5 * o.v, when: 0.1, attack: 0.1, pan: o.pan });
  },
  siren: () => { for (let i = 0; i < 5; i++) { tone(480, 0.5, { type: 'sawtooth', vol: 0.18, lp: 2500, when: i * 0.55, slide: 960, slideT: 0.45 }); tone(484, 0.5, { type: 'square', vol: 0.06, lp: 2500, when: i * 0.55, slide: 970, slideT: 0.45 }); } },
  launch: () => { noise(3, { type: 'bandpass', freq: 200, slide: 2500, q: 1, vol: 0.6, attack: 0.3 }); tone(60, 2.5, { vol: 0.4, slide: 120, attack: 0.2 }); },
  nuke: () => {
    noise(6, { freq: 400, slide: 40, vol: 1.2, attack: 0.01 });
    noise(1.5, { freq: 3000, slide: 300, vol: 0.8 });
    tone(45, 5, { vol: 0.9, slide: 22 });
    tone(32, 6, { type: 'triangle', vol: 0.6, slide: 20, when: 0.3 });
    for (let i = 0; i < 8; i++) noise(0.6, { freq: rnd(150, 400), vol: 0.4, when: 1 + i * 0.4 + Math.random() * 0.3 });
  },
  intercept: () => { S.explode({ v: 0.8 }); tone(1500, 0.5, { type: 'square', vol: 0.08, slide: 400, lp: 3000 }); },
  victory: () => {
    const n = [[523, 0], [523, 0.15], [523, 0.3], [523, 0.45], [415, 0.75], [466, 1.05], [523, 1.35], [466, 1.65], [523, 1.8]];
    n.forEach(([f, w], i) => { tone(f, i === n.length - 1 ? 1.4 : 0.22, { type: 'sawtooth', vol: 0.15, lp: 2500, when: w, attack: 0.02, hold: i === n.length - 1 ? 0.8 : 0.08, vib: [5, 4] }); tone(f * 1.5, 0.22, { type: 'triangle', vol: 0.06, when: w }); });
    for (let i = 0; i < 12; i++) { noise(0.4, { type: 'highpass', freq: 3000, vol: 0.2, when: 2 + i * 0.25 + Math.random() * 0.2 }); tone(rnd(1500, 3000), 0.3, { vol: 0.05, when: 2 + i * 0.25, slide: rnd(300, 600) }); }
  },
  defeat: () => {
    // Sad trombone. Wah wah wah waaaah.
    [[311, 0, 0.45], [294, 0.5, 0.45], [277, 1.0, 0.45], [262, 1.5, 1.6]].forEach(([f, w, d], i) =>
      tone(f, d, { type: 'sawtooth', vol: 0.22, lp: 1100, q: 3, when: w, attack: 0.05, hold: d * 0.6, vib: i === 3 ? [6, 9] : [4, 2] }));
  },
  moo: (o = {}) => {
    // A cow voiced by the browser's text-to-speech. Every cow gets a random voice, pitch and speed.
    // It never cuts anyone off: if someone is already talking, the cow keeps quiet.
    try { if (speechSynthesis.speaking || speechSynthesis.pending) return; } catch { return; }
    const squeaky = Math.random() < 0.2;
    say(['Moo', 'Moo', 'Moo moo', 'Moo?', 'Moo!', 'Moo, moo, moo'][Math.floor(Math.random() * 6)], Math.floor(Math.random() * 1000), {
      pitch: squeaky ? rnd(1.6, 2) : rnd(0.1, 0.6), rate: rnd(0.45, 0.8), vol: o.v ?? 1, noCancel: true,
    });
  },
  mutant: (o = { v: 1 }) => {
    tone(70, 1.4, { type: 'sawtooth', vol: 0.35 * o.v, lp: 700, q: 8, vib: [11, 18], slide: 45, pan: o.pan, attack: 0.05 });
    tone(73, 1.4, { type: 'square', vol: 0.12 * o.v, lp: 500, slide: 50, pan: o.pan, attack: 0.05 });
    noise(1.2, { type: 'bandpass', freq: 400, q: 3, vol: 0.15 * o.v, pan: o.pan });
  },
  crate: () => { tone(988, 0.08, { type: 'square', vol: 0.12 }); tone(1319, 0.4, { type: 'square', vol: 0.12, when: 0.08 }); },
  kaching: () => { noise(0.08, { type: 'highpass', freq: 4000, vol: 0.3 }); [2093, 2637, 3136].forEach((f, i) => tone(f, 0.6, { vol: 0.1, when: 0.05 + i * 0.03 })); },
  promote: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.15, when: i * 0.06 })),
  ribbit: (o = { v: 1 }) => { for (let i = 0; i < 2; i++) tone(rnd(380, 460), 0.09, { type: 'square', vol: 0.2 * o.v, slide: 180, lp: 1400, q: 5, when: i * 0.13, pan: o.pan }); },
  partyHorn: () => { tone(330, 0.9, { type: 'sawtooth', vol: 0.2, lp: 2500, slide: 1100, slideT: 0.25, vib: [9, 15] }); noise(0.9, { type: 'bandpass', freq: 1800, q: 2, vol: 0.1 }); },
  whistle: (dur = 6) => tone(2400, dur, { vol: 0.12, slide: 300, attack: 0.5 }),
  tick: (hi) => { noise(0.03, { type: 'bandpass', freq: hi ? 4000 : 2800, q: 8, vol: 0.5 }); },
  bell: () => { [262, 524, 786, 1048].forEach((f, i) => tone(f, 3, { vol: 0.25 / (i + 1), attack: 0.002 })); },
  // Nation sounds.
  bat: (o = { v: 1 }) => { noise(0.05, { type: 'bandpass', freq: 1800, q: 4, vol: 0.6 * o.v, pan: o.pan }); tone(700, 0.08, { type: 'triangle', vol: 0.25 * o.v, slide: 500, pan: o.pan }); },
  pop: (o = { v: 1 }) => { for (let i = 0; i < 3; i++) tone(rnd(500, 800), 0.06, { vol: 0.22 * o.v, slide: 1400, when: i * 0.05, pan: o.pan }); },
  jingle: (o = { v: 1 }) => { for (let i = 0; i < 6; i++) tone(rnd(2600, 3600), 0.25, { type: 'triangle', vol: 0.06 * o.v, when: i * 0.04 + Math.random() * 0.03, attack: 0.002, pan: o.pan }); },
  horn: (o = { v: 1 }) => { for (let i = 0; i < 2; i++) { tone(440, 0.12, { type: 'square', vol: 0.1 * o.v, lp: 2200, when: i * 0.18, pan: o.pan }); tone(554, 0.12, { type: 'square', vol: 0.07 * o.v, lp: 2200, when: i * 0.18, pan: o.pan }); } },
  oompah: (o = { v: 1 }) => {
    // A tuba and a cymbal: oom, pah, oom, pah.
    const root = [87, 98, 110, 82][Math.floor(Math.random() * 4)];
    for (let i = 0; i < 4; i++) {
      if (i % 2 === 0) tone(i === 2 ? root * 1.5 : root, 0.28, { type: 'sawtooth', vol: 0.3 * o.v, lp: 500, q: 2, when: i * 0.3, attack: 0.02, pan: o.pan });
      else { tone(root * 2.5, 0.15, { type: 'square', vol: 0.06 * o.v, lp: 1600, when: i * 0.3, pan: o.pan }); noise(0.12, { type: 'highpass', freq: 6000, vol: 0.12 * o.v, when: i * 0.3, pan: o.pan }); }
    }
  },
  techno: (o = { v: 1 }) => {
    // Two bars of 128 BPM techno: four-on-the-floor kick, offbeat hats, claps and a squelchy acid bass.
    const v = o.v ?? 1, st = 60 / 128 / 4, pan = o.pan;
    const root = [45, 43, 41, 48][Math.floor(Math.random() * 4)];
    const BASS = [0, 0, 12, 0, 0, 3, 0, 15, 0, 0, 12, 7, 0, 10, 0, 12]; // semitones over the root
    const REST = [0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    for (let i = 0; i < 32; i++) {
      const w = i * st, s16 = i % 16;
      if (i % 4 === 0) kick(w, v, pan);
      if (i % 4 === 2) noise(0.11, { type: 'highpass', freq: 7500, vol: 0.2 * v, when: w, pan });
      else noise(0.03, { type: 'highpass', freq: 9000, vol: 0.06 * v, when: w, pan });
      if (i % 8 === 4) clap(w, v, pan);
      if (!REST[s16]) acid(NOTE(root + BASS[s16]), st * 0.9, w, v * (s16 % 4 === 3 ? 1.3 : 1), i / 32, pan);
    }
    // a minor-chord stab on the last offbeat
    for (const n of [0, 3, 7]) tone(NOTE(root + 24 + n), 0.25, { type: 'sawtooth', vol: 0.05 * v, lp: 2200, q: 4, when: 30 * st, pan });
  },
  disco: (o = { v: 1 }) => { [523, 659, 784, 659].forEach((f, i) => tone(f, 0.14, { type: 'square', vol: 0.06 * o.v, lp: 2500, when: i * 0.14, pan: o.pan })); },
  // Air force.
  prop: (o = { v: 1 }) => { // propeller plane droning past
    const v = o.v ?? 1;
    tone(rnd(85, 100), 2.2, { type: 'sawtooth', vol: 0.12 * v, lp: 420, q: 2, attack: 0.6, vib: [24, 6], slide: 70, pan: o.pan });
    noise(2.2, { freq: 500, vol: 0.12 * v, attack: 0.6, pan: o.pan });
  },
  jet: (o = { v: 1 }) => { // jet roaring overhead
    const v = o.v ?? 1;
    noise(2.4, { type: 'bandpass', freq: 700, slide: 2600, q: 1.2, vol: 0.35 * v, attack: 0.8, pan: o.pan });
    noise(2.6, { freq: 300, vol: 0.25 * v, attack: 0.9, pan: o.pan });
    tone(rnd(1800, 2200), 2.2, { vol: 0.02 * v, slide: 1200, attack: 0.8, pan: o.pan });
  },
  flak: (o = { v: 1 }) => { // thump on the ground, crack up in the sky
    const v = o.v ?? 1;
    tone(120, 0.18, { vol: 0.45 * v, slide: 45, pan: o.pan });
    noise(0.1, { freq: 900, vol: 0.4 * v, pan: o.pan });
    noise(0.35, { freq: 2200, slide: 300, vol: 0.35 * v, when: 0.22, pan: o.pan });
  },
  bombs: (o = { v: 1 }) => { // falling whistle, then a string of explosions
    const v = o.v ?? 1;
    tone(1700, 0.55, { vol: 0.08 * v, slide: 450, attack: 0.05, pan: o.pan });
    for (let i = 0; i < 5; i++) {
      const w = 0.45 + i * 0.09 + Math.random() * 0.05;
      noise(0.7, { freq: 1100, slide: 90, vol: 0.55 * v, when: w, pan: o.pan });
      tone(rnd(55, 75), 0.5, { vol: 0.45 * v, slide: 30, when: w, pan: o.pan });
    }
  },
  ping: () => { tone(1568, 0.14, { type: 'sine', vol: 0.3 }); tone(2093, 0.3, { type: 'sine', vol: 0.25, when: 0.12 }); },
  wonder: () => { // choir-like chord with a slow swell and a bell on top
    [196, 294, 392, 494, 587].forEach((f, i) => { tone(f, 3.2, { type: 'sawtooth', vol: 0.09, lp: 1800, attack: 0.5, when: i * 0.08, vib: [5, 3] }); });
    [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, 1.6, { vol: 0.1, when: 1.2 + i * 0.14, attack: 0.002 }));
    noise(2, { freq: 7000, type: 'highpass', vol: 0.08, when: 1.2 });
  },
  laser: (o = { v: 1 }) => {
    tone(2600, 0.9, { type: 'sawtooth', vol: 0.18 * o.v, slide: 120, lp: 5000, pan: o.pan });
    tone(90, 1.1, { type: 'square', vol: 0.3 * o.v, slide: 40, lp: 800, pan: o.pan });
    noise(1.1, { freq: 3000, slide: 200, vol: 0.7 * o.v, pan: o.pan, when: 0.05 });
  },
  charge: () => tone(120, 2.4, { type: 'sawtooth', vol: 0.14, slide: 1800, lp: 3500, attack: 0.4 }),
  coin: () => { tone(1319, 0.06, { type: 'square', vol: 0.08 }); tone(1760, 0.2, { type: 'square', vol: 0.08, when: 0.06 }); },
  medal: () => [659, 784, 988, 1319].forEach((f, i) => tone(f, 0.4, { type: 'triangle', vol: 0.18, when: i * 0.09 })),
  liftoff: () => { noise(9, { freq: 200, slide: 1400, vol: 0.9, attack: 1.2 }); tone(45, 8, { type: 'sawtooth', vol: 0.3, slide: 90, lp: 300, attack: 1 }); },
  boing: () => tone(200, 0.4, { type: 'sine', vol: 0.3, slide: 900, vib: [18, 60] }),
  fireworks: () => { for (let i = 0; i < 6; i++) { const w = i * 0.35 + Math.random() * 0.2; tone(rnd(800, 1400), 0.6, { vol: 0.05, slide: 3000, when: w }); noise(0.5, { freq: 2500, vol: 0.35, when: w + 0.6 }); } },
};

// Techno drum kit and bass.
function kick(when, v, pan) {
  tone(150, 0.32, { vol: 0.85 * v, slide: 42, slideT: 0.11, when, pan });
  noise(0.012, { type: 'highpass', freq: 3000, vol: 0.25 * v, when, pan });
}
function clap(when, v, pan) {
  for (let i = 0; i < 3; i++) noise(0.025, { type: 'bandpass', freq: 1400, q: 1.5, vol: 0.32 * v, when: when + i * 0.011, pan });
  noise(0.16, { type: 'bandpass', freq: 1200, q: 1.2, vol: 0.22 * v, when: when + 0.033, pan });
}
// One acid bass note: a sawtooth through a resonant low-pass that snaps open and shut.
// 'sweep' (0..1) slowly opens the filter over the phrase, like turning the cutoff knob.
function acid(freq, dur, when, v, sweep, pan) {
  const a = ctx(); if (!a) return;
  const t = a.currentTime + when;
  const osc = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain();
  osc.type = 'sawtooth'; osc.frequency.setValueAtTime(freq, t);
  f.type = 'lowpass'; f.Q.value = 14;
  const top = 600 + sweep * 2200;
  f.frequency.setValueAtTime(180, t); f.frequency.exponentialRampToValueAtTime(top, t + 0.015); f.frequency.exponentialRampToValueAtTime(220, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16 * v, t + 0.004);
  g.gain.setValueAtTime(0.16 * v, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(f).connect(g).connect(out(pan));
  osc.start(t); osc.stop(t + dur + 0.05);
}

// Stop the same sound piling up when 50 archers shoot at once.
const lastPlay = new Map();
const GAP = { prop: 1800, jet: 2000, flak: 70, bombs: 250, bat: 90, pop: 80, jingle: 200, horn: 900, oompah: 1300, techno: 3800, disco: 800, sword: 70, bow: 60, gun: 45, mg: 120, cannon: 160, catapult: 150, rocket: 160, tower: 90, hit: 40, grunt: 90, scream: 4000, moo: 600, explode: 120, collapse: 300, ribbit: 150, mutant: 1500 };

function play(name, o) {
  if (cfg.muted || !S[name]) return;
  if (!ctx()) return;
  const now = performance.now(), gap = GAP[name] || 30;
  if (now - (lastPlay.get(name) || 0) < gap) return;
  lastPlay.set(name, now);
  S[name](o);
}

// Where the camera is, for sounds that come from a place in the world.
const listener = { x: 0, y: 0, w: 30 };
export function setListener(x, y, w) { listener.x = x; listener.y = y; listener.w = w; }

export const sfx = {
  unlock() { ctx(); music.check(); },
  play,
  // Play a sound coming from map position (x, y): quieter when far away, panned left/right.
  at(name, x, y, vol = 1) {
    const dx = x - listener.x, dy = y - listener.y;
    const d = Math.sqrt(dx * dx + dy * dy) / listener.w;
    const v = vol * Math.max(0, 1 - Math.max(0, d - 0.35) * 1.4);
    if (v < 0.06) return;
    play(name, { v, pan: (dx / listener.w) * 1.2 });
  },
  click: () => play('click'),
  error: () => play('error'),
  done: () => play('done'),
  attack: () => play('alarm'),
  age: () => play('age'),
  boom: () => play('explode', { v: 1 }),
  siren: () => play('siren'),
  nuke: () => play('nuke'),
};

// ---------- spoken lines ----------
let voices = [];
function loadVoices() {
  try { voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)); } catch { voices = []; }
}
if (window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
let announcerBusyUntil = 0;

// who: 'announcer' or a number (any number; the same number picks the same voice).
export function say(text, who = 'announcer', o = {}) {
  if (!cfg.voice || cfg.muted || !window.speechSynthesis || !text) return;
  try {
    const now = performance.now();
    const isAnn = who === 'announcer';
    if (!isAnn && now < announcerBusyUntil) return; // don't talk over the announcer
    if ((!isAnn && !o.noCancel) || o.interrupt) speechSynthesis.cancel();
    else if (speechSynthesis.pending) return; // don't stack announcements up
    const u = new SpeechSynthesisUtterance(text);
    u.volume = Math.min(1, cfg.vol * 1.2 * (o.vol ?? 1));
    if (voices.length) {
      if (isAnn) u.voice = voices.find((v) => /UK English Male|Daniel|Arthur|Male/i.test(v.name)) || voices[0];
      else u.voice = voices[Math.abs(who | 0) % voices.length];
    }
    u.pitch = o.pitch ?? (isAnn ? 0.7 : 1);
    u.rate = o.rate ?? (isAnn ? 0.95 : 1.1);
    if (isAnn) announcerBusyUntil = now + 600 + text.length * 70;
    speechSynthesis.speak(u);
  } catch { /* no speech on this browser */ }
}

// ---------- music ----------
// A little generative tune. Calm in peace time, drums and a minor key in battle.
// Gets a bit faster each age, turns into an oom-pah band during happy hour.
const NOTE = (n) => 440 * 2 ** ((n - 69) / 12);
const PEACE_PROG = [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]];   // I vi IV V
const WAR_PROG = [[0, 3, 7], [-4, 0, 3], [-9, -5, -2], [-2, 2, 5]];     // i VI III VII
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];
const MINOR = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15];

export const music = {
  on: false, step: 0, next: 0, timer: null, intensity: 0, target: 0, age: 0, mode: 'normal', mel: 3, key: 50,
  check() {
    const want = !!(cfg.music > 0 && this.wanted);
    if (want && !this.on && ctx()) this.start();
    else if (!want && this.on) this.stop();
  },
  play() { this.wanted = true; this.check(); },
  stop() {
    this.on = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  },
  start() {
    this.on = true;
    this.next = ac.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 50);
  },
  // 0 = calm, 1 = all-out war
  setIntensity(v) { this.target = Math.max(0, Math.min(1, v)); },
  schedule() {
    if (!ac || ac.state !== 'running') return;
    const bpm = (this.mode === 'happy' ? 132 : 84 + this.age * 7) + this.intensity * 26;
    const sixteenth = 60 / bpm / 4;
    while (this.next < ac.currentTime + 0.25) {
      this.intensity += (this.target - this.intensity) * 0.02;
      this.note(this.step, this.next, sixteenth);
      this.step++;
      this.next += sixteenth;
    }
  },
  note(step, t, len) {
    const war = this.intensity > 0.45;
    const s16 = step % 16, bar = Math.floor(step / 16);
    const prog = war ? WAR_PROG : PEACE_PROG;
    const chord = prog[bar % 4].map((n) => n + this.key);
    const when = t - ac.currentTime;
    const dest = musicBus;
    const v = 0.5;
    if (this.mode === 'happy') {
      // Oom-pah!
      if (s16 % 8 === 0) tone(NOTE(chord[0] - 12), len * 3, { type: 'sawtooth', vol: 0.3 * v, lp: 600, when, dest });
      if (s16 % 8 === 4) for (const n of chord) tone(NOTE(n + 12), len * 2, { type: 'square', vol: 0.06 * v, lp: 2500, when, dest });
      if (s16 % 2 === 0 && Math.random() < 0.6) tone(NOTE(chord[Math.floor(Math.random() * 3)] + 24), len * 1.8, { type: 'triangle', vol: 0.1 * v, when, dest });
      return;
    }
    // pad on each bar
    if (s16 === 0) for (const n of chord) tone(NOTE(n), len * 16, { type: war ? 'sawtooth' : 'triangle', vol: (war ? 0.04 : 0.07) * v, lp: war ? 900 : 1500, attack: 0.4, hold: len * 10, when, dest });
    // bass
    const bassHit = war ? s16 % 2 === 0 : s16 === 0 || s16 === 8 || (s16 === 14 && Math.random() < 0.5);
    if (bassHit) tone(NOTE(chord[0] - 24 + (war && s16 % 4 === 2 ? 12 : 0)), len * (war ? 1.6 : 5), { type: war ? 'sawtooth' : 'triangle', vol: 0.22 * v, lp: war ? 500 : 800, when, dest });
    // melody: a random walk over the scale
    const scale = war ? MINOR : PENTA;
    const density = war ? 0.55 : 0.35;
    if (s16 % 2 === 0 && Math.random() < density) {
      this.mel = Math.max(0, Math.min(scale.length - 1, this.mel + Math.floor(Math.random() * 5) - 2));
      const n = this.key + 12 + scale[this.mel] + (war ? 0 : 0);
      tone(NOTE(n), len * (war ? 1.5 : 3), { type: war ? 'square' : 'sine', vol: (war ? 0.05 : 0.11) * v, lp: 2600, when, dest });
    }
    // drums, louder with intensity
    const dv = Math.max(0, (this.intensity - 0.2) / 0.8) * v;
    if (dv > 0.02) {
      if (s16 % 4 === 0) tone(110, 0.25, { vol: 0.8 * dv, slide: 40, when, dest });
      if (s16 === 4 || s16 === 12) noise(0.18, { type: 'bandpass', freq: 1800, q: 0.8, vol: 0.5 * dv, when, dest });
      if (s16 % 2 === 0) noise(0.04, { type: 'highpass', freq: 7000, vol: 0.25 * dv, when, dest });
      if (war && s16 === 15 && Math.random() < 0.4) for (let i = 0; i < 3; i++) noise(0.1, { type: 'bandpass', freq: 1200 - i * 200, vol: 0.4 * dv, when: when + i * len / 3, dest });
    } else if (s16 % 4 === 2) noise(0.05, { type: 'highpass', freq: 6000, vol: 0.05 * v, when, dest }); // shaker
    if (s16 === 0 && bar % 8 === 0) this.key = 48 + [0, 2, 5, 7][Math.floor(Math.random() * 4)];
  },
};
