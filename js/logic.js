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
