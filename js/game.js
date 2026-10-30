// In-game user interface: mouse and keyboard input, the HUD, and alerts.
import { Renderer } from './render.js';
import { UNITS, BLDS, TECHS, TECH_ORDER, AGES, AGE_UP, NUKE, RES, RES_ICON, BUILD_ORDER, cityLimit, forNation, techCost, techTime, UPGRADE, upgradeCost, upgradeTime, GATHER_RATE, gatherMult, WONDERS, MARKET, LASER, tradeRate, techReqs, commerceLevel } from './sim/data.js';
import { SPEEDS } from './session.js';
import { NATIONS, nationOf } from './sim/nations.js';
import { flagImg } from './flags.js';
import { DT } from './sim/sim.js';
import { sfx, toggleMute, say, music, setListener, audioSettings, setAudio } from './sfx.js';
import { unitName, cowMood, lineFor, specialLine, pokeLine, cityPokeLine, TAUNTS, CRATE_TEXT, STREAK, awards, rankIcon } from './flavor.js';
import { SILLY } from './sim/extras.js';

// Which built-in voice each unit type uses (any number works, it just picks a voice).
const VOICE = { citizen: 1, infantry: 2, ranged: 3, cavalry: 4, siege: 5, oompah: 6, scooter: 7, jeepney: 8, bowler: 9 };
const PITCH = { citizen: 1.25, infantry: 0.95, ranged: 1.1, cavalry: 0.85, siege: 0.7, oompah: 0.75, scooter: 1.35, jeepney: 1.05, bowler: 1.0 };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.floor(n).toLocaleString('en');
const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
const costHtml = (cost, res) => Object.entries(cost).map(([k, v]) => `<span class="${res && res[k] < v ? 'need' : ''}">${RES_ICON[k]} ${v}</span>`).join(' ');

export class GameUI {
  constructor(session, onQuit) {
    this.session = session;
    this.world = session.world;
    this.me = session.me;
    this.onQuit = onQuit;
    this.canvas = $('view');
    this.r = new Renderer(this.canvas, this.world, this.me);
    this.sel = new Set();
    this.groups = new Map();
    this.mode = null;
    this.mouse = { x: -1, y: -1, inside: false, down: null, pan: null };
    this.keys = new Set();
    this.hover = 0;
    this.lastAlertPos = null;
    this.alertTimes = new Map();
    this.cardSig = '';
    this.lastHud = 0;
    this.lastMini = 0;
    this.overShown = false;
    this.defeatShown = false;
    this.idleIdx = 0;
    this.homeIdx = 0;
    this.heat = 0;           // how much fighting is going on near me (drives the music)
    this.lastVoice = 0;
    this.pokes = { id: 0, n: 0, t: 0 };
    this.streak = [];        // times of my recent kills
    this.firstBlood = false;
    this.nextMoo = performance.now() + 8000;
    this.lastPhase = '';
    this.cardPage = null;    // 'wonders' while a citizen's wonder page is open
    this.history = [];       // score and army over time, for the end screen
    this.medals = [];        // medals I earned this game
    this.medalIds = new Set();
    this.rocketSaid = {};    // which countdown warnings have been given, per rocket
    this.capSeen = {};       // when each gather limit warning was last shown

    const city = this.world.s.blds.find((b) => b.owner === this.me && b.type === 'city');
    if (city) this.r.centreOn(city.x + 1.5, city.y + 1.5);
    this.bind();
    this.onSpeed(session.speed || 1, true);
    this.onPause(!!session.paused, session.pausedBy);
    music.play();
    // Who is who.
    const nat = nationOf(this.pl);
    setTimeout(() => {
      this.chatLine({ p: -1, text: `You lead ${nat.name}. “${nat.motto}”` });
      const others = this.world.s.players.filter((_, i) => i !== this.me).map((p) => `${p.name} (${nationOf(p).name})`);
      if (others.length) this.chatLine({ p: -1, text: `Also here: ${others.join(', ')}.` });
    }, 50);
    this.running = true;
    requestAnimationFrame((t) => this.loop(t));
  }

  destroy() {
    this.running = false;
    music.stop();
    clearTimeout(this.bannerTimer);
    for (const id of ['game-over', 'game-menu', 'rocket-clock', 'banner', 'pause-note', 'tooltip']) $(id).classList.add('hidden');
    for (const [el, ev, fn, opt] of this.listeners) el.removeEventListener(ev, fn, opt);
  }

  // ---------- helpers ----------
  get s() { return this.world.s; }
  get pl() { return this.s.players[this.me]; }
  send(cmd) { this.session.send(cmd); }
  selected() { return [...this.sel].map((id) => this.world.get(id)).filter((e) => e); }
  mineSel() { return this.selected().filter((e) => e.owner === this.me); }

  pick(sx, sy) {
    const [wx, wy] = this.r.toWorld(sx, sy);
    const w = this.world;
    let best = null, bd = 1e9;
    // Planes are drawn up in the sky, so click where they are drawn.
    for (const [id, [px, py]] of this.r.planeAt) {
      const u = w.get(id);
      if (!u || u.hp <= 0) continue;
      const dx = px - wx, dy = py - wy, d = dx * dx + dy * dy, rr = UNITS[u.type].radius * 1.6 + 0.2;
      if (d < rr * rr && d < bd) { bd = d; best = u; }
    }
    if (best) return best;
    for (const u of this.s.units) {
      if (UNITS[u.type].air) continue;
      if (!w.ally(this.me, u.owner) && !this.r.isVisible(u.x, u.y)) continue;
      const dx = u.x - wx, dy = u.y - wy, d = dx * dx + dy * dy;
      const rr = UNITS[u.type].radius + 0.25;
      if (d < rr * rr && d < bd) { bd = d; best = u; }
    }
    if (best) return best;
    for (const c of this.s.critters || []) {
      if (!this.r.isVisible(c.x, c.y)) continue;
      const dx = c.x - wx, dy = c.y - wy, d = dx * dx + dy * dy;
      const rr = (c.mutant ? 0.5 : 0.35) + 0.3;
      if (d < rr * rr && d < bd) { bd = d; best = c; }
    }
    if (best) return best;
    for (const b of this.s.blds) {
      if (wx >= b.x && wx < b.x + b.size && wy >= b.y && wy < b.y + b.size) {
        if (!w.ally(this.me, b.owner) && !this.r.isExplored(wx, wy)) continue;
        return b;
      }
    }
    return null;
  }

  // ---------- input ----------
  bind() {
    this.listeners = [];
    const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); this.listeners.push([el, ev, fn, opt]); };
    const cv = this.canvas;
    on(window, 'resize', () => this.r.resize());
    on(cv, 'contextmenu', (e) => e.preventDefault());
    on(cv, 'mousedown', (e) => this.onDown(e));
    on(window, 'mousemove', (e) => this.onMove(e));
    on(window, 'mouseup', (e) => this.onUp(e));
    on(cv, 'dblclick', (e) => this.onDbl(e));
    on(cv, 'wheel', (e) => this.onWheel(e), { passive: false });
    // When the mouse leaves the window past an edge (e.g. up onto the browser tabs), keep scrolling that way
    // until it comes back. This makes edge scrolling work in a normal browser window, not just fullscreen.
    on(window, 'mouseout', (e) => {
      if (e.relatedTarget) return; // still inside the page
      const m = this.mouse, edge = 40;
      m.out = null;
      if (localStorage.getItem('ron-edge') !== '0' && m.inside && document.hasFocus()) {
        const ox = m.x < edge ? -1 : m.x > this.r.vw - edge ? 1 : 0, oy = m.y < edge ? -1 : m.y > this.r.vh - edge ? 1 : 0;
        if (ox || oy) m.out = [ox, oy];
      }
      m.inside = false;
    });
    on($('btn-full'), 'click', () => this.toggleFullscreen());
    on(window, 'blur', () => { this.keys.clear(); this.mouse.inside = false; this.mouse.out = null; });
    on(window, 'keydown', (e) => this.onKey(e));
    on(window, 'keyup', (e) => this.keys.delete(e.key));
    const mm = $('minimap');
    const mmMove = (e) => {
      const rect = mm.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * this.world.W, y = ((e.clientY - rect.top) / rect.height) * this.world.H;
      return [x, y];
    };
    on(mm, 'mousedown', (e) => {
      e.preventDefault();
      const [x, y] = mmMove(e);
      if (e.button === 2) { this.contextAt(x, y, null, e.shiftKey); return; }
      if (e.altKey) { this.pingAt(x, y); return; }
      if (this.mode && this.mode.k === 'target') { this.targetAt(x, y, e.shiftKey); return; }
      this.r.centreOn(x, y); this.mouse.mm = true;
    });
    on(mm, 'mousemove', (e) => { if (this.mouse.mm) { const [x, y] = mmMove(e); this.r.centreOn(x, y); } });
    on(mm, 'contextmenu', (e) => e.preventDefault());
    on($('btn-idle'), 'click', () => this.nextIdle());
    on($('btn-menu'), 'click', () => this.toggleMenu(true));
    on($('btn-resume'), 'click', () => this.toggleMenu(false));
    on($('btn-resign'), 'click', () => {
      if (confirm('Resign? Your cities and units will be destroyed.')) { this.send({ c: 'resign' }); this.toggleMenu(false); }
    });
    on($('btn-quit'), 'click', () => { if (confirm('Quit to the main menu?')) this.onQuit(); });
    on($('btn-over-quit'), 'click', () => this.onQuit());
    on($('btn-over-again'), 'click', () => this.session.backToLobby());
    on($('btn-pause'), 'click', () => this.session.togglePause());
    on($('btn-speed'), 'click', () => {
      if (!this.session.isHost) { this.alert('Only the host can change the game speed', 'info'); return; }
      this.session.setSpeed(SPEEDS[(SPEEDS.indexOf(this.session.speed) + 1) % SPEEDS.length]);
    });
    on($('rocket-clock'), 'click', () => { if (this.rocketPos) this.r.centreOn(...this.rocketPos); });
    on($('score-table'), 'click', (e) => {
      const g = e.target.closest('.gift');
      if (!g) return;
      sfx.click();
      this.send({ c: 'gift', to: +g.dataset.to, res: g.dataset.res, amt: 100 });
    });
    on($('btn-over-watch'), 'click', () => { $('game-over').classList.add('hidden'); this.r.spectate = true; });
    const ci = $('chat-input');
    on(ci, 'keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.moveTaunt(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (e.key === 'Enter') {
        const pick = this.tauntPick;
        if (pick) this.sendTaunt(pick);
        else {
          // "/t hello" goes to your team only.
          const m = ci.value.match(/^\/t(?:eam)?\s+(.+)/i);
          if (m) this.session.sendChat(m[1], true); else this.session.sendChat(ci.value);
          ci.value = ''; this.closeChat();
        }
      }
      if (e.key === 'Escape') this.closeChat();
    });
    on(ci, 'input', () => { this.tauntPick = 0; this.renderTaunts(); });
    on($('btn-taunts'), 'click', () => { if ($('chat-input').classList.contains('hidden')) this.openChat(); else this.closeChat(); });
    const tl = $('taunts');
    on(tl, 'mousedown', (e) => e.preventDefault()); // keep the cursor in the chat box
    on(tl, 'click', (e) => {
      const row = e.target.closest('.taunt');
      if (!row) return;
      sfx.unlock();
      if (e.target.closest('.hear')) this.hearTaunt(+row.dataset.n);
      else this.sendTaunt(+row.dataset.n);
    });
    on($('cmd-card'), 'mouseover', (e) => this.showTip(e));
    on($('cmd-card'), 'mouseout', () => $('tooltip').classList.add('hidden'));
    on($('cmd-card'), 'click', (e) => {
      const btn = e.target.closest('.cmd');
      const a = btn && this.cardActions[btn.dataset.i];
      if (!a) return;
      if (!a.enabled) { this.alert(a.need, 'bad'); sfx.error(); return; }
      sfx.click(); a.fn(e.shiftKey);
    });
    on($('sel-info'), 'click', (e) => {
      const q = e.target.closest('.qitem');
      if (q) { this.send({ c: 'cancel', b: +q.dataset.b, i: +q.dataset.i }); return; }
      const mu = e.target.closest('.mu');
      if (mu) {
        const ids = mu.dataset.ids.split(',').map(Number);
        if (e.shiftKey) ids.forEach((id) => this.sel.delete(id));
        else this.sel = new Set(ids);
      }
    });
  }

  openChat() {
    const ci = $('chat-input'); ci.classList.remove('hidden'); $('chat-log').classList.add('open'); ci.focus();
    this.tauntPick = 0; this.renderTaunts();
  }
  closeChat() {
    const ci = $('chat-input'); ci.classList.add('hidden'); $('chat-log').classList.remove('open'); ci.blur();
    $('taunts').classList.add('hidden');
  }

  // The taunts that match what's typed in the chat box: by number ("1" finds 1, 10-19) or by words.
  tauntMatches() {
    const q = $('chat-input').value.trim().toLowerCase();
    const all = Object.keys(TAUNTS).map(Number);
    if (!q) return all;
    return /^\d+$/.test(q) ? all.filter((n) => String(n).startsWith(q)) : all.filter((n) => TAUNTS[n].toLowerCase().includes(q));
  }

  renderTaunts() {
    const box = $('taunts'), list = this.tauntMatches(), q = $('chat-input').value.trim();
    box.classList.toggle('hidden', !list.length);
    box.innerHTML = '<div class="taunt-tip">📣 Click to say it to everyone. 🔊 hears it first, only you. ↑↓ and Enter work too.</div><div class="taunt-list">'
      + list.map((n) => `<div class="taunt ${n === this.tauntPick ? 'picked' : ''} ${q === String(n) ? 'exact' : ''}" data-n="${n}"><span class="num">${n}</span><span class="txt">${esc(TAUNTS[n])}</span><button class="hear" title="Hear it first (only you)">🔊</button></div>`).join('')
      + '</div>';
    const row = box.querySelector('.picked');
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  moveTaunt(step) {
    const list = this.tauntMatches();
    if (!list.length) return;
    const i = list.indexOf(this.tauntPick);
    this.tauntPick = list[i < 0 ? (step > 0 ? 0 : list.length - 1) : (i + step + list.length) % list.length];
    this.renderTaunts();
  }

  sendTaunt(n) {
    this.session.sendChat(String(n));
    $('chat-input').value = '';
    this.tauntPick = 0;
    this.closeChat();
  }

  tauntVoice(p) { return { pitch: 0.8 + (p % 4) * 0.15, rate: 1 }; }
  hearTaunt(n) { say(TAUNTS[n], 10 + this.me, this.tauntVoice(this.me)); }

  onDown(e) {
    sfx.unlock();
    if (!$('chat-input').classList.contains('hidden')) this.closeChat(); // clicking the map closes the chat box
    const x = e.offsetX, y = e.offsetY;
    if (e.button === 1) { e.preventDefault(); this.mouse.pan = { x, y, cx: this.r.cam.x, cy: this.r.cam.y }; return; }
    if (e.button === 2) {
      if (this.mode) { this.mode = null; return; }
      const [wx, wy] = this.r.toWorld(x, y);
      this.contextAt(wx, wy, this.pick(x, y), e.shiftKey);
      return;
    }
    if (e.button !== 0) return;
    if (e.altKey) { this.pingAt(...this.r.toWorld(x, y)); return; }
    if (this.mode && this.mode.k === 'place') {
      const g = this.ghostAt(x, y);
      if (g.ok) {
        const cits = this.mineSel().filter((u) => u.kind === 'u' && u.type === 'citizen').map((u) => u.id);
        this.send({ c: 'build', ids: cits, type: this.mode.type, x: g.x, y: g.y });
        sfx.play('place');
        const c0 = this.world.get(cits[0]);
        if (c0) this.speak(c0, 'work');
        if (!e.shiftKey) this.mode = null;
      } else { this.alert(g.why, 'bad'); sfx.error(); }
      return;
    }
    if (this.mode && this.mode.k === 'target') {
      const [wx, wy] = this.r.toWorld(x, y);
      this.targetAt(wx, wy, e.shiftKey);
      return;
    }
    this.mouse.down = { x, y };
  }

  onMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    this.mouse.x = x; this.mouse.y = y;
    this.mouse.inside = true; // only edge-scroll after the mouse has really moved
    this.mouse.out = null;
    if (this.mouse.pan) {
      const p = this.mouse.pan;
      this.r.cam.x = p.cx - (x - p.x) / this.r.cam.z;
      this.r.cam.y = p.cy - (y - p.y) / this.r.cam.z;
      this.r.clampCam();
    }
  }

  onUp(e) {
    if (e.button === 1) { this.mouse.pan = null; return; }
    if (e.button !== 0) return;
    this.mouse.mm = false;
    const d = this.mouse.down;
    this.mouse.down = null;
    if (!d) return;
    const x = this.mouse.x, y = this.mouse.y;
    if (Math.abs(x - d.x) < 5 && Math.abs(y - d.y) < 5) {
      const ent = this.pick(x, y);
      if (e.shiftKey && ent && ent.kind === 'u' && ent.owner === this.me) {
        if (this.sel.has(ent.id)) this.sel.delete(ent.id); else this.sel.add(ent.id);
      } else {
        this.sel = new Set(ent ? [ent.id] : []);
        if (ent) this.clicked(ent);
      }
      return;
    }
    const [ax, ay] = this.r.toWorld(Math.min(x, d.x), Math.min(y, d.y));
    const [bx, by] = this.r.toWorld(Math.max(x, d.x), Math.max(y, d.y));
    const at = (u) => this.r.planeAt.get(u.id) || [u.x, u.y];
    const inBox = this.s.units.filter((u) => { const [x, y] = at(u); return u.owner === this.me && x >= ax && x <= bx && y >= ay && y <= by; });
    if (!e.shiftKey) this.sel = new Set();
    for (const u of inBox) this.sel.add(u.id);
    if (inBox.length) { sfx.play('select'); this.speak(inBox.find((u) => u.type !== 'citizen') || inBox[0], 'select'); }
  }

  onDbl(e) {
    const ent = this.pick(e.offsetX, e.offsetY);
    if (!ent || ent.owner !== this.me) return;
    const [ax, ay] = this.r.toWorld(0, 0), [bx, by] = this.r.toWorld(this.r.vw, this.r.vh);
    const list = ent.kind === 'u'
      ? this.s.units.filter((u) => u.owner === this.me && u.type === ent.type && u.x >= ax && u.x <= bx && u.y >= ay && u.y <= by)
      : this.s.blds.filter((b) => b.owner === this.me && b.type === ent.type && b.done);
    this.sel = new Set(list.map((x) => x.id));
  }

  contextAt(wx, wy, target, shift) {
    const mine = this.mineSel();
    if (!mine.length) return;
    const w = this.world;
    const units = mine.filter((e) => e.kind === 'u');
    const blds = mine.filter((e) => e.kind === 'b');
    if (units.length) {
      if (target && w.truce() && w.rival(this.me, target.owner)) this.alert('🕊️ No rush is on: nobody can attack yet.', 'info');
      if (target && w.hostile(this.me, target)) {
        this.send({ c: 'attack', ids: units.map((u) => u.id), t: target.id });
        this.r.addMarker(...w.centre(target), '#ff4040');
        sfx.play('order');
        this.speak(units.find((u) => u.type !== 'citizen') || units[0], 'attack');
        return;
      }
      if (target && target.kind === 'b' && target.owner === this.me) {
        const cits = units.filter((u) => u.type === 'citizen');
        const rest = units.filter((u) => u.type !== 'citizen');
        if (cits.length) {
          this.send({ c: 'work', ids: cits.map((u) => u.id), t: target.id });
          this.r.addMarker(...w.centre(target), '#ffcc33');
          this.speak(cits[0], 'work');
        }
        if (rest.length) this.send({ c: 'move', ids: rest.map((u) => u.id), x: wx, y: wy });
        sfx.play('order');
        return;
      }
      this.send({ c: 'move', ids: units.map((u) => u.id), x: wx, y: wy, q: !!shift });
      this.r.addMarker(wx, wy, shift ? '#b7f5bd' : '#7ee787');
      sfx.play('order');
      this.speak(units.find((u) => u.type !== 'citizen') || units[0], 'move');
      return;
    }
    for (const b of blds) {
      if (target && target !== b && target.kind !== 'c' && (target.kind === 'b' || w.enemy(this.me, target.owner))) this.send({ c: 'rally', b: b.id, t: target.id });
      else this.send({ c: 'rally', b: b.id, x: wx, y: wy });
    }
    this.r.addMarker(wx, wy, '#ffffff');
  }

  targetAt(wx, wy, shift) {
    const m = this.mode;
    if (m.what === 'am') {
      const ids = this.mineSel().filter((e) => e.kind === 'u').map((u) => u.id);
      this.send({ c: 'move', ids, x: wx, y: wy, am: true, q: !!shift });
      this.r.addMarker(wx, wy, '#ff9900');
      sfx.play('order');
      const u0 = this.world.get(ids[0]);
      if (u0) this.speak(u0, 'attack');
    } else if (m.what === 'nuke') {
      if (this.world.truce()) this.alert('🕊️ No rush is on: nobody can launch yet.', 'info');
      this.send({ c: 'launch', b: m.b, x: wx, y: wy });
    } else if (m.what === 'laser') {
      this.send({ c: 'laser', b: m.b, x: wx, y: wy });
      this.mode = null;
      return;
    }
    if (!shift) this.mode = null;
  }

  ghostAt(sx, sy) {
    const d = BLDS[this.mode.type];
    const [wx, wy] = this.r.toWorld(sx, sy);
    const x = Math.round(wx - d.size / 2), y = Math.round(wy - d.size / 2);
    const res = this.world.canPlace(this.me, this.mode.type, x, y);
    let ok = res.ok, why = res.why;
    if (ok && !this.world.canAfford(this.me, d.cost)) { ok = false; why = 'Not enough resources'; }
    return { type: this.mode.type, x, y, ok, why };
  }

  onKey(e) {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (!$('game-menu').classList.contains('hidden') && e.key !== 'Escape') return;
    const k = e.key;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) { this.keys.add(k); e.preventDefault(); return; }
    if (k === 'Enter') { e.preventDefault(); this.openChat(); return; }
    if (k === 'Escape') {
      if (!$('settings-panel').classList.contains('hidden')) { $('settings-panel').classList.add('hidden'); return; }
      if (this.mode) this.mode = null;
      else if (this.cardPage) this.cardPage = null;
      else if (!$('game-menu').classList.contains('hidden')) this.toggleMenu(false);
      else if (this.sel.size) this.sel.clear();
      else this.toggleMenu(true);
      return;
    }
    if (k === 'F10') { e.preventDefault(); this.toggleMenu(true); return; }
    if (k === 'F9') { e.preventDefault(); this.toggleFullscreen(); return; }
    if (k === 'F8' || k === 'Pause') { e.preventDefault(); this.session.togglePause(); return; }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'a') { e.preventDefault(); this.selectArmy(false); return; }
    if (k === ',') { this.selectArmy(true); return; }
    if (/^[0-9]$/.test(k)) {
      const n = +k;
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.groups.set(n, [...this.sel]); this.alert(`Group ${n} set`, 'info'); return; }
      const g = (this.groups.get(n) || []).filter((id) => this.world.get(id));
      if (!g.length) return;
      const now = performance.now();
      if (this.lastGroup === n && now - this.lastGroupT < 350) {
        const e0 = this.world.get(g[0]); this.r.centreOn(...this.world.centre(e0));
      }
      this.lastGroup = n; this.lastGroupT = now;
      this.sel = new Set(g);
      return;
    }
    if (k === '.') { this.nextIdle(); return; }
    if (k === ' ') { e.preventDefault(); if (this.lastAlertPos) this.r.centreOn(...this.lastAlertPos); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const up = k.toUpperCase();
    if (up === 'Z') { if (this.mouse.inside) this.pingAt(...this.r.toWorld(this.mouse.x, this.mouse.y)); return; }
    if (up === 'M' && !(this.mineSel().some((u) => u.type === 'citizen'))) { const m = toggleMute(); this.alert(m ? 'Sound off' : 'Sound on', 'info'); return; }
    // Command card hotkeys first (refresh the card so it matches the current selection).
    this.updateCard();
    const act = (this.cardActions || []).find((a) => a.key === up && a.enabled);
    if (act) { e.preventDefault(); sfx.click(); act.fn(e.shiftKey); return; }
    if (up === 'H') {
      const cities = this.s.blds.filter((b) => b.owner === this.me && b.type === 'city');
      if (cities.length) { const c = cities[this.homeIdx++ % cities.length]; this.r.centreOn(c.x + 1.5, c.y + 1.5); this.sel = new Set([c.id]); }
    }
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => this.alert('This browser did not allow fullscreen. Try F11.', 'bad'));
  }

  // Mouse wheel: zoom, or scroll the map (setting). Trackpads send small sideways deltas too, so those pan.
  onWheel(e) {
    e.preventDefault();
    const mode = localStorage.getItem('ron-wheel') || 'zoom';
    const z = this.r.cam.z;
    if (e.ctrlKey || (mode === 'zoom' && !e.shiftKey && Math.abs(e.deltaX) < 2)) {
      // Pinch on a trackpad also arrives as ctrl+wheel with small steps.
      const f = e.ctrlKey && Math.abs(e.deltaY) < 20 ? Math.exp(-e.deltaY * 0.02) : e.deltaY < 0 ? 1.15 : 1 / 1.15;
      this.r.zoomAt(e.offsetX, e.offsetY, f);
      return;
    }
    const unit = e.deltaMode === 1 ? 30 : e.deltaMode === 2 ? this.r.vh : 1;
    let dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    this.r.cam.x += (dx * 1.2) / z; this.r.cam.y += (dy * 1.2) / z;
    this.r.clampCam();
  }

  nextIdle() {
    const idle = this.s.units.filter((u) => u.owner === this.me && u.type === 'citizen' && !u.ord);
    if (!idle.length) return;
    const u = idle[this.idleIdx++ % idle.length];
    this.sel = new Set([u.id]);
    this.r.centreOn(u.x, u.y);
  }

  // Ctrl+A: the whole army. Comma: only the soldiers with nothing to do.
  selectArmy(idleOnly) {
    const list = this.s.units.filter((u) => u.owner === this.me && u.type !== 'citizen' && (!idleOnly || !u.ord));
    if (!list.length) { this.alert(idleOnly ? 'No idle soldiers' : 'You have no soldiers', 'info'); return; }
    this.sel = new Set(list.map((u) => u.id));
    sfx.play('select');
    if (idleOnly) { const u = list[this.idleIdx++ % list.length]; this.r.centreOn(u.x, u.y); }
  }

  // Show allies a spot on the map.
  pingAt(x, y) {
    const now = performance.now();
    if (now - (this.lastPing || 0) < 700) return;
    this.lastPing = now;
    this.session.sendPing(x, y);
  }
  onPing(msg) {
    const p = this.s.players[msg.p];
    if (!p) return;
    this.r.ping(msg.x, msg.y, p.color);
    this.r.worldPing(msg.x, msg.y, p.color);
    sfx.play('ping');
    this.lastAlertPos = [msg.x, msg.y];
    if (msg.p !== this.me) this.alert(`📍 ${p.name} marked a spot (Space to look)`, 'info');
  }

  onPause(on, name) {
    $('btn-pause').textContent = on ? '▶' : '⏸';
    $('pause-note').classList.toggle('hidden', !on);
    if (on) $('pause-note').textContent = `⏸ ${name ? `${name} paused the game` : 'Game paused'}. Press F8 to carry on.`;
  }
  onSpeed(x, quiet) {
    $('btn-speed').textContent = `⏩ ${x}×`;
    this.r.speedNow = x;
    if (!quiet) { this.alert(`Game speed: ${x}×`, 'info'); sfx.click(); }
  }

  // A big message across the middle of the screen.
  banner(title, sub = '', kind = '') {
    const el = $('banner');
    el.className = kind;
    el.style.animation = 'none';
    el.innerHTML = `<div class="b-title">${esc(title)}</div>${sub ? `<div class="b-sub">${esc(sub)}</div>` : ''}`;
    void el.offsetWidth; // restart the animation
    el.style.animation = '';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => el.classList.add('hidden'), 4500);
  }

  toggleMenu(show) {
    $('game-menu').classList.toggle('hidden', !show);
    if (show) $('score-table').innerHTML = this.scoreHtml();
  }

  scoreHtml() {
    const rows = this.s.players.map((p, i) => {
      const units = this.s.units.filter((u) => u.owner === i).length;
      const cities = this.s.blds.filter((b) => b.owner === i && b.type === 'city').length;
      const lp = (this.session.lobby && this.session.lobby.players[i]) || {};
      const tag = lp.bot || lp.takeover ? ' 🤖' : lp.online === false ? ' 🔌' : '';
      const gifts = !this.s.over && this.pl.alive && p.alive && i !== this.me && this.world.ally(this.me, i)
        ? `<div class="gifts">Send 100: ${RES.map((k) => `<button class="gift small secondary" data-to="${i}" data-res="${k}" title="Send 100 ${k} to ${esc(p.name)}">${RES_ICON[k]}</button>`).join('')}</div>` : '';
      return `<tr><td><span class="swatch" style="background:${p.color}"></span>${flagImg(p.nation, 12)} ${esc(p.name)}${tag}${p.alive ? '' : ' 💀'}${gifts}</td><td>${p.team + 1}</td><td>${AGES[p.age]}</td><td>${cities}</td><td>${units}</td><td>${p.kills}</td><td>${p.lost}</td><td>${p.nukes}</td><td>${(p.st && p.st.wonders) || 0}</td></tr>`;
    }).join('');
    return `<table class="scores"><tr><th>Player</th><th>Team</th><th>Age</th><th>Cities</th><th>Units</th><th>Kills</th><th>Lost</th><th>☢</th><th>🏛</th></tr>${rows}</table>`;
  }

  awardsHtml() {
    const list = awards(this.s.players);
    if (!list.length) return '';
    return '<h3 class="awards-title">🏆 Awards</h3><div class="awards">' + list.map((a) => {
      const p = this.s.players[a.p];
      return `<div class="award"><span class="aicon">${a.icon}</span><div><b>${esc(a.title)}</b><br><span class="swatch" style="background:${p.color}"></span>${esc(p.name)} <span class="adesc">— ${esc(a.text)}</span></div></div>`;
    }).join('') + '</div>';
  }

  // ---------- alerts ----------
  alert(text, kind = 'info', pos = null) {
    const key = kind + text;
    const now = performance.now();
    if (now - (this.alertTimes.get(key) || 0) < 2500) return;
    this.alertTimes.set(key, now);
    if (pos) this.lastAlertPos = pos;
    const el = document.createElement('div');
    el.className = `alert ${kind}`;
    el.textContent = text;
    const box = $('alerts');
    box.appendChild(el);
    while (box.children.length > 5) box.firstChild.remove();
    setTimeout(() => el.remove(), kind === 'nuke' ? 6000 : 4000);
  }

  chatLine(msg) {
    const el = document.createElement('div');
    el.className = 'line';
    const taunt = msg.p >= 0 && /^\d{1,2}$/.test(msg.text.trim()) ? TAUNTS[+msg.text.trim()] : null;
    if (msg.p < 0) { el.classList.add('sys'); el.textContent = msg.text; }
    else el.innerHTML = `${msg.team ? '<span class="team-tag">[team]</span> ' : ''}<b style="color:${esc(msg.color || '#fff')}">${esc(msg.name)}:</b> ${taunt ? `<i>📣 ${esc(msg.text.trim())}. ${esc(taunt)}</i>` : esc(msg.text)}`;
    if (taunt) say(taunt, 10 + msg.p, this.tauntVoice(msg.p));
    else if (msg.p >= 0 && msg.p !== this.me) sfx.play('click');
    const log = $('chat-log');
    log.appendChild(el);
    while (log.children.length > 8) log.firstChild.remove();
  }

  // A unit says something: speech bubble, plus spoken out loud if voices are on.
  speak(u, kind, text) {
    if (!u) return;
    const now = performance.now();
    if (!text && now - this.lastVoice < 1400) return;
    this.lastVoice = now;
    const cls = u.kind === 'u' ? UNITS[u.type].cls : 'inf';
    let special = null;
    if (u.kind === 'u' && !text) {
      const st = this.world.stats(u.owner, u.type);
      const key = st.uniq === 2 ? u.type : st.uniq === 1 ? `${this.s.players[u.owner].nation}:${u.type}` : null;
      if (key && Math.random() < 0.8) special = specialLine(key, kind === 'work' ? 'move' : kind);
    }
    const line = text || special || lineFor(cls, kind);
    this.r.bubble(u.id, line);
    if (u.kind === 'u') say(line, VOICE[u.type] || 0, { pitch: PITCH[u.type] || 1, rate: 1.15 });
  }

  // Clicked on a single thing.
  clicked(e) {
    const now = performance.now();
    const p = this.pokes;
    if (p.id === e.id && now - p.t < 1500) p.n++; else { p.id = e.id; p.n = 1; }
    p.t = now;
    if (e.kind === 'c') {
      sfx.at(e.mutant ? 'mutant' : 'moo', e.x, e.y, 1.2);
      this.r.bubble(e.id, e.mutant ? pickOne(['MOOOOAAARGH', 'Brains... I mean grass...', 'MOO. (menacingly)']) : p.n >= 4 ? 'Stop it. I am a cow.' : pickOne(['Moo.', 'Moo?', 'Mooooo.', '...moo']));
      return;
    }
    if (e.owner !== this.me) return;
    if (e.kind === 'b') {
      sfx.play('select');
      if (e.type === 'city' && p.n >= 5) { this.r.bubble(e.id, cityPokeLine()); say(this.r.bubbles.get(e.id).text, 9, { pitch: 1.1 }); p.n = 0; }
      return;
    }
    sfx.play('select');
    if (p.n >= 4) { const line = pokeLine(); this.speak(e, 'poke', line); if (p.n >= 7) { sfx.play('boing'); p.n = 0; } return; }
    this.speak(e, 'select');
  }

  handleEvents(evs) {
    const w = this.world, me = this.me;
    const name = (p) => (this.s.players[p] ? this.s.players[p].name : '?');
    const [cx, cy] = this.r.toWorld(this.r.vw / 2, this.r.vh / 2);
    const near = (x, y, d = 25) => Math.hypot(x - cx, y - cy) < d;
    const now = performance.now();
    for (const e of evs) {
      const fresh = this.s.tick - e.tick < 60;
      if (!fresh && e.type !== 'victory' && e.type !== 'eliminated') continue;
      const seen = e.x == null || this.r.isVisible(e.x, e.y);
      switch (e.type) {
        case 'error': if (e.p === me) { this.alert(e.msg, 'bad'); sfx.error(); } break;
        case 'placed': break;
        case 'shot': {
          if (!seen) break;
          if (e.p === me || (e.x2 != null && this.isMineNear(e.x2, e.y2))) this.heat += 0.05;
          const nat = { bowler: 'bat', scooter: 'gun', jeepney: 'gun' }[e.ut] || (e.uq === 1 && e.ut === 'ranged' ? 'pop' : null);
          if (e.uq === 1 && e.ut === 'siege') sfx.at('jingle', e.x, e.y, 1);
          if (e.cls === 'aa' || (e.ta && e.cls === 'bld' && e.age >= 3)) { sfx.at('flak', e.x, e.y, 0.9); break; }
          if (e.cls === 'air') { sfx.at('mg', e.x, e.y, 0.8); break; }
          const snd = nat || (e.cls === 'cow' ? 'hit' : e.melee ? 'sword' : e.cls === 'bld' ? (e.age >= 2 ? 'gun' : 'tower')
            : e.cls === 'sie' ? (e.age >= 4 ? 'rocket' : e.age >= 2 ? 'cannon' : 'catapult')
              : e.cls === 'cav' && e.age >= 3 ? 'cannon' : e.cls === 'rng' && e.age >= 3 ? 'mg' : e.age >= 2 ? 'gun' : 'bow');
          sfx.at(snd, e.x, e.y, 0.9);
          break;
        }
        case 'bomb':
          if (seen) sfx.at('bombs', e.x, e.y, 1.1);
          break;
        case 'upgraded':
          if (e.p === me) {
            this.alert(`⬆️ ${UPGRADE[e.btype].names[e.lvl]} ready: +${Math.round(UPGRADE.rate * 100)}% speed, room for one more worker`, 'good');
            sfx.play('tech');
          }
          break;
        case 'attacked':
          if (e.p === me) {
            this.heat += 0.08;
            // Only alert if the fight is off screen, and not too often.
            const onScreen = Math.abs(e.x - cx) < this.r.vw / this.r.cam.z / 2 && Math.abs(e.y - cy) < this.r.vh / this.r.cam.z / 2;
            if (!onScreen && now - (this.lastAttackAlert || 0) > 10000) {
              this.lastAttackAlert = now;
              this.alert('You are under attack! (Space to look)', 'bad', [e.x, e.y]);
              this.r.ping(e.x, e.y);
              sfx.attack();
              say(pickOne(['We are under attack!', 'Our people are being attacked!', 'Enemy forces sighted!', 'Help! Somebody is hitting us!']), 'announcer');
            }
          }
          break;
        case 'die': {
          if (seen) {
            const r = Math.random();
            sfx.at(r < 0.03 ? 'scream' : 'grunt', e.x, e.y, 0.8);
          }
          if (e.by === me) {
            this.streak.push(now);
            this.streak = this.streak.filter((t) => now - t < 12000);
            const n = this.streak.length;
            const hit = STREAK.find(([k]) => k === n);
            if (hit) { this.alert(`🔥 ${hit[1]}`, 'good'); say(hit[1], 'announcer'); this.r.float(e.x, e.y, hit[1], '#ff9d2a', true); }
          }
          if (!this.firstBlood && e.by >= 0) {
            this.firstBlood = true;
            this.alert(`🩸 First blood: ${name(e.by)}!`, e.by === me ? 'good' : 'info');
            say('First blood!', 'announcer');
          }
          break;
        }
        case 'age':
          if (e.p === me) {
            this.alert(`Welcome to the ${AGES[e.age]} Age!`, 'good');
            this.banner(`The ${AGES[e.age]} Age`, 'New buildings, units and techs are ready', 'gold');
            sfx.age();
            say(`Welcome to the ${AGES[e.age]} age.`, 'announcer');
            for (const c of this.s.blds.filter((b) => b.owner === me && b.type === 'city')) this.r.fireworks(c.x + 1.5, c.y + 1.5, 3);
          } else {
            this.alert(`${name(e.p)} reached the ${AGES[e.age]} Age`, 'info');
            if (e.age === 4) say(`${name(e.p)} has entered the Atomic age. Uh oh.`, 'announcer');
          }
          break;
        case 'tech':
          if (e.tech === 'manhattan') {
            this.alert(e.p === me ? 'Manhattan Project complete. You can build Missile Silos.' : `☢ ${name(e.p)} completed the Manhattan Project!`, e.p === me ? 'good' : 'bad');
            say(e.p === me ? 'The Manhattan Project is complete. Try not to end the world.' : `Warning. ${name(e.p)} has the bomb.`, 'announcer');
          } else if (TECHS[e.tech].nation) {
            // National techs are announced to everyone. Bragging rights.
            const brag = { autobahn: 'The Autobahn is open. No speed limit.', seven11: 'A 7-Eleven has opened on every corner.', karaoke: 'Karaoke night has begun. Nobody is safe.', tigers: 'Beware the cornered tigers.' }[e.tech];
            this.alert(`⭐ ${e.p === me ? 'You' : name(e.p)}: ${TECHS[e.tech].name}! ${brag || ''}`, e.p === me ? 'good' : 'info');
            sfx.play(e.tech === 'karaoke' ? 'disco' : e.tech === 'autobahn' ? 'horn' : 'promote');
            if (e.p === me) say(brag, 'announcer');
          } else if (e.p === me) { this.alert(`${TECHS[e.tech].name} researched`, 'good'); sfx.play('tech'); }
          break;
        case 'built':
          if (e.p === me) {
            if (e.btype === 'city' || e.btype === 'silo') { this.alert(`${BLDS[e.btype].names[this.pl.age]} complete`, 'good'); sfx.play('built'); if (e.btype === 'city') say('A new city has been founded.', 'announcer'); }
            else if (near(e.x, e.y)) sfx.at('hammer', e.x, e.y);
          }
          break;
        case 'trained':
          if (e.p === me && Math.random() < 0.35) {
            const u = w.get(e.id);
            if (u && near(u.x, u.y, 20)) { sfx.play(u.type === 'scooter' ? 'horn' : 'trained'); this.speak(u, 'select'); }
          }
          break;
        case 'promote': {
          if (seen) this.r.float(e.x, e.y, `${rankIcon(e.rank)} Promoted!`, '#ffd700', true);
          if (e.p === me) {
            sfx.play('promote');
            const u = w.get(e.id);
            if (u) this.speak(u, 'promo', pickOne(['I would like to thank my mother.', 'Promotion! Finally!', 'Does this come with a raise?', 'Call me sir now.', 'They grow up so fast.']));
          }
          break;
        }
        case 'captured':
          if (e.p === me) { this.alert(`You captured ${e.name || 'a city'}!`, 'good', [e.x, e.y]); this.banner(`${e.name || 'City'} captured!`, '', 'gold'); sfx.play('capture'); say(`We have captured ${e.name || 'a city'}.`, 'announcer'); }
          else if (e.from === me) { this.alert(`${e.name || 'A city'} was captured by ${name(e.p)}!`, 'bad', [e.x, e.y]); this.banner(`${e.name || 'A city'} has fallen`, `Taken by ${name(e.p)}`, 'red'); sfx.attack(); say(`We have lost ${e.name || 'a city'}!`, 'announcer'); }
          else this.alert(`${name(e.p)} captured a city from ${name(e.from)}`, 'info');
          break;
        case 'convert':
          if (e.from === me) this.alert('A building was lost to enemy territory', 'bad', [e.x, e.y]);
          break;
        case 'destroyed':
          if (seen && near(e.x, e.y, 30)) sfx.at('collapse', e.x, e.y);
          break;
        case 'truce':
          if (e.left) this.alert('🕊️ No rush ends in 1 minute. Get ready!', 'info');
          else this.alert('⚔️ No rush is over. The war can start!', 'bad');
          break;
        case 'launch':
          this.lastAlertPos = [e.x, e.y];
          if (e.p === me) this.alert('☢ Missile away!', 'nuke');
          else this.alert(`☢ NUCLEAR LAUNCH DETECTED (${name(e.p)}) — Space to look`, 'nuke');
          this.r.ping(e.x, e.y);
          sfx.siren();
          sfx.play('launch');
          this.heat += 1;
          say(e.p === me ? 'Missile away.' : 'Nuclear launch detected.', 'announcer', { interrupt: true });
          break;
        case 'nuke': {
          sfx.nuke();
          const d = Math.hypot(e.x - cx, e.y - cy);
          if (d < 40) { const f = $('nuke-flash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 120); }
          const lim = w.settings.doomsday | 0;
          this.alert(`☢ Doomsday Clock: ${this.s.doom}${lim > 0 ? ' / ' + lim : ''}`, 'bad');
          setTimeout(() => sfx.play('bell'), 2500);
          if (lim > 0 && lim - this.s.doom === 1) setTimeout(() => say('One more nuke and everybody loses. Just so you know.', 'announcer'), 4000);
          break;
        }
        case 'intercept': this.alert(`Missile shot down over ${name(e.victim)}'s territory!`, 'good'); sfx.play('intercept'); say('Missile intercepted!', 'announcer'); break;
        case 'nukeReady': if (e.p === me) { this.alert('☢ Nuke ready to launch', 'good'); sfx.done(); say('Nuclear missile ready.', 'announcer'); } break;
        case 'eliminated':
          if (!fresh) break;
          this.alert(e.p === me ? 'You have been defeated.' : `${name(e.p)} has been defeated!`, e.p === me ? 'bad' : 'info');
          if (e.p !== me) { this.banner(`${name(e.p)} is out`, '', 'red'); say(`${name(e.p)} has been eliminated.`, 'announcer'); }
          break;
        // ----- wonders, the laser and the market -----
        case 'wonder': {
          const d = BLDS[e.btype];
          this.banner(`${d.names[0]}`, `${e.p === me ? 'You built a Wonder of the World' : `${name(e.p)} built a Wonder of the World`}. ${d.desc}`, 'gold');
          this.alert(`${d.icon} ${e.p === me ? 'You' : name(e.p)} built the ${d.names[0]}`, e.p === me ? 'good' : 'info', [e.x, e.y]);
          this.r.ping(e.x, e.y, '#ffd700');
          sfx.play('wonder');
          if (e.btype === 'rocket') {
            this.lastAlertPos = [e.x, e.y];
            this.alert(w.ally(me, e.p) ? '🚀 Defend the Moon Rocket for 4 minutes and you win! (Space to look)' : '🚀 Destroy the Moon Rocket or lose! (Space to look)', w.ally(me, e.p) ? 'good' : 'nuke');
            say(w.ally(me, e.p) ? 'Our Moon Rocket is ready. Defend it for four minutes and we win.' : `${name(e.p)} is building a Moon Rocket. You have four minutes to destroy it.`, 'announcer', { interrupt: true });
          } else say(`${name(e.p)} has built the ${d.names[0]}.`, 'announcer');
          break;
        }
        case 'wonderLost': {
          const d = BLDS[e.btype];
          const lostMine = e.p === me;
          this.banner(`${d.names[0]} destroyed`, lostMine ? 'Your wonder is gone' : `${name(e.p)} lost a wonder`, lostMine ? 'red' : '');
          this.alert(`${d.icon} The ${d.names[0]} of ${name(e.p)} was destroyed`, lostMine ? 'bad' : 'info', [e.x, e.y]);
          say(`The ${d.names[0]} has been destroyed.`, 'announcer');
          break;
        }
        case 'laserAim':
          this.lastAlertPos = [e.x, e.y];
          this.r.ping(e.x, e.y, '#5ff0ff');
          if (e.p === me) sfx.play('charge');
          else if (seen) { this.alert('🛰️ Orbital laser! Move away from the circle!', 'bad', [e.x, e.y]); sfx.play('charge'); say('Orbital laser incoming!', 'announcer'); }
          break;
        case 'laser':
          if (seen || e.p === me) { sfx.at('laser', e.x, e.y, 1.5); this.heat += 0.5; }
          break;
        case 'rocketWin':
          this.banner('🚀 Lift-off!', `${name(e.p)} reached the Moon`, 'gold');
          sfx.play('liftoff');
          break;
        case 'terracotta':
          if (e.p === me && near(e.x, e.y)) sfx.at('trained', e.x, e.y, 0.5);
          if (seen) this.r.float(e.x, e.y, '🗿 Reporting for duty', '#d9a77c');
          break;
        case 'traded':
          if (e.p === me) sfx.play('coin');
          break;
        case 'gift':
          if (e.to === me) { this.alert(`🎁 ${name(e.p)} sent you ${e.amt} ${e.res}`, 'good'); sfx.play('coin'); }
          else if (e.p === me) { this.alert(`Sent ${e.amt} ${e.res} to ${name(e.to)}`, 'info'); sfx.play('coin'); }
          break;
        // ----- the silly stuff -----
        case 'silly': this.sillyEvent(e); break;
        case 'crate': {
          const t = e.kind === 'tech' ? TECHS[e.tech].name : '';
          const text = CRATE_TEXT[e.kind](e, t);
          if (e.p === me) {
            this.alert(`🎁 ${text}`, e.kind === 'dud' || e.kind === 'map' ? 'info' : 'good', [e.x, e.y]);
            sfx.play(e.kind === 'dud' ? 'boing' : 'crate');
            if (e.kind === 'map') this.revealMap();
          }
          if (seen) this.r.float(e.x, e.y, e.kind === 'res' ? `+${e.amt} ${RES_ICON[e.res]}` : e.kind === 'dud' ? '🤷' : '🎁!', '#ffd700', true);
          break;
        }
        case 'critter':
          if (seen) {
            sfx.at(e.mutant ? 'mutant' : 'moo', e.x, e.y, 0.9);
            if (e.food) this.r.float(e.x, e.y, `+${e.food} ${RES_ICON.food}`, '#9be37a');
          }
          break;
        case 'mutate':
          if (seen) { sfx.at('mutant', e.x, e.y, 1.3); this.r.float(e.x, e.y, '☢ MUTANT COW!', '#7dff3a', true); }
          if (near(e.x, e.y, 40)) this.alert('☢ A cow wandered into the fallout. It is not a cow any more.', 'bad', [e.x, e.y]);
          break;
        case 'meteorHit':
          if (near(e.x, e.y, 35)) sfx.at('explode', e.x, e.y, 1.6), sfx.play('collapse', { v: 0.8 });
          break;
      }
    }
  }

  isMineNear(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y), w = this.world;
    return tx >= 0 && ty >= 0 && tx < w.W && ty < w.H && w.terr[ty * w.W + tx] === this.me;
  }

  sillyEvent(e) {
    const info = SILLY[e.kind];
    if (!info) return;
    let text = info.text;
    if (e.kind === 'tax') {
      const p = this.s.players[e.p];
      text = e.p === this.me ? `You were the richest, so ${e.amt} of your resources went to everyone else. Sorry.` : `${p ? p.name : '?'} was the richest and had to share ${e.amt} resources. Thanks!`;
    }
    this.alert(`${info.title} ${text}`, e.kind === 'meteor' ? 'bad' : 'info', e.x != null ? [e.x, e.y] : null);
    const ann = {
      frogs: 'A plague of frogs! Ribbit.', happy: 'Happy hour! Drinks are on the house.', tax: 'Tax audit!', stampede: 'Cow stampede!',
      drop: 'Supply drop incoming.', meteor: 'Meteor incoming! Take cover!', boom: 'Economic boom! Money for everyone!',
    }[e.kind];
    say(ann, 'announcer');
    if (e.x != null) this.r.ping(e.x, e.y, '#ffd700');
    if (e.kind === 'frogs') { for (let i = 0; i < 6; i++) setTimeout(() => sfx.play('ribbit', { v: 1 }), i * 400); }
    else if (e.kind === 'happy') sfx.play('partyHorn');
    else if (e.kind === 'tax' || e.kind === 'boom') sfx.play('kaching');
    else if (e.kind === 'stampede') { for (let i = 0; i < 4; i++) setTimeout(() => sfx.play('moo', { v: 0.8, pan: (Math.random() - 0.5) * 1.5 }), i * 350); }
    else if (e.kind === 'meteor') sfx.play('whistle', 7.5);
    else if (e.kind === 'drop') sfx.play('crate');
  }

  revealMap() {
    // The crate's treasure map: show a big random chunk of the map for a moment.
    const w = this.world, r = this.r;
    const cx = Math.floor(Math.random() * w.W), cy = Math.floor(Math.random() * w.H);
    for (let y = Math.max(0, cy - 20); y < Math.min(w.H, cy + 20); y++) for (let x = Math.max(0, cx - 20); x < Math.min(w.W, cx + 20); x++) r.explored[y * w.W + x] = 1;
    r.ping(cx, cy, '#ffd700');
  }

  // ---------- main loop ----------
  loop(t) {
    if (!this.running) return;
    requestAnimationFrame((tt) => this.loop(tt));
    const dt = Math.min(0.1, (t - (this.lastT || t)) / 1000);
    this.lastT = t;
    this.world = this.session.world;
    this.r.world = this.world;
    // camera keys and screen edge scrolling
    const sp = (900 / this.r.cam.z) * dt;
    let dx = 0, dy = 0;
    if (this.keys.has('ArrowLeft')) dx -= sp;
    if (this.keys.has('ArrowRight')) dx += sp;
    if (this.keys.has('ArrowUp')) dy -= sp;
    if (this.keys.has('ArrowDown')) dy += sp;
    if (this.mouse.inside && !this.mouse.down && !this.mouse.pan && document.hasFocus()) {
      const m = this.mouse, edge = 8;
      if (m.x < edge) dx -= sp; if (m.x > this.r.vw - edge) dx += sp;
      if (m.y < edge) dy -= sp; if (m.y > this.r.vh - edge) dy += sp;
    } else if (this.mouse.out && !this.mouse.inside && document.hasFocus()) {
      dx += this.mouse.out[0] * sp; dy += this.mouse.out[1] * sp;
    }
    if (dx || dy) { this.r.cam.x += dx; this.r.cam.y += dy; this.r.clampCam(); }
    setListener(...this.r.viewCentre());
    this.ambience(t, dt);

    const evs = this.world.events;
    if (evs.length) {
      this.world.events = [];
      this.r.addEvents(evs);
      this.handleEvents(evs);
    }
    // drop dead entities from selection
    for (const id of this.sel) if (!this.world.get(id)) this.sel.delete(id);

    const overCanvas = this.mouse.y > 34 && this.mouse.y < this.r.vh - 212;
    const hov = overCanvas && !this.mouse.down ? this.pick(this.mouse.x, this.mouse.y) : null;
    this.hover = hov ? hov.id : 0;
    this.canvas.style.cursor = this.mode ? 'crosshair' : hov && this.world.hostile(this.me, hov) && this.mineSel().some((e) => e.kind === 'u') ? 'crosshair' : 'default';

    const ui = {
      sel: this.sel, hover: this.hover, alpha: this.session.alpha(),
      box: this.mouse.down && (Math.abs(this.mouse.x - this.mouse.down.x) > 4 || Math.abs(this.mouse.y - this.mouse.down.y) > 4)
        ? { x0: this.mouse.down.x, y0: this.mouse.down.y, x1: this.mouse.x, y1: this.mouse.y } : null,
      ghost: this.mode && this.mode.k === 'place' ? this.ghostAt(this.mouse.x, this.mouse.y) : null,
      targetMode: this.mode && this.mode.k === 'target' ? this.mode.what : null,
    };
    this.r.draw(ui);

    if (t - this.lastHud > 120) { this.lastHud = t; this.updateHud(); this.updateRocketClock(); }
    if (t - (this.lastMedal || 0) > 2000) { this.lastMedal = t; this.checkMedals(); }
    this.sampleHistory();
    if (t - this.lastMini > 200) { this.lastMini = t; this.r.drawMinimap($('minimap')); }
    this.checkOver();
  }

  // Music mood, random moos, sunset announcements.
  ambience(t, dt) {
    const s = this.s;
    this.heat = Math.max(0, Math.min(1.5, this.heat - dt * 0.08));
    music.setIntensity(s.missiles.length ? 1 : Math.min(1, this.heat));
    music.age = this.pl.age;
    music.mode = s.mods && s.mods.speed ? 'happy' : 'normal';
    const now = performance.now();
    if (now > this.nextMoo) {
      this.nextMoo = now + 7000 + Math.random() * 12000;
      const cows = (s.critters || []).filter((c) => this.r.onScreen(c.x, c.y, 0) && this.r.isVisible(c.x, c.y));
      if (cows.length) {
        const c = cows[Math.floor(Math.random() * cows.length)];
        sfx.at(c.mutant ? 'mutant' : 'moo', c.x, c.y, 0.7);
        this.r.bubble(c.id, c.mutant ? pickOne(['GRRRMOOO', 'hhhrrrrnnngh', 'MOO (radioactive)']) : pickOne(['Moo.', 'Moo!', 'Mooo?', 'Moo moo.', '*chews*', '*stares at you*']), 1800);
      }
    }
    // Bands and jeepneys on screen play music now and then.
    if (now > (this.nextBand || 0)) {
      this.nextBand = now + 3500 + Math.random() * 2000;
      const mus = s.units.filter((u) => (u.type === 'oompah' || u.type === 'jeepney') && this.r.onScreen(u.x, u.y, 0) && this.r.isVisible(u.x, u.y));
      if (mus.length) {
        const u = mus[Math.floor(Math.random() * mus.length)];
        sfx.at(u.type === 'jeepney' ? 'disco' : s.players[u.owner].age >= 4 ? 'techno' : 'oompah', u.x, u.y, 0.9);
      }
    }
    // Planes on screen drone past now and then.
    if (now > (this.nextPlane || 0)) {
      this.nextPlane = now + 2500 + Math.random() * 3000;
      const planes = s.units.filter((u) => UNITS[u.type].air && this.r.onScreen(u.x, u.y, 0) && (u.owner === this.me || this.r.isVisible(u.x, u.y)));
      if (planes.length) {
        const u = planes[Math.floor(Math.random() * planes.length)];
        sfx.at(s.players[u.owner].age >= 4 ? 'jet' : 'prop', u.x, u.y, Math.min(1, 0.5 + planes.length * 0.05));
      }
    }
    const ph = this.r.dayPhase();
    if (ph !== this.lastPhase) {
      if (this.lastPhase && ph === 'dusk') this.chatLine({ p: -1, text: '🌙 Night is falling.' });
      if (this.lastPhase && ph === 'dawn') { this.chatLine({ p: -1, text: '🐓 Cock-a-doodle-doo! A new day.' }); }
      this.lastPhase = ph;
    }
  }

  checkOver() {
    const s = this.s;
    if (!this.pl.alive && !this.defeatShown && !s.over) {
      this.defeatShown = true;
      this.showOver('DEFEAT', 'You lost all your cities. You can keep watching the rest of the game.');
      sfx.play('defeat');
      say('You have been defeated.', 'announcer', { interrupt: true });
    }
    if (s.over && !this.overShown) {
      this.overShown = true;
      music.stop();
      if (s.over.armageddon) {
        this.showOver('☢ ARMAGEDDON ☢', 'The Doomsday Clock struck midnight. Too many nukes. Everybody loses. Well done, everyone.');
        say('Armageddon. Everybody loses. The cockroaches win.', 'announcer', { interrupt: true });
        sfx.play('defeat');
      } else if (s.over.rocket) {
        const win = s.players.filter((p) => p.team === s.over.winnerTeam).map((p) => p.name).join(' & ');
        const mine = s.over.winnerTeam === this.pl.team;
        this.showOver(mine ? 'VICTORY' : 'DEFEAT', mine ? 'Your Moon Rocket made it. Your team owns the Moon. Everyone else has to pay rent.' : `${win} launched the Moon Rocket. You had four minutes.`);
        sfx.play(mine ? 'victory' : 'defeat');
        say(mine ? 'Lift off. Victory!' : 'They reached the moon. We lose.', 'announcer', { interrupt: true });
      } else if (s.over.winnerTeam === this.pl.team) {
        this.showOver('VICTORY', 'Your enemies are defeated.');
        sfx.play('victory');
        say('Victory!', 'announcer', { interrupt: true });
        const [x, y] = this.r.viewCentre();
        this.r.fireworks(x, y, 12);
      } else {
        const win = s.players.filter((p) => p.team === s.over.winnerTeam).map((p) => p.name).join(' & ');
        this.showOver('DEFEAT', `${win} won the game.`);
        sfx.play('defeat');
      }
    }
  }

  showOver(title, text) {
    $('over-title').textContent = title;
    $('over-text').textContent = text;
    $('over-scores').innerHTML = this.scoreHtml() + this.medalsHtml() + this.awardsHtml();
    this.sampleHistory(true);
    this.drawGraphs();
    const again = $('btn-over-again'), host = this.session.isHost;
    again.disabled = !host;
    again.textContent = host ? '🔁 Play again' : 'Waiting for host…';
    again.title = host ? 'Everyone goes back to the lobby' : 'Only the host can start another game';
    $('game-over').classList.remove('hidden');
    this.r.spectate = true;
  }

  // ---------- rocket countdown ----------
  updateRocketClock() {
    const b = this.s.blds.find((x) => x.type === 'rocket' && x.done && x.hp > 0);
    const el = $('rocket-clock');
    if (!b || this.s.over) { el.classList.add('hidden'); this.rocketPos = null; return; }
    this.rocketPos = [b.x + 2, b.y + 2];
    const left = Math.max(0, Math.ceil((b.launchAt - this.s.tick) * DT));
    const owner = this.s.players[b.owner], ally = this.world.ally(this.me, b.owner);
    el.classList.remove('hidden');
    el.classList.toggle('danger', !ally);
    el.classList.toggle('soon', left <= 60);
    el.textContent = `🚀 ${b.owner === this.me ? 'Your' : `${owner.name}'s`} Moon Rocket launches in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const said = (this.rocketSaid[b.id] ||= {});
    for (const mark of [60, 10]) {
      if (left <= mark && !said[mark]) {
        said[mark] = true;
        this.alert(`🚀 ${mark} seconds until lift-off!`, ally ? 'good' : 'nuke', this.rocketPos);
        say(`${mark} seconds until lift off.`, 'announcer');
      }
    }
  }

  // ---------- medals ----------
  // Small goals you can show off to your friends. Checked on your own screen, and announced in chat.
  checkMedals() {
    const pl = this.pl, me = this.me, s = this.s, w = this.world;
    if (s.over || !pl.alive) return;
    const army = s.units.filter((u) => u.owner === me && u.type !== 'citizen');
    const cities = w.cityCount(me), st = pl.st || {};
    const techs = Object.keys(pl.techs).length;
    const capped = RES.filter((k) => this.isCapped(k)).length;
    const list = [
      ['city3', '🏙️', 'Empire Builder', '3 cities', cities >= 3],
      ['city6', '🌆', 'Superpower', '6 cities', cities >= 6],
      ['army50', '⚔️', 'Standing Army', '50 soldiers at once', army.length >= 50],
      ['army100', '🎖️', 'Overkill', '100 soldiers at once', army.length >= 100],
      ['hero', '⭐', 'Living Legend', 'a ★★★ soldier', army.some((u) => u.rank >= 3)],
      ['wonder', '🏛️', 'Wonder of the World', 'built a wonder', (st.wonders || 0) >= 1],
      ['wonder3', '🗺️', 'Wonder Collector', 'built 3 wonders', (st.wonders || 0) >= 3],
      ['cows', '🥩', 'Steak Night', 'hunted 10 cows', (st.cows || 0) >= 10],
      ['techs', '📚', 'Bookworm', '15 techs', techs >= 15],
      ['nuke', '☢️', 'Oppenheimer', 'launched a nuke', pl.nukes >= 1],
      ['caps', '🚩', 'Conqueror', 'captured 3 cities', (st.caps || 0) >= 3],
      ['kills', '💀', 'Grim Reaper', '100 kills', pl.kills >= 100],
      ['atomic', '⚛️', 'Atomic Age', 'reached the last age', pl.age >= 4],
      ['maxed', '🏭', 'Full Steam', 'hit 3 gather limits at once', capped >= 3],
    ];
    for (const [id, icon, title, text, done] of list) {
      if (!done || this.medalIds.has(id)) continue;
      this.medalIds.add(id);
      this.medals.push({ icon, title, text });
      this.alert(`${icon} Medal: ${title} (${text})`, 'good');
      sfx.play('medal');
      this.session.sendChat(`🏅 ${title}: ${text}`);
    }
  }
  medalsHtml() {
    if (!this.medals.length) return '';
    return `<h3 class="awards-title">🏅 Your medals</h3><div class="medals">${this.medals.map((m) => `<span class="medal" title="${esc(m.text)}">${m.icon} ${esc(m.title)}</span>`).join('')}</div>`;
  }

  // ---------- graphs for the end screen ----------
  sampleHistory(force) {
    const s = this.s, every = Math.round(15 / DT);
    if (!force && (s.tick % every || this.lastSample === s.tick)) return;
    this.lastSample = s.tick;
    const army = s.players.map(() => 0), score = s.players.map((p) => p.age * 150 + p.kills * 2 + Object.keys(p.techs).length * 15 + ((p.st && p.st.wonders) || 0) * 200);
    for (const u of s.units) { if (u.type !== 'citizen') army[u.owner]++; score[u.owner] += u.type === 'citizen' ? 2 : 5; }
    for (const b of s.blds) if (b.done) score[b.owner] += b.type === 'city' ? 120 : 10;
    this.history.push({ t: s.tick * DT, score, army });
  }
  drawGraphs() {
    const box = $('over-graphs');
    box.innerHTML = '';
    if (this.history.length < 3) return;
    const ps = this.s.players;
    for (const [key, title] of [['score', 'Score'], ['army', 'Army size']]) {
      const c = document.createElement('canvas');
      c.width = 340; c.height = 130;
      const wrap = document.createElement('div');
      wrap.className = 'graph';
      wrap.innerHTML = `<div class="g-title">${title}</div>`;
      wrap.appendChild(c); box.appendChild(wrap);
      const g = c.getContext('2d');
      const pad = 26, W = c.width - pad - 6, H = c.height - 18;
      const tMax = this.history[this.history.length - 1].t || 1;
      const yMax = Math.max(1, ...this.history.map((h) => Math.max(...h[key])));
      g.strokeStyle = '#30363d'; g.fillStyle = '#9aa4ad'; g.font = '10px system-ui'; g.lineWidth = 1;
      for (let i = 0; i <= 2; i++) {
        const y = 3 + (H * i) / 2;
        g.beginPath(); g.moveTo(pad, y); g.lineTo(pad + W, y); g.stroke();
        g.textAlign = 'right'; g.textBaseline = 'middle';
        g.fillText(String(Math.round((yMax * (2 - i)) / 2)), pad - 3, y);
      }
      g.textAlign = 'center'; g.textBaseline = 'top';
      for (let i = 0; i <= 3; i++) g.fillText(`${Math.round(((tMax * i) / 3) / 60)}m`, pad + (W * i) / 3, H + 6);
      ps.forEach((p, i) => {
        g.strokeStyle = p.color; g.lineWidth = 2; g.lineJoin = 'round';
        g.beginPath();
        this.history.forEach((h, n) => {
          const x = pad + (h.t / tMax) * W, y = 3 + H - (h[key][i] / yMax) * H;
          if (n) g.lineTo(x, y); else g.moveTo(x, y);
        });
        g.stroke();
      });
    }
  }

  // Is this resource at its gather limit right now?
  isCapped(k) {
    const w = this.world;
    if (!w.gathered || !w.gathered[this.me]) return false;
    return w.gathered[this.me][k] >= w.capOf(this.me, k) - 0.01;
  }

  // ---------- HUD ----------
  updateHud() {
    const w = this.world, pl = this.pl, me = this.me;
    const rates = w.rates ? w.rates[me] : {};
    $('res').innerHTML = RES.map((k) => {
      if (k === 'oil' && pl.age < 3 && pl.res.oil < 1) return '';
      const cap = w.capOf(me, k), capped = this.isCapped(k);
      if (capped && pl.alive) {
        const now = performance.now();
        if (now - (this.capSeen[k] || -1e9) > 90000) {
          this.capSeen[k] = now;
          this.alert(`⚠️ ${k[0].toUpperCase() + k.slice(1)} is at its gather limit (${+cap.toFixed(1)}/s). More workers won't help. Research Commerce or build a Market.`, 'info');
        }
      }
      const got = (w.gathered && w.gathered[me] && w.gathered[me][k]) || 0;
      return `<span class="r" title="${k}: +${(rates[k] || 0).toFixed(1)} per second in total. Workers gather ${got.toFixed(1)} of a limit of ${cap.toFixed(1)} per second; anything over the limit is lost. Commerce techs and Markets raise the limit.">${RES_ICON[k]} ${fmt(pl.res[k])} <span class="rate ${capped ? 'capped' : ''}">${capped ? '⚠' : '+'}${(rates[k] || 0).toFixed(1)}/s</span><span class="capbar ${capped ? 'capped' : ''}"><i style="width:${Math.min(100, (100 * got) / cap).toFixed(0)}%"></i></span></span>`;
    }).join('') + `<span class="r" title="Population / cap">👥 <span class="${w.pop(me) >= w.popCap(me) ? 'low' : ''}">${w.pop(me)}/${w.popCap(me)}</span></span>`;
    $('age-label').textContent = `${AGES[pl.age]} Age`;
    const lim = w.settings.doomsday | 0;
    $('doom').textContent = lim > 0 ? `☢ ${this.s.doom}/${lim}` : (this.s.doom ? `☢ ${this.s.doom}` : '');
    const secs = Math.floor(this.s.tick * DT);
    const ph = this.r.dayPhase();
    $('clock').textContent = `${ph === 'night' ? '🌙' : ph === 'dusk' ? '🌇' : ph === 'dawn' ? '🌅' : '☀️'} ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const m = this.s.mods || {};
    const mods = [m.food && '🐸', m.speed && '🍺', m.gather && '📈'].filter(Boolean).join('');
    if (mods) $('clock').textContent = mods + ' ' + $('clock').textContent;
    if (w.truce()) {
      const left = Math.ceil((w.truceEnd - this.s.tick) * DT);
      $('clock').textContent = `🕊️ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · ${$('clock').textContent}`;
    }
    const idle = this.s.units.filter((u) => u.owner === me && u.type === 'citizen' && !u.ord).length;
    $('btn-idle').querySelector('span').textContent = idle;
    $('btn-idle').style.opacity = idle ? 1 : 0.5;
    this.updateSelInfo();
    this.updateCard();
  }

  // Building name for the owner's age. Gather buildings are named by their upgrade level instead.
  bldName(b) {
    const up = UPGRADE[b.type];
    if (up) return up.names[b.lvl || 0];
    return BLDS[b.type].names[this.s.players[b.owner].age];
  }

  orderText(u) {
    const o = u.ord;
    if (!o) return 'Idle';
    if (o.k === 'move') return o.am ? 'Attack-moving' : 'Moving';
    if (o.k === 'attack') return 'Attacking';
    if (o.k === 'rearm') return 'Flying home to reload';
    if (o.k === 'work') {
      const b = this.world.get(o.t);
      if (!b) return 'Working';
      const n = this.bldName(b);
      if (!b.done) return `Building ${n}`;
      if (BLDS[b.type].gather) return u.working ? `Gathering ${BLDS[b.type].gather} at ${n}` : `Going to ${n}`;
      return `Repairing ${n}`;
    }
    return '';
  }

  updateSelInfo() {
    const w = this.world;
    const ents = this.selected();
    const box = $('sel-info');
    if (!ents.length) {
      const nat = nationOf(this.pl);
      box.innerHTML = `<h3>${flagImg(this.pl.nation, 16)} ${esc(this.pl.name)} <span class="natname">of ${esc(nat.name)}</span></h3><div class="stats">${AGES[this.pl.age]} Age · Cities ${w.cityCount(this.me)}/${cityLimit(this.pl)} · <span title="${esc(nat.power.map(([t, d]) => `${t}: ${d}`).join('\n'))}">${nat.power.map(([t]) => esc(t)).join(' · ')}</span></div><div class="coach">${this.coachHtml()}</div><div class="stats">Select units or buildings. Right-click to give orders. <b>.</b> finds idle citizens, <b>H</b> goes home, <b>Z</b> marks a spot for allies.</div>`;
      return;
    }
    if (ents.length === 1) {
      const e = ents[0];
      if (e.kind === 'c') {
        const max = w.maxHp(e);
        box.innerHTML = `<h3>${e.mutant ? '☢️🐄' : '🐄'} ${esc(unitName(e))}</h3>
          <div class="stats">${e.mutant ? 'Mutant cow. Attacks anything nearby. Worth 300 food.' : 'A cow. Kill it for 120 food. Or just let it be.'}</div>
          <div class="hpbar"><div style="width:${(100 * e.hp) / max}%"></div></div>
          <div class="stats">HP ${Math.ceil(e.hp)}/${max}</div><div class="stats"><i>${esc(cowMood(e))}</i></div>`;
        return;
      }
      const owner = this.s.players[e.owner];
      if (e.kind === 'u') {
        const st = w.stats(e.owner, e.type);
        const max = w.maxHp(e), mul = w.rankMul(e);
        box.innerHTML = `<h3>${UNITS[e.type].icon} ${esc(st.name)} ${e.rank ? `<span class="rank">${rankIcon(e.rank)}</span>` : ''}</h3>
          <div class="stats"><span class="swatch" style="background:${owner.color}"></span>${flagImg(owner.nation, 11)} ${esc(owner.name)} · <i>${esc(unitName(e, owner.nation))}</i></div>
          <div class="hpbar"><div style="width:${(100 * e.hp) / max}%"></div></div>
          <div class="stats">HP ${Math.ceil(e.hp)}/${Math.round(max)} · Attack ${(st.atk * mul).toFixed(0)} · Range ${st.range < 1 ? 'melee' : st.range} · Speed ${st.speed.toFixed(1)}${e.kills ? ` · Kills ${e.kills}` : ''}</div>
          ${st.uniq ? `<div class="stats uniq">${esc(st.desc)}</div>` : UNITS[e.type].desc && (st.air || st.aaOnly) ? `<div class="stats">${esc(UNITS[e.type].desc)}</div>` : ''}
          ${st.bomb ? `<div class="stats">Bombs: ${e.ammo ? 'loaded' : 'reloading'}</div>` : ''}
          <div class="stats">${e.owner === this.me ? this.orderText(e) : ''}</div>`;
      } else {
        const d = BLDS[e.type];
        const name = e.type === 'city' && e.name ? `${d.names[owner.age]}: ${e.name}` : this.bldName(e);
        let extra = '';
        if (!e.done) extra += `<div class="stats">Under construction: ${Math.floor((100 * e.prog) / d.time)}% — right-click with citizens to help</div>`;
        if (d.gather && e.done) {
          const n = (w.workerCount && w.workerCount.get(e.id)) || 0;
          const per = GATHER_RATE[d.gather] * gatherMult(owner, d.gather) * w.lvlMul(e);
          extra += `<div class="stats">Workers ${n}/${w.slots(e)} · ${RES_ICON[d.gather]} ${(per * 60).toFixed(0)} ${d.gather} per worker per minute</div>`;
          extra += `<div class="stats">Level ${e.lvl || 0}${e.lvl ? ` (+${Math.round(UPGRADE.rate * 100 * e.lvl)}% speed, +${UPGRADE.slots * e.lvl} workers)` : ''}${(e.lvl || 0) < AGES.length - 1 ? ` · ${(e.lvl || 0) >= owner.age ? `next upgrade in the ${AGES[(e.lvl || 0) + 1]} Age` : (e.lvl || 0) >= commerceLevel(owner) ? `next upgrade needs ${TECHS[`com${(e.lvl || 0) + 1}`].name}` : 'can be upgraded now'}` : ' · fully upgraded'}</div>`;
        }
        if (e.type === 'city') extra += `<div class="stats">Territory radius ${8 + owner.age} · Pop +${d.pop}</div>`;
        if (d.wonder) extra += `<div class="stats uniq">${esc(d.desc)}</div>`;
        if (e.type === 'rocket' && e.done) extra += `<div class="stats"><b>Launches in ${Math.max(0, Math.ceil((e.launchAt - this.s.tick) * DT))}s</b></div>`;
        if (e.type === 'market' && e.done) extra += `<div class="stats">Every Market you own raises all gather limits by ${Math.round(MARKET.capBonus * 100)}%. Price: ${MARKET.trade} buys ${Math.floor(MARKET.trade * tradeRate(owner))}.</div>`;
        if (e.type === 'silo') extra += `<div class="stats">Nukes ready: ${e.stock}/${NUKE.maxStock}</div>`;
        if (e.owner === this.me && e.q.length) {
          extra += '<div class="queue">' + e.q.map((it, i) => {
            const icon = it.k === 'unit' ? UNITS[it.type].icon : it.k === 'age' ? '⏫' : it.k === 'nuke' ? '☢️' : it.k === 'upg' ? '⬆️' : '📜';
            const title = it.k === 'unit' ? w.stats(this.me, it.type).name : it.k === 'age' ? `${AGES[this.pl.age + 1]} Age` : it.k === 'nuke' ? 'Nuke' : it.k === 'upg' ? `Upgrade to ${UPGRADE[e.type].names[(e.lvl || 0) + 1]}` : TECHS[it.type].name;
            const pct = i === 0 ? 100 * (1 - it.t / it.total) : 0;
            return `<div class="qitem ${it.blocked ? 'blocked' : ''}" data-b="${e.id}" data-i="${i}" title="${esc(title)}${it.blocked ? ' — population cap reached! Build more cities or research Civics.' : ''} (click to cancel)">${icon}<div class="bar" style="width:${pct}%"></div></div>`;
          }).join('') + '</div>';
        }
        box.innerHTML = `<h3>${d.icon} ${esc(name)}</h3>
          <div class="stats"><span class="swatch" style="background:${owner.color}"></span>${flagImg(owner.nation, 11)} ${esc(owner.name)}</div>
          <div class="hpbar"><div style="width:${(100 * e.hp) / w.maxHp(e)}%"></div></div>
          <div class="stats">HP ${Math.ceil(e.hp)}/${Math.round(w.maxHp(e))}</div>${extra}`;
      }
      return;
    }
    // many: group by type
    const groups = new Map();
    for (const e of ents) {
      const k = e.kind + e.type;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    let html = `<h3>${ents.length} selected</h3><div class="multi">`;
    for (const [, list] of groups) {
      for (const e of list.slice(0, 40)) {
        const max = w.maxHp(e);
        const icon = e.kind === 'u' ? UNITS[e.type].icon : BLDS[e.type].icon;
        html += `<div class="mu" data-ids="${e.id}" title="${esc(e.kind === 'u' ? w.stats(e.owner, e.type).name : BLDS[e.type].names[0])}">${icon}<div class="hb"><div style="width:${(100 * e.hp) / max}%"></div></div></div>`;
      }
    }
    box.innerHTML = html + '</div>';
  }

  // One tip for what to do next.
  coachHtml() {
    const w = this.world, pl = this.pl, me = this.me;
    if (!pl.alive) return '';
    const idle = this.s.units.filter((u) => u.owner === me && u.type === 'citizen' && !u.ord).length;
    if (idle) return `💤 ${idle} idle citizen${idle > 1 ? 's' : ''}. Press <b>.</b> and put ${idle > 1 ? 'them' : 'it'} to work.`;
    if (w.pop(me) >= w.popCap(me)) return '👥 Population is full. Build a city or research Civics at a Library.';
    const capped = RES.find((k) => this.isCapped(k));
    if (capped) return `⚠️ ${capped[0].toUpperCase() + capped.slice(1)} is at its limit. Research Commerce at a Library or build a Market (K).`;
    const mine = this.s.blds.filter((b) => b.owner === me && b.done);
    if (!mine.some((b) => b.type === 'library')) return `📚 Build a Library (Y). You need Science from it to reach the next age.`;
    if (pl.age < AGES.length - 1) {
      const up = AGE_UP[pl.age];
      if (up.needs && !pl.techs[up.needs] && !pl.pending[up.needs]) return `📜 Research ${TECHS[up.needs].name} at a Library. The ${AGES[pl.age + 1]} Age needs it.`;
      if (!pl.pending.age && up.needs && pl.techs[up.needs] && w.canAfford(me, up.cost)) return `⏫ You can advance to the ${AGES[pl.age + 1]} Age. Select a city and press U.`;
    }
    const com = commerceLevel(pl);
    if (com < pl.age && !pl.pending[`com${com + 1}`] && TECHS[`com${com + 1}`]) return `💰 ${TECHS[`com${com + 1}`].name} raises your gather limits and lets you upgrade buildings.`;
    if (!mine.some((b) => BLDS[b.type].trains && b.type !== 'city')) return '⚔️ Build a Barracks (B) so you can defend yourself.';
    if (this.world.settings.wonders !== false && pl.age >= 1 && !(pl.st && pl.st.wonders)) return '🏛️ Wonders give big bonuses. Select a citizen and press J.';
    return '🚩 Build an army and take a city from someone.';
  }

  // Build the list of buttons for the command card.
  cardList() {
    const w = this.world, pl = this.pl, me = this.me;
    const mine = this.mineSel();
    const list = [];
    if (!mine.length || !pl.alive) return list;
    const units = mine.filter((e) => e.kind === 'u');
    const blds = mine.filter((e) => e.kind === 'b');
    if (units.length) {
      const cits = units.filter((u) => u.type === 'citizen');
      if (cits.length && this.cardPage === 'wonders' && w.settings.wonders !== false) {
        for (const type of WONDERS) {
          const d = BLDS[type];
          const taken = this.s.blds.find((b) => b.type === type);
          let need = '';
          if (taken) need = `${taken.owner === me ? 'You are' : `${this.s.players[taken.owner].name} is`} already ${taken.done ? 'the owner' : 'building it'}`;
          else if (pl.age < d.age) need = `Needs the ${AGES[d.age]} Age`;
          else if (d.needTech && !pl.techs[d.needTech]) need = `Needs ${TECHS[d.needTech].name}`;
          list.push({
            icon: d.icon, label: d.names[0], cost: d.cost, need, desc: `<b>Only one in the whole game.</b> ${d.desc}`,
            active: this.mode && this.mode.k === 'place' && this.mode.type === type,
            fn: () => { this.mode = { k: 'place', type }; this.cardPage = null; },
          });
        }
        list.push({ key: 'J', icon: '↩️', label: 'Back', desc: 'Back to normal buildings.', fn: () => { this.cardPage = null; } });
        return list;
      }
      if (cits.length) {
        for (const type of BUILD_ORDER) {
          const d = BLDS[type];
          let need = '';
          if (pl.age < d.age) need = `Needs the ${AGES[d.age]} Age`;
          else if (d.needTech && !pl.techs[d.needTech]) need = `Needs ${TECHS[d.needTech].name}`;
          else if (type === 'city' && w.cityCount(me) >= cityLimit(pl)) need = `City limit reached (${cityLimit(pl)})`;
          if (d.age > pl.age + 1 && type !== 'silo') continue;
          if (type === 'silo' && pl.age < 4) continue;
          list.push({
            key: d.key, icon: d.icon, label: d.names[pl.age], cost: d.cost, need, desc: d.desc,
            active: this.mode && this.mode.k === 'place' && this.mode.type === type,
            fn: () => { this.mode = { k: 'place', type }; },
          });
        }
      }
      if (cits.length && w.settings.wonders !== false) {
        list.push({ key: 'J', icon: '🏛️', label: 'Wonders', desc: 'Huge buildings with huge bonuses. There is only one of each in the whole game, so build it before someone else does.', fn: () => { this.cardPage = 'wonders'; } });
      }
      const mil = units.filter((u) => u.type !== 'citizen');
      if (mil.length || !cits.length) {
        list.push({ key: 'A', icon: '⚔️', label: 'Attack-move', desc: 'Move and fight anything on the way.', fn: () => { this.mode = { k: 'target', what: 'am' }; } });
      }
      list.push({ key: 'S', icon: '✋', label: 'Stop', desc: 'Stop what they are doing.', fn: () => this.send({ c: 'stop', ids: units.map((u) => u.id) }) });
      return list;
    }
    // Buildings: only same-type groups get the card.
    const type = blds[0].type;
    if (!blds.every((b) => b.type === type)) return list;
    const done = blds.filter((b) => b.done);
    if (!done.length) return list;
    const d = BLDS[type];
    const pick = () => done.slice().sort((a, b) => a.q.length - b.q.length)[0];
    if (d.trains) {
      for (const ut of d.trains) {
        const ud = UNITS[ut];
        if (!forNation(pl, ud)) continue;
        if (ud.nation && pl.age + 1 < ud.age) continue;
        const st = w.stats(me, ut);
        const queued = done.reduce((n, b) => n + b.q.filter((q) => q.type === ut).length, 0);
        list.push({
          key: ud.key, icon: ud.icon, label: st.name, cost: st.cost, need: pl.age < ud.age ? `Needs the ${AGES[ud.age]} Age` : '', count: queued,
          desc: `${st.uniq ? '⭐ ' : ''}${st.desc}<br>HP ${Math.round(st.hp)} · Attack ${st.atk.toFixed(0)} · Range ${st.range < 1 ? 'melee' : st.range} · ${+st.time.toFixed(1)}s${ud.batch ? ` · makes ${ud.batch}` : ''}`,
          fn: (shift) => { for (let i = 0; i < (shift ? 5 : 1); i++) this.send({ c: 'train', b: pick().id, type: ut }); },
        });
      }
    }
    if (type === 'city' && pl.age < AGES.length - 1) {
      const up = AGE_UP[pl.age];
      list.push({
        key: 'U', icon: '⏫', label: `${AGES[pl.age + 1]} Age`, cost: up.cost, need: pl.pending.age ? 'Already researching' : up.needs && !pl.techs[up.needs] ? `Research ${TECHS[up.needs].name} at a Library first` : '',
        desc: `Advance to the ${AGES[pl.age + 1]} Age. Units upgrade automatically, new buildings and techs unlock, and your borders grow. Takes ${up.time}s.`,
        fn: () => this.send({ c: 'research', b: pick().id, tech: 'age' }),
      });
    }
    if (d.research) {
      // National tech first. For chains (Agriculture -> Irrigation -> Fertiliser) only show the next step.
      // Then Science and Commerce, which everything else leans on. What you can't research yet goes last.
      const rank = (t) => (t.nation ? 0 : t.line === 'sci' ? 1 : t.line === 'com' ? 2 : 3);
      const techs = [];
      for (const tk of TECH_ORDER) {
        const t = TECHS[tk];
        if (pl.techs[tk] || !forNation(pl, t)) continue;
        if (t.age > pl.age + 1) continue;
        const reqs = techReqs(t);
        if (reqs[0] && !pl.techs[reqs[0]] && !pl.pending[reqs[0]]) continue; // the chain's parent comes first
        const missing = reqs.filter((r) => !pl.techs[r]);
        let need = '';
        if (pl.pending[tk]) need = 'Researching…';
        else if (pl.age < t.age) need = `Needs the ${AGES[t.age]} Age`;
        else if (missing.length) need = `Needs ${missing.map((r) => TECHS[r].name).join(' and ')}`;
        techs.push({ tk, t, need });
      }
      techs.sort((a, b) => (a.need ? 10 : 0) + rank(a.t) - (b.need ? 10 : 0) - rank(b.t));
      for (const { tk, t, need } of techs) {
        list.push({
          icon: tk === 'manhattan' ? '☢️' : tk === 'sdi' ? '🛡️' : t.nation ? '⭐' : t.line === 'sci' ? '🔬' : t.line === 'com' ? '💰' : '📜', label: t.name, cost: techCost(pl, tk), need,
          desc: `${t.nation ? `<b>${NATIONS[t.nation].name} national tech.</b> ` : ''}${t.desc} Takes ${+techTime(pl, tk).toFixed(1)}s.`, fn: () => this.send({ c: 'research', b: pick().id, tech: tk }),
        });
      }
    }
    if (d.nukes) {
      const b = done[0];
      list.push({
        key: 'N', icon: '☢️', label: 'Build Nuke', cost: NUKE.cost, need: b.q.length + b.stock >= NUKE.maxStock ? 'Silo is full' : '',
        desc: `A nuclear missile. Takes ${NUKE.time}s. Kills everything within ${NUKE.killRadius} tiles, ruins cities, and leaves fallout.`,
        fn: () => this.send({ c: 'train', b: b.id, type: 'nuke' }),
      });
      const ready = done.find((x) => x.stock > 0);
      list.push({
        key: 'L', icon: '🚀', label: 'LAUNCH', need: ready ? '' : 'No nuke ready', count: done.reduce((n, x) => n + x.stock, 0),
        desc: 'Pick a target anywhere on the map. Everyone will see it coming.',
        active: this.mode && this.mode.what === 'nuke',
        fn: () => { const r = done.find((x) => x.stock > 0); if (r) this.mode = { k: 'target', what: 'nuke', b: r.id }; },
      });
    }
    if (type === 'market') {
      const rate = Math.floor(MARKET.trade * tradeRate(pl));
      const keys = { food: 'F', wood: 'D', metal: 'E', oil: 'G' };
      for (const to of RES) {
        if (to === 'oil' && pl.age < 3) continue;
        // Pays with whatever you have the most of.
        const from = RES.filter((k) => k !== to).sort((a, b) => pl.res[b] - pl.res[a])[0];
        list.push({
          key: keys[to], icon: RES_ICON[to], label: `Buy ${rate} ${to}`, cost: { [from]: MARKET.trade },
          need: pl.res[from] < MARKET.trade ? `You need ${MARKET.trade} of another resource` : '',
          desc: `Pay ${MARKET.trade} of your most plentiful resource and get ${rate} ${to}. Commerce techs give better prices. Shift = 5 times.`,
          fn: (shift) => {
            for (let i = 0; i < (shift ? 5 : 1); i++) {
              const f = RES.filter((k) => k !== to).sort((a, b) => this.pl.res[b] - this.pl.res[a])[0];
              this.send({ c: 'trade', from: f, to });
            }
          },
        });
      }
    }
    if (type === 'laser') {
      const b = done[0], left = Math.max(0, Math.ceil(((b.ready || 0) - this.s.tick) * DT));
      list.push({
        key: 'L', icon: '🛰️', label: 'Fire laser', need: left ? `Recharging: ${left}s` : '', count: left,
        desc: `Burns enemies in a ${LASER.radius} tile circle, ${LASER.delay}s after you click. Units there lose ${Math.round(LASER.unitDmg * 100)}% of their health and buildings ${Math.round(LASER.bldDmg * 100)}%. Your side is safe. Fires every ${LASER.every}s. Everyone can see the warning circle.`,
        active: this.mode && this.mode.what === 'laser',
        fn: () => { this.mode = { k: 'target', what: 'laser', b: b.id }; },
      });
    }
    if (UPGRADE[type]) {
      // Upgrade the least upgraded one first.
      const cands = () => done.filter((b) => !b.q.some((it) => it.k === 'upg')).sort((a, b) => (a.lvl || 0) - (b.lvl || 0) || a.id - b.id);
      const cand = cands();
      const b = cand[0] || done[0], lvl = (b.lvl || 0) + 1, up = UPGRADE[type];
      let need = '';
      if (lvl >= up.names.length) need = 'Fully upgraded';
      else if (!cand.length) need = 'Already upgrading';
      else if (lvl > pl.age) need = `Next upgrade in the ${AGES[lvl]} Age`;
      else if (lvl > commerceLevel(pl)) need = `Needs ${TECHS[`com${lvl}`].name} at a Library`;
      const name = up.names[Math.min(lvl, up.names.length - 1)];
      list.push({
        key: 'U', icon: '⬆️', label: `Upgrade: ${name}`, cost: lvl < up.names.length ? upgradeCost(type, lvl) : null, need,
        desc: `Each upgrade gives +${Math.round(UPGRADE.rate * 100)}% gathering speed and room for ${UPGRADE.slots} more worker. One upgrade per age. Takes ${upgradeTime(lvl)}s.${done.length > 1 ? ' With several selected, it upgrades the lowest one first.' : ''}`,
        fn: () => { const c = cands()[0]; if (c) this.send({ c: 'upgrade', b: c.id }); },
      });
    }
    if (done.some((b) => b.q.length)) {
      list.push({ key: 'X', icon: '✖️', label: 'Cancel last', desc: 'Cancel the last item in the queue and get the resources back.', fn: () => { const b = done.find((x) => x.q.length); if (b) this.send({ c: 'cancel', b: b.id }); } });
    }
    return list;
  }

  updateCard() {
    const list = this.cardList();
    const res = this.pl.res;
    for (const a of list) {
      a.enabled = !a.need;
      a.poor = a.cost && Object.entries(a.cost).some(([k, v]) => res[k] < v);
    }
    this.cardActions = list;
    const sig = list.map((a) => `${a.key}|${a.label}|${a.enabled}|${a.poor}|${a.active}|${a.count || 0}`).join(';');
    if (sig === this.cardSig) return;
    this.cardSig = sig;
    $('cmd-card').innerHTML = list.map((a, i) => `<button class="cmd ${a.enabled ? '' : 'off'} ${a.poor ? 'poor' : ''} ${a.active ? 'active' : ''}" data-i="${i}">
      ${a.key ? `<span class="hk">${a.key}</span>` : ''}${a.count ? `<span class="cnt">${a.count}</span>` : ''}<span class="ic">${a.icon}</span>${esc(a.label)}</button>`).join('');
  }

  showTip(e) {
    const btn = e.target.closest('.cmd');
    const tip = $('tooltip');
    if (!btn) return;
    const a = this.cardActions[btn.dataset.i];
    if (!a) return;
    tip.innerHTML = `<b>${esc(a.label)}</b>${a.key ? ` <span style="color:#9aa4ad">[${a.key}]</span>` : ''}
      ${a.cost ? `<div class="cost">${costHtml(a.cost, this.pl.res)}</div>` : ''}
      ${a.need ? `<div class="need">${esc(a.need)}</div>` : ''}<div>${a.desc || ''}</div>`;
    tip.classList.remove('hidden');
    const r = btn.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - 310, r.left) + 'px';
    tip.style.top = '0px';
    const h = tip.getBoundingClientRect().height;
    tip.style.top = (r.top - h - 8) + 'px';
  }
}
