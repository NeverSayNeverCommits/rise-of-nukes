// In-game user interface: mouse and keyboard input, the HUD, and alerts.
import { Renderer } from './render.js';
import { UNITS, BLDS, TECHS, TECH_ORDER, AGES, AGE_UP, NUKE, RES, RES_ICON, BUILD_ORDER, cityLimit } from './sim/data.js';
import { DT } from './sim/sim.js';
import { sfx, toggleMute } from './sfx.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.floor(n).toLocaleString('en');
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

    const city = this.world.s.blds.find((b) => b.owner === this.me && b.type === 'city');
    if (city) this.r.centreOn(city.x + 1.5, city.y + 1.5);
    this.bind();
    this.running = true;
    requestAnimationFrame((t) => this.loop(t));
  }

  destroy() {
    this.running = false;
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
    for (const u of this.s.units) {
      if (!w.ally(this.me, u.owner) && !this.r.isVisible(u.x, u.y)) continue;
      const dx = u.x - wx, dy = u.y - wy, d = dx * dx + dy * dy;
      const rr = UNITS[u.type].radius + 0.25;
      if (d < rr * rr && d < bd) { bd = d; best = u; }
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
    on(cv, 'wheel', (e) => { e.preventDefault(); this.r.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
    on(document, 'mouseleave', () => { this.mouse.inside = false; });
    on(window, 'blur', () => { this.keys.clear(); this.mouse.inside = false; });
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
      if (e.button === 2) { this.contextAt(x, y, null); return; }
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
    on($('btn-over-watch'), 'click', () => { $('game-over').classList.add('hidden'); this.r.spectate = true; });
    const ci = $('chat-input');
    on(ci, 'keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { this.session.sendChat(ci.value); ci.value = ''; this.closeChat(); }
      if (e.key === 'Escape') this.closeChat();
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

  openChat() { const ci = $('chat-input'); ci.classList.remove('hidden'); $('chat-log').classList.add('open'); ci.focus(); }
  closeChat() { const ci = $('chat-input'); ci.classList.add('hidden'); $('chat-log').classList.remove('open'); ci.blur(); }

  onDown(e) {
    sfx.unlock();
    const x = e.offsetX, y = e.offsetY;
    if (e.button === 1) { e.preventDefault(); this.mouse.pan = { x, y, cx: this.r.cam.x, cy: this.r.cam.y }; return; }
    if (e.button === 2) {
      if (this.mode) { this.mode = null; return; }
      const [wx, wy] = this.r.toWorld(x, y);
      this.contextAt(wx, wy, this.pick(x, y), e.shiftKey);
      return;
    }
    if (e.button !== 0) return;
    if (this.mode && this.mode.k === 'place') {
      const g = this.ghostAt(x, y);
      if (g.ok) {
        const cits = this.mineSel().filter((u) => u.kind === 'u' && u.type === 'citizen').map((u) => u.id);
        this.send({ c: 'build', ids: cits, type: this.mode.type, x: g.x, y: g.y });
        sfx.click();
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
      }
      return;
    }
    const [ax, ay] = this.r.toWorld(Math.min(x, d.x), Math.min(y, d.y));
    const [bx, by] = this.r.toWorld(Math.max(x, d.x), Math.max(y, d.y));
    const inBox = this.s.units.filter((u) => u.owner === this.me && u.x >= ax && u.x <= bx && u.y >= ay && u.y <= by);
    if (!e.shiftKey) this.sel = new Set();
    // Prefer soldiers when the box has both soldiers and citizens? Keep both: it's simpler to understand.
    for (const u of inBox) this.sel.add(u.id);
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
      if (target && w.enemy(this.me, target.owner)) {
        this.send({ c: 'attack', ids: units.map((u) => u.id), t: target.id });
        this.r.addMarker(...w.centre(target), '#ff4040');
        return;
      }
      if (target && target.kind === 'b' && target.owner === this.me) {
        const cits = units.filter((u) => u.type === 'citizen');
        const rest = units.filter((u) => u.type !== 'citizen');
        if (cits.length) {
          this.send({ c: 'work', ids: cits.map((u) => u.id), t: target.id });
          this.r.addMarker(...w.centre(target), '#ffcc33');
        }
        if (rest.length) this.send({ c: 'move', ids: rest.map((u) => u.id), x: wx, y: wy });
        return;
      }
      this.send({ c: 'move', ids: units.map((u) => u.id), x: wx, y: wy });
      this.r.addMarker(wx, wy, '#7ee787');
      return;
    }
    for (const b of blds) {
      if (target && target !== b && (target.kind === 'b' || w.enemy(this.me, target.owner))) this.send({ c: 'rally', b: b.id, t: target.id });
      else this.send({ c: 'rally', b: b.id, x: wx, y: wy });
    }
    this.r.addMarker(wx, wy, '#ffffff');
  }

  targetAt(wx, wy, shift) {
    const m = this.mode;
    if (m.what === 'am') {
      const ids = this.mineSel().filter((e) => e.kind === 'u').map((u) => u.id);
      this.send({ c: 'move', ids, x: wx, y: wy, am: true });
      this.r.addMarker(wx, wy, '#ff9900');
    } else if (m.what === 'nuke') {
      this.send({ c: 'launch', b: m.b, x: wx, y: wy });
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
      if (this.mode) this.mode = null;
      else if (!$('game-menu').classList.contains('hidden')) this.toggleMenu(false);
      else if (this.sel.size) this.sel.clear();
      else this.toggleMenu(true);
      return;
    }
    if (k === 'F10') { e.preventDefault(); this.toggleMenu(true); return; }
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
    if (up === 'M') { const m = toggleMute(); this.alert(m ? 'Sound off' : 'Sound on', 'info'); return; }
    // Command card hotkeys first (refresh the card so it matches the current selection).
    this.updateCard();
    const act = (this.cardActions || []).find((a) => a.key === up && a.enabled);
    if (act) { e.preventDefault(); sfx.click(); act.fn(e.shiftKey); return; }
    if (up === 'H') {
      const cities = this.s.blds.filter((b) => b.owner === this.me && b.type === 'city');
      if (cities.length) { const c = cities[this.homeIdx++ % cities.length]; this.r.centreOn(c.x + 1.5, c.y + 1.5); this.sel = new Set([c.id]); }
    }
  }

  nextIdle() {
    const idle = this.s.units.filter((u) => u.owner === this.me && u.type === 'citizen' && !u.ord);
    if (!idle.length) return;
    const u = idle[this.idleIdx++ % idle.length];
    this.sel = new Set([u.id]);
    this.r.centreOn(u.x, u.y);
  }

  toggleMenu(show) {
    $('game-menu').classList.toggle('hidden', !show);
    if (show) $('score-table').innerHTML = this.scoreHtml();
  }

  scoreHtml() {
    const rows = this.s.players.map((p, i) => {
      const units = this.s.units.filter((u) => u.owner === i).length;
      const cities = this.s.blds.filter((b) => b.owner === i && b.type === 'city').length;
      return `<tr><td><span class="swatch" style="background:${p.color}"></span>${esc(p.name)}${p.alive ? '' : ' 💀'}</td><td>${p.team + 1}</td><td>${AGES[p.age]}</td><td>${cities}</td><td>${units}</td><td>${p.kills}</td><td>${p.lost}</td><td>${p.nukes}</td></tr>`;
    }).join('');
    return `<table class="scores"><tr><th>Player</th><th>Team</th><th>Age</th><th>Cities</th><th>Units</th><th>Kills</th><th>Lost</th><th>☢</th></tr>${rows}</table>`;
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
    if (msg.p < 0) { el.classList.add('sys'); el.textContent = msg.text; }
    else el.innerHTML = `<b style="color:${esc(msg.color || '#fff')}">${esc(msg.name)}:</b> ${esc(msg.text)}`;
    const log = $('chat-log');
    log.appendChild(el);
    while (log.children.length > 8) log.firstChild.remove();
  }

  handleEvents(evs) {
    const w = this.world, me = this.me;
    const name = (p) => (this.s.players[p] ? this.s.players[p].name : '?');
    const [cx, cy] = this.r.toWorld(this.r.vw / 2, this.r.vh / 2);
    for (const e of evs) {
      const fresh = this.s.tick - e.tick < 60;
      switch (e.type) {
        case 'error': if (e.p === me && fresh) { this.alert(e.msg, 'bad'); sfx.error(); } break;
        case 'attacked':
          if (e.p === me && fresh) {
            const now = performance.now();
            // Only alert if the fight is off screen, and not too often.
            const onScreen = Math.abs(e.x - cx) < this.r.vw / this.r.cam.z / 2 && Math.abs(e.y - cy) < this.r.vh / this.r.cam.z / 2;
            if (!onScreen && now - (this.lastAttackAlert || 0) > 8000) {
              this.lastAttackAlert = now;
              this.alert('You are under attack! (Space to look)', 'bad', [e.x, e.y]);
              this.r.ping(e.x, e.y);
              sfx.attack();
            }
          }
          break;
        case 'age':
          if (e.p === me) { this.alert(`Welcome to the ${AGES[e.age]} Age!`, 'good'); sfx.age(); }
          else this.alert(`${name(e.p)} reached the ${AGES[e.age]} Age`, 'info');
          break;
        case 'tech':
          if (e.tech === 'manhattan') this.alert(e.p === me ? 'Manhattan Project complete. You can build Missile Silos.' : `☢ ${name(e.p)} completed the Manhattan Project!`, e.p === me ? 'good' : 'bad');
          else if (e.p === me) { this.alert(`${TECHS[e.tech].name} researched`, 'good'); sfx.done(); }
          break;
        case 'built':
          if (e.p === me && fresh && (e.btype === 'city' || e.btype === 'silo')) { this.alert(`${BLDS[e.btype].names[this.pl.age]} complete`, 'good'); sfx.done(); }
          break;
        case 'captured':
          if (e.p === me) { this.alert(`You captured ${e.name || 'a city'}!`, 'good', [e.x, e.y]); sfx.done(); }
          else if (e.from === me) { this.alert(`${e.name || 'A city'} was captured by ${name(e.p)}!`, 'bad', [e.x, e.y]); sfx.attack(); }
          else this.alert(`${name(e.p)} captured a city from ${name(e.from)}`, 'info');
          break;
        case 'convert':
          if (e.from === me) this.alert('A building was lost to enemy territory', 'bad', [e.x, e.y]);
          break;
        case 'launch':
          if (!fresh) break;
          this.lastAlertPos = [e.x, e.y];
          if (e.p === me) this.alert('☢ Missile away!', 'nuke');
          else this.alert(`☢ NUCLEAR LAUNCH DETECTED (${name(e.p)}) — Space to look`, 'nuke');
          this.r.ping(e.x, e.y);
          sfx.siren();
          break;
        case 'nuke': {
          if (!fresh) break;
          sfx.nuke();
          const d = Math.hypot(e.x - cx, e.y - cy);
          if (d < 40) { const f = $('nuke-flash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 80); }
          this.alert(`☢ Doomsday Clock: ${this.s.doom}${w.settings.doomsday > 0 ? ' / ' + w.settings.doomsday : ''}`, 'bad');
          break;
        }
        case 'intercept': if (fresh) { this.alert(`Missile shot down over ${name(e.victim)}'s territory!`, 'good'); sfx.boom(); } break;
        case 'nukeReady': if (e.p === me) { this.alert('☢ Nuke ready to launch', 'good'); sfx.done(); } break;
        case 'destroyed': if (fresh && this.r.isVisible(e.x, e.y) && Math.hypot(e.x - cx, e.y - cy) < 25) sfx.boom(); break;
        case 'eliminated':
          this.alert(e.p === me ? 'You have been defeated.' : `${name(e.p)} has been defeated!`, e.p === me ? 'bad' : 'info');
          break;
      }
    }
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
    }
    if (dx || dy) { this.r.cam.x += dx; this.r.cam.y += dy; this.r.clampCam(); }

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
    this.canvas.style.cursor = this.mode ? 'crosshair' : hov && this.world.enemy(this.me, hov.owner) && this.mineSel().some((e) => e.kind === 'u') ? 'crosshair' : 'default';

    const ui = {
      sel: this.sel, hover: this.hover, alpha: this.session.alpha(),
      box: this.mouse.down && (Math.abs(this.mouse.x - this.mouse.down.x) > 4 || Math.abs(this.mouse.y - this.mouse.down.y) > 4)
        ? { x0: this.mouse.down.x, y0: this.mouse.down.y, x1: this.mouse.x, y1: this.mouse.y } : null,
      ghost: this.mode && this.mode.k === 'place' ? this.ghostAt(this.mouse.x, this.mouse.y) : null,
      targetMode: this.mode && this.mode.k === 'target' ? this.mode.what : null,
    };
    this.r.draw(ui);

    if (t - this.lastHud > 120) { this.lastHud = t; this.updateHud(); }
    if (t - this.lastMini > 200) { this.lastMini = t; this.r.drawMinimap($('minimap')); }
    this.checkOver();
  }

  checkOver() {
    const s = this.s;
    if (!this.pl.alive && !this.defeatShown && !s.over) {
      this.defeatShown = true;
      this.showOver('DEFEAT', 'You lost all your cities. You can keep watching the rest of the game.');
    }
    if (s.over && !this.overShown) {
      this.overShown = true;
      if (s.over.armageddon) this.showOver('☢ ARMAGEDDON ☢', 'The Doomsday Clock struck midnight. Too many nukes. Everybody loses.');
      else if (s.over.winnerTeam === this.pl.team) this.showOver('VICTORY', 'Your enemies are defeated.');
      else {
        const win = s.players.filter((p) => p.team === s.over.winnerTeam).map((p) => p.name).join(' & ');
        this.showOver('DEFEAT', `${win} won the game.`);
      }
    }
  }

  showOver(title, text) {
    $('over-title').textContent = title;
    $('over-text').textContent = text;
    $('over-scores').innerHTML = this.scoreHtml();
    $('game-over').classList.remove('hidden');
    this.r.spectate = true;
  }

  // ---------- HUD ----------
  updateHud() {
    const w = this.world, pl = this.pl, me = this.me;
    const rates = w.rates ? w.rates[me] : {};
    $('res').innerHTML = RES.map((k) => {
      if (k === 'oil' && pl.age < 3 && pl.res.oil < 1) return '';
      return `<span class="r" title="${k}">${RES_ICON[k]} ${fmt(pl.res[k])} <span class="rate">+${(rates[k] || 0).toFixed(1)}/s</span></span>`;
    }).join('') + `<span class="r" title="Population / cap">👥 <span class="${w.pop(me) >= w.popCap(me) ? 'low' : ''}">${w.pop(me)}/${w.popCap(me)}</span></span>`;
    $('age-label').textContent = `${AGES[pl.age]} Age`;
    const lim = w.settings.doomsday | 0;
    $('doom').textContent = lim > 0 ? `☢ ${this.s.doom}/${lim}` : (this.s.doom ? `☢ ${this.s.doom}` : '');
    const secs = Math.floor(this.s.tick * DT);
    $('clock').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const idle = this.s.units.filter((u) => u.owner === me && u.type === 'citizen' && !u.ord).length;
    $('btn-idle').querySelector('span').textContent = idle;
    $('btn-idle').style.opacity = idle ? 1 : 0.5;
    this.updateSelInfo();
    this.updateCard();
  }

  orderText(u) {
    const o = u.ord;
    if (!o) return 'Idle';
    if (o.k === 'move') return o.am ? 'Attack-moving' : 'Moving';
    if (o.k === 'attack') return 'Attacking';
    if (o.k === 'work') {
      const b = this.world.get(o.t);
      if (!b) return 'Working';
      const n = BLDS[b.type].names[this.s.players[b.owner].age];
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
      box.innerHTML = `<h3>${esc(this.pl.name)}</h3><div class="stats">${AGES[this.pl.age]} Age · Cities ${w.cityCount(this.me)}/${cityLimit(this.pl)}<br>Select units or buildings. Right-click to give orders.<br>Press <b>.</b> to find idle citizens, <b>H</b> for home.</div>`;
      return;
    }
    if (ents.length === 1) {
      const e = ents[0];
      const owner = this.s.players[e.owner];
      if (e.kind === 'u') {
        const st = w.stats(e.owner, e.type);
        box.innerHTML = `<h3>${UNITS[e.type].icon} ${esc(st.name)}</h3>
          <div class="stats"><span class="swatch" style="background:${owner.color}"></span>${esc(owner.name)}</div>
          <div class="hpbar"><div style="width:${(100 * e.hp) / st.hp}%"></div></div>
          <div class="stats">HP ${Math.ceil(e.hp)}/${Math.round(st.hp)} · Attack ${st.atk.toFixed(0)} · Range ${st.range < 1 ? 'melee' : st.range} · Speed ${st.speed.toFixed(1)}</div>
          <div class="stats">${e.owner === this.me ? this.orderText(e) : ''}</div>`;
      } else {
        const d = BLDS[e.type];
        const name = e.type === 'city' && e.name ? `${d.names[owner.age]}: ${e.name}` : d.names[owner.age];
        let extra = '';
        if (!e.done) extra += `<div class="stats">Under construction: ${Math.floor((100 * e.prog) / d.time)}% — right-click with citizens to help</div>`;
        if (d.gather && e.done) {
          const n = (w.workerCount && w.workerCount.get(e.id)) || 0;
          extra += `<div class="stats">Workers ${n}/${d.slots} · makes ${RES_ICON[d.gather]} ${d.gather}</div>`;
        }
        if (e.type === 'city') extra += `<div class="stats">Territory radius ${8 + owner.age} · Pop +${d.pop}</div>`;
        if (e.type === 'silo') extra += `<div class="stats">Nukes ready: ${e.stock}/${NUKE.maxStock}</div>`;
        if (e.owner === this.me && e.q.length) {
          extra += '<div class="queue">' + e.q.map((it, i) => {
            const icon = it.k === 'unit' ? UNITS[it.type].icon : it.k === 'age' ? '⏫' : it.k === 'nuke' ? '☢️' : '📜';
            const title = it.k === 'unit' ? w.stats(this.me, it.type).name : it.k === 'age' ? `${AGES[this.pl.age + 1]} Age` : it.k === 'nuke' ? 'Nuke' : TECHS[it.type].name;
            const pct = i === 0 ? 100 * (1 - it.t / it.total) : 0;
            return `<div class="qitem ${it.blocked ? 'blocked' : ''}" data-b="${e.id}" data-i="${i}" title="${esc(title)}${it.blocked ? ' — population cap reached! Build more cities or research Civics.' : ''} (click to cancel)">${icon}<div class="bar" style="width:${pct}%"></div></div>`;
          }).join('') + '</div>';
        }
        box.innerHTML = `<h3>${d.icon} ${esc(name)}</h3>
          <div class="stats"><span class="swatch" style="background:${owner.color}"></span>${esc(owner.name)}</div>
          <div class="hpbar"><div style="width:${(100 * e.hp) / d.hp}%"></div></div>
          <div class="stats">HP ${Math.ceil(e.hp)}/${d.hp}</div>${extra}`;
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
        const max = e.kind === 'u' ? w.stats(e.owner, e.type).hp : BLDS[e.type].hp;
        const icon = e.kind === 'u' ? UNITS[e.type].icon : BLDS[e.type].icon;
        html += `<div class="mu" data-ids="${e.id}" title="${esc(e.kind === 'u' ? w.stats(e.owner, e.type).name : BLDS[e.type].names[0])}">${icon}<div class="hb"><div style="width:${(100 * e.hp) / max}%"></div></div></div>`;
      }
    }
    box.innerHTML = html + '</div>';
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
        const st = w.stats(me, ut);
        const queued = done.reduce((n, b) => n + b.q.filter((q) => q.type === ut).length, 0);
        list.push({
          key: ud.key, icon: ud.icon, label: st.name, cost: st.cost, need: pl.age < ud.age ? `Needs the ${AGES[ud.age]} Age` : '', count: queued,
          desc: `${ud.desc}<br>HP ${Math.round(st.hp)} · Attack ${st.atk.toFixed(0)} · Range ${st.range < 1 ? 'melee' : st.range} · ${st.time}s`,
          fn: (shift) => { for (let i = 0; i < (shift ? 5 : 1); i++) this.send({ c: 'train', b: pick().id, type: ut }); },
        });
      }
    }
    if (type === 'city' && pl.age < AGES.length - 1) {
      const up = AGE_UP[pl.age];
      list.push({
        key: 'U', icon: '⏫', label: `${AGES[pl.age + 1]} Age`, cost: up.cost, need: pl.pending.age ? 'Already researching' : '',
        desc: `Advance to the ${AGES[pl.age + 1]} Age. Units upgrade automatically, new buildings and techs unlock, and your borders grow. Takes ${up.time}s.`,
        fn: () => this.send({ c: 'research', b: pick().id, tech: 'age' }),
      });
    }
    if (d.research) {
      for (const tk of TECH_ORDER) {
        const t = TECHS[tk];
        if (pl.techs[tk]) continue;
        if (t.age > pl.age + 1) continue;
        let need = '';
        if (pl.pending[tk]) need = 'Researching…';
        else if (pl.age < t.age) need = `Needs the ${AGES[t.age]} Age`;
        else if (t.req && !pl.techs[t.req]) need = `Needs ${TECHS[t.req].name}`;
        list.push({
          icon: tk === 'manhattan' ? '☢️' : tk === 'sdi' ? '🛡️' : '📜', label: t.name, cost: t.cost, need,
          desc: `${t.desc} Takes ${t.time}s.`, fn: () => this.send({ c: 'research', b: pick().id, tech: tk }),
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
