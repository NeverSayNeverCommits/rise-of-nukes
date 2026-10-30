// Deterministic random numbers. Only integer math, so every browser gets the same results.

export function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// mulberry32 step. Takes and returns the state so it can live inside the game state.
export function nextRand(stateObj) {
  let t = (stateObj.rng = (stateObj.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function makeRand(seed) {
  const s = { rng: seed | 0 };
  return () => nextRand(s);
}
