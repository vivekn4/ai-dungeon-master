// Crafted by Vivek Nair (VN) — https://github.com/vivekn4
/**
 * Pure game logic for AI Dungeon Master.
 * No DOM, no fetch, no side effects — safe to import in Node tests
 * and in the browser alike.
 */

/** Roll one die with `sides` faces. Returns an integer in [1, sides]. */
export function rollDie(sides) {
  const s = Math.floor(Number(sides));
  if (!Number.isFinite(s) || s < 2) throw new RangeError("sides must be an integer >= 2");
  // crypto.getRandomValues when available (browser + Node 19+), else Math.random.
  const g = typeof globalThis.crypto?.getRandomValues === "function"
    ? globalThis.crypto
    : null;
  if (g) {
    const buf = new Uint32Array(1);
    // Rejection sampling to avoid modulo bias.
    const limit = Math.floor(0xffffffff / s) * s;
    let x;
    do {
      g.getRandomValues(buf);
      x = buf[0];
    } while (x >= limit);
    return (x % s) + 1;
  }
  return Math.floor(Math.random() * s) + 1;
}

/** Clamp a value into [min, max] (inclusive). Non-numbers become min. */
export function clamp(value, min, max) {
  const v = Number(value);
  if (!Number.isFinite(v)) return min;
  if (v < min) return min;
  if (v > max) return max;
  return Math.floor(v);
}

/** Clamp hit points into [0, maxHp]. */
export function clampHp(hp, maxHp) {
  return clamp(hp, 0, Math.max(0, Math.floor(Number(maxHp) || 0)));
}

/** Generic fallback choices when the model forgets the CHOICES contract. */
export const FALLBACK_CHOICES = [
  "Look around carefully",
  "Proceed cautiously",
  "Ask for a hint",
];

const CHOICE_LINE_RE = /^\s*(?:\d+\s*[.):\-]\s*|\*\s+|-\s+)(.+?)\s*$/;

/**
 * Split a Dungeon Master reply into { story, choices }.
 * The backend contract: the reply ends with a line "CHOICES:" followed by
 * exactly 3 numbered options. Tolerates extra whitespace, different bullet
 * styles, and stray text after the list. Returns choices=null when the
 * marker is missing or no options could be parsed (caller falls back).
 */
export function parseChoices(rawText) {
  const text = String(rawText ?? "");
  const marker = text.search(/^[ \t]*CHOICES:[ \t]*$/im);
  if (marker === -1) {
    return { story: text.trim(), choices: null };
  }
  const story = text.slice(0, marker).trim();
  const rest = text.slice(marker).replace(/^[ \t]*CHOICES:[ \t]*$/im, "");
  const choices = [];
  for (const line of rest.split("\n")) {
    if (choices.length >= 3) break;
    const m = line.match(CHOICE_LINE_RE);
    if (m && m[1].trim()) choices.push(m[1].trim());
  }
  if (choices.length === 0) {
    return { story: text.trim(), choices: null };
  }
  // Pad short lists with generic options so the UI always offers 3.
  const padded = choices.slice();
  for (const fb of FALLBACK_CHOICES) {
    if (padded.length >= 3) break;
    if (!padded.includes(fb)) padded.push(fb);
  }
  return { story, choices: padded };
}

/** Max HP per hero class. */
export const CLASS_MAX_HP = {
  Warrior: 40,
  Rogue: 26,
  Mage: 22,
  Ranger: 30,
  Cleric: 32,
};

/**
 * Starting kit per class: gear the hero already carries + starting gold.
 * Original VN design: every hero starts with a small thematic kit so the
 * inventory panel is never empty on turn one.
 */
export const CLASS_STARTING_KIT = {
  Warrior: { items: ["Worn Shield", "Trail Rations"], gold: 10 },
  Rogue: { items: ["Lockpicks", "Smoke Pellet"], gold: 25 },
  Mage: { items: ["Apprentice Staff", "Faded Scroll"], gold: 10 },
  Ranger: { items: ["Trail Rations", "Hunting Knife"], gold: 15 },
  Cleric: { items: ["Holy Symbol", "Bandages"], gold: 10 },
};

/** XP needed to go from `level` to `level + 1`. */
export function xpForNextLevel(level) {
  const lv = Math.max(1, Math.floor(Number(level) || 1));
  return 100 + (lv - 1) * 50;
}

/* ------------------------------------------------------------------ */
/* Objectives (win conditions)                                         */
/* ------------------------------------------------------------------ */

/**
 * Objective pool: each campaign draws 2 of these. The DM is told the
 * drawn objectives in the hidden setup message and marks one complete
 * with `OBJECTIVE: <id> done` in its STATE block. Completing all of
 * them ends the campaign in victory (free play continues after).
 */
export const OBJECTIVE_POOL = [
  { id: "escape-depths", label: "Escape the depths alive" },
  { id: "slay-boss", label: "Slay the dungeon's boss" },
  { id: "claim-artifact", label: "Claim the legendary artifact" },
  { id: "rescue-captive", label: "Rescue the captive" },
  { id: "uncover-secret", label: "Uncover the realm's hidden secret" },
];

/** Draw `count` distinct objectives. `randFn` is injectable for tests. */
export function pickObjectives(count = 2, randFn = Math.random) {
  const pool = [...OBJECTIVE_POOL];
  const picked = [];
  while (picked.length < Math.min(count, pool.length) && pool.length > 0) {
    const i = Math.floor(randFn() * pool.length);
    picked.push({ ...pool.splice(i, 1)[0], done: false });
  }
  return picked;
}

/* ------------------------------------------------------------------ */
/* STATE block: the DM's machine-readable turn report                  */
/* ------------------------------------------------------------------ */

/**
 * The DM ends every reply with a STATE block (after the CHOICES list)
 * reporting the mechanical consequences of the turn as deltas. The
 * client owns all math: it applies, clamps, and levels up.
 *
 *   STATE:
 *   HP: -5
 *   GOLD: +20
 *   XP: +15
 *   ITEM+: Torch
 *   ITEM-: Rusty Key
 *   FOE: Goblin Chief | 24 | 6
 *   OBJECTIVE: slay-boss done
 *
 * FOE: none clears the current foe. Unknown keys are ignored so a
 * creative DM can never corrupt the game state.
 */
const SIGNED_INT_RE = /^[+-]?\d+$/;

export function parseStateBlock(rawText) {
  const empty = {
    found: false, hp: 0, gold: 0, xp: 0,
    itemsAdded: [], itemsRemoved: [],
    foe: undefined, objectiveDone: null,
  };
  const text = String(rawText ?? "");
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^[ \t]*STATE:[ \t]*$/i.test(l));
  if (start === -1) return empty;
  const out = { ...empty, found: true, itemsAdded: [], itemsRemoved: [] };
  for (const line of lines.slice(start + 1)) {
    if (/^[ \t]*CHOICES:[ \t]*$/i.test(line)) break;
    const m = line.match(/^[ \t]*([A-Za-z+_-]+)[ \t]*:[ \t]*(.*?)[ \t]*$/);
    if (!m) continue;
    const key = m[1].toUpperCase();
    const val = m[2];
    if ((key === "HP" || key === "GOLD" || key === "XP") && SIGNED_INT_RE.test(val)) {
      out[key.toLowerCase()] = Number(val);
    } else if (key === "ITEM+" && val) {
      out.itemsAdded.push(val.slice(0, 80));
    } else if (key === "ITEM-" && val) {
      out.itemsRemoved.push(val.slice(0, 80));
    } else if (key === "FOE") {
      if (/^none$/i.test(val)) {
        out.foe = null;
      } else {
        const parts = val.split("|").map((s) => s.trim());
        const hp = Number(parts[1]);
        const attack = Number(parts[2]);
        if (parts[0] && Number.isFinite(hp) && hp > 0 && Number.isFinite(attack) && attack >= 0) {
          out.foe = {
            name: parts[0].slice(0, 60),
            hp: Math.min(999, Math.floor(hp)),
            maxHp: Math.min(999, Math.floor(hp)),
            attack: Math.min(30, Math.floor(attack)),
          };
        }
      }
    } else if (key === "OBJECTIVE") {
      const om = val.match(/^([a-z0-9-]+)\s+done$/i);
      if (om) out.objectiveDone = om[1].toLowerCase();
    }
  }
  return out;
}

/** Remove the STATE block from a reply so it is never shown as prose. */
export function stripStateBlock(rawText) {
  const lines = String(rawText ?? "").split("\n");
  const start = lines.findIndex((l) => /^[ \t]*STATE:[ \t]*$/i.test(l));
  if (start === -1) return String(rawText ?? "");
  const kept = [...lines.slice(0, start)];
  let skipping = true;
  for (const line of lines.slice(start + 1)) {
    if (/^[ \t]*CHOICES:[ \t]*$/i.test(line)) skipping = false;
    if (!skipping) kept.push(line);
  }
  return kept.join("\n").trim();
}

/**
 * Apply parsed STATE deltas to a character object. Pure: returns a new
 * character plus an events summary for SFX/VFX. Level-ups grant +5 max
 * HP and heal +5 HP each; HP/gold are clamped; item adds de-duplicate.
 */
export function applyStateDeltas(character, deltas) {
  const c = {
    ...character,
    inventory: [...(character.inventory || [])],
    quests: [...(character.quests || [])],
  };
  const events = { levelsGained: 0, died: false, itemsAdded: [], itemsRemoved: [] };
  if (!deltas?.found) return { character: c, events };

  c.hp = clampHp((c.hp ?? 0) + (deltas.hp || 0), c.maxHp ?? 30);
  c.gold = Math.max(0, Math.floor(Number(c.gold) || 0) + (deltas.gold || 0));

  let xp = Math.max(0, Math.floor(Number(c.xp) || 0) + (deltas.xp || 0));
  let level = Math.max(1, Math.floor(Number(c.level) || 1));
  let maxHp = Math.max(1, Math.floor(Number(c.maxHp) || 30));
  while (xp >= xpForNextLevel(level)) {
    xp -= xpForNextLevel(level);
    level += 1;
    maxHp += 5;
    c.hp = Math.min(maxHp, c.hp + 5);
    events.levelsGained += 1;
  }
  c.xp = xp;
  c.level = level;
  c.maxHp = maxHp;
  if (c.hp <= 0) events.died = true;

  for (const item of deltas.itemsAdded || []) {
    if (!c.inventory.includes(item)) {
      c.inventory.push(item);
      events.itemsAdded.push(item);
    }
  }
  for (const item of deltas.itemsRemoved || []) {
    const idx = c.inventory.indexOf(item);
    if (idx !== -1) {
      c.inventory.splice(idx, 1);
      events.itemsRemoved.push(item);
    }
  }
  return { character: c, events };
}

/* ------------------------------------------------------------------ */
/* Combat — code owns the dice, the DM only narrates the outcome       */
/* ------------------------------------------------------------------ */

/**
 * Resolve one combat round. `action` is "attack" | "defend" | "flee".
 * `roll` is an injectable die function (defaults to rollDie) so tests
 * can drive exact outcomes. Returns the new HP values, the updated foe,
 * an outcome tag, and plain-text log lines for the story feed.
 */
export function resolveCombatRound({ action, playerHp, playerLevel, foe, roll = rollDie }) {
  const f = { ...foe, hp: Math.max(0, Math.floor(foe?.hp ?? 0)) };
  let hp = Math.max(0, Math.floor(playerHp ?? 0));
  const level = Math.max(1, Math.floor(playerLevel || 1));
  const log = [];

  if (action === "flee") {
    // 8 faces in 20 (13-20) = 40% clean escape.
    if (roll(20) >= 13) {
      log.push(`You slip away from the ${f.name} and escape!`);
      return { outcome: "fled", playerHp: hp, foe: f, log };
    }
    log.push(`You try to flee, but the ${f.name} blocks your escape!`);
  } else if (action === "defend") {
    log.push(`You raise your guard against the ${f.name}.`);
  } else {
    // attack
    const hitRoll = roll(20);
    if (hitRoll >= 9) {
      const dmg = roll(8) + level;
      f.hp = Math.max(0, f.hp - dmg);
      log.push(`You strike the ${f.name} for ${dmg} damage.`);
      if (f.hp <= 0) {
        log.push(`The ${f.name} is defeated!`);
        return { outcome: "victory", playerHp: hp, foe: f, log };
      }
    } else {
      log.push(`Your attack misses the ${f.name}!`);
    }
  }

  // Enemy retaliation (after a failed flee, a defend, or a non-lethal attack).
  let enemyDmg = roll(6) + Math.max(0, Math.floor(f.attack || 0));
  if (action === "defend") enemyDmg = Math.floor(enemyDmg / 2);
  hp = Math.max(0, hp - enemyDmg);
  log.push(`The ${f.name} strikes back for ${enemyDmg} damage.`);
  if (hp <= 0) {
    log.push("You collapse, defeated.");
    return { outcome: "defeat", playerHp: hp, foe: f, log };
  }
  return { outcome: "ongoing", playerHp: hp, foe: f, log };
}

/* ------------------------------------------------------------------ */
/* Achievements — code-checked milestones, awarded once per campaign   */
/* ------------------------------------------------------------------ */

export const ACHIEVEMENTS = [
  { id: "first-roll", name: "First Roll", desc: "Roll the dice for the first time" },
  { id: "natural-twenty", name: "Natural Twenty", desc: "Roll a nat 20 on a d20" },
  { id: "first-blood", name: "First Blood", desc: "Win your first combat" },
  { id: "survivor", name: "Survivor", desc: "Reach turn 25" },
  { id: "hoarder", name: "Hoarder", desc: "Carry 10 items at once" },
  { id: "quest-master", name: "Quest Master", desc: "Complete 3 quests" },
  { id: "legend", name: "Legend", desc: "Reach level 3" },
];

/** Stats snapshot -> ids newly earned (not already in `earnedIds`). */
export function checkAchievements(stats, earnedIds = []) {
  const earned = new Set(earnedIds);
  const s = stats || {};
  const newly = [];
  const qualifies = {
    "first-roll": (s.rolls || 0) >= 1,
    "natural-twenty": (s.nat20s || 0) >= 1,
    "first-blood": (s.combatWins || 0) >= 1,
    survivor: (s.turns || 0) >= 25,
    hoarder: (s.inventoryCount || 0) >= 10,
    "quest-master": (s.questsDone || 0) >= 3,
    legend: (s.level || 1) >= 3,
  };
  for (const a of ACHIEVEMENTS) {
    if (qualifies[a.id] && !earned.has(a.id)) newly.push(a.id);
  }
  return newly;
}

/* ------------------------------------------------------------------ */
/* Chronicle — export the campaign as a readable markdown tale         */
/* ------------------------------------------------------------------ */

/** Build a markdown chronicle from a campaign snapshot. Pure. */
export function formatChronicle({ setup, messages, character, objectives, achievements }) {
  const lines = [];
  const name = setup?.name || "Hero";
  lines.push(`# The Chronicle of ${name}`);
  lines.push("");
  lines.push(`*${setup?.charClass || ""} · ${setup?.setting || ""} · Crafted by VN*`);
  lines.push("");
  if (objectives?.length) {
    lines.push("## Objectives");
    for (const o of objectives) lines.push(`- [${o.done ? "x" : " "}] ${o.label}`);
    lines.push("");
  }
  if (achievements?.length) {
    lines.push("## Honors");
    for (const id of achievements) {
      const a = ACHIEVEMENTS.find((x) => x.id === id);
      if (a) lines.push(`- 🏆 ${a.name} — ${a.desc}`);
    }
    lines.push("");
  }
  lines.push("## The Tale");
  for (const m of messages || []) {
    if (m.hidden) continue;
    if (m.role === "user") {
      lines.push(`**${name}:** ${m.content}`);
    } else {
      const { story } = parseChoices(stripStateBlock(m.content));
      if (story) lines.push(story);
    }
    lines.push("");
  }
  lines.push("## Final State");
  lines.push(`- HP: ${character?.hp ?? 0} / ${character?.maxHp ?? 0}`);
  lines.push(`- Level ${character?.level ?? 1} · Gold: ${character?.gold ?? 0}`);
  lines.push(`- Inventory: ${(character?.inventory || []).join(", ") || "empty"}`);
  const quests = character?.quests || [];
  if (quests.length) {
    lines.push("- Quests:");
    for (const q of quests) lines.push(`  - [${q.done ? "x" : " "}] ${q.text}`);
  }
  return lines.join("\n");
}

/** Escape HTML special chars so AI text can be injected safely. */
export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}
