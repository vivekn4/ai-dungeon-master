# ⚔️ AI Dungeon Master

![AI Dungeon Master banner](assets/banner.jpg)

![Made by VN](https://img.shields.io/badge/made%20by-VN-blue)

A solo Dungeons & Dragons–style adventure game in your browser. Create a hero, pick a realm (or invent your own), and an AI Dungeon Master weaves a living story around every choice you make — complete with dice rolls, hit points, inventory, and a quest log.

**100% free to run** — powered by the free Gemini API. No build step, no bundler, no paid services.

> ![Gameplay screenshot](docs/screenshot.png)
> *Screenshot placeholder — replace `docs/screenshot.png` with a real capture of your adventure.*

## ✨ Features

- **Hero creation** — name, 5 classes (Warrior, Rogue, Mage, Ranger, Cleric — each with its own HP), 3 realms or a fully custom setting
- **Living story** — the AI narrates in vivid second person, reacts to your dice rolls, and ends every reply with 3 clickable quick-choice actions
- **Typewriter narration** — story text types out like a bard's tale (click to skip)
- **Dice roller** — d20/d12/d10/d8/d6/d4 with roll animation, critical hit/fumble flair, send-as-action or insert-into-input
- **Character panel** — HP bar with damage/heal controls, inventory list, quest log with completion tracking
- **3 save slots** — full campaign state (story history + character) persisted in `localStorage`
- **Dark-fantasy UI** — ember particles, gold-on-obsidian theme, fully mobile-responsive
- **Synthesized SFX** — zero-asset WebAudio sound engine: dice rattles, critical-hit fanfares, fumble buzzes, quest-complete jingles, whooshes on every send (mutable, persisted)
- **Canvas VFX** — ambient rising embers, confetti bursts on nat 20s and quest completions, screen shake on nat 1s, sparkles on quick choices; auto-quality scaling + `prefers-reduced-motion` support

## 🚀 Run locally

**Requirements:** Node.js 20+ and a free Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).

```bash
npm install
cp .env.example .env
# edit .env and paste your key into AI_API_KEY
npm start
```

Open http://localhost:3000 and begin your adventure. 🐉

## ☁️ Deploy to Render (free)

1. Push this repo to GitHub.
2. In [Render](https://render.com), click **New → Web Service** and select the repo (or **New → Blueprint** and point it at `render.yaml`).
3. Set the **AI_API_KEY** environment variable to your free Gemini key.
4. Deploy — Render builds with `npm install` and starts with `npm start`. Your game is live at the URL Render gives you.

## 🔑 Environment variables

| Variable      | Required | Default                                                        | Description                                      |
|---------------|----------|----------------------------------------------------------------|--------------------------------------------------|
| `AI_API_KEY`  | Yes      | —                                                              | Free Gemini API key (Google AI Studio). Never commit it. |
| `PORT`        | No       | `3000`                                                         | HTTP port (Render sets this automatically).      |
| `AI_MODEL`    | No       | `gemini-3.8-flash`                                             | Model name sent to the OpenAI-compatible endpoint. |
| `AI_BASE_URL` | No       | `https://generativelanguage.googleapis.com/v1beta/openai`      | OpenAI-compatible chat completions base URL.     |
| `FRONTEND_URL`| No       | (open)                                                         | Comma-separated CORS allowlist. Set in production. |

## 🧪 Tests

```bash
npm test   # pure-logic unit tests: dice ranges, choice parser, HP clamping
```

## 🗂️ Project structure

```
├── index.html          # setup screen + game screen markup
├── css/style.css       # dark-fantasy theme, responsive
├── js/app.js           # game state, UI wiring, AI chat flow (ES module)
├── js/logic.js         # pure logic (dice, choice parser, HP) — unit tested
├── server.js           # hardened Express API: /api/health, /api/chat
├── test/logic.test.mjs# unit tests for js/logic.js
├── render.yaml         # one-click Render deploy
└── .env.example        # environment template
```

## 🛡️ Backend notes

- `helmet`, CORS allowlist, per-IP rate limiting (`express-rate-limit`), request validation, and a 60-second upstream timeout.
- The API key lives **only** in the `AI_API_KEY` env var — it is never sent to the browser.
- All failures return graceful JSON (`{ error: "..." }`); the server never crashes and never leaks stack traces or keys.

## 📜 License

MIT — see [LICENSE](LICENSE).

---

**Crafted by [Vivek Nair](https://github.com/vivekn4) · VN**
