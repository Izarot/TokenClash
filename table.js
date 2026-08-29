const el = id => document.getElementById(id);
let game = null, seatedPlayers = [], tableChat = [], running = false, paused = false, turnDelay = 900;
let allModels = [];
const ACCENTS = ['#2d9cf4', '#ff4d4d', '#28a745', '#ffd700'];
const COLOR_HEX = { red: '#ff4d4d', yellow: '#ffd700', green: '#28a745', blue: '#2d9cf4', wild: '#ffffff' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

window.addEventListener('load', async () => {
    await loadModels();
    const saved = localStorage.getItem('tokenclash_match');
    if (saved) {
        try {
            const s = JSON.parse(saved);
            if (s.gameJSON && s.gameJSON.phase !== 'over') {
                el('resume-row').style.display = 'block';
                el('resume-btn').onclick = () => resumeMatch(s);
            }
        } catch (e) {}
    }
});

async function loadModels() {
    try {
        const res = await fetch('/api/models');
        allModels = await res.json();
        const sel = el('model-select'); sel.innerHTML = '';
        allModels.forEach(m => {
            const o = document.createElement('option');
            o.value = m.id; o.innerText = m.name;
            sel.appendChild(o);
        });
    } catch (e) { alert('Model load failed: ' + e.message); }
}

function seatPlayer() {
    if (seatedPlayers.length >= 4) return alert('Table is full (4 max).');
    const id = el('model-select').value; if (!id) return;
    const nick = el('nickname-input').value.trim() || id.split(':').pop().split('/')[0];
    seatedPlayers.push({ modelId: id, nickname: nick, accent: ACCENTS[seatedPlayers.length] });
    el('nickname-input').value = '';
    renderSeats();
}

function unseat(i) {
    seatedPlayers.splice(i, 1);
    seatedPlayers.forEach((p, j) => p.accent = ACCENTS[j]);
    renderSeats();
}

function renderSeats() {
    const c = el('seats'); c.innerHTML = '';
    seatedPlayers.forEach((p, i) => {
        const d = document.createElement('div');
        d.className = 'seat'; d.style.borderColor = p.accent;
        d.innerHTML = `<span style="color:${p.accent}">●</span> <b>${p.nickname}</b> <span class="model">${p.modelId}</span> <button onclick="unseat(${i})">✕</button>`;
        c.appendChild(d);
    });
    el('start-btn').disabled = seatedPlayers.length < 2;
}

function startMatch() {
    game = new UnoGame(seatedPlayers.map(p => p.nickname));
    tableChat = [];
    el('setup-panel').style.display = 'none';
    el('table-panel').style.display = 'block';
    el('pause-btn').style.display = 'inline-block';
    addLog(`🎬 Match started: ${seatedPlayers.map(p => p.nickname).join(' vs ')}`);
    renderTable(); saveMatch();
    runLoop();
}

function resumeMatch(s) {
    game = UnoGame.fromJSON(s.gameJSON);
    seatedPlayers = s.seatedPlayers; tableChat = s.tableChat || [];
    el('setup-panel').style.display = 'none';
    el('table-panel').style.display = 'block';
    el('pause-btn').style.display = 'inline-block';
    (s.tableChat || []).forEach(t => {
        const m = t.match(/^(.*?): (.*)$/s);
        if (m) addTaunt(m[1], m[2]);
    });
    renderTable();
    addLog('↻ Match resumed.');
    runLoop();
}

function saveMatch() {
    localStorage.setItem('tokenclash_match', JSON.stringify({ gameJSON: game.toJSON(), seatedPlayers, tableChat }));
}

function newMatch() { localStorage.removeItem('tokenclash_match'); location.reload(); }
function togglePause() { paused = !paused; el('pause-btn').innerText = paused ? '▶ Resume' : '⏸ Pause'; }
function setSpeed(v) { turnDelay = parseInt(v); }

async function runLoop() {
    running = true;
    let safety = 1000;
    while (game.phase !== 'over' && running && safety-- > 0) {
        if (paused) { await sleep(300); continue; }
        await playTurn();
        await sleep(turnDelay);
    }
    running = false;
    if (game.phase === 'over') {
        addLog(`🏁 Match complete. ${game.winner} takes the table.`);
        localStorage.removeItem('tokenclash_match');
        el('new-match-btn').style.display = 'inline-block';
    } else if (safety <= 0) {
        addLog('⚠️ Safety cap (1000 turns) hit — match declared a draw.');
    }
}

async function playTurn() {
    const pi = game.current;
    highlightCurrent(pi);
    await askAndApply(pi);
    if (game.phase === 'await-draw-decision' && game.current === pi && running && !paused) {
        await askAndApply(pi, { forcePassOnError: true });
    }
    renderTable(); saveMatch();
}

async function askAndApply(pi, opts = {}) {
    const player = seatedPlayers[pi];
    if (!player) return;
    const view = game.getPlayerView(pi);
    let data = { status: 'error', error: 'no response' };
    try {
        const res = await fetch('/api/turn', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: player.modelId, playerName: player.nickname, view, tableChat: tableChat.slice(-8) })
        });
        data = await res.json();
    } catch (e) { data = { status: 'error', error: 'network' }; }

    let move, taunt = null;
    if (data.status === 'move') { move = data.move; taunt = data.taunt; }
    else if (data.status === 'invalid') {
        addLog(`⚠️ ${player.nickname} hallucinated an illegal move — CHEATER CALLED OUT!`, 'entry-error');
        move = { card: 'hallucinated-' + Date.now() }; // engine punishes with +2
    } else {
        addLog(`🔧 ${player.nickname} had a technical issue (${data.error || 'unknown'}).`, 'entry-error');
        move = (opts.forcePassOnError && game.phase === 'await-draw-decision') ? { pass: true } : { draw: true };
    }

    if (taunt) {
        tableChat.push(`${player.nickname}: ${taunt}`);
        addTaunt(player.nickname, taunt);
    }

    const result = game.applyMove(pi, move);
    if (!result.ok) addLog(`⛔ Referee rejected: ${result.error}`, 'entry-error');
    renderEvents(result.events);
}

// ---------- RENDERING ----------
function highlightCurrent(pi) {
    document.querySelectorAll('.player-panel').forEach((p, i) => p.classList.toggle('active', i === pi));
}

function renderTable() {
    el('top-card').innerHTML = cardHTML(game.top());
    el('active-color').style.background = COLOR_HEX[game.activeColor] || '#fff';
    el('pile-count').innerText = game.drawPile.length;
    el('direction').innerText = game.direction === 1 ? '↻ clockwise' : '↺ counter';
    el('winner-banner').style.display = game.phase === 'over' ? 'block' : 'none';
    if (game.phase === 'over') el('winner-banner').innerText = `🏆 ${game.winner} WINS!`;

    const strip = el('players-strip'); strip.innerHTML = '';
    game.players.forEach((p, i) => {
        const accent = seatedPlayers[i] ? seatedPlayers[i].accent : '#888';
        const d = document.createElement('div');
        d.className = 'player-panel' + (i === game.current && game.phase !== 'over' ? ' active' : '');
        d.style.borderColor = accent;
        const hand = p.hand.map(c => `<span class="mini-card ${c.color}">${c.value}</span>`).join('') || '<span class="mini-card">—</span>';
        d.innerHTML = `<div class="pname" style="color:${accent}">${p.name} <small>· ${p.hand.length} cards</small></div><div class="hand">${hand}</div>`;
        strip.appendChild(d);
    });
}

function cardHTML(c) {
    return `<div class="big-card ${c.color}"><div class="cv">${c.value}</div><div class="cc">${c.color}</div></div>`;
}

function renderEvents(events) {
    for (const e of events) {
        if (e.type === 'play') addLog(`${e.player} → ${e.card}`);
        else if (e.type === 'draw' && e.card) addLog(`${e.player} draws a card.`);
        else if (e.type === 'cheat') addLog(e.note, 'entry-error');
        else if (e.type === 'uno') addLog(e.text, 'entry-gold');
        else if (e.type === 'win') addLog(e.text, 'entry-gold');
        else if (e.text) addLog(e.text);
    }
}

function addLog(text, cls = '') {
    const d = document.createElement('div');
    d.className = `entry ${cls}`;
    d.innerText = text;
    el('log').appendChild(d);
    el('log').scrollTop = el('log').scrollHeight;
}

function addTaunt(name, text) {
    const d = document.createElement('div');
    d.className = 'taunt';
    d.innerHTML = `<span class="tname">${name}:</span> ${text.replace(/</g, '&lt;')}`;
    el('chat').appendChild(d);
    el('chat').scrollTop = el('chat').scrollHeight;
}