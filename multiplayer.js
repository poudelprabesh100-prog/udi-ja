// Multiplayer: lobbies of up to 5 friends, relayed through the Cloudflare Durable Object in /server.
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
  let sentPos = { x: -1, y: -1, l: -1 }, posAt = 0, createTries = 0, endTimer = 0;

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
  function connect(roomCode, create) {
    if (ws) { const old = ws; ws = null; old.close(); }
    code = roomCode;
    note('Connecting…');
    setBusy(true);
    let opened = false;
    const url = `${SERVER}?room=${roomCode}&create=${create ? 1 : 0}&name=${encodeURIComponent(cleanName())}&skin=${skin}`;
    let sock;
    try { sock = new WebSocket(url); } catch { note('Couldn’t reach the lobby server.', true); setBusy(false); return; }
    ws = sock;
    // Don't sit on "Connecting…" forever if the server is unreachable.
    const giveUp = setTimeout(() => { if (!opened && ws === sock) sock.close(); }, 8000);
    sock.onopen = () => { opened = true; clearTimeout(giveUp); };
    sock.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (ws === sock) handle(m); };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      clearInterval(pingTimer);
      setBusy(false);
      if (inRoom) dropped();
      else if (!el('mpNote').classList.contains('bad')) note(opened ? '' : 'Couldn’t reach the lobby server. Check your connection and try again.', !opened);
    };
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
        myId = m.id; hostId = m.host; inRoom = true; over = false;
        if (mode !== 'versus') soloMode = mode;
        note('');
        setBusy(false);
        history.replaceState(null, '', '?room=' + code);
        clearInterval(pingTimer);
        pingTimer = setInterval(() => send({ t: 'ping', ts: Date.now() }), 4000);
        send({ t: 'ping', ts: Date.now() });
        break;
      case 'error':
        if (m.code === 'taken' && createTries++ < 4) { createLobbyRetry(); return; }
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
        if (p) { p.nx = m.x; p.ny = m.y; p.line = m.l; }
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
      case 'pong': latency = Math.max(0, Date.now() - m.ts); break;
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
      const kite = document.createElement('small');
      kite.textContent = palettes[p.skin][0];
      li.append(kite);
      list.append(li);
    }
    const n = players.length;
    el('startMatch').hidden = !isHost();
    el('startMatch').disabled = n < 2;
    el('lobbyHint').textContent = isHost()
      ? (n < 2 ? 'Share the code with friends. You need at least 2 players to start.' : `${n} players ready. Pick a flying ground above, then start.`)
      : 'Waiting for the host to start. You can still pick your kite from the shop.';
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
      if (p.id === myId) return;
      const nx = (i + 1) / (total + 1);
      peers.push({ id: p.id, name: p.name, n: p.skin, hp: p.hp, remote: true, anchor: .5, spool: 50, line: 50,
        nx, ny: .72, x: W * nx, y: H * .72, phase: Math.random() * 6.28 });
    });
    el('pause').textContent = 'Menu';
    sentPos = { x: -1, y: -1, l: -1 };
    posAt = 0;
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

  function leave() {
    if (ws) { const old = ws; ws = null; old.close(); }
    clearInterval(pingTimer);
    inRoom = false; players = []; myId = hostId = null; over = false;
    resetToSetup();
    renderLobby();
    setBusy(false);
    note('');
    history.replaceState(null, '', location.pathname);
  }

  function dropped() {
    const midMatch = state === 'play' || state === 'result';
    inRoom = false; players = []; myId = hostId = null;
    resetToSetup();
    renderLobby();
    const msg = 'The connection to the lobby was lost.';
    if (midMatch) dialog('Disconnected', msg + ' Join again with the same code if the lobby is still open.', [['OK', () => {}]]);
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
    // outgoing position, ~11 times a second while moving and every 0.4s otherwise
    tick() {
      if (!inRoom || !player || state !== 'play') return;
      const now = performance.now();
      const x = player.x / W, y = player.y / H;
      const moved = Math.abs(x - sentPos.x) > .003 || Math.abs(y - sentPos.y) > .003 || Math.abs(line - sentPos.l) > 1;
      if ((moved && now - posAt > 90) || now - posAt > 400) {
        posAt = now;
        sentPos = { x, y, l: line };
        send({ t: 'pos', x: +x.toFixed(4), y: +y.toFixed(4), l: Math.round(line) });
      }
    },
    // smooth other players' kites toward their latest reported spot (runs every frame, also while spectating)
    frame(dt) {
      if (mode !== 'versus') return;
      const k = Math.min(1, dt * 10);
      for (const p of peers) {
        p.x += (p.nx * W - p.x) * k;
        p.y += (p.ny * H - p.y) * k;
        p.spool += (p.line - p.spool) * k;
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

  // Opening an invite link (?room=CODE) joins straight away.
  const invited = new URLSearchParams(location.search).get('room');
  if (invited) {
    el('joinCode').value = invited.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    joinLobby(invited);
  }
})();
