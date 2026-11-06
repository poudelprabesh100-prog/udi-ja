// Udi Ja! lobby server: one Durable Object per lobby code, relaying a match of up to 3 kite players.
// Each client flies its own kite; the room only tracks who is in, durability, eliminations and the winner.
//
// Phones drop their connection the moment the browser goes to the background (to share a code in a chat app, say).
// So a player who disconnects keeps their seat for a while and takes it back by presenting the private token they
// joined with. Room state is saved to Durable Object storage, so the lobby also survives the object being evicted.
import { DurableObject } from 'cloudflare:workers';

const MAX_PLAYERS = 3;
const HEALTH = [3, 4, 4, 5];
const GROUNDS = ['valley', 'night', 'lake', 'fields', 'square'];
const IDLE_LOBBY_MS = 15 * 60 * 1000; // close connections of a lobby nobody has touched
const GRACE_LOBBY_MS = 10 * 60 * 1000; // how long an absent player keeps their seat in a lobby
const GRACE_PLAY_MS = 25 * 1000; // ...and during a match

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/ws') return new Response('Udi Ja! lobby server', { headers: { 'content-type': 'text/plain' } });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const code = (url.searchParams.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (code.length < 4) return new Response('Bad lobby code', { status: 400 });
    // No location hint: Cloudflare places the lobby near the first player, which measured fastest and steadiest
    // (a fixed 'apac' hint was sometimes much slower).
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
  },
};

const num = (v, lo, hi, fallback = 0) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : fallback);
const cleanName = (s) => String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 12) || 'Pilot';
const cleanToken = (s) => (/^[A-Za-z0-9]{8,40}$/.test(String(s || '')) ? String(s) : '');
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.players = new Map(); // id -> { id, name, skin, hp, alive, kills, token, ws, dropAt }
    this.board = new Map(); // id -> result row for the current match
    this.hostId = null;
    this.phase = 'lobby';
    this.ground = 'valley';
    this.nextId = 1;
    this.lastActive = Date.now();
    // Load saved state before handling any request (the object may have been evicted since the last visit).
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('room');
      if (saved) this.restore(saved);
    });
  }

  // ---- persistence -----------------------------------------------------------------------
  restore(saved) {
    const now = Date.now();
    this.hostId = saved.hostId;
    this.phase = saved.phase;
    this.ground = saved.ground;
    this.nextId = saved.nextId;
    this.board = new Map((saved.board || []).map((r) => [r.id, r]));
    for (const p of saved.players) {
      // After a restart nobody is connected yet; everyone gets a fresh window to come back.
      this.players.set(p.id, { ...p, ws: null, dropAt: now + (this.phase === 'play' ? GRACE_PLAY_MS : GRACE_LOBBY_MS) });
    }
    this.schedule();
  }

  save() {
    if (this.players.size === 0) {
      this.ctx.storage.deleteAll().catch(() => {});
      return;
    }
    this.ctx.storage.put('room', {
      hostId: this.hostId,
      phase: this.phase,
      ground: this.ground,
      nextId: this.nextId,
      board: [...this.board.values()],
      players: [...this.players.values()].map(({ id, name, skin, hp, alive, kills, token }) => ({ id, name, skin, hp, alive, kills, token })),
    }).catch(() => {});
  }

  // One alarm covers both jobs: expire players who stayed away too long, and close an abandoned lobby's connections.
  schedule() {
    let next = Infinity;
    let anyConnected = false;
    for (const p of this.players.values()) {
      if (p.ws) anyConnected = true;
      else next = Math.min(next, p.dropAt);
    }
    if (anyConnected && this.phase === 'lobby') next = Math.min(next, this.lastActive + IDLE_LOBBY_MS + 1000);
    if (next === Infinity) this.ctx.storage.deleteAlarm().catch(() => {});
    else this.ctx.storage.setAlarm(Math.max(next, Date.now() + 500)).catch(() => {});
  }

  async alarm() {
    await this.ready;
    const now = Date.now();
    for (const p of [...this.players.values()]) if (!p.ws && p.dropAt <= now) this.leave(p);
    if (this.phase === 'lobby' && now - this.lastActive > IDLE_LOBBY_MS) {
      for (const p of this.players.values()) if (p.ws) { try { p.ws.close(1000, 'idle'); } catch {} }
    }
    this.schedule();
  }

  // ---- connections -----------------------------------------------------------------------
  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);
    const create = url.searchParams.get('create') === '1';
    const token = cleanToken(url.searchParams.get('token'));
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();

    const refuse = (code, msg) => {
      this.send(server, { t: 'error', code, msg });
      try { server.close(1000, code); } catch {}
    };
    const returning = token ? [...this.players.values()].find((p) => p.token === token) : null;
    if (returning) this.rejoin(returning, server);
    else if (this.players.size === 0 && !create) refuse('notfound', 'Lobby not found. Check the code and try again.');
    else if (this.players.size > 0 && create) refuse('taken', 'That code is already in use.');
    else if (this.phase === 'play') refuse('started', 'That match has already started. Try again once it ends.');
    else if (this.players.size >= MAX_PLAYERS) refuse('full', 'This lobby is full (3 players max).');
    else this.join(server, url, token);

    return new Response(null, { status: 101, webSocket: client });
  }

  bind(p, ws) {
    if (p.ws && p.ws !== ws) {
      const old = p.ws;
      p.ws = null; // so the old socket's close event is ignored
      try { old.close(1000, 'replaced'); } catch {}
    }
    p.ws = ws;
    p.dropAt = 0;
    this.lastActive = Date.now();
    ws.addEventListener('message', (e) => this.onMessage(p, ws, e.data));
    ws.addEventListener('close', () => {
      try { ws.close(1000, 'bye'); } catch {} // answer the client's close so its side finishes closing too
      this.drop(p, ws);
    });
    ws.addEventListener('error', () => this.drop(p, ws));
  }

  join(ws, url, token) {
    const id = String(this.nextId++);
    const skin = num(url.searchParams.get('skin'), 0, 3, 0) | 0;
    const player = { id, name: cleanName(url.searchParams.get('name')), skin, hp: HEALTH[skin], alive: true, kills: 0, token: token || randomToken(), ws: null, dropAt: 0 };
    this.players.set(id, player);
    if (!this.hostId) this.hostId = id;
    this.bind(player, ws);
    this.send(ws, { t: 'welcome', id, host: this.hostId });
    this.sendRoster();
    this.save();
    this.schedule();
  }

  // A player came back (same private token): give them their seat back, and the match state if one is running.
  rejoin(p, ws) {
    this.bind(p, ws);
    this.send(ws, { t: 'welcome', id: p.id, host: this.hostId, rejoined: true });
    if (this.phase === 'play') this.send(ws, { t: 'resume', ground: this.ground, players: this.matchPlayers() });
    this.sendRoster();
    this.save();
    this.schedule();
  }

  // Socket closed: hold the seat for a while instead of dropping the player.
  drop(p, ws) {
    if (this.players.get(p.id) !== p || p.ws !== ws) return;
    p.ws = null;
    p.dropAt = Date.now() + (this.phase === 'play' ? GRACE_PLAY_MS : GRACE_LOBBY_MS);
    this.sendRoster();
    this.save();
    this.schedule();
  }

  send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }

  broadcast(obj, exceptId) {
    const text = JSON.stringify(obj);
    for (const p of this.players.values()) if (p.id !== exceptId && p.ws) { try { p.ws.send(text); } catch {} }
  }

  matchPlayers() {
    return [...this.players.values()].map(({ id, name, skin, hp, alive }) => ({ id, name, skin, hp, alive }));
  }

  sendRoster() {
    this.broadcast({
      t: 'roster',
      phase: this.phase,
      host: this.hostId,
      ground: this.ground,
      players: [...this.players.values()].map(({ id, name, skin, hp, alive, kills, ws }) => ({ id, name, skin, hp, alive, kills, away: !ws })),
    });
  }

  // ---- messages --------------------------------------------------------------------------
  onMessage(p, ws, data) {
    if (p.ws !== ws || typeof data !== 'string' || data.length > 400) return;
    let m;
    try { m = JSON.parse(data); } catch { return; }
    switch (m.t) {
      case 'ping':
        this.send(p.ws, { t: 'pong', ts: m.ts });
        return;
      case 'leave': // the player chose to leave: free the seat now
        this.leave(p);
        return;
      case 'pos':
        if (this.phase !== 'play' || !p.alive) return;
        this.broadcast({ t: 'pos', id: p.id, x: num(m.x, 0, 1), y: num(m.y, 0, 1), l: num(m.l, 0, 100, 50) }, p.id);
        return;
      case 'cut': {
        if (this.phase !== 'play' || !p.alive) return;
        const target = this.players.get(String(m.to));
        if (target && target.alive && target !== p && target.ws) this.send(target.ws, { t: 'cut', from: p.id });
        return;
      }
      case 'block': {
        const target = this.players.get(String(m.to));
        if (this.phase === 'play' && target && target.ws) this.send(target.ws, { t: 'block', from: p.id });
        return;
      }
      case 'hit':
        if (this.phase === 'play' && p.alive) this.hit(p, String(m.by));
        break;
      case 'skin':
        if (this.phase !== 'lobby') return;
        p.skin = num(m.skin, 0, 3, 0) | 0;
        p.hp = HEALTH[p.skin];
        this.sendRoster();
        break;
      case 'name':
        p.name = cleanName(m.name);
        this.sendRoster();
        break;
      case 'ground':
        if (p.id !== this.hostId || this.phase !== 'lobby' || !GROUNDS.includes(m.ground)) return;
        this.ground = m.ground;
        this.sendRoster();
        break;
      case 'start':
        if (p.id !== this.hostId || this.phase !== 'lobby') return;
        if ([...this.players.values()].filter((q) => q.ws).length < 2) return;
        this.startMatch();
        break;
      default:
        return;
    }
    this.lastActive = Date.now();
    this.save();
    this.schedule();
  }

  startMatch() {
    // Anyone still away when the host starts is left behind.
    for (const q of [...this.players.values()]) if (!q.ws) this.removePlayer(q);
    this.phase = 'play';
    this.board = new Map();
    for (const p of this.players.values()) {
      p.hp = HEALTH[p.skin];
      p.alive = true;
      p.kills = 0;
      this.board.set(p.id, { id: p.id, name: p.name, skin: p.skin, kills: 0, place: 0 });
    }
    this.broadcast({
      t: 'start',
      ground: this.ground,
      players: [...this.players.values()].map(({ id, name, skin, hp }) => ({ id, name, skin, hp })),
    });
  }

  aliveCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.alive) n++;
    return n;
  }

  hit(victim, byId) {
    victim.hp -= 1;
    const by = byId !== victim.id ? this.players.get(byId) : null;
    this.broadcast({ t: 'hp', id: victim.id, hp: Math.max(0, victim.hp), by: by ? by.id : null });
    if (victim.hp > 0) return;
    this.eliminate(victim, by);
  }

  eliminate(victim, by) {
    victim.alive = false;
    if (by) {
      by.kills += 1;
      const row = this.board.get(by.id);
      if (row) row.kills = by.kills;
    }
    const row = this.board.get(victim.id);
    if (row) row.place = this.aliveCount() + 1;
    this.broadcast({ t: 'dead', id: victim.id, by: by ? by.id : null });
    this.checkEnd();
  }

  checkEnd() {
    if (this.phase !== 'play') return;
    const alive = [...this.players.values()].filter((p) => p.alive);
    if (alive.length > 1) return;
    const winner = alive[0] || null;
    if (winner) {
      const row = this.board.get(winner.id);
      if (row) row.place = 1;
    }
    const standings = [...this.board.values()].sort((a, b) => a.place - b.place || b.kills - a.kills);
    this.phase = 'lobby';
    this.lastActive = Date.now();
    this.broadcast({ t: 'end', winner: winner ? winner.id : null, standings });
    for (const p of this.players.values()) {
      p.hp = HEALTH[p.skin]; p.alive = true; p.kills = 0;
      if (!p.ws) p.dropAt = Date.now() + GRACE_LOBBY_MS; // anyone who was away mid-match gets the longer lobby grace
    }
    this.sendRoster();
  }

  // A player's seat is gone for good (they left, or stayed away too long).
  removePlayer(p) {
    this.players.delete(p.id);
    if (p.ws) { const old = p.ws; p.ws = null; try { old.close(1000, 'left'); } catch {} }
    if (this.hostId === p.id) this.hostId = this.players.keys().next().value ?? null;
    if (this.players.size === 0) {
      this.phase = 'lobby';
      this.ground = 'valley';
      this.board = new Map();
    }
  }

  leave(p) {
    if (this.players.get(p.id) !== p) return;
    if (this.phase === 'play' && p.alive) {
      p.alive = false;
      const row = this.board.get(p.id);
      if (row) row.place = this.aliveCount() + 1;
      this.broadcast({ t: 'dead', id: p.id, by: null, left: true }, p.id);
    }
    this.removePlayer(p);
    if (this.players.size > 0) {
      this.checkEnd();
      this.sendRoster();
    }
    this.save();
    this.schedule();
  }
}
