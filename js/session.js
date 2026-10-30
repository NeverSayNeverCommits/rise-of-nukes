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
import { NATION_KEYS } from './sim/nations.js';
import { HostNet, ClientNet } from './net.js';
import { Bot, BOT_LEVELS, botName } from './bot.js';

export const VERSION = 5;
export const SPEEDS = [1, 1.25, 1.5, 2];
// Closing a tab can take a long time to show up as a closed connection, so everyone also says
// "still here" every few seconds. Silence for this long counts as gone.
const HEARTBEAT_MS = 4000, SILENCE_MS = 20000;
const TAKEOVER_SECS = 45; // a bot plays for someone who has dropped out, until they come back
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
    this.bots = new Map();  // host: slot -> Bot
    this.takeovers = new Map(); // host: slot -> timer for a bot to step in
    this.paused = false;
    this.speed = 1;
  }

  get isHost() { return this.mode !== 'client'; }

  // ---------- host / solo ----------

  host() {
    this.lobby.players = [{ name: this.name, color: PLAYER_COLORS[0], team: 0, nation: localStorage.getItem('ron-nation') || 'random', conn: null, online: true }];
    if (this.mode === 'solo') { this.addBot('normal'); return; }
    this.startHeartbeat();
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
      players: this.lobby.players.map((p) => ({ name: p.name, color: p.color, team: p.team, nation: p.nation, online: p.online, bot: p.bot || null })),
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

  // Everyone tells everyone they are still there. Host: spot players who went silent. Client: spot a silent host.
  startHeartbeat() {
    this.lastHeard = performance.now();
    this.heartbeat = setInterval(() => {
      const now = performance.now();
      if (this.isHost) {
        this.net.broadcast({ t: 'ka' });
        if (!this.world) return;
        this.lobby.players.forEach((p, i) => {
          if (p.conn && p.online && now - (p.seen || now) > SILENCE_MS) this.markSilent(i);
          else if (p.conn && !p.seen) p.seen = now;
        });
      } else {
        this.net.send({ t: 'ka' });
        if (this.world && !this.hostLost && now - this.lastHeard > SILENCE_MS) { this.hostLost = true; this.ui.onDisconnected(); }
      }
    }, HEARTBEAT_MS);
  }
  markSilent(i) {
    const p = this.lobby.players[i];
    p.online = false;
    this.sys(`${p.name} has gone quiet. They can rejoin with the same name and code. A bot takes over in ${TAKEOVER_SECS} seconds.`);
    this.startTakeover(i);
    this.pushLobby();
  }

  hostMsg(cid, msg) {
    const slot = this.slotOf(cid);
    if (slot >= 0) {
      // Heard from them. If they had gone quiet, they're back.
      const p = this.lobby.players[slot];
      p.seen = performance.now();
      if (this.world && !p.online) {
        p.online = true;
        this.endTakeover(slot);
        this.sys(`${p.name} is back.`);
        this.pushLobby();
      }
    }
    if (msg.t === 'ka') return;
    switch (msg.t) {
      case 'hello': {
        if (msg.v !== VERSION) { this.net.send(cid, { t: 'reject', why: 'Different game version. Everyone should reload the page.' }); return; }
        const name = String(msg.name || 'Player').slice(0, 16);
        if (this.world) {
          // Rejoin: match a player with the same name. Prefer one that is offline; if the old
          // connection still looks alive (closing a tab can take a while to notice), take it over.
          let i = this.lobby.players.findIndex((p) => !p.bot && !p.online && p.name === name);
          if (i < 0) i = this.lobby.players.findIndex((p, k) => !p.bot && k !== this.me && p.name === name);
          if (i < 0) { this.net.send(cid, { t: 'reject', why: 'Game already started. To rejoin, use the same name you had.' }); return; }
          const p = this.lobby.players[i];
          if (p.conn && p.conn !== cid) { const old = p.conn; p.conn = null; this.net.kick(old); }
          p.conn = cid; p.online = true;
          this.net.send(cid, { t: 'start', setup: this.world.setup, you: i, resync: true });
          this.sendSnapshot(cid);
          this.net.send(cid, { t: 'speed', x: this.speed });
          if (this.paused) this.net.send(cid, { t: 'pause', on: true, name: this.pausedBy });
          this.endTakeover(i);
          this.sys(`${name} rejoined.`);
          this.pushLobby();
          return;
        }
        if (this.lobby.players.length >= MAX_PLAYERS) { this.net.send(cid, { t: 'reject', why: 'Game is full.' }); return; }
        let nm = name, k = 2;
        while (this.lobby.players.some((p) => p.name === nm)) nm = `${name}${k++}`;
        const used = new Set(this.lobby.players.map((p) => p.color));
        const color = PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[0];
        const usedTeams = new Set(this.lobby.players.map((p) => p.team));
        let team = 0; while (usedTeams.has(team)) team++;
        const nation = NATION_KEYS.includes(msg.nation) ? msg.nation : 'random';
        this.lobby.players.push({ name: nm, color, team, nation, conn: cid, online: true });
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
        this.chat(slot, String(msg.text || '').slice(0, 200), !!msg.team);
        return;
      }
      case 'pause': {
        if (slot < 0 || !this.world) return;
        this.setPaused(!!msg.on, this.lobby.players[slot].name);
        return;
      }
      case 'ping': {
        if (slot < 0 || !this.world) return;
        this.relayPing(slot, +msg.x, +msg.y);
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
      this.sys(`${p.name} disconnected. They can rejoin with the same name and code. A bot takes over in ${TAKEOVER_SECS} seconds.`);
      this.startTakeover(i);
      this.pushLobby();
    }
  }

  // If someone drops out, a bot looks after their nation until they come back.
  startTakeover(slot) {
    this.endTakeover(slot);
    this.takeovers.set(slot, setTimeout(() => {
      this.takeovers.delete(slot);
      const p = this.lobby.players[slot];
      if (!this.world || !p || p.online || !this.world.s.players[slot].alive) return;
      this.bots.set(slot, new Bot(this.world, slot, 'normal'));
      this.bots.get(slot).takeover = true;
      this.sys(`🤖 A bot is playing for ${p.name} until they come back.`);
    }, TAKEOVER_SECS * 1000));
  }
  endTakeover(slot) {
    if (this.takeovers.has(slot)) { clearTimeout(this.takeovers.get(slot)); this.takeovers.delete(slot); }
    if (this.bots.get(slot)?.takeover) this.bots.delete(slot);
  }

  // ---------- computer players (host only) ----------
  addBot(level = 'normal') {
    if (!this.isHost || this.world || this.lobby.players.length >= MAX_PLAYERS) return;
    const players = this.lobby.players;
    const used = new Set(players.map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[0];
    const teams = new Set(players.map((p) => p.team));
    let team = 0; while (teams.has(team)) team++;
    const nation = NATION_KEYS[Math.floor(Math.random() * NATION_KEYS.length)];
    players.push({ name: botName(nation, players.map((p) => p.name)), color, team, nation, conn: null, online: true, bot: BOT_LEVELS[level] ? level : 'normal' });
    this.pushLobby();
  }

  // The host changes a bot's nation, team, colour or difficulty.
  setBot(slot, v) {
    const p = this.lobby.players[slot];
    if (!this.isHost || this.world || !p || !p.bot) return;
    if (BOT_LEVELS[v.level]) p.bot = v.level;
    this.setPlayer(slot, v);
  }

  setPlayer(slot, v) {
    const p = this.lobby.players[slot];
    if (!p) return;
    if (typeof v.color === 'string' && PLAYER_COLORS.includes(v.color)) p.color = v.color;
    if (Number.isInteger(v.team) && v.team >= 0 && v.team < MAX_PLAYERS) p.team = v.team;
    if (v.nation === 'random' || NATION_KEYS.includes(v.nation)) p.nation = v.nation;
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
    if (!this.isHost || !p || this.world) return;
    if (p.bot) { this.lobby.players.splice(slot, 1); this.pushLobby(); return; }
    if (!p.conn) return;
    this.net.send(p.conn, { t: 'reject', why: 'You were removed from the lobby.' });
    setTimeout(() => this.net.kick(p.conn), 300);
  }

  startGame() {
    if (!this.isHost || this.world) return;
    const seed = (crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff) | 1;
    const setup = {
      seed,
      // 'Random' is decided here, on the host, so everyone gets the same answer.
      players: this.lobby.players.map((p) => ({
        name: p.name, color: p.color, team: p.team, bot: p.bot || undefined,
        nation: NATION_KEYS.includes(p.nation) ? p.nation : NATION_KEYS[Math.floor(Math.random() * NATION_KEYS.length)],
      })),
      settings: { ...this.lobby.settings },
    };
    this.lobby.players.forEach((p, i) => { if (p.conn) this.net.send(p.conn, { t: 'start', setup, you: i }); });
    this.begin(setup, 0);
  }

  begin(setup, me) {
    this.world = new World(setup);
    this.me = me;
    this.paused = false;
    this.speed = SPEEDS.includes(+this.world.settings.speed) ? +this.world.settings.speed : 1;
    this.bots = new Map();
    if (this.isHost) setup.players.forEach((p, i) => { if (p.bot) this.bots.set(i, new Bot(this.world, i, p.bot)); });
    this.ui.onStart(this.world, me);
    this.lastStep = performance.now();
    this.startTimer();
  }

  startTimer() {
    if (this.stopTimer) this.stopTimer();
    this.stopTimer = makeTimer(TICK_MS / this.speed, () => this.onTimer());
  }

  // ---------- pause and game speed ----------
  togglePause() {
    if (!this.world || this.world.s.over) return;
    if (this.isHost) this.setPaused(!this.paused, this.lobby.players[this.me]?.name);
    else this.net.send({ t: 'pause', on: !this.paused });
  }
  setPaused(on, name) {
    if (this.paused === on) return;
    this.paused = on; this.pausedBy = name;
    if (this.net) this.net.broadcast({ t: 'pause', on, name });
    this.lastStep = performance.now();
    this.ui.onPause && this.ui.onPause(on, name);
  }
  // Host only. Everyone's timer changes at once.
  setSpeed(x) {
    if (!this.isHost || !this.world || !SPEEDS.includes(x) || x === this.speed) return;
    this.speed = x;
    if (this.net) this.net.broadcast({ t: 'speed', x });
    this.startTimer();
    this.ui.onSpeed && this.ui.onSpeed(x);
  }

  // ---------- pings to allies ----------
  sendPing(x, y) {
    if (!this.world) return;
    if (this.isHost) this.relayPing(this.me, x, y);
    else this.net.send({ t: 'ping', x, y });
  }
  relayPing(slot, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const msg = { t: 'ping', p: slot, x, y };
    this.toTeam(slot, msg);
    if (this.world.ally(slot, this.me)) this.ui.onPing && this.ui.onPing(msg);
  }
  // Send to the other human players on this player's team.
  toTeam(slot, msg) {
    if (!this.net) return;
    this.lobby.players.forEach((p, i) => { if (p.conn && this.world && this.world.ally(slot, i)) this.net.send(p.conn, msg); });
  }

  // ---------- back to the lobby for another game ----------
  backToLobby() {
    if (!this.isHost || !this.world) return;
    if (this.net) this.net.broadcast({ t: 'lobby-back' });
    this.resetGame();
    // Whoever left doesn't stay in the lobby.
    this.lobby.players = this.lobby.players.filter((p) => p.bot || p.online !== false);
    this.ui.onLobbyBack && this.ui.onLobbyBack();
    this.pushLobby();
  }
  resetGame() {
    if (this.stopTimer) { this.stopTimer(); this.stopTimer = null; }
    for (const t of this.takeovers.values()) clearTimeout(t);
    this.takeovers.clear();
    this.world = null; this.queue = []; this.pending = []; this.bots = new Map(); this.paused = false; this.waitSnap = false;
    this.hashes = new Map();
  }

  sendSnapshot(cid) {
    if (!this.world) return;
    this.net.send(cid, { t: 'snap', n: this.world.s.tick, state: this.world.serialize() });
  }

  onTimer() {
    if (!this.world) return;
    if (this.isHost) {
      if (this.paused) return;
      // Bots think here and send normal commands, so everyone runs them in the same turn.
      for (const [slot, bot] of this.bots) {
        const list = bot.tick(this.world);
        if (list.length) this.pending.push(...list);
        if (bot.taunts.length) this.chat(slot, String(bot.taunts.shift()));
      }
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
    if (this.paused) return 1;
    return Math.max(0, Math.min(1, (performance.now() - this.lastStep) / (TICK_MS / this.speed)));
  }

  // Send a game command from the local player.
  send(cmd) {
    if (!this.world || this.world.s.over) return;
    if (this.isHost) { cmd.p = this.me; this.pending.push(cmd); }
    else this.net.send({ t: 'cmd', cmd });
  }

  sendChat(text, team = false) {
    text = text.trim();
    if (!text) return;
    if (this.isHost) this.chat(this.me, text, team);
    else this.net.send({ t: 'chat', text, team });
  }

  chat(slot, text, team = false) {
    const msg = { t: 'chat', p: slot, name: this.lobby.players[slot]?.name, color: this.lobby.players[slot]?.color, text };
    if (team && this.world) {
      msg.team = true;
      this.toTeam(slot, msg);
      if (this.world.ally(slot, this.me)) this.ui.onChat(msg);
      return;
    }
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
    this.lastHeard = performance.now();
    this.net = new ClientNet(this.code, {
      onOpen: () => { this.startHeartbeat(); this.net.send({ t: 'hello', name: this.name, v: VERSION, nation: localStorage.getItem('ron-nation') || 'random' }); this.ui.onStatus('Connected. Waiting for the host…'); },
      onMessage: (msg) => this.clientMsg(msg),
      onClose: () => this.ui.onDisconnected(),
      onError: (t) => this.ui.onError(t),
    });
  }

  clientMsg(msg) {
    this.lastHeard = performance.now();
    if (this.hostLost) { this.hostLost = false; this.ui.onChat({ p: -1, name: '', text: 'The host is back.' }); }
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
      case 'pause':
        this.paused = !!msg.on; this.pausedBy = msg.name;
        this.lastStep = performance.now();
        this.ui.onPause && this.ui.onPause(this.paused, msg.name);
        return;
      case 'speed':
        this.speed = msg.x;
        if (this.world) this.startTimer();
        this.ui.onSpeed && this.ui.onSpeed(msg.x);
        return;
      case 'ping': this.ui.onPing && this.ui.onPing(msg); return;
      case 'lobby-back':
        this.resetGame();
        this.ui.onLobbyBack && this.ui.onLobbyBack();
        return;
    }
  }

  leave() {
    clearInterval(this.heartbeat);
    if (this.stopTimer) this.stopTimer();
    if (this.net) this.net.close();
  }
}
