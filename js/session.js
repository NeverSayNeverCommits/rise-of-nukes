// Runs a game session: lobby, then the lockstep game loop.
//
// How multiplayer works (host-relayed lockstep):
//  - Every browser runs the same deterministic simulation.
//  - Players send their commands ("move these units there") to the host.
//  - Every 50 ms the host bundles all commands it got into a "turn", sends it to everyone and runs it.
//  - Clients run turns in order as they arrive. Same commands + same code = same game everywhere.
//  - Every few seconds clients send a checksum. If it ever differs, the host sends a full copy of
//    the game state to fix it.
import { World, TICK_MS, defaultSettings } from './sim/sim.js';
import { PLAYER_COLORS } from './sim/data.js';
import { HostNet, ClientNet } from './net.js';

export const VERSION = 1;
const HASH_EVERY = 100; // ticks (5 seconds)
export const MAX_PLAYERS = 8;

// A timer in a Web Worker keeps ticking even when the tab is in the background
// (normal timers get slowed to once per second there, which would freeze everyone's game).
function makeTimer(ms, fn) {
  try {
    const src = 'let id;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = fn;
    w.postMessage(ms);
    return () => w.terminate();
  } catch {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }
}

export class Session {
  // mode: 'host' | 'client' | 'solo'
  // ui: callbacks { onLobby, onStart, onChat, onStatus, onError, onDisconnected }
  constructor(mode, name, ui) {
    this.mode = mode;
    this.name = name;
    this.ui = ui;
    this.world = null;
    this.me = 0;
    this.queue = [];      // client: turns waiting to run
    this.pending = [];    // host: commands for the next turn
    this.hashes = new Map();
    this.lastStep = performance.now();
    this.stopTimer = null;
    this.settings = defaultSettings();
    this.lobby = { players: [], settings: this.settings };
  }

  get isHost() { return this.mode !== 'client'; }

  // ---------- host / solo ----------

  host() {
    this.lobby.players = [{ name: this.name, color: PLAYER_COLORS[0], team: 0, conn: null, online: true }];
    if (this.mode === 'solo') { this.ui.onLobby(this.publicLobby(), 0); return; }
    this.net = new HostNet({
      onReady: (code) => { this.code = code; this.ui.onStatus(`Room ready. Code: ${code}`); this.ui.onLobby(this.publicLobby(), 0); },
      onJoin: () => {},
      onMessage: (cid, msg) => this.hostMsg(cid, msg),
      onLeave: (cid) => this.hostLeave(cid),
      onError: (t) => this.ui.onError(t),
    });
  }

  publicLobby() {
    return {
      code: this.code,
      players: this.lobby.players.map((p) => ({ name: p.name, color: p.color, team: p.team, online: p.online })),
      settings: this.lobby.settings,
      started: !!this.world,
    };
  }

  pushLobby() {
    const lob = this.publicLobby();
    if (this.net) this.lobby.players.forEach((p, i) => { if (p.conn) this.net.send(p.conn, { t: 'lobby', lobby: lob, you: i }); });
    this.ui.onLobby(lob, this.me);
  }

  slotOf(cid) { return this.lobby.players.findIndex((p) => p.conn === cid); }

  hostMsg(cid, msg) {
    const slot = this.slotOf(cid);
    switch (msg.t) {
      case 'hello': {
        if (msg.v !== VERSION) { this.net.send(cid, { t: 'reject', why: 'Different game version. Everyone should reload the page.' }); return; }
        const name = String(msg.name || 'Player').slice(0, 16);
        if (this.world) {
          // Rejoin: match a player with the same name. Prefer one that is offline; if the old
          // connection still looks alive (closing a tab can take a while to notice), take it over.
          let i = this.lobby.players.findIndex((p) => !p.online && p.name === name);
          if (i < 0) i = this.lobby.players.findIndex((p, k) => k !== this.me && p.name === name);
          if (i < 0) { this.net.send(cid, { t: 'reject', why: 'Game already started. To rejoin, use the same name you had.' }); return; }
          const p = this.lobby.players[i];
          if (p.conn && p.conn !== cid) { const old = p.conn; p.conn = null; this.net.kick(old); }
          p.conn = cid; p.online = true;
          this.net.send(cid, { t: 'start', setup: this.world.setup, you: i, resync: true });
          this.sendSnapshot(cid);
          this.sys(`${name} rejoined.`);
          return;
        }
        if (this.lobby.players.length >= MAX_PLAYERS) { this.net.send(cid, { t: 'reject', why: 'Game is full.' }); return; }
        let nm = name, k = 2;
        while (this.lobby.players.some((p) => p.name === nm)) nm = `${name}${k++}`;
        const used = new Set(this.lobby.players.map((p) => p.color));
        const color = PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[0];
        const usedTeams = new Set(this.lobby.players.map((p) => p.team));
        let team = 0; while (usedTeams.has(team)) team++;
        this.lobby.players.push({ name: nm, color, team, conn: cid, online: true });
        this.sys(`${nm} joined.`);
        this.pushLobby();
        return;
      }
      case 'lobby-set': {
        if (slot < 0 || this.world) return;
        this.setPlayer(slot, msg);
        return;
      }
      case 'cmd': {
        if (slot < 0 || !this.world || !msg.cmd) return;
        const cmd = msg.cmd; cmd.p = slot;
        this.pending.push(cmd);
        return;
      }
      case 'hash': {
        const h = this.hashes.get(msg.n);
        if (h != null && h !== msg.h) {
          console.warn(`Player ${slot} out of sync at tick ${msg.n}, sending a full state`);
          this.sendSnapshot(cid);
        }
        return;
      }
      case 'needsnap': this.sendSnapshot(cid); return;
      case 'chat': {
        if (slot < 0) return;
        this.chat(slot, String(msg.text || '').slice(0, 200));
        return;
      }
    }
  }

  hostLeave(cid) {
    const i = this.slotOf(cid);
    if (i < 0) return;
    const p = this.lobby.players[i];
    if (!this.world) {
      this.lobby.players.splice(i, 1);
      this.sys(`${p.name} left.`);
      this.pushLobby();
    } else {
      p.online = false; p.conn = null;
      this.sys(`${p.name} disconnected. They can rejoin with the same name and code.`);
      this.ui.onLobby(this.publicLobby(), this.me);
    }
  }

  setPlayer(slot, v) {
    const p = this.lobby.players[slot];
    if (!p) return;
    if (typeof v.color === 'string' && PLAYER_COLORS.includes(v.color)) p.color = v.color;
    if (Number.isInteger(v.team) && v.team >= 0 && v.team < MAX_PLAYERS) p.team = v.team;
    this.pushLobby();
  }

  setSettings(s) {
    if (!this.isHost || this.world) return;
    Object.assign(this.lobby.settings, s);
    this.pushLobby();
  }

  // Change own colour/team (works for host and client).
  setMine(v) {
    if (this.isHost) this.setPlayer(this.me, v);
    else this.net.send({ t: 'lobby-set', ...v });
  }

  kick(slot) {
    const p = this.lobby.players[slot];
    if (!this.isHost || !p || !p.conn || this.world) return;
    this.net.send(p.conn, { t: 'reject', why: 'You were removed from the lobby.' });
    setTimeout(() => this.net.kick(p.conn), 300);
  }

  startGame() {
    if (!this.isHost || this.world) return;
    const seed = (crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff) | 1;
    const setup = {
      seed,
      players: this.lobby.players.map((p) => ({ name: p.name, color: p.color, team: p.team })),
      settings: { ...this.lobby.settings },
    };
    this.lobby.players.forEach((p, i) => { if (p.conn) this.net.send(p.conn, { t: 'start', setup, you: i }); });
    this.begin(setup, 0);
  }

  begin(setup, me) {
    this.world = new World(setup);
    this.me = me;
    this.ui.onStart(this.world, me);
    this.lastStep = performance.now();
    this.stopTimer = makeTimer(TICK_MS, () => this.onTimer());
  }

  sendSnapshot(cid) {
    if (!this.world) return;
    this.net.send(cid, { t: 'snap', n: this.world.s.tick, state: this.world.serialize() });
  }

  onTimer() {
    if (!this.world) return;
    if (this.isHost) {
      const cmds = this.pending; this.pending = [];
      const n = this.world.s.tick + 1;
      if (this.net) this.net.broadcast({ t: 'turn', n, c: cmds });
      this.stepWorld(cmds);
      if (n % HASH_EVERY === 0) {
        this.hashes.set(n, this.world.hash());
        this.hashes.delete(n - HASH_EVERY * 30);
      }
    } else {
      if (this.waitSnap) return;
      let k = this.queue.length > 4 ? this.queue.length - 2 : 1;
      k = Math.min(k, 60);
      while (k-- > 0 && this.queue.length) {
        const turn = this.queue.shift();
        if (turn.n <= this.world.s.tick) continue;
        if (turn.n !== this.world.s.tick + 1) {
          // Missed a turn somehow; ask for a full state.
          this.queue = []; this.waitSnap = true;
          this.net.send({ t: 'needsnap' });
          return;
        }
        this.stepWorld(turn.c);
        if (turn.n % HASH_EVERY === 0) this.net.send({ t: 'hash', n: turn.n, h: this.world.hash() });
      }
    }
  }

  stepWorld(cmds) {
    this.world.step(cmds);
    this.lastStep = performance.now();
  }

  // Interpolation factor for smooth drawing between ticks.
  alpha() {
    return Math.max(0, Math.min(1, (performance.now() - this.lastStep) / TICK_MS));
  }

  // Send a game command from the local player.
  send(cmd) {
    if (!this.world || this.world.s.over) return;
    if (this.isHost) { cmd.p = this.me; this.pending.push(cmd); }
    else this.net.send({ t: 'cmd', cmd });
  }

  sendChat(text) {
    text = text.trim();
    if (!text) return;
    if (this.isHost) this.chat(this.me, text);
    else this.net.send({ t: 'chat', text });
  }

  chat(slot, text) {
    const msg = { t: 'chat', p: slot, name: this.lobby.players[slot]?.name, color: this.lobby.players[slot]?.color, text };
    if (this.net) this.net.broadcast(msg);
    this.ui.onChat(msg);
  }

  sys(text) {
    const msg = { t: 'chat', p: -1, name: '', text };
    if (this.net) this.net.broadcast(msg);
    this.ui.onChat(msg);
  }

  // ---------- client ----------

  join(code) {
    this.code = code.toUpperCase();
    this.net = new ClientNet(this.code, {
      onOpen: () => { this.net.send({ t: 'hello', name: this.name, v: VERSION }); this.ui.onStatus('Connected. Waiting for the host…'); },
      onMessage: (msg) => this.clientMsg(msg),
      onClose: () => this.ui.onDisconnected(),
      onError: (t) => this.ui.onError(t),
    });
  }

  clientMsg(msg) {
    switch (msg.t) {
      case 'lobby': this.me = msg.you; this.lobby = msg.lobby; this.ui.onLobby(msg.lobby, msg.you); return;
      case 'reject': this.ui.onError(msg.why); this.net.close(); return;
      case 'start':
        if (msg.resync) this.waitSnap = true;
        this.begin(msg.setup, msg.you);
        return;
      case 'snap': {
        if (!this.world) return;
        this.world.load(msg.state);
        this.queue = this.queue.filter((t) => t.n > msg.n);
        this.waitSnap = false;
        this.lastStep = performance.now();
        this.ui.onResync && this.ui.onResync();
        return;
      }
      case 'turn': this.queue.push(msg); return;
      case 'chat': this.ui.onChat(msg); return;
    }
  }

  leave() {
    if (this.stopTimer) this.stopTimer();
    if (this.net) this.net.close();
  }
}
