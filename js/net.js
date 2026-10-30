// Peer-to-peer networking with PeerJS (WebRTC).
// The host's browser is the hub: every other player connects to the host only.
// PeerJS's free public server is only used to introduce browsers to each other.

const PREFIX = 'rise-of-nukes-v1-';
const CHUNK = 15000; // big messages are split, some browsers drop data channel messages over ~16-64 KB

export function makeRoomCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const buf = new Uint32Array(5);
  crypto.getRandomValues(buf);
  for (const n of buf) s += abc[n % abc.length];
  return s;
}

function peerOptions() {
  return {
    debug: 1,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
      ],
    },
  };
}

// Splits and rejoins large messages.
class Wire {
  constructor(conn, onMessage) {
    this.conn = conn;
    this.parts = new Map();
    conn.on('data', (raw) => {
      let msg = raw;
      if (typeof raw === 'string') {
        try { msg = JSON.parse(raw); } catch { return; }
      }
      if (msg && msg.t === '_part') {
        let p = this.parts.get(msg.id);
        if (!p) { p = []; this.parts.set(msg.id, p); }
        p[msg.i] = msg.d;
        if (p.filter((x) => x != null).length === msg.n) {
          this.parts.delete(msg.id);
          onMessage(JSON.parse(p.join('')));
        }
        return;
      }
      onMessage(msg);
    });
  }

  send(msg) {
    if (!this.conn.open) return;
    const s = JSON.stringify(msg);
    if (s.length <= CHUNK) { this.conn.send(s); return; }
    const id = Math.random().toString(36).slice(2);
    const n = Math.ceil(s.length / CHUNK);
    for (let i = 0; i < n; i++) this.conn.send(JSON.stringify({ t: '_part', id, i, n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) }));
  }
}

function friendlyError(err) {
  const t = err && err.type;
  if (t === 'peer-unavailable') return 'No game found with that code. Check the code and that the host is still in the lobby.';
  if (t === 'unavailable-id') return 'That room code is taken. Try again.';
  if (t === 'network' || t === 'server-error' || t === 'socket-error') return 'Could not reach the matchmaking server. Check your internet connection.';
  if (t === 'browser-incompatible') return 'Your browser does not support WebRTC.';
  return (err && err.message) || String(err);
}

export class HostNet {
  // handlers: onReady(code), onJoin(connId), onMessage(connId, msg), onLeave(connId), onError(text)
  constructor(handlers) {
    this.h = handlers;
    this.conns = new Map(); // connId -> Wire
    this.open(0);
  }

  open(attempt) {
    const code = makeRoomCode();
    const peer = new window.Peer(PREFIX + code, peerOptions());
    this.peer = peer;
    peer.on('open', () => { this.code = code; this.h.onReady(code); });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id' && attempt < 3) { peer.destroy(); this.open(attempt + 1); return; }
      if (err.type === 'peer-unavailable') return;
      this.h.onError(friendlyError(err));
    });
    peer.on('disconnected', () => {
      // Lost the matchmaking server. Existing games keep working; try to reconnect so new joins work.
      setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 2000);
    });
    peer.on('connection', (conn) => {
      const id = conn.connectionId;
      conn.on('open', () => {
        const wire = new Wire(conn, (msg) => this.h.onMessage(id, msg));
        this.conns.set(id, wire);
        this.h.onJoin(id);
      });
      conn.on('close', () => { if (this.conns.delete(id)) this.h.onLeave(id); });
      conn.on('error', () => { if (this.conns.delete(id)) this.h.onLeave(id); });
    });
  }

  send(connId, msg) { const w = this.conns.get(connId); if (w) w.send(msg); }
  broadcast(msg, except = null) {
    // Stringify once for the common small-message case.
    for (const [id, w] of this.conns) if (id !== except) w.send(msg);
  }
  kick(connId) { const w = this.conns.get(connId); if (w) w.conn.close(); }
  close() { try { this.peer.destroy(); } catch { /* ignore */ } }
}

export class ClientNet {
  // handlers: onOpen(), onMessage(msg), onClose(), onError(text)
  constructor(code, handlers) {
    this.h = handlers;
    const peer = new window.Peer(undefined, peerOptions());
    this.peer = peer;
    let opened = false;
    const timeout = setTimeout(() => { if (!opened) handlers.onError('Timed out connecting to the host. The host may be behind a strict firewall, try another host.'); }, 20000);
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true, serialization: 'raw' });
      this.conn = conn;
      conn.on('open', () => {
        opened = true; clearTimeout(timeout);
        this.wire = new Wire(conn, (msg) => handlers.onMessage(msg));
        handlers.onOpen();
      });
      conn.on('close', () => handlers.onClose());
      conn.on('error', (e) => handlers.onError(friendlyError(e)));
    });
    peer.on('error', (err) => { clearTimeout(timeout); handlers.onError(friendlyError(err)); });
  }

  send(msg) { if (this.wire) this.wire.send(msg); }
  close() { try { this.peer.destroy(); } catch { /* ignore */ } }
}
