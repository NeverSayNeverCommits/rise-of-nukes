// Menu and lobby screens. Starts the game UI when the host starts the game.
import { Session, MAX_PLAYERS } from './session.js';
import { GameUI } from './game.js';
import { PLAYER_COLORS } from './sim/data.js';
import { sfx, say, audioSettings, setAudio } from './sfx.js';
import { NATIONS, NATION_KEYS, NATION_UNITS, NATION_TECHS } from './sim/nations.js';
import { flagImg } from './flags.js';
import { BOT_LEVELS } from './bot.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let session = null;
let game = null;

function show(id) {
  for (const s of ['menu', 'lobby', 'game']) $(s).classList.toggle('hidden', s !== id);
}

function status(el, text, err = false) {
  $(el).textContent = text;
  $(el).classList.toggle('err', err);
}

function playerName() {
  const n = $('name').value.trim() || 'Commander';
  localStorage.setItem('ron-name', n);
  return n;
}

function uiCallbacks() {
  return {
    onLobby: (lobby, me) => renderLobby(lobby, me),
    onStart: () => startGameUI(),
    onChat: (msg) => {
      if (game) game.chatLine(msg);
      const log = $('lobby-log');
      const el = document.createElement('div');
      if (msg.p < 0) { el.className = 'sys'; el.textContent = msg.text; }
      else el.innerHTML = `<b style="color:${esc(msg.color || '#fff')}">${esc(msg.name)}:</b> ${esc(msg.text)}`;
      log.appendChild(el); log.scrollTop = log.scrollHeight;
    },
    onStatus: (t) => { status('lobby-status', t); status('menu-status', t); },
    onError: (t) => {
      if (game) { game.alert(t, 'bad'); return; }
      status('lobby-status', t, true); status('menu-status', t, true);
      if (session && session.mode === 'client' && !session.lobby.players.length) { session.leave(); session = null; show('menu'); }
    },
    onDisconnected: () => {
      if (game) { game.alert('Lost connection to the host. The game cannot continue.', 'bad'); game.chatLine({ p: -1, text: 'Disconnected from host. Rejoin with the same code and name if the host is still there.' }); }
      else { show('menu'); status('menu-status', 'Disconnected from the host.', true); session = null; }
    },
    onResync: () => { if (game) game.chatLine({ p: -1, text: 'Game state synced with host.' }); },
    onPause: (on, name) => { if (game) game.onPause(on, name); },
    onSpeed: (x) => { if (game) game.onSpeed(x); },
    onPing: (msg) => { if (game) game.onPing(msg); },
    onLobbyBack: () => {
      if (game) { game.destroy(); game = null; }
      show('lobby');
      if (session) renderLobby(session.publicLobby ? session.mode === 'client' ? session.lobby : session.publicLobby() : session.lobby, session.me);
      status('lobby-status', session && session.isHost ? 'Ready for another round. Change anything you like and start.' : 'Back in the lobby. Waiting for the host…');
    },
  };
}

function renderLobby(lobby, me) {
  // During a game this only keeps the list up to date. Don't leave the game screen.
  if (session.world) return;
  show('lobby');
  const host = session.isHost;
  $('room-box').classList.toggle('hidden', session.mode === 'solo');
  $('room-code').textContent = lobby.code || session.code || '…';
  const tb = $('player-table').querySelector('tbody');
  tb.innerHTML = lobby.players.map((p, i) => {
    const mine = i === me;
    // The host sets up bots the same way you set up yourself.
    const edit = mine || (host && p.bot);
    const colorSel = edit
      ? `<select data-color>${PLAYER_COLORS.map((c) => `<option value="${c}" ${c === p.color ? 'selected' : ''} style="background:${c}">${c === p.color ? '■ ' : ''}${colorName(c)}</option>`).join('')}</select>`
      : `<span class="swatch" style="background:${p.color}"></span>${colorName(p.color)}`;
    const natSel = edit
      ? `<select data-nation><option value="random" ${p.nation === 'random' ? 'selected' : ''}>🎲 Random</option>${NATION_KEYS.map((k) => `<option value="${k}" ${k === p.nation ? 'selected' : ''}>${NATIONS[k].name}</option>`).join('')}</select>`
      : nationLabel(p.nation);
    const teamSel = edit
      ? `<select data-team>${Array.from({ length: MAX_PLAYERS }, (_, t) => `<option value="${t}" ${t === p.team ? 'selected' : ''}>Team ${t + 1}</option>`).join('')}</select>`
      : `Team ${p.team + 1}`;
    const kick = host && i !== 0 ? `<button class="small secondary" data-kick="${i}">${p.bot ? 'Remove' : 'Kick'}</button>` : '';
    const lvl = p.bot && host
      ? `<select data-level>${Object.entries(BOT_LEVELS).map(([k, v]) => `<option value="${k}" ${k === p.bot ? 'selected' : ''}>${v.name}</option>`).join('')}</select>`
      : p.bot ? esc(BOT_LEVELS[p.bot]?.name || '') : '';
    return `<tr data-slot="${i}"><td><span class="swatch" style="background:${p.color}"></span>${p.bot ? '🤖 ' : ''}${esc(p.name)}${i === 0 ? ' 👑' : ''}${mine ? ' (you)' : ''}${p.online === false ? ' (offline)' : ''} ${lvl}</td><td><span class="nat">${flagImg(p.nation || 'random', 16)}${natSel}</span></td><td>${colorSel}</td><td>${teamSel}</td><td>${kick}</td></tr>`;
  }).join('');
  // Each row's selects change that row's player: yourself, or (for the host) a bot.
  const setRow = (e, v) => {
    const slot = +e.target.closest('tr').dataset.slot;
    if (slot === me) session.setMine(v); else session.setBot(slot, v);
  };
  tb.querySelectorAll('[data-color]').forEach((el) => el.addEventListener('change', (e) => setRow(e, { color: e.target.value })));
  tb.querySelectorAll('[data-nation]').forEach((el) => el.addEventListener('change', (e) => {
    if (+e.target.closest('tr').dataset.slot === me) localStorage.setItem('ron-nation', e.target.value);
    setRow(e, { nation: e.target.value });
  }));
  renderNationCard(lobby.players[me]?.nation);
  tb.querySelectorAll('[data-team]').forEach((el) => el.addEventListener('change', (e) => setRow(e, { team: +e.target.value })));
  tb.querySelectorAll('[data-level]').forEach((el) => el.addEventListener('change', (e) => setRow(e, { level: e.target.value })));
  $('bot-row').classList.toggle('hidden', !host);
  tb.querySelectorAll('[data-kick]').forEach((b) => b.addEventListener('click', () => session.kick(+b.dataset.kick)));
  for (const sel of $('settings').querySelectorAll('select')) {
    const k = sel.dataset.set;
    sel.value = String(lobby.settings[k]);
    sel.disabled = !host;
  }
  $('btn-start').classList.toggle('hidden', !host);
  const n = lobby.players.length;
  if (host) {
    $('btn-start').disabled = false;
    const humans = lobby.players.filter((p) => !p.bot).length;
    const teams = new Set(lobby.players.map((p) => p.team)).size;
    status('lobby-status', n < 2
      ? (session.mode === 'solo' ? 'Sandbox: just you, no enemies. Add a bot if you want a fight.' : 'Send the room code or invite link to your friends, or add bots.')
      : teams < 2 ? 'Everyone is on the same team, so nobody can win. Put a bot on another team for a co-op game.'
        : `${humans} ${humans === 1 ? 'player' : 'players'}${n > humans ? ` and ${n - humans} ${n - humans === 1 ? 'bot' : 'bots'}` : ''} ready.`);
  } else status('lobby-status', 'Waiting for the host to start…');
}

const nationLabel = (k) => (NATIONS[k] ? NATIONS[k].name : 'Random');

// The box under the player list that explains your nation.
function renderNationCard(k) {
  const box = $('nation-card');
  const n = NATIONS[k];
  if (!n) {
    box.innerHTML = `<h3>${flagImg('random', 22)} Random nation</h3><div class="motto">You will find out when the game starts. Exciting!</div>
      <div class="nat-grid">${NATION_KEYS.map((key) => `<div>${flagImg(key, 14)} <b>${NATIONS[key].name}</b>: ${esc(NATIONS[key].motto)}</div>`).join('')}</div>`;
    return;
  }
  const sig = NATION_UNITS[n.signature], tech = NATION_TECHS[n.tech];
  box.innerHTML = `<h3>${flagImg(k, 22)} ${n.name}</h3><div class="motto">“${esc(n.motto)}”</div>
    <div class="nat-grid">
      <div><b>National power</b><ul>${n.power.map(([t, d]) => `<li><b>${esc(t)}:</b> ${esc(d)}</li>`).join('')}</ul></div>
      <div><b>Unique units</b><ul>${n.unique.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>
        <b>Signature unit</b><ul><li>${sig.icon} <b>${esc(sig.names[sig.age])}</b> (${esc(['Ancient', 'Classical', 'Gunpowder', 'Industrial', 'Atomic'][sig.age])} Age): ${esc(sig.desc.replace(/^[^.]*signature unit\. /, ''))}</li></ul>
        <b>National tech</b><ul><li>📜 <b>${esc(tech.name)}</b>: ${esc(tech.desc)}</li></ul></div>
    </div>`;
}

const COLOR_NAMES = { '#e74c3c': 'Red', '#3498db': 'Blue', '#2ecc71': 'Green', '#f1c40f': 'Yellow', '#9b59b6': 'Purple', '#e67e22': 'Orange', '#1abc9c': 'Teal', '#ecf0f1': 'White' };
function colorName(c) { return COLOR_NAMES[c] || c; }

function startGameUI() {
  show('game');
  if (game) game.destroy();
  game = new GameUI(session, quitToMenu);
  game.chatLine({ p: -1, text: 'Game started. Press Enter to chat. Good luck, commander.' });
}

function quitToMenu() {
  if (game) { game.destroy(); game = null; }
  if (session) { session.leave(); session = null; }
  // Simplest way to reset everything cleanly.
  location.href = location.pathname;
}

// ---------- menu buttons ----------
$('name').value = localStorage.getItem('ron-name') || '';
const params = new URLSearchParams(location.search);
if (params.get('join')) $('join-code').value = params.get('join').toUpperCase();

$('btn-host').addEventListener('click', () => {
  sfx.unlock();
  if (!window.Peer) { status('menu-status', 'Networking library failed to load. Check your connection and reload.', true); return; }
  session = new Session('host', playerName(), uiCallbacks());
  status('menu-status', 'Creating room…');
  session.host();
});

$('btn-solo').addEventListener('click', () => {
  sfx.unlock();
  session = new Session('solo', playerName(), uiCallbacks());
  session.host();
});

$('btn-join').addEventListener('click', () => {
  sfx.unlock();
  const code = $('join-code').value.trim().toUpperCase();
  if (code.length !== 5) { status('menu-status', 'Room codes have 5 letters.', true); return; }
  if (!window.Peer) { status('menu-status', 'Networking library failed to load. Check your connection and reload.', true); return; }
  session = new Session('client', playerName(), uiCallbacks());
  status('menu-status', 'Connecting…');
  session.join(code);
});
$('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });

// ---------- lobby buttons ----------
$('btn-start').addEventListener('click', () => session && session.startGame());
$('btn-add-bot').addEventListener('click', () => session && session.addBot($('bot-level').value));
$('btn-leave').addEventListener('click', quitToMenu);
$('btn-copy').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?join=${session.code}`;
  try { await navigator.clipboard.writeText(url); status('lobby-status', 'Invite link copied!'); }
  catch { prompt('Copy this link:', url); }
});
for (const sel of $('settings').querySelectorAll('select')) {
  sel.addEventListener('change', () => {
    const k = sel.dataset.set;
    const v = ['startAge', 'doomsday', 'speed', 'noRush'].includes(k) ? +sel.value : k === 'silly' || k === 'wonders' ? sel.value === 'true' : sel.value;
    session.setSettings({ [k]: v });
  });
}
$('lobby-chat').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && session) { session.sendChat(e.target.value); e.target.value = ''; }
});

// ---------- sound & display settings ----------
function openSettings() {
  const a = audioSettings();
  $('set-vol').value = a.vol; $('set-music').value = a.music;
  $('set-voice').checked = a.voice; $('set-muted').checked = a.muted;
  $('set-night').checked = localStorage.getItem('ron-night') !== '0';
  $('set-wheel').value = localStorage.getItem('ron-wheel') || 'zoom';
  $('set-edge').checked = localStorage.getItem('ron-edge') !== '0';
  $('settings-panel').classList.remove('hidden');
}
$('btn-settings').addEventListener('click', () => { sfx.unlock(); openSettings(); });
$('btn-sound').addEventListener('click', () => { sfx.unlock(); openSettings(); });
$('btn-menu-settings').addEventListener('click', openSettings);
$('btn-settings-close').addEventListener('click', () => $('settings-panel').classList.add('hidden'));
$('set-vol').addEventListener('input', (e) => setAudio('vol', +e.target.value));
$('set-vol').addEventListener('change', () => sfx.play('explode', { v: 0.6 }));
$('set-music').addEventListener('input', (e) => setAudio('music', +e.target.value));
$('set-voice').addEventListener('change', (e) => { setAudio('voice', e.target.checked); if (e.target.checked) say('Voices on. Hello, commander.', 'announcer'); });
$('set-muted').addEventListener('change', (e) => setAudio('muted', e.target.checked));
$('set-night').addEventListener('change', (e) => {
  localStorage.setItem('ron-night', e.target.checked ? '1' : '0');
  if (game) game.r.noNight = !e.target.checked;
});
$('set-wheel').addEventListener('change', (e) => localStorage.setItem('ron-wheel', e.target.value));
$('set-edge').addEventListener('change', (e) => localStorage.setItem('ron-edge', e.target.checked ? '1' : '0'));
$('btn-test-sound').addEventListener('click', () => { sfx.unlock(); sfx.play('moo', { v: 1 }); setTimeout(() => say('This is a test cow.', 1), 2000); });

// A random silly line under the title.
const TAGLINES = ['Now with 40% more cows.', 'Mutually assured entertainment.', 'The cows are not friendly. Well, most of them.',
  'Peace was never an option.', 'Featuring a Doomsday Clock that is definitely fine.', 'Not responsible for friendships lost.',
  'Contains nuclear weapons and one (1) sad potato.', 'Unit voices may contain sarcasm.', 'Duck and cover. Mostly duck.',
  'Diplomacy is just nuking with extra steps.', 'Warning: meteors are not covered by insurance.', 'Happy hour is a valid military strategy.'];
$('tagline').textContent = TAGLINES[Math.floor(Math.random() * TAGLINES.length)];

// Warn before closing the tab mid-game (closing the host's tab ends the game for everyone).
window.addEventListener('beforeunload', (e) => {
  if (game && session && session.mode !== 'solo') { e.preventDefault(); e.returnValue = ''; }
});

// Closing the tab: tell the others straight away instead of leaving them to work it out.
window.addEventListener('pagehide', () => { if (session) session.leave(); });

// Debug handle for the browser console.
window.ron = { get session() { return session; }, get game() { return game; } };
