// Menu and lobby screens. Starts the game UI when the host starts the game.
import { Session, MAX_PLAYERS } from './session.js';
import { GameUI } from './game.js';
import { PLAYER_COLORS } from './sim/data.js';
import { sfx } from './sfx.js';

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
  };
}

function renderLobby(lobby, me) {
  show('lobby');
  const host = session.isHost;
  $('room-box').classList.toggle('hidden', session.mode === 'solo');
  $('room-code').textContent = lobby.code || session.code || '…';
  const tb = $('player-table').querySelector('tbody');
  tb.innerHTML = lobby.players.map((p, i) => {
    const mine = i === me;
    const colorSel = mine
      ? `<select data-color>${PLAYER_COLORS.map((c) => `<option value="${c}" ${c === p.color ? 'selected' : ''} style="background:${c}">${c === p.color ? '■ ' : ''}${colorName(c)}</option>`).join('')}</select>`
      : `<span class="swatch" style="background:${p.color}"></span>${colorName(p.color)}`;
    const teamSel = mine
      ? `<select data-team>${Array.from({ length: MAX_PLAYERS }, (_, t) => `<option value="${t}" ${t === p.team ? 'selected' : ''}>Team ${t + 1}</option>`).join('')}</select>`
      : `Team ${p.team + 1}`;
    const kick = host && i !== 0 ? `<button class="small secondary" data-kick="${i}">Kick</button>` : '';
    return `<tr><td><span class="swatch" style="background:${p.color}"></span>${esc(p.name)}${i === 0 ? ' 👑' : ''}${mine ? ' (you)' : ''}${p.online === false ? ' (offline)' : ''}</td><td>${colorSel}</td><td>${teamSel}</td><td>${kick}</td></tr>`;
  }).join('');
  tb.querySelector('[data-color]')?.addEventListener('change', (e) => session.setMine({ color: e.target.value }));
  tb.querySelector('[data-team]')?.addEventListener('change', (e) => session.setMine({ team: +e.target.value }));
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
    status('lobby-status', session.mode === 'solo'
      ? 'Practice mode: just you, no enemies. Good for learning and testing.'
      : n < 2 ? 'Send the room code or invite link to your friends. You can also start alone.' : `${n} players ready.`);
  } else status('lobby-status', 'Waiting for the host to start…');
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
$('btn-leave').addEventListener('click', quitToMenu);
$('btn-copy').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?join=${session.code}`;
  try { await navigator.clipboard.writeText(url); status('lobby-status', 'Invite link copied!'); }
  catch { prompt('Copy this link:', url); }
});
for (const sel of $('settings').querySelectorAll('select')) {
  sel.addEventListener('change', () => {
    const k = sel.dataset.set;
    const v = ['startAge', 'doomsday'].includes(k) ? +sel.value : sel.value;
    session.setSettings({ [k]: v });
  });
}
$('lobby-chat').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && session) { session.sendChat(e.target.value); e.target.value = ''; }
});

// Warn before closing the tab mid-game (closing the host's tab ends the game for everyone).
window.addEventListener('beforeunload', (e) => {
  if (game && session && session.mode !== 'solo') { e.preventDefault(); e.returnValue = ''; }
});

// Debug handle for the browser console.
window.ron = { get session() { return session; }, get game() { return game; } };
