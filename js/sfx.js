// Tiny sound effects made with the Web Audio API (no sound files needed).
let ac = null;
let muted = localStorage.getItem('ron-muted') === '1';

function ctx() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

export function isMuted() { return muted; }
export function toggleMute() { muted = !muted; localStorage.setItem('ron-muted', muted ? '1' : '0'); return muted; }

function tone(freq, dur, type = 'sine', vol = 0.15, when = 0, slideTo = null) {
  const a = ctx(); if (!a || muted) return;
  const t = a.currentTime + when;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.05);
}

function noise(dur, vol = 0.4, lp = 800, when = 0) {
  const a = ctx(); if (!a || muted) return;
  const t = a.currentTime + when;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
  const g = a.createGain(); g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination); src.start(t);
}

export const sfx = {
  unlock() { ctx(); },
  click() { tone(660, 0.05, 'square', 0.04); },
  error() { tone(200, 0.12, 'square', 0.05); },
  attack() { tone(520, 0.12, 'triangle', 0.12); tone(390, 0.18, 'triangle', 0.12, 0.13); },
  done() { tone(880, 0.08, 'sine', 0.08); tone(1320, 0.12, 'sine', 0.08, 0.08); },
  age() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, i * 0.12)); },
  boom() { noise(0.6, 0.35, 600); },
  siren() { for (let i = 0; i < 4; i++) tone(500, 0.45, 'sawtooth', 0.07, i * 0.5, 900); },
  nuke() { noise(4, 0.9, 300); noise(1.2, 0.6, 2000); tone(50, 3, 'sine', 0.5, 0, 25); },
};
