# AI Dungeon Master — PLAN

Crafted by Vivek Nair (VN) — https://github.com/vivekn4

## Vision
A solo tabletop RPG in the browser: a free AI Dungeon Master narrates a living
story while **code owns all the numbers** — dice, HP, gold, XP, combat, and
victory. The DM writes prose; the game engine decides outcomes. That split is
the whole architecture, and it is what keeps the story honest: the model can
never fudge a roll, forget your gold, or revive a defeated foe.

## Current state (v1.1, 2026-10-14)
- Zero-build static frontend (vanilla ES modules) + hardened Express backend.
- Free Gemini API via the OpenAI-compatible endpoint. Key lives only in `AI_API_KEY`.
- Hero creation (5 classes with starting kits), 3 realms + custom setting.
- Typewriter narration, quick-choice buttons, free-form actions.
- Dice roller (d20–d4) with crit/fumble flair.
- **STATE block contract**: every DM reply ends with `CHOICES:` + a `STATE:` block
  of deltas (HP/GOLD/XP/ITEM±/FOE/OBJECTIVE). The client parses, clamps, and
  applies them; the DM's prose never changes a number by itself.
- **XP + levels**: XP threshold 100 + 50/level; level-up grants +5 max HP, +5 HP.
- **Gold**: loot and spending tracked by the client.
- **Objectives**: each campaign draws 2 win conditions (escape / slay boss /
  claim artifact / rescue captive / uncover secret). Completing all = victory.
- **Code-owned combat**: when a foe appears, Attack/Defend/Flee resolve with
  real dice in `resolveCombatRound` (d20 hit check, d8+level damage, defend
  halves retaliation, flee ~40%). The DM only narrates the decided outcome.
- **Achievements**: 7 code-checked honors (First Roll, Natural Twenty, First
  Blood, Survivor, Hoarder, Quest Master, Legend), toast + chime, once each.
- **Saves**: 3 manual slots (v2 format) + silent autosave after every reply,
  resumable from the setup screen. V1 saves migrate with fresh defaults.
- **Chronicle export**: one-click `.md` download of the full tale.
- Maximalist SFX/VFX: WebAudio synth engine, canvas embers/confetti/shake,
  `prefers-reduced-motion` honored.

## Architecture
```
index.html          setup + game screens (objectives / combat / honors panels)
css/style.css       dark-fantasy theme + toast/combat/stat styles
js/app.js           state, UI wiring, DM chat flow, consequences pass
js/logic.js         PURE logic (dice, parsers, deltas, combat, achievements)
js/sfx.js           zero-asset WebAudio synth engine
js/vfx.js           canvas particles (embers, confetti, sparkle, shake)
server.js           Express API: /api/health, /api/ready, /api/chat
test/logic.test.mjs  unit tests for js/logic.js (36 tests)
```

## Design rules
1. **Code owns numbers.** Any mechanic that changes HP/gold/XP/inventory/foes
   lives in `logic.js` and is unit-tested. The DM reports; it never decides.
2. **Pure logic stays pure.** `logic.js` has no DOM/fetch/side effects so
   `npm test` covers the whole rules engine.
3. **Graceful degradation.** A missing/malformed STATE block is a no-op, never
   a crash. Old saves migrate. The game plays on even if the DM forgets the
   contract (fallback choices still work).
4. **Zero budget.** No paid services, no API keys beyond the user's own free
   Gemini key, no build step, no bundler.
5. **VN standard.** Every repo carries the VN signature; SFX/VFX are
   maximalist but never break the game (all sound/visual calls are guarded).

## Teardown learnings (2026-10-14)
Three similar open-source AI-DM projects were analyzed from their public
GitHub sources (mechanisms only — no code, strings, or assets copied):
- **Project A (Next.js + Gemini, structured JSON output)**: schema-constrained
  replies returning narrative + full game state + XP/level + game-over flag,
  class starting kits, and a keyword-inferred dungeon map. → Adopted:
  structured state contract (as a text STATE block, since our OpenAI-compatible
  endpoint can't guarantee a JSON schema), XP/leveling, class kits.
  Skipped: keyword-inferred map (gimmicky for free-form settings; low value).
- **Project B (FastAPI + SQLite + local LLM)**: code-owned combat (dice math in
  code, LLM narrates only the resolved outcome), delta-based stat updates,
  achievements with toasts, guaranteed move action, world events, portable
  save codes, AI end-of-game summary. → Adopted: code-owned combat, delta
  updates, achievements. Skipped: world events (needs server-side global
  state; low value for a solo local game), save codes (slots + autosave
  already cover it), AI summary (chronicle export is free and instant).
- **Project C (Cloudflare Durable Objects + Workers AI)**: randomized win
  conditions picked at session start and tracked to a victory screen,
  state-delta + conditions-met contract, voice input, offline fallback
  narrative. → Adopted: randomized objectives/victory. Skipped: voice input
  (spotty browser support, complexity), Durable Objects (no need — the game
  is local-first by design).
- **Observed, not implemented**: per-turn JSON-schema enforcement via a
  provider SDK (our OpenAI-compatible Gemini endpoint doesn't guarantee it;
  the text STATE block is the robust equivalent). Voice narration / TTS
  (adds cost/complexity; out of scope for a zero-budget text game).

## Future ideas (not committed)
- Bestiary: a card per foe met (AC/HP/attacks), kept client-side.
- Progress clocks / faction standings as extra objective flavors.
- Scene images per chapter (free image endpoint) — only if it stays $0.
- Import/export of a save as a shareable file (portable campaigns).
- Daily quest / streak hooks — only if they fit solo play without nagging.

## QA
```bash
npm test          # 36 pure-logic unit tests
node --check js/*.js server.js
npm start         # then http://localhost:3000 — /api/health must return ok:true
```
