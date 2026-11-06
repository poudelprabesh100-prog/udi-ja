// Udi Ja! lobby server: one Durable Object per lobby code, relaying a match of up to 3 kite players.
// Each client flies its own kite; the room only tracks who is in, durability, eliminations and the winner.
import { DurableObject } from 'cloudflare:workers';

const MAX_PLAYERS = 3;
const HEALTH = [3, 4, 4, 5];
const GROUNDS = ['valley', 'night', 'lake', 'fields', 'square'];
const IDLE_LOBBY_MS = 15 * 60 * 1000;

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

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.players = new Map(); // id -> { id, name, skin, hp, alive, kills, ws }
    this.board = new Map(); // id -> result row for the current match
    this.hostId = null;
    this.phase = 'lobby';
    this.ground = 'valley';
    this.nextId = 1;
    this.lastActive = Date.now();
    this.timer = 0;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const create = url.searchParams.get('create') === '1';
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();

    const refuse = (code, msg) => {
      this.send(server, { t: 'error', code, msg });
      try { server.close(1000, code); } catch {}
    };
    if (this.players.size === 0 && !create) refuse('notfound', 'Lobby not found. Check the code and try again.');
    else if (this.players.size > 0 && create) refuse('taken', 'That code is already in use.');
    else if (this.phase === 'play') refuse('started', 'That match has already started. Try again once it ends.');
    else if (this.players.size >= MAX_PLAYERS) refuse('full', 'This lobby is full (3 players max).');
    else this.join(server, url);

    return new Response(null, { status: 101, webSocket: client });
  }

  join(ws, url) {
    const id = String(this.nextId++);
    const skin = num(url.searchParams.get('skin'), 0, 3, 0) | 0;
    const player = { id, name: cleanName(url.searchParams.get('name')), skin, hp: HEALTH[skin], alive: true, kills: 0, ws };
    this.players.set(id, player);
    if (!this.hostId) this.hostId = id;
    this.lastActive = Date.now();
    if (!this.timer) this.timer = setInterval(() => this.sweep(), 60_000);

    ws.addEventListener('message', (e) => this.onMessage(player, e.data));
    ws.addEventListener('close', () => this.leave(player));
    ws.addEventListener('error', () => this.leave(player));

    this.send(ws, { t: 'welcome', id, host: this.hostId });
    this.sendRoster();
  }

  send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }

  broadcast(obj, exceptId) {
    const text = JSON.stringify(obj);
    for (const p of this.players.values()) if (p.id !== exceptId) { try { p.ws.send(text); } catch {} }
  }

  sendRoster() {
    this.broadcast({
      t: 'roster',
      phase: this.phase,
      host: this.hostId,
      ground: this.ground,
      players: [...this.players.values()].map(({ id, name, skin, hp, alive, kills }) => ({ id, name, skin, hp, alive, kills })),
    });
  }

  onMessage(p, data) {
    if (typeof data !== 'string' || data.length > 400) return;
    let m;
    try { m = JSON.parse(data); } catch { return; }
    switch (m.t) {
      case 'ping':
        this.send(p.ws, { t: 'pong', ts: m.ts });
        return;
      case 'pos':
        if (this.phase !== 'play' || !p.alive) return;
        this.broadcast({ t: 'pos', id: p.id, x: num(m.x, 0, 1), y: num(m.y, 0, 1), l: num(m.l, 0, 100, 50) }, p.id);
        return;
      case 'cut': {
        if (this.phase !== 'play' || !p.alive) return;
        const target = this.players.get(String(m.to));
        if (target && target.alive && target !== p) this.send(target.ws, { t: 'cut', from: p.id });
        return;
      }
      case 'block': {
        const target = this.players.get(String(m.to));
        if (this.phase === 'play' && target) this.send(target.ws, { t: 'block', from: p.id });
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
        if (p.id !== this.hostId || this.phase !== 'lobby' || this.players.size < 2) return;
        this.startMatch();
        break;
      default:
        return;
    }
    this.lastActive = Date.now();
  }

  startMatch() {
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
    this.broadcast({ t: 'end', winner: winner ? winner.id : null, standings });
    for (const p of this.players.values()) { p.hp = HEALTH[p.skin]; p.alive = true; p.kills = 0; }
    this.sendRoster();
  }

  leave(p) {
    if (this.players.get(p.id) !== p) return;
    if (this.phase === 'play' && p.alive) {
      p.alive = false;
      const row = this.board.get(p.id);
      if (row) row.place = this.aliveCount() + 1;
      this.broadcast({ t: 'dead', id: p.id, by: null, left: true }, p.id);
    }
    this.players.delete(p.id);
    if (this.hostId === p.id) this.hostId = this.players.keys().next().value ?? null;
    if (this.players.size === 0) {
      clearInterval(this.timer);
      this.timer = 0;
      this.phase = 'lobby';
      this.ground = 'valley';
      return;
    }
    this.checkEnd();
    this.sendRoster();
  }

  // Close lobbies nobody has touched for a while so they stop using free-plan duration.
  sweep() {
    if (this.phase === 'lobby' && Date.now() - this.lastActive > IDLE_LOBBY_MS) {
      for (const p of [...this.players.values()]) { try { p.ws.close(1000, 'idle'); } catch {} }
    }
  }
}
