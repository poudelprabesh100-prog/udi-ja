// Multiplayer: lobbies of up to 3 friends, relayed through the Cloudflare Durable Object in /server.
// Each player flies their own kite and reports where it is. A cut is sent to the victim, whose own
// game decides whether it lands (dodge / brace protect) and reports the hit back to the room.
(() => {
  const DEPLOYED_URL = 'wss://udi-ja-rooms.poudelprabesh100.workers.dev/ws';
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  // On localhost the game talks to a local copy of the lobby server (run `npx wrangler dev` in /server).
  const SERVER = local ? (new URLSearchParams(location.search).get('server') || 'ws://127.0.0.1:8787/ws') : DEPLOYED_URL;
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const el = (id) => document.getElementById(id);

  let ws = null, myId = null, hostId = null, code = '', players = [], phase = 'lobby';
  let inRoom = false, over = false, soloMode = 'survival', latency = 0, pingTimer = 0;
  let sentPos = { x: -1, y: -1, l: -1 }, posAt = 0, settled = true, createTries = 0, endTimer = 0;
  const MIN_DELAY = 90, MAX_DELAY = 280, MAX_EXTRAPOLATE = 120;
  const LEAD_SHARE = .6, MAX_LEAD_S = .2, MAX_LEAD_PX = 45; // how far ahead of the delayed position other kites are drawn

  // Position of a remote kite at time t, from its received samples (oldest first).
  function sampleAt(buf, t) {
    const first = buf[0], last = buf[buf.length - 1];
    if (buf.length === 1 || t <= first.t) return first;
    if (t >= last.t) {
      // ran out of data: keep gliding along the last velocity for a moment, then hold
      const prev = buf[buf.length - 2], span = last.t - prev.t;
      if (span < 5 || span > 600) return last;
      const k = Math.min(t - last.t, MAX_EXTRAPOLATE) / span;
      return { x: last.x + (last.x - prev.x) * k, y: last.y + (last.y - prev.y) * k, l: last.l };
    }
    let i = buf.length - 1;
    while (i > 1 && buf[i - 1].t > t) i--;
    const a = buf[i - 1], b = buf[i], f = (t - a.t) / (b.t - a.t || 1);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, l: a.l + (b.l - a.l) * f };
  }

  const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const note = (text, bad) => { const n = el('mpNote'); n.textContent = text || ''; n.classList.toggle('bad', !!bad); };
  const isHost = () => inRoom && myId === hostId;

  // ---- name ------------------------------------------------------------------------------
  const nameInput = el('pname');
  try { nameInput.value = localStorage.tiharName || ''; } catch {}
  const cleanName = () => {
    let n = nameInput.value.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 12);
    if (!n) n = 'Pilot' + Math.floor(10 + Math.random() * 90);
    try { localStorage.tiharName = n; } catch {}
    return n;
  };
  nameInput.addEventListener('change', () => { const n = cleanName(); nameInput.value = n; send({ t: 'name', name: n }); });

  // ---- connection ------------------------------------------------------------------------
  // A private token identifies this player to the room. Phones close the connection as soon as the browser goes
  // to the background (to paste a code into a chat, say); the token lets us walk back into the same seat.
  const memoryToken = Array.from({ length: 16 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  function token() {
    try {
      if (!sessionStorage.tiharToken) sessionStorage.tiharToken = memoryToken;
      return sessionStorage.tiharToken;
    } catch { return memoryToken; }
  }
  const savedRoom = () => { try { return sessionStorage.tiharRoom || ''; } catch { return ''; } };
  const rememberRoom = (c) => { try { if (c) sessionStorage.tiharRoom = c; else sessionStorage.removeItem('tiharRoom'); } catch {} };

  let welcomed = false, lastPongAt = 0, retryTimer = 0, retries = 0, netText = '';

  // rejoin = silently re-establishing a lost connection (no "Connecting…" flicker, lobby stays on screen)
  function connect(roomCode, create, rejoin) {
    if (ws) { const old = ws; ws = null; old.close(); }
    code = roomCode;
    welcomed = false;
    if (!rejoin) { note('Connecting…'); setBusy(true); }
    let opened = false;
    const url = `${SERVER}?room=${roomCode}&create=${create ? 1 : 0}&name=${encodeURIComponent(cleanName())}&skin=${skin}&token=${token()}`;
    let sock;
    try { sock = new WebSocket(url); } catch { if (!rejoin) { note('Couldn’t reach the lobby server.', true); setBusy(false); } return; }
    ws = sock;
    // Don't sit on "Connecting…" forever if the server is unreachable.
    const giveUp = setTimeout(() => { if (!opened && ws === sock) sock.close(); }, 8000);
    sock.onopen = () => { opened = true; clearTimeout(giveUp); };
    sock.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (ws === sock) handle(m); };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      clearInterval(pingTimer);
      if (inRoom) { if (!rejoin) lostConnection(); return; } // a failed rejoin attempt is retried by the timer
      setBusy(false);
      if (!el('mpNote').classList.contains('bad')) note(opened ? '' : 'Couldn’t reach the lobby server. Check your connection and try again.', !opened);
    };
  }

  // ---- staying connected -----------------------------------------------------------------
  function setNet(text) {
    const wasText = netText;
    netText = text || '';
    const badge = el('netStatus');
    badge.textContent = netText;
    badge.hidden = !netText || state === 'setup';
    if (netText && state === 'setup') note(netText);
    else if (!netText && wasText && el('mpNote').textContent === wasText) note('');
  }

  function lostConnection() {
    if (!inRoom) return;
    setNet('Connection lost. Reconnecting…');
    retries = 0;
    tryReconnect();
  }

  function tryReconnect() {
    clearTimeout(retryTimer);
    if (!inRoom) return;
    if (retries >= 15) { giveUpRoom('Couldn’t get back into the lobby. Check your connection and join again with the same code.'); return; }
    if (document.hidden) { retryTimer = setTimeout(tryReconnect, 1000); return; } // wait until the player is back
    retries++;
    connect(code, false, true);
    retryTimer = setTimeout(() => { if (inRoom && !welcomed) tryReconnect(); }, 3500);
  }

  // The connection can look open but be dead after the phone slept: check with a ping when the page comes back.
  function checkAlive() {
    if (!inRoom) return;
    if (!ws || ws.readyState > 1) { retries = 0; lostConnection(); return; }
    const asked = Date.now();
    send({ t: 'ping', ts: asked });
    setTimeout(() => { if (inRoom && ws && lastPongAt < asked) { const old = ws; ws = null; old.close(); lostConnection(); } }, 2500);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkAlive(); });
  window.addEventListener('online', checkAlive);
  window.addEventListener('pageshow', (e) => { if (e.persisted) checkAlive(); });

  function giveUpRoom(msg) {
    clearTimeout(retryTimer);
    clearInterval(pingTimer);
    if (ws) { const old = ws; ws = null; old.close(); }
    rememberRoom('');
    setNet('');
    dropped(msg);
  }

  function createLobby() {
    createTries = 0;
    const roomCode = Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
    connect(roomCode, true);
  }

  function joinLobby(raw) {
    const roomCode = String(raw || el('joinCode').value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (roomCode.length < 5) { note('Enter the 5-letter lobby code.', true); return; }
    connect(roomCode, false);
  }

  function setBusy(b) { for (const id of ['createLobby', 'joinLobby']) el(id).disabled = b; }

  // ---- messages --------------------------------------------------------------------------
  function handle(m) {
    switch (m.t) {
      case 'welcome':
        myId = m.id; hostId = m.host; inRoom = true; welcomed = true;
        if (!m.rejoined) over = false;
        if (mode !== 'versus') soloMode = mode;
        clearTimeout(retryTimer);
        retries = 0;
        setNet('');
        note('');
        setBusy(false);
        rememberRoom(code);
        history.replaceState(null, '', '?room=' + code);
        lastPongAt = Date.now();
        clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          send({ t: 'ping', ts: Date.now() });
          // no answer for a long while while the page is in view: the connection is dead, so rebuild it
          if (!document.hidden && Date.now() - lastPongAt > 12000 && ws) { const old = ws; ws = null; old.close(); lostConnection(); }
        }, 4000);
        send({ t: 'ping', ts: Date.now() });
        break;
      case 'resume': resumeMatch(m); break;
      case 'error':
        if (m.code === 'taken' && createTries++ < 4) { createLobbyRetry(); return; }
        if (inRoom) {
          giveUpRoom(m.code === 'notfound' ? 'The lobby has closed, so we couldn’t get you back in.'
            : m.code === 'started' ? 'You were away too long and the match carried on without you.' : m.msg);
          return;
        }
        if (m.code === 'notfound') rememberRoom('');
        note(m.msg, true);
        setBusy(false);
        break;
      case 'roster':
        players = m.players; hostId = m.host; phase = m.phase;
        if (m.ground && !(state === 'play' || state === 'result')) applyGround(m.ground);
        renderLobby();
        break;
      case 'start': beginMatch(m); break;
      case 'pos': {
        const p = peers.find((q) => q.id === m.id);
        if (p) {
          const now = performance.now();
          // learn how bumpy this player's connection is from the gaps between their updates
          if (p.lastAt) {
            const gap = now - p.lastAt;
            if (gap < 300) { p.gap += (gap - p.gap) * .1; p.dev += (Math.abs(gap - p.gap) - p.dev) * .1; }
          }
          p.lastAt = now;
          p.buf.push({ t: now, x: m.x, y: m.y, l: m.l });
          if (p.buf.length > 16) p.buf.shift();
        }
        break;
      }
      case 'cut': onCut(m.from); break;
      case 'block': { tone(180, .16, 'square', .07); const p = peers.find((q) => q.id === m.from); if (p) burst(p.x, p.y, '#65f2ef', 12); break; }
      case 'hp': {
        const p = peers.find((q) => q.id === m.id);
        if (p) { if (m.hp < p.hp) burst(p.x, p.y, palettes[p.n][1]); p.hp = m.hp; }
        break;
      }
      case 'dead': onDead(m); break;
      case 'end': onEnd(m); break;
      case 'pong': latency = Math.max(0, Date.now() - m.ts); lastPongAt = Date.now(); break;
    }
  }

  function createLobbyRetry() {
    const roomCode = Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
    connect(roomCode, true);
  }

  // ---- lobby UI --------------------------------------------------------------------------
  function applyGround(key) {
    const b = [...grounds.children].find((g) => g.dataset.ground === key);
    if (b) chooseGround(b, true);
  }

  function renderLobby() {
    document.body.classList.toggle('inLobby', inRoom);
    el('friendsHome').hidden = inRoom;
    el('lobbyRoom').hidden = !inRoom;
    el('launch').hidden = inRoom;
    if (!inRoom) return;
    el('lobbyCode').textContent = code;
    const list = el('roster');
    list.replaceChildren();
    for (const p of players) {
      const li = document.createElement('li');
      const dot = document.createElement('i');
      dot.style.background = palettes[p.skin][1];
      dot.style.boxShadow = '0 0 0 2px ' + palettes[p.skin][2];
      const name = document.createElement('span');
      name.textContent = p.name + (p.id === myId ? ' (you)' : '');
      li.append(dot, name);
      if (p.id === hostId) { const tag = document.createElement('em'); tag.textContent = 'host'; li.append(tag); }
      if (p.away) { const tag = document.createElement('em'); tag.className = 'away'; tag.textContent = 'away'; li.append(tag); }
      const kite = document.createElement('small');
      kite.textContent = palettes[p.skin][0];
      li.append(kite);
      list.append(li);
    }
    const n = players.length, here = players.filter((p) => !p.away).length;
    el('startMatch').hidden = !isHost();
    el('startMatch').disabled = here < 2;
    el('lobbyHint').textContent = isHost()
      ? (n < 2 ? 'Share the code with friends. You need at least 2 players to start (3 max).'
        : here < 2 ? 'Your friend is away from the game. They can rejoin with the same code, or you can wait.'
        : `${here} of 3 players ready. Pick a flying ground above, then start.${here < n ? ' Anyone still away will be left out.' : ''}`)
      : `Waiting for the host to start (${n} of 3 players). You can still pick your kite from the shop.`;
    document.body.classList.toggle('lobbyGuest', inRoom && !isHost());
  }

  el('createLobby').onclick = createLobby;
  el('joinLobby').onclick = () => joinLobby();
  el('joinCode').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  el('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinLobby(); });
  el('startMatch').onclick = () => send({ t: 'start' });
  el('leaveLobby').onclick = () => leave();
  el('shareLobby').onclick = async () => {
    const link = `${location.origin}${location.pathname}?room=${code}`;
    const text = `Join my Udi Ja! kite lobby with code ${code}`;
    try {
      if (navigator.share) { await navigator.share({ title: 'Udi Ja!', text, url: link }); return; }
      await navigator.clipboard.writeText(link);
      note('Invite link copied. Send it to your friends.');
    } catch { note('Share this link: ' + link); }
  };

  // ---- match start / end -----------------------------------------------------------------
  function beginMatch(m) {
    clearTimeout(endTimer);
    over = false;
    if (mode !== 'versus') soloMode = mode;
    mode = 'versus';
    applyGround(m.ground);
    start();
    const idx = Math.max(0, m.players.findIndex((p) => p.id === myId));
    const total = m.players.length;
    const mine = m.players[idx];
    player.x = W * (idx + 1) / (total + 1);
    player.hp = mine.hp;
    peers.length = 0;
    m.players.forEach((p, i) => {
      if (p.id === myId || p.alive === false) return;
      const nx = (i + 1) / (total + 1);
      peers.push({ id: p.id, name: p.name, n: p.skin, hp: p.hp, remote: true, anchor: .5, spool: 50, line: 50,
        buf: [{ t: performance.now(), x: nx, y: .72, l: 50 }], gap: 70, dev: 15, lastAt: 0, delay: 140, vx: 0, vy: 0, x: W * nx, y: H * .72, phase: Math.random() * 6.28 });
    });
    el('pause').textContent = 'Menu';
    sentPos = { x: -1, y: -1, l: -1 };
    posAt = 0;
  }

  // We just got back into a match that is still running (the connection dropped, or the page was reloaded).
  function resumeMatch(m) {
    const mine = m.players.find((p) => p.id === myId);
    if (!mine) return;
    if (state === 'play' || state === 'result') {
      // page survived: just catch up on what we missed
      for (const q of m.players) {
        if (q.id === myId) continue;
        const i = peers.findIndex((p) => p.id === q.id);
        if (q.alive === false) { if (i >= 0) peers.splice(i, 1); } else if (i >= 0) peers[i].hp = q.hp;
      }
      if (state === 'play' && mine.alive === false) { player.hp = 0; eliminated(); }
      else if (state === 'play') player.hp = Math.min(player.hp, mine.hp);
      return;
    }
    // page was reloaded: rebuild the match view from the room's state
    beginMatch(m);
    if (mine.alive === false) { player.hp = 0; eliminated(); }
  }

  function aliveCount() { return peers.length + (player && player.hp > 0 ? 1 : 0); }

  function onCut(from) {
    if (state !== 'play' || !player || player.hp <= 0) return;
    if (guard > 0 || dash > 0) { send({ t: 'block', to: from }); tone(900, .12, 'triangle', .07); return; }
    player.hp--;
    burst(player.x, player.y, '#ff5578');
    hurt();
    send({ t: 'hit', by: from });
    if (player.hp <= 0) eliminated();
  }

  function eliminated() {
    state = 'result'; victory = false; keys.clear(); jx = jy = 0; target = null;
    setTimeout(() => {
      if (state === 'result' && !over) {
        dialog('You’re out', 'Your line was cut. Watch the rest of the match, or leave the lobby.', [['Watch', () => {}], ['Leave lobby', () => leave()]]);
      }
    }, 500);
  }

  function onDead(m) {
    const i = peers.findIndex((q) => q.id === m.id);
    if (i >= 0) {
      const p = peers[i];
      burst(p.x, p.y, palettes[p.n][1], 36);
      peers.splice(i, 1);
      if (m.by === myId) { cuts++; points += bounty[p.n]; tone(880, .18); }
    }
  }

  function onEnd(m) {
    over = true;
    const won = m.winner === myId;
    const winnerRow = m.standings.find((s) => s.id === m.winner);
    const mineRow = m.standings.find((s) => s.id === myId);
    const kills = mineRow ? mineRow.kills : 0;
    const earned = kills * 12 + Math.floor(elapsed / 10) + (won ? 40 : 0);
    coins += earned; save();
    $('kn').textContent = palettes[skin][0] + ' · ' + coins + ' coins';
    if (won) {
      state = 'result'; victory = true; fire = 0;
      for (let i = 0; i < 5; i++) burst(Math.random() * W, Math.random() * H * .7, palettes[i % 4][1], 40);
      tone(880, .4);
    }
    const lines = m.standings.map((s) => `${s.place}. ${s.name}${s.id === myId ? ' (you)' : ''} · ${s.kills} cut${s.kills === 1 ? '' : 's'}`);
    const body = lines.join('\n') + '\n\n+' + earned + ' coins · Wallet ' + coins + ' coins';
    const title = won ? 'Congratulations, kite champion!' : winnerRow ? winnerRow.name + ' wins' : 'Match over';
    clearTimeout(endTimer);
    endTimer = setTimeout(() => {
      if (!inRoom) return;
      dialog(title, body, [['Back to lobby', backToLobby], ['Leave lobby', () => leave()]]);
    }, won ? 1600 : 700);
  }

  function resetToSetup() {
    clearTimeout(endTimer);
    peers.length = 0;
    el('pause').textContent = 'Pause';
    mode = soloMode;
    if (state !== 'setup') lobby();
  }

  function backToLobby() {
    if (!inRoom) return;
    resetToSetup();
    renderLobby();
    el('friends').scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // The player chose to leave: tell the room so the seat is freed right away (a dropped connection keeps it).
  function leave() {
    send({ t: 'leave' });
    clearTimeout(retryTimer);
    clearInterval(pingTimer);
    if (ws) { const old = ws; ws = null; old.close(); }
    rememberRoom('');
    setNet('');
    inRoom = false; players = []; myId = hostId = null; over = false;
    resetToSetup();
    renderLobby();
    setBusy(false);
    note('');
    history.replaceState(null, '', location.pathname);
  }

  // We could not get back into the room.
  function dropped(msg) {
    const midMatch = state === 'play' || state === 'result';
    inRoom = false; players = []; myId = hostId = null;
    resetToSetup();
    renderLobby();
    setBusy(false);
    history.replaceState(null, '', location.pathname);
    if (midMatch) dialog('Disconnected', msg, [['OK', () => {}]]);
    else note(msg, true);
  }

  // ---- hooks called by game.js -----------------------------------------------------------
  Object.assign(MP, {
    skin(i) { if (inRoom && phase === 'lobby') send({ t: 'skin', skin: i }); },
    ground(key) { if (isHost()) send({ t: 'ground', ground: key }); },
    locked: () => inRoom && !isHost(),
    cut(target, hit) { send({ t: 'cut', to: target.id }); burst(hit.x, hit.y, '#fff6bd', 10); },
    stats: () => aliveCount() + ' flying · ' + cuts + ' cut' + (cuts === 1 ? '' : 's') + (latency ? ' · ' + latency + 'ms' : ''),
    menu() {
      dialog('Leave the match?', 'The match keeps going without you, and your kite will be counted out.',
        [['Keep flying', () => {}], ['Leave match', () => leave()]]);
    },
    // Outgoing position: ~15 times a second while moving, one last update once the kite stops, and a
    // slow heartbeat so the room knows we're still here.
    tick() {
      if (!inRoom || !player || state !== 'play') return;
      const now = performance.now();
      const x = player.x / W, y = player.y / H;
      const moved = Math.abs(x - sentPos.x) > .002 || Math.abs(y - sentPos.y) > .002 || Math.abs(line - sentPos.l) > .5;
      const due = moved ? now - posAt > 66 : (!settled && now - posAt > 100) || now - posAt > 400;
      if (due) {
        posAt = now;
        settled = !moved;
        sentPos = { x, y, l: line };
        send({ t: 'pos', x: +x.toFixed(4), y: +y.toFixed(4), l: Math.round(line) });
      }
    },
    // Other players' kites are drawn slightly in the past, interpolating between the positions we received,
    // so they glide instead of jumping. Then they are nudged ahead along their direction of travel to
    // make up for the network delay (runs every frame, also while spectating).
    frame(dt) {
      if (mode !== 'versus') return;
      const now = performance.now();
      for (const p of peers) {
        // stay just far enough behind to cover this player's jitter; ease changes so motion never warps
        const want = Math.min(MAX_DELAY, Math.max(MIN_DELAY, p.gap + 3 * p.dev));
        p.delay += (want - p.delay) * Math.min(1, dt * 1.5);
        const s = sampleAt(p.buf, now - p.delay);

        // current velocity (px/s) from the newest updates; zero if they've gone quiet (kite is at rest)
        const n = p.buf.length, last = p.buf[n - 1];
        let vx = 0, vy = 0;
        if (n > 1 && now - last.t < 250) {
          let j = n - 2;
          while (j > 0 && last.t - p.buf[j].t < 90) j--;
          const span = (last.t - p.buf[j].t) / 1000;
          if (span > .03) { vx = (last.x - p.buf[j].x) * W / span; vy = (last.y - p.buf[j].y) * H / span; }
        }
        const kv = Math.min(1, dt * 6);
        p.vx += (vx - p.vx) * kv;
        p.vy += (vy - p.vy) * kv;

        const lead = Math.min(MAX_LEAD_S, (latency + p.delay) / 1000 * LEAD_SHARE);
        const lx = Math.max(-MAX_LEAD_PX, Math.min(MAX_LEAD_PX, p.vx * lead));
        const ly = Math.max(-MAX_LEAD_PX, Math.min(MAX_LEAD_PX, p.vy * lead));
        const tx = s.x * W + lx, ty = s.y * H + ly, kp = Math.min(1, dt * 22);
        p.x += (tx - p.x) * kp;
        p.y += (ty - p.y) * kp;
        p.spool = s.l;
        p.line = s.l;
      }
      if (state === 'result') {
        $('stats').textContent = (over ? 'Match over' : 'Spectating') + ' · ' + aliveCount() + ' flying' + (latency ? ' · ' + latency + 'ms' : '');
      }
    },
    draw() {
      if (mode !== 'versus') return;
      ctx.textAlign = 'center';
      ctx.font = 'bold 11px sans-serif';
      for (const b of peers) {
        drawKite(b, false);
        ctx.fillStyle = '#242439';
        ctx.fillRect(b.x - 16, b.y - 32, 32, 5);
        ctx.fillStyle = '#acf495';
        ctx.fillRect(b.x - 16, b.y - 32, 32 * Math.max(0, b.hp) / health[b.n], 5);
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#1b1830d0';
        ctx.strokeText(b.name, b.x, b.y - 38);
        ctx.fillStyle = '#fff';
        ctx.fillText(b.name, b.x, b.y - 38);
        ctx.lineWidth = 1;
      }
    },
  });

  // Opening an invite link (?room=CODE) joins straight away. So does coming back to a tab that was in a lobby
  // (the browser may have reloaded the page while it was in the background): our private token gets us our seat back.
  const invited = (new URLSearchParams(location.search).get('room') || savedRoom()).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (invited) {
    el('joinCode').value = invited;
    joinLobby(invited);
  }
})();
