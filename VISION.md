PROJECT: TOKENCLASH
===================

WHAT IT IS:
A spectator platform where multiple AI models play games against each
other LIVE, for human entertainment. The human doesn't play — the human
watches AI models battle, bluff, make mistakes, and trash-talk in real time.

THE TAGLINE:
"Many minds. One table." (sister product to The Conclave)

CORE LOOP:
Viewer opens TokenClash
  -> picks a game (v1: UNO)
  -> picks which AI models play (dynamic model list, no hardcoding)
  -> hits Start
  -> watches the full game live: every move, every taunt, every collapse

GAME #1: UNO
- 3-4 AI players, each a different model with a nickname
- Full rules: number cards, Skip, Reverse, +2, Wild, Wild+4
- Turn-based. The engine is the referee; AIs only REQUEST moves.
- Every requested move is validated against real rules.
- Illegal move (hallucinated card) = penalty draw + "CHEATER CALLED OUT"
- Hands are FACE-UP to spectators. Watching an AI miss its winning card
  is the content.

WHY UNO FIRST:
- Turn-based (no reflexes needed — LLMs decide, engine executes)
- Language-shaped decisions (hold, dump, target, bluff)
- Hidden-information drama (opponent at 1 card = panic)
- Simple enough to build in days, deep enough to stay funny

THE AI PLAYER CONTRACT:
Each turn, a model receives:
  - its hand (face-up to itself AND spectators)
  - discard pile top + active color
  - opponent card counts
  - last moves + taunts (the table chat)
It must respond ONLY with JSON:
  {"card": "<card-id>"} or {"draw": true}, optional "taunt": "<one line>"
The engine executes valid moves, penalizes invalid ones, and appends
taunts to the table chat. Models never touch game state directly.

TECH STACK:
- Frontend: HTML/CSS/JS (vanilla, same doctrine as The Conclave)
- Backend: Vercel serverless (api/chat.js pattern reused for game turns)
- Model discovery: same dynamic-fetch doctrine — providers scanned live,
  zero hardcoded model IDs
- API keys: server-side env vars only

ROADMAP (in order):
T1: One UNO table, 3-4 models, full game loop, live viewer, taunts     <- NOW
T2: Tournament mode (bracket of tables, winner advances)
T3: More games (Snake Battle Royale, Trivia, Territory War)
T4: Human seat (user joins as 5th player)
T5: User-submitted games + user-added custom AI players

DESIGN LANGUAGE:
Black/white monochrome base (Conclave family), one accent color per
player model, live table view, game log styled like a fight commentary.

BUILT BY: Izarot (12) — creator of NightCode & The Conclave
STATUS: v0 planning complete. Engine build begins now.
