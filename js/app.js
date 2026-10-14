// Crafted by Vivek Nair (VN) — https://github.com/vivekn4
/**
 * AI Dungeon Master — frontend application.
 * Zero-build vanilla JS (ES module). All pure logic lives in logic.js
 * so it can be unit-tested in Node.
 */
import { rollDie, clampHp, parseChoices, parseStateBlock, stripStateBlock, applyStateDeltas, resolveCombatRound, pickObjectives, checkAchievements, formatChronicle, xpForNextLevel, FALLBACK_CHOICES, CLASS_MAX_HP, CLASS_STARTING_KIT, ACHIEVEMENTS, escapeHtml } from "./logic.js";
import { Sfx } from "./sfx.js";
import { Vfx } from "./vfx.js";

/* ---------------------------------------------------------------- */
/* State                                                             */
/* ---------------------------------------------------------------- */

const SAVE_KEY = "aidm_saves_v1";
const AUTOSAVE_KEY = "aidm_autosave_v1";

const state = {
  started: false,
  busy: false,
  dead: false,
  victory: false,
  setup: { name: "", charClass: "Warrior", setting: "" },
  // { role: 'user'|'assistant', content: string, hidden?: boolean }
  messages: [],
  // quests: {text, done}; foe: null | {name, hp, maxHp, attack}
  character: { hp: 40, maxHp: 40, gold: 10, xp: 0, level: 1, inventory: [], quests: [], foe: null, objectives: [], achievements: [], turns: 0, rolls: 0, nat20s: 0, combatWins: 0 },
  lastRoll: null, // { sides, value }
};

/* ---------------------------------------------------------------- */
/* DOM helpers                                                       */
/* ---------------------------------------------------------------- */

function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element: #${id}`);
  return el;
}

const ui = {};
function cacheDom() {
  [
    "setup-screen", "game-screen", "hero-name", "hero-class", "setting-select",
    "setting-custom", "start-btn", "setup-error", "resume-autosave-btn",
    "char-name", "char-sub", "new-campaign-btn",
    "story-log", "thinking", "choice-buttons", "action-input", "send-btn",
    "hp-fill", "hp-text", "stats-line", "inv-input", "inv-add-btn", "inv-list",
    "quest-input", "quest-add-btn", "quest-list",
    "objective-list", "achievement-list",
    "combat-card", "foe-name", "foe-hp-fill", "foe-hp-text",
    "combat-attack", "combat-defend", "combat-flee",
    "dice-result", "dice-send", "dice-insert", "sfx-toggle",
    "chronicle-btn", "toast",
  ].forEach((id) => { ui[id] = $(id); });
  ui.hpBtns = Array.from(document.querySelectorAll(".hp-btn"));
  ui.dieBtns = Array.from(document.querySelectorAll(".die-btn"));
  if (ui.hpBtns.length === 0) throw new Error("Missing .hp-btn buttons");
  if (ui.dieBtns.length === 0) throw new Error("Missing .die-btn buttons");
}

/* ---------------------------------------------------------------- */
/* Screens                                                           */
/* ---------------------------------------------------------------- */

function showScreen(which) {
  ui["setup-screen"].classList.toggle("hidden", which !== "setup");
  ui["game-screen"].classList.toggle("hidden", which !== "game");
}

/* ---------------------------------------------------------------- */
/* Story log                                                         */
/* ---------------------------------------------------------------- */

function scrollLog() {
  ui["story-log"].scrollTop = ui["story-log"].scrollHeight;
}

function appendUserMessage(text) {
  const div = document.createElement("div");
  div.className = "message user";
  div.innerHTML = `<div class="bubble">${escapeHtml(text)}</div>`;
  ui["story-log"].appendChild(div);
  scrollLog();
}

function appendSystemMessage(text) {
  const div = document.createElement("div");
  div.className = "message system";
  div.innerHTML = `<div class="sysline">${escapeHtml(text)}</div>`;
  ui["story-log"].appendChild(div);
  scrollLog();
}

/** Typewriter for AI narration. Returns a promise; click the message to skip. */
function typewrite(el, text) {
  return new Promise((resolve) => {
    let i = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(timer);
      el.textContent = text;
      scrollLog();
      resolve();
    };
    el.addEventListener("click", finish, { once: true });
    const timer = setInterval(() => {
      i += 3; // 3 chars per tick keeps long replies snappy
      if (i >= text.length) {
        finish();
      } else {
        el.textContent = text.slice(0, i);
        scrollLog();
      }
    }, 14);
  });
}

async function appendAiMessage(story, animate) {
  const div = document.createElement("div");
  div.className = "message dm";
  const body = document.createElement("div");
  body.className = "bubble dm-text";
  body.title = "Click to skip";
  div.appendChild(body);
  ui["story-log"].appendChild(div);
  if (animate) {
    await typewrite(body, story);
  } else {
    body.textContent = story;
  }
  scrollLog();
}

/** Re-render the whole log from state (used on load). No animation. */
function renderLogFromState() {
  ui["story-log"].innerHTML = "";
  for (const m of state.messages) {
    if (m.hidden) continue;
    if (m.role === "user") appendUserMessage(m.content);
    else {
      const { story } = parseChoices(stripStateBlock(m.content));
      const div = document.createElement("div");
      div.className = "message dm";
      div.innerHTML = `<div class="bubble dm-text"></div>`;
      div.querySelector(".dm-text").textContent = story;
      ui["story-log"].appendChild(div);
    }
  }
  scrollLog();
  // Restore quick choices from the latest AI reply, if any.
  const lastAi = [...state.messages].reverse().find((m) => m.role === "assistant" && !m.hidden);
  if (lastAi) {
    const { choices } = parseChoices(stripStateBlock(lastAi.content));
    renderChoices(choices || FALLBACK_CHOICES);
  } else {
    renderChoices([]);
  }
}

/* ---------------------------------------------------------------- */
/* Quick choices                                                     */
/* ---------------------------------------------------------------- */

function renderChoices(choices) {
  ui["choice-buttons"].innerHTML = "";
  choices.forEach((text) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "choice-btn";
    btn.textContent = text;
    btn.addEventListener("click", () => sendPlayerAction(text));
    ui["choice-buttons"].appendChild(btn);
  });
}

function clearChoices() {
  ui["choice-buttons"].innerHTML = "";
}

/* ---------------------------------------------------------------- */
/* AI communication                                                  */
/* ---------------------------------------------------------------- */

function apiMessages() {
  // Bound history so requests stay small; hidden setup message stays first.
  const visible = state.messages.filter((m) => !m.hidden).slice(-28);
  const hidden = state.messages.filter((m) => m.hidden);
  return [...hidden, ...visible].map((m) => ({ role: m.role, content: m.content }));
}

async function requestDmReply() {
  ui.thinking.classList.remove("hidden");
  clearChoices();
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: apiMessages() }),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      throw new Error("The spirits garbled the reply (bad response). Try again.");
    }
    if (!res.ok) throw new Error(data?.error || `Request failed (HTTP ${res.status})`);
    if (!data?.reply) throw new Error("The Dungeon Master fell silent. Try again.");

    const { story, choices } = parseChoices(stripStateBlock(data.reply));
    state.messages.push({ role: "assistant", content: data.reply });
    state.character.turns += 1;
    await appendAiMessage(story, true);
    renderChoices(choices || FALLBACK_CHOICES);
    applyDmConsequences(parseStateBlock(data.reply));
  } catch (err) {
    Sfx.errorBuzz();
    appendSystemMessage(`⚠️ ${err.message || "Something went wrong."}`);
  } finally {
    ui.thinking.classList.add("hidden");
    state.busy = false;
    ui["send-btn"].disabled = false;
    ui["action-input"].focus();
  }
}

async function sendPlayerAction(text) {
  const clean = String(text ?? "").trim();
  if (!clean || state.busy || !state.started) return;
  if (state.dead) {
    appendSystemMessage("💀 Your hero has fallen. Start a New Campaign to rise again.");
    return;
  }
  Sfx.whoosh();
  state.busy = true;
  ui["send-btn"].disabled = true;
  state.messages.push({ role: "user", content: clean });
  appendUserMessage(clean);
  ui["action-input"].value = "";
  await requestDmReply();
}

/* ---------------------------------------------------------------- */
/* Consequences: apply the DM's STATE block, then check milestones   */
/* ---------------------------------------------------------------- */

/** Stats snapshot for the achievement checker. */
function achievementStats() {
  const c = state.character;
  return {
    rolls: c.rolls || 0,
    nat20s: c.nat20s || 0,
    turns: c.turns || 0,
    inventoryCount: (c.inventory || []).length,
    questsDone: (c.quests || []).filter((q) => q.done).length,
    level: c.level || 1,
    combatWins: c.combatWins || 0,
  };
}

let toastTimer = null;
const toastQueue = [];
function showToast(text) {
  toastQueue.push(text);
  if (toastTimer) return;
  const next = () => {
    const t = toastQueue.shift();
    if (!t) { toastTimer = null; return; }
    ui.toast.textContent = t;
    ui.toast.classList.remove("hidden");
    toastTimer = setTimeout(() => {
      ui.toast.classList.add("hidden");
      toastTimer = setTimeout(next, 350);
    }, 3800);
  };
  next();
}

/** Award newly-earned achievements with toast + sparkle. */
function checkAndAwardAchievements() {
  const newly = checkAchievements(achievementStats(), state.character.achievements || []);
  if (newly.length === 0) return;
  state.character.achievements = [...(state.character.achievements || []), ...newly];
  for (const id of newly) {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (a) showToast(`🏆 Honor earned: ${a.name} — ${a.desc}`);
  }
  if (newly.length > 0) Sfx.successChime();
  renderAchievements();
}

/** Apply STATE deltas (XP/HP/gold/items) with level-up fanfare. */
function applyDeltas(deltas) {
  const { character, events } = applyStateDeltas(state.character, deltas);
  state.character = character;
  if (events.levelsGained > 0) {
    Sfx.levelUp();
    Vfx.confetti(window.innerWidth / 2, window.innerHeight * 0.3);
    appendSystemMessage(`⭐ LEVEL UP! You are now level ${character.level} (+5 max HP, +5 HP).`);
  }
  renderCharacter();
  if (events.died) handleDeath();
  return events;
}

/** Full consequence pass for one DM reply: STATE, foe, objectives, honors. */
function applyDmConsequences(deltas) {
  applyDeltas(deltas);
  if (state.dead) { autoSave(); return; }
  if (deltas.foe !== undefined) {
    state.character.foe = deltas.foe;
    if (deltas.foe) {
      appendSystemMessage(`⚔️ A foe appears: ${deltas.foe.name} (${deltas.foe.hp} HP)! Use the Combat panel — the dice decide.`);
      Sfx.diceRoll();
    }
    renderCombat();
  }
  if (deltas.objectiveDone) {
    const obj = (state.character.objectives || []).find((o) => o.id === deltas.objectiveDone);
    if (obj && !obj.done) {
      obj.done = true;
      Sfx.fanfare();
      Vfx.confetti(window.innerWidth / 2, window.innerHeight * 0.35);
      appendSystemMessage(`🎯 Objective complete: ${obj.label}`);
      renderObjectives();
      if ((state.character.objectives || []).length > 0 && state.character.objectives.every((o) => o.done) && !state.victory) {
        state.victory = true;
        appendSystemMessage(`🏆 VICTORY! ${state.setup.name} has completed every objective and the realm sings of this legend! Free play continues — or start a New Campaign.`);
        Sfx.fanfare();
        Vfx.confetti(window.innerWidth / 2, window.innerHeight * 0.3, { count: 160 });
      }
    }
  }
  checkAndAwardAchievements();
  autoSave();
}

function handleDeath() {
  if (state.dead) return;
  state.dead = true;
  state.character.foe = null;
  Sfx.errorBuzz();
  Vfx.shake(12, 420);
  appendSystemMessage(`💀 ${state.setup.name} has fallen… The tale ends here. Start a New Campaign to rise again, or load a save.`);
  renderCombat();
  autoSave();
}

/* ---------------------------------------------------------------- */
/* Campaign setup                                                    */
/* ---------------------------------------------------------------- */

function startCampaign() {
  const name = ui["hero-name"].value.trim();
  const charClass = ui["hero-class"].value;
  const customSetting = ui["setting-custom"].value.trim();
  const setting = customSetting || ui["setting-select"].value;

  ui["setup-error"].textContent = "";
  if (!name) {
    ui["setup-error"].textContent = "Give your hero a name to begin.";
    ui["hero-name"].focus();
    return;
  }
  if (name.length > 40) {
    ui["setup-error"].textContent = "Keep the hero name under 40 characters.";
    ui["hero-name"].focus();
    return;
  }

  const maxHp = CLASS_MAX_HP[charClass] || 30;
  const kit = CLASS_STARTING_KIT[charClass] || { items: [], gold: 10 };
  const objectives = pickObjectives(2);
  state.setup = { name, charClass, setting };
  state.messages = [
    {
      role: "user",
      hidden: true,
      content:
        `CAMPAIGN SETUP — do not repeat this back, just begin the adventure. ` +
        `Hero: "${name}", a ${charClass}. Setting: ${setting}. ` +
        `Campaign objectives (win by completing ALL of them; report each with an OBJECTIVE line when truly complete): ` +
        objectives.map((o) => `${o.id}: ${o.label}`).join("; ") + `. ` +
        `Open with an exciting first scene worthy of a legend.`,
    },
  ];
  state.character = { hp: maxHp, maxHp, gold: kit.gold, xp: 0, level: 1, inventory: [...kit.items], quests: [], foe: null, objectives, achievements: [], turns: 0, rolls: 0, nat20s: 0, combatWins: 0 };
  state.lastRoll = null;
  state.started = true;
  state.dead = false;
  state.victory = false;
  state.busy = true;
  ui["send-btn"].disabled = true;

  ui["char-name"].textContent = name;
  ui["char-sub"].textContent = `${charClass} · ${setting}`;
  ui["story-log"].innerHTML = "";
  ui["dice-result"].textContent = "—";
  ui["dice-send"].disabled = true;
  ui["dice-insert"].disabled = true;

  renderCharacter();
  renderSlotStatuses();
  showScreen("game");
  appendSystemMessage(`⚔️ ${name} the ${charClass} enters ${setting}…`);
  Sfx.fanfare();
  Sfx.whoosh();
  Vfx.confetti(window.innerWidth / 2, 130);
  requestDmReply();
}

function newCampaign() {
  if (!window.confirm("Abandon this campaign and start a new one? Unsaved progress will be lost.")) {
    return;
  }
  Sfx.whoosh();
  state.started = false;
  state.busy = false;
  state.dead = false;
  state.victory = false;
  state.messages = [];
  state.lastRoll = null;
  ui["action-input"].value = "";
  showScreen("setup");
  refreshResumeButton();
  ui["hero-name"].focus();
}

/* ---------------------------------------------------------------- */
/* Character panel                                                   */
/* ---------------------------------------------------------------- */

function renderCharacter() {
  renderHp();
  renderStats();
  renderInventory();
  renderQuests();
  renderObjectives();
  renderCombat();
  renderAchievements();
}

function renderStats() {
  const c = state.character;
  ui["stats-line"].textContent =
    `🪙 ${c.gold ?? 0} gold · ⭐ Level ${c.level ?? 1} · XP ${c.xp ?? 0}/${xpForNextLevel(c.level ?? 1)} · 🌀 Turn ${c.turns ?? 0}`;
}

function renderObjectives() {
  ui["objective-list"].innerHTML = "";
  const objs = state.character.objectives || [];
  if (objs.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-note";
    li.textContent = "No objectives in this campaign.";
    ui["objective-list"].appendChild(li);
    return;
  }
  objs.forEach((o) => {
    const li = document.createElement("li");
    li.className = "quest-item" + (o.done ? " done" : "");
    const span = document.createElement("span");
    span.textContent = `${o.done ? "✓ " : "○ "}${o.label}`;
    li.appendChild(span);
    ui["objective-list"].appendChild(li);
  });
}

function renderCombat() {
  const foe = state.character.foe;
  ui["combat-card"].classList.toggle("hidden", !foe);
  if (!foe) return;
  ui["foe-name"].textContent = `${foe.name} — ATK ${foe.attack}`;
  const pct = foe.maxHp > 0 ? Math.max(0, Math.min(100, (foe.hp / foe.maxHp) * 100)) : 0;
  ui["foe-hp-fill"].style.width = `${pct}%`;
  ui["foe-hp-text"].textContent = `${foe.hp} / ${foe.maxHp} HP`;
  const disabled = state.busy || state.dead;
  for (const id of ["combat-attack", "combat-defend", "combat-flee"]) ui[id].disabled = disabled;
}

function renderAchievements() {
  ui["achievement-list"].innerHTML = "";
  const earned = state.character.achievements || [];
  if (earned.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-note";
    li.textContent = "No honors yet — adventure awaits!";
    ui["achievement-list"].appendChild(li);
    return;
  }
  for (const id of earned) {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) continue;
    const li = document.createElement("li");
    li.className = "quest-item done";
    const span = document.createElement("span");
    span.textContent = `🏆 ${a.name} — ${a.desc}`;
    li.appendChild(span);
    ui["achievement-list"].appendChild(li);
  }
}

function renderHp() {
  const { hp, maxHp } = state.character;
  const pct = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
  ui["hp-fill"].style.width = `${pct}%`;
  ui["hp-fill"].classList.toggle("low", pct <= 30);
  ui["hp-text"].textContent = `${hp} / ${maxHp} HP`;
}

function adjustHp(delta) {
  if (!state.started) return;
  state.character.hp = clampHp(state.character.hp + delta, state.character.maxHp);
  renderHp();
  if (state.character.hp <= 0) {
    Sfx.errorBuzz();
    Vfx.shake(12, 420);
  }
}

function renderInventory() {
  ui["inv-list"].innerHTML = "";
  if (state.character.inventory.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-note";
    li.textContent = "Empty pockets… for now.";
    ui["inv-list"].appendChild(li);
    return;
  }
  state.character.inventory.forEach((item, idx) => {
    const li = document.createElement("li");
    li.className = "inv-item";
    const span = document.createElement("span");
    span.textContent = item;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mini-btn danger";
    btn.textContent = "✕";
    btn.title = "Remove item";
    btn.dataset.idx = String(idx);
    li.appendChild(span);
    li.appendChild(btn);
    ui["inv-list"].appendChild(li);
  });
}

function addInventory() {
  const val = ui["inv-input"].value.trim();
  if (!val || !state.started) return;
  state.character.inventory.push(val.slice(0, 80));
  ui["inv-input"].value = "";
  renderInventory();
  Sfx.successChime();
  ui["inv-input"].focus();
}

function renderQuests() {
  ui["quest-list"].innerHTML = "";
  if (state.character.quests.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-note";
    li.textContent = "No quests yet. Adventure awaits!";
    ui["quest-list"].appendChild(li);
    return;
  }
  state.character.quests.forEach((q, idx) => {
    const li = document.createElement("li");
    li.className = "quest-item" + (q.done ? " done" : "");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "mini-btn";
    toggle.textContent = q.done ? "↩" : "✓";
    toggle.title = q.done ? "Reopen quest" : "Complete quest";
    toggle.dataset.action = "toggle";
    toggle.dataset.idx = String(idx);
    const span = document.createElement("span");
    span.textContent = q.text;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "mini-btn danger";
    del.textContent = "✕";
    del.title = "Remove quest";
    del.dataset.action = "remove";
    del.dataset.idx = String(idx);
    li.appendChild(toggle);
    li.appendChild(span);
    li.appendChild(del);
    ui["quest-list"].appendChild(li);
  });
}

function addQuest() {
  const val = ui["quest-input"].value.trim();
  if (!val || !state.started) return;
  state.character.quests.push({ text: val.slice(0, 120), done: false });
  ui["quest-input"].value = "";
  renderQuests();
  Sfx.successChime();
  ui["quest-input"].focus();
}

/* ---------------------------------------------------------------- */
/* Dice roller                                                       */
/* ---------------------------------------------------------------- */

function rollDice(sides) {
  if (!state.started) return;
  const resultEl = ui["dice-result"];
  ui["dice-send"].disabled = true;
  ui["dice-insert"].disabled = true;
  Sfx.diceRoll();

  // Roll animation: rapid cycling, then settle.
  let ticks = 0;
  const anim = setInterval(() => {
    ticks += 1;
    resultEl.textContent = String(1 + Math.floor(Math.random() * sides));
    resultEl.classList.add("rolling");
    if (ticks >= 10) {
      clearInterval(anim);
      const value = rollDie(sides);
      state.lastRoll = { sides, value };
      state.character.rolls = (state.character.rolls || 0) + 1;
      if (sides === 20 && value === 20) state.character.nat20s = (state.character.nat20s || 0) + 1;
      checkAndAwardAchievements();
      resultEl.textContent = String(value);
      resultEl.classList.remove("rolling");
      resultEl.classList.remove("crit");
      if (sides === 20 && value === 20) {
        resultEl.classList.add("crit");
        resultEl.textContent = `20 ✨`;
        Sfx.diceSettle("high");
        Vfx.confetti(window.innerWidth / 2, window.innerHeight * 0.3);
      } else if (sides === 20 && value === 1) {
        resultEl.classList.add("crit");
        resultEl.textContent = `1 💀`;
        Sfx.diceSettle("low");
        Vfx.shake(10, 380);
      } else {
        Sfx.diceSettle();
      }
      ui["dice-send"].disabled = false;
      ui["dice-insert"].disabled = false;
    }
  }, 60);
}

function sendRoll() {
  if (!state.lastRoll) return;
  const { sides, value } = state.lastRoll;
  sendPlayerAction(`I roll a d${sides} and get ${value}.`);
}

function insertRoll() {
  if (!state.lastRoll) return;
  const { sides, value } = state.lastRoll;
  const input = ui["action-input"];
  const tag = ` [d${sides}: ${value}]`;
  input.value = (input.value + tag).slice(0, 2000);
  input.focus();
}

/* ---------------------------------------------------------------- */
/* Combat — dice resolved here, DM narrates the outcome only          */
/* ---------------------------------------------------------------- */

async function doCombatRound(action) {
  const foe = state.character.foe;
  if (!foe || state.busy || !state.started || state.dead) return;
  state.busy = true;
  ui["send-btn"].disabled = true;
  renderCombat();
  Sfx.diceRoll();

  const result = resolveCombatRound({
    action,
    playerHp: state.character.hp,
    playerLevel: state.character.level,
    foe,
  });
  state.character.hp = result.playerHp;
  state.character.foe = result.foe;
  renderHp();
  renderStats();

  for (const line of result.log) appendSystemMessage(`⚔️ ${line}`);
  if (result.outcome === "victory") {
    state.character.combatWins = (state.character.combatWins || 0) + 1;
    state.character.foe = null;
    Sfx.fanfare();
    Vfx.confetti(window.innerWidth / 2, window.innerHeight * 0.3);
    applyDeltas({ found: true, hp: 0, gold: 0, xp: 25, itemsAdded: [], itemsRemoved: [], foe: undefined, objectiveDone: null });
    checkAndAwardAchievements();
  } else if (result.outcome === "fled") {
    state.character.foe = null;
    Sfx.whoosh();
  } else if (result.outcome === "defeat") {
    Sfx.errorBuzz();
    Vfx.shake(12, 420);
    renderCombat();
    handleDeath();
    state.busy = false;
    ui["send-btn"].disabled = false;
    return;
  } else {
    if (state.character.hp <= 0) { // safety net; resolveCombatRound already reports defeat
      handleDeath();
      state.busy = false;
      ui["send-btn"].disabled = false;
      return;
    }
    if (state.character.hp <= state.character.maxHp * 0.3) Vfx.shake(6, 300);
    else Sfx.diceSettle();
  }
  renderCombat();
  autoSave();

  // Hidden combat report: the DM narrates the decided numbers, never re-rolls.
  state.messages.push({
    role: "user",
    hidden: true,
    content: `[Combat round resolved by the game dice — narrate EXACTLY this, do not change any numbers: ${result.log.join(" ")}] End with CHOICES and a STATE block as usual.`,
  });
  await requestDmReply();
}

/* ---------------------------------------------------------------- */
/* Save / load (3 localStorage slots + autosave)                     */
/* ---------------------------------------------------------------- */

function readSaves() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return [arr[0] || null, arr[1] || null, arr[2] || null];
  } catch {
    return [null, null, null];
  }
}

function writeSaves(saves) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(saves));
}

/** Snapshot the full campaign state. Version 2 adds gold/XP/foe/objectives/achievements. */
function snapshotCampaign() {
  return {
    version: 2,
    savedAt: new Date().toISOString(),
    setup: { ...state.setup },
    messages: state.messages.map((m) => ({ ...m })),
    character: {
      hp: state.character.hp,
      maxHp: state.character.maxHp,
      gold: state.character.gold ?? 0,
      xp: state.character.xp ?? 0,
      level: state.character.level ?? 1,
      inventory: [...(state.character.inventory || [])],
      quests: (state.character.quests || []).map((q) => ({ ...q })),
      foe: state.character.foe ? { ...state.character.foe } : null,
      objectives: (state.character.objectives || []).map((o) => ({ ...o })),
      achievements: [...(state.character.achievements || [])],
      turns: state.character.turns ?? 0,
      rolls: state.character.rolls ?? 0,
      nat20s: state.character.nat20s ?? 0,
      combatWins: state.character.combatWins ?? 0,
    },
    dead: state.dead,
    victory: state.victory,
  };
}

/** Restore a snapshot (migrates version-1 saves with fresh defaults). */
function restoreCampaign(s) {
  state.setup = { ...s.setup };
  state.messages = (s.messages || []).map((m) => ({ ...m }));
  const c = s.character || {};
  state.character = {
    hp: clampHp(c.hp ?? 30, c.maxHp ?? 30),
    maxHp: Math.max(1, Math.floor(Number(c.maxHp) || 30)),
    gold: Math.max(0, Math.floor(Number(c.gold) || 0)),
    xp: Math.max(0, Math.floor(Number(c.xp) || 0)),
    level: Math.max(1, Math.floor(Number(c.level) || 1)),
    inventory: Array.isArray(c.inventory) ? [...c.inventory] : [],
    quests: Array.isArray(c.quests)
      ? c.quests.map((q) => ({ text: String(q.text || ""), done: !!q.done }))
      : [],
    foe: c.foe ? { ...c.foe } : null,
    objectives: Array.isArray(c.objectives) && c.objectives.length > 0
      ? c.objectives.map((o) => ({ id: String(o.id || ""), label: String(o.label || ""), done: !!o.done }))
      : pickObjectives(2),
    achievements: Array.isArray(c.achievements) ? [...c.achievements] : [],
    turns: Math.max(0, Math.floor(Number(c.turns) || 0)),
    rolls: Math.max(0, Math.floor(Number(c.rolls) || 0)),
    nat20s: Math.max(0, Math.floor(Number(c.nat20s) || 0)),
    combatWins: Math.max(0, Math.floor(Number(c.combatWins) || 0)),
  };
  state.dead = !!s.dead;
  state.victory = !!s.victory;
  state.lastRoll = null;
  state.started = true;
  state.busy = false;
}

function saveSlot(i) {
  if (!state.started) return;
  const saves = readSaves();
  saves[i] = snapshotCampaign();
  try {
    writeSaves(saves);
  } catch {
    appendSystemMessage("⚠️ Could not save — browser storage is unavailable.");
    return;
  }
  renderSlotStatuses();
  Sfx.successChime();
  const sb = document.getElementById(`save-btn-${i}`);
  if (sb) {
    const r = sb.getBoundingClientRect();
    Vfx.sparkle(r.left + r.width / 2, r.top);
  }
  appendSystemMessage(`💾 Campaign saved to slot ${i + 1}.`);
}

/** Silent autosave after every reply / combat round. Never throws. */
function autoSave() {
  if (!state.started) return;
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshotCampaign()));
  } catch {
    /* storage full/blocked — manual slots still work */
  }
}

function readAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function refreshResumeButton() {
  const s = readAutosave();
  ui["resume-autosave-btn"].classList.toggle("hidden", !s);
}

function loadAutosave() {
  const s = readAutosave();
  if (!s) return;
  restoreCampaign(s);
  ui["send-btn"].disabled = false;
  ui["char-name"].textContent = state.setup.name || "Hero";
  ui["char-sub"].textContent = `${state.setup.charClass || ""} · ${state.setup.setting || ""}`;
  ui["dice-result"].textContent = "—";
  ui["dice-send"].disabled = true;
  ui["dice-insert"].disabled = true;
  renderCharacter();
  showScreen("game");
  Sfx.whoosh();
  renderLogFromState();
  appendSystemMessage("📜 Autosave restored. The adventure continues…");
}

function loadSlot(i) {
  const saves = readSaves();
  const s = saves[i];
  if (!s) return;
  restoreCampaign(s);
  ui["send-btn"].disabled = false;
  ui["char-name"].textContent = state.setup.name || "Hero";
  ui["char-sub"].textContent = `${state.setup.charClass || ""} · ${state.setup.setting || ""}`;
  ui["dice-result"].textContent = "—";
  ui["dice-send"].disabled = true;
  ui["dice-insert"].disabled = true;
  renderCharacter();
  showScreen("game");
  Sfx.whoosh();
  renderLogFromState();
  appendSystemMessage(`📜 Loaded campaign from slot ${i + 1}. The adventure continues…`);
}

function renderSlotStatuses() {
  const saves = readSaves();
  saves.forEach((s, i) => {
    const saveBtn = $(`save-btn-${i}`);
    const loadBtn = $(`load-btn-${i}`);
    const status = $(`slot-status-${i}`);
    if (s && s.setup) {
      const d = new Date(s.savedAt);
      const label = Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
      status.textContent = `${s.setup.name || "Hero"} · ${label}`;
      loadBtn.disabled = false;
    } else {
      status.textContent = "Empty";
      loadBtn.disabled = true;
    }
    saveBtn.disabled = !state.started;
  });
}

/* ---------------------------------------------------------------- */
/* Chronicle export                                                  */
/* ---------------------------------------------------------------- */

function exportChronicle() {
  if (!state.started && state.messages.length === 0) return;
  const md = formatChronicle({
    setup: state.setup,
    messages: state.messages,
    character: state.character,
    objectives: state.character.objectives,
    achievements: state.character.achievements,
  });
  const safeName = (state.setup.name || "hero").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `aidm-chronicle-${safeName}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  Sfx.successChime();
  appendSystemMessage("📜 Chronicle exported — your tale, saved as markdown.");
}

/* ---------------------------------------------------------------- */
/* SFX / VFX wiring                                                  */
/* ---------------------------------------------------------------- */

function wireSfxToggle() {
  const btn = ui["sfx-toggle"];
  const paint = () => {
    const m = Sfx.isMuted();
    btn.textContent = m ? "🔇" : "🔊";
    btn.title = m ? "Unmute sound effects" : "Mute sound effects";
    btn.setAttribute("aria-label", btn.title);
    btn.setAttribute("aria-pressed", String(m));
  };
  btn.addEventListener("click", () => {
    Sfx.toggle();
    paint();
  });
  paint();
}

let lastHoverTarget = null;
function wireGlobalFx() {
  // Every button press gets a click blip; choice buttons get a sparkle.
  document.addEventListener("click", (e) => {
    const btn = e.target && e.target.closest ? e.target.closest("button") : null;
    if (!btn || btn.disabled) return;
    Sfx.click();
    if (btn.classList.contains("choice-btn")) {
      Vfx.sparkle(e.clientX, e.clientY);
    }
  });
  // Subtle hover tick on the fun buttons (throttled to one tick per entry).
  document.addEventListener("mouseover", (e) => {
    const t = e.target && e.target.closest ? e.target.closest(".choice-btn, .die-btn") : null;
    if (t && t !== lastHoverTarget && !t.disabled) {
      lastHoverTarget = t;
      Sfx.hoverTick();
    } else if (!t) {
      lastHoverTarget = null;
    }
  });
}

/* ---------------------------------------------------------------- */
/* Wiring                                                            */
/* ---------------------------------------------------------------- */

function wireEvents() {
  ui["start-btn"].addEventListener("click", startCampaign);
  ui["hero-name"].addEventListener("keydown", (e) => {
    if (e.key === "Enter") startCampaign();
  });
  ui["setting-custom"].addEventListener("keydown", (e) => {
    if (e.key === "Enter") startCampaign();
  });

  ui["new-campaign-btn"].addEventListener("click", newCampaign);

  ui["send-btn"].addEventListener("click", () => sendPlayerAction(ui["action-input"].value));
  ui["action-input"].addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendPlayerAction(ui["action-input"].value);
    }
  });

  ui.hpBtns.forEach((btn) => {
    btn.addEventListener("click", () => adjustHp(Number(btn.dataset.delta) || 0));
  });

  ui.dieBtns.forEach((btn) => {
    btn.addEventListener("click", () => rollDice(Number(btn.dataset.sides)));
  });
  ui["dice-send"].addEventListener("click", sendRoll);
  ui["dice-insert"].addEventListener("click", insertRoll);

  ui["combat-attack"].addEventListener("click", () => doCombatRound("attack"));
  ui["combat-defend"].addEventListener("click", () => doCombatRound("defend"));
  ui["combat-flee"].addEventListener("click", () => doCombatRound("flee"));

  ui["chronicle-btn"].addEventListener("click", exportChronicle);
  ui["resume-autosave-btn"].addEventListener("click", loadAutosave);

  ui["inv-add-btn"].addEventListener("click", addInventory);
  ui["inv-input"].addEventListener("keydown", (e) => {
    if (e.key === "Enter") addInventory();
  });
  ui["inv-list"].addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-idx]");
    if (!btn) return;
    state.character.inventory.splice(Number(btn.dataset.idx), 1);
    renderInventory();
  });

  ui["quest-add-btn"].addEventListener("click", addQuest);
  ui["quest-input"].addEventListener("keydown", (e) => {
    if (e.key === "Enter") addQuest();
  });
  ui["quest-list"].addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-idx]");
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    if (btn.dataset.action === "toggle") {
      state.character.quests[idx].done = !state.character.quests[idx].done;
      if (state.character.quests[idx].done) {
        Sfx.levelUp();
        const r = btn.getBoundingClientRect();
        Vfx.confetti(r.left + r.width / 2, r.top, { count: 26 });
        // Code-owned quest reward: +10 XP (level-ups handled by applyDeltas).
        applyDeltas({ found: true, hp: 0, gold: 0, xp: 10, itemsAdded: [], itemsRemoved: [], foe: undefined, objectiveDone: null });
        checkAndAwardAchievements();
      }
    } else {
      state.character.quests.splice(idx, 1);
    }
    renderQuests();
  });

  for (let i = 0; i < 3; i++) {
    $(`save-btn-${i}`).addEventListener("click", () => saveSlot(i));
    $(`load-btn-${i}`).addEventListener("click", () => loadSlot(i));
  }
}

function init() {
  cacheDom();
  Vfx.init({ mode: "ember" });
  wireSfxToggle();
  wireGlobalFx();
  wireEvents();
  renderSlotStatuses();
  refreshResumeButton();
  showScreen("setup");
}

document.addEventListener("DOMContentLoaded", init);
