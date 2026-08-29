// ============================================================
// TOKENCLASH ENGINE v0.1 — The UNO Referee
// Pure game logic. No AI, no network. Fully deterministic
// given a shuffle seed. Testable standalone: `node engine.js`
// ============================================================

const COLORS = ['red', 'yellow', 'green', 'blue'];
const NUMBERS = ['0','1','2','3','4','5','6','7','8','9'];
const ACTIONS = ['skip', 'reverse', '+2'];
const PENALTY_CARDS = 2; // illegal move punishment

let idCounter = 0;
const card = (color, value) => ({ id: `${color[0]}${value}${idCounter++}`, color, value });

function buildDeck() {
    const deck = [];
    for (const c of COLORS) {
        deck.push(card(c, '0'));
        for (const n of NUMBERS.slice(1)) { deck.push(card(c, n)); deck.push(card(c, n)); }
        for (const a of ACTIONS) { deck.push(card(c, a)); deck.push(card(c, a)); }
    }
    for (let i = 0; i < 4; i++) { deck.push(card('wild', 'wild')); deck.push(card('wild', 'wild+4')); }
    return deck;
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

class UnoGame {
    constructor(playerNames) {
        if (playerNames.length < 2 || playerNames.length > 4)
            throw new Error('TokenClash UNO supports 2-4 players');
        this.players = playerNames.map(name => ({ name, hand: [] }));
        this.drawPile = shuffle(buildDeck());
        this.discard = [];
        this.direction = 1;
        this.current = 0;
        this.phase = 'playing'; // playing | await-draw-decision | over
        this.winner = null;
        this.turnCount = 0;
        this.log = [`🎮 New game: ${playerNames.join(' vs ')}`];

        // deal 7 each
        for (let i = 0; i < 7; i++)
            for (const p of this.players) p.hand.push(this.drawPile.pop());

        // flip first discard (number card only, for clean start)
        let first;
        do {
            first = this.drawPile.pop();
            if (first.color === 'wild' || ACTIONS.includes(first.value)) this.drawPile.unshift(first); // bury non-numbers
        } while (first.color === 'wild' || ACTIONS.includes(first.value));
        this.discard.push(first);
        this.activeColor = first.color;
        this.log.push(`🃏 First card: ${first.color} ${first.value}`);
    }

    top() { return this.discard[this.discard.length - 1]; }

    drawCards(playerIdx, n) {
        const drawn = [];
        for (let i = 0; i < n; i++) {
            if (this.drawPile.length === 0) this.reshuffle();
            if (this.drawPile.length === 0) break; // extreme edge: everything in hands
            const c = this.drawPile.pop();
            this.players[playerIdx].hand.push(c);
            drawn.push(c);
        }
        return drawn;
    }

    reshuffle() {
        if (this.discard.length <= 1) return;
        const top = this.discard.pop();
        this.drawPile = shuffle(this.discard);
        this.discard = [top];
        this.log.push('♻️ Draw pile empty — reshuffled the discard pile.');
    }

    matches(card) {
        const t = this.top();
        return card.color === 'wild' || card.color === this.activeColor || card.value === t.value;
    }

    mostCommonColor(playerIdx) {
        const counts = {};
        for (const c of this.players[playerIdx].hand)
            if (c.color !== 'wild') counts[c.color] = (counts[c.color] || 0) + 1;
        return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || COLORS[0];
    }

    nextPlayer(steps = 1) {
        this.current = (this.current + this.direction * steps + this.players.length * steps) % this.players.length;
    }

    // Returns {ok, error?, events[]} — the ONLY way the game state changes.
    applyMove(playerIdx, move) {
        const events = [];
        if (this.phase === 'over') return { ok: false, error: 'Game is over.' };
        if (playerIdx !== this.current) return { ok: false, error: 'Not your turn.' };

        const p = this.players[playerIdx];
        const name = p.name;
        this.turnCount++;

        // ---- DRAW REQUEST ----
        if (move.draw) {
            const [drawn] = this.drawCards(playerIdx, 1);
            if (!drawn) { this.nextPlayer(); events.push({ type: 'draw', player: name, note: 'no cards left to draw' }); return { ok: true, events }; }
            events.push({ type: 'draw', player: name, card: drawn });
            if (this.matches(drawn)) {
                // official rule: drawn card may be played immediately, or pass
                this.phase = 'await-draw-decision';
                this.drawnCard = drawn.id;
                events.push({ type: 'notice', text: `${name} drew ${drawn.color} ${drawn.value} — playable! Play it or pass.` });
            } else {
                events.push({ type: 'notice', text: `${name} drew ${drawn.color} ${drawn.value} — no luck.` });
                this.nextPlayer();
            }
            return { ok: true, events };
        }

        // ---- PASS (only valid right after drawing a playable card) ----
        if (move.pass) {
            if (this.phase !== 'await-draw-decision') return { ok: false, error: 'You can only pass after drawing a playable card.' };
            events.push({ type: 'notice', text: `${name} keeps the drawn card and passes.` });
            this.phase = 'playing'; this.drawnCard = null;
            this.nextPlayer();
            return { ok: true, events };
        }

        // ---- PLAY REQUEST ----
        const cardId = move.card;
        const handCard = p.hand.find(c => c.id === cardId);
        if (!handCard) return { ok: false, error: `You don't have card "${cardId}".` };

        // in await-draw-decision, only the drawn card may be played
        if (this.phase === 'await-draw-decision' && cardId !== this.drawnCard)
            return { ok: false, error: 'After drawing you may only play the drawn card or pass.' };

        if (!this.matches(handCard)) {
            // ILLEGAL MOVE → penalty
            const drawn = this.drawCards(playerIdx, PENALTY_CARDS);
            events.push({ type: 'cheat', player: name, card: cardId, note: `CHEATER CALLED OUT — illegal play. Draws ${PENALTY_CARDS}.` });
            this.nextPlayer();
            return { ok: true, events };
        }

        // Valid play — remove from hand, place on discard
        p.hand.splice(p.hand.findIndex(c => c.id === cardId), 1);
        this.discard.push(handCard);
        this.activeColor = handCard.color === 'wild' ? (move.chosenColor || this.mostCommonColor(playerIdx)) : handCard.color;
        events.push({ type: 'play', player: name, card: `${handCard.color} ${handCard.value}`, activeColor: this.activeColor });

        // UNO call (automatic in v1)
        if (p.hand.length === 1) events.push({ type: 'uno', text: `🗣️ ${name}: "UNO!"` });

        // Win check
        if (p.hand.length === 0) {
            this.phase = 'over';
            this.winner = name;
            events.push({ type: 'win', text: `🏆 ${name} WINS after ${this.turnCount} turns!` });
            return { ok: true, events };
        }

        // Action effects
        if (handCard.value === 'skip') {
            const skipped = this.players[(this.current + this.direction + this.players.length) % this.players.length].name;
            events.push({ type: 'skip', text: `⛔ ${skipped} was skipped.` });
            this.nextPlayer(2);
        } else if (handCard.value === 'reverse') {
            this.direction *= -1;
            events.push({ type: 'reverse', text: `🔄 Direction reversed.` });
            if (this.players.length === 2) this.nextPlayer(2); // acts as skip in 1v1
            else this.nextPlayer();
        } else if (handCard.value === '+2') {
            const victim = (this.current + this.direction + this.players.length) % this.players.length;
            this.drawCards(victim, 2);
            events.push({ type: 'draw-penalty', text: `💸 ${this.players[victim].name} draws 2 and is skipped.` });
            this.nextPlayer(2);
        } else if (handCard.value === 'wild+4') {
            const victim = (this.current + this.direction + this.players.length) % this.players.length;
            this.drawCards(victim, 4);
            events.push({ type: 'draw-penalty', text: `💥 ${this.players[victim].name} draws 4 and is skipped. Color: ${this.activeColor}.` });
            this.nextPlayer(2);
        } else {
            this.nextPlayer();
        }

        this.phase = 'playing'; this.drawnCard = null;
        return { ok: true, events };
    }

    // What an AI player is allowed to see (NO other hands)
    getPlayerView(playerIdx) {
        const p = this.players[playerIdx];
        return {
            yourName: p.name,
            yourHand: p.hand,
            topDiscard: `${this.top().color} ${this.top().value}`,
            activeColor: this.activeColor,
            opponents: this.players.filter((_, i) => i !== playerIdx).map(o => ({ name: o.name, cards: o.hand.length })),
            direction: this.direction === 1 ? 'clockwise' : 'counter-clockwise',
            phase: this.phase,
            drawnCardId: this.phase === 'await-draw-decision' ? this.drawnCard : null
        };
    }

    // Spectators see EVERYTHING (open hands = better entertainment)
    getSpectatorState() {
        return JSON.parse(JSON.stringify({
            players: this.players, discard: this.discard[this.discard.length - 1],
            activeColor: this.activeColor, current: this.current,
            direction: this.direction, phase: this.phase, winner: this.winner,
            drawPileCount: this.drawPile.length, log: this.log
        }));
    }
}

module.exports = { UnoGame, buildDeck, shuffle };

// ---------- STANDALONE SANITY TEST: `node engine.js` ----------
if (require.main === module) {
    const g = new UnoGame(['GPT', 'Gemini', 'Llama', 'Mistral']);
    let safety = 5000;
    while (g.phase !== 'over' && safety-- > 0) {
        const pi = g.current;
        const hand = g.players[pi].hand;
        // dumb bot: play first legal card, else draw
        const legal = hand.find(c => g.matches(c));
        const move = legal ? { card: legal.id, chosenColor: legal.color === 'wild' ? 'red' : undefined } : { draw: true };
        const result = g.applyMove(pi, move);
        if (!result.ok) { console.log('ILLEGAL REFEREE STATE:', result.error); process.exit(1); }
        for (const e of result.events) {
            if (e.type === 'play') console.log(`${e.player} → ${e.card}`);
            if (e.type === 'uno') console.log(e.text);
            if (e.type === 'cheat') console.log(`⚠️ ${e.player} CHEATED (${e.card}) → penalty`);
            if (e.type === 'win') console.log(e.text);
        }
    }
    if (safety <= 0) console.log('❌ SAFETY HIT — possible infinite loop bug!');
    else console.log(`\n✅ Engine test complete. Winner: ${g.winner}, turns: ${g.turnCount}`);
}
