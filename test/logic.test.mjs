// Crafted by Vivek Nair (VN) — https://github.com/vivekn4
/**
 * Unit tests for js/logic.js — pure game logic.
 * Run: npm test   (node test/logic.test.mjs)
 */
import assert from "node:assert/strict";
import {
  rollDie,
  clamp,
  clampHp,
  parseChoices,
  FALLBACK_CHOICES,
  CLASS_MAX_HP,
  CLASS_STARTING_KIT,
  xpForNextLevel,
  OBJECTIVE_POOL,
  pickObjectives,
  parseStateBlock,
  stripStateBlock,
  applyStateDeltas,
  resolveCombatRound,
  ACHIEVEMENTS,
  checkAchievements,
  formatChronicle,
  escapeHtml,
} from "../js/logic.js";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("dice roller");
for (const sides of [4, 6, 8, 10, 12, 20]) {
  test(`d${sides}: 1000 rolls all within [1, ${sides}]`, () => {
    for (let i = 0; i < 1000; i++) {
      const r = rollDie(sides);
      assert.ok(Number.isInteger(r), `not an integer: ${r}`);
      assert.ok(r >= 1 && r <= sides, `out of range: ${r}`);
    }
  });
}
test("d20: all 20 faces appear in 2000 rolls (distribution sanity)", () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(rollDie(20));
  assert.equal(seen.size, 20, `only saw faces: ${[...seen].sort((a, b) => a - b)}`);
});
test("rollDie rejects sides < 2", () => {
  assert.throws(() => rollDie(1), RangeError);
  assert.throws(() => rollDie(0), RangeError);
  assert.throws(() => rollDie("nope"), RangeError);
});

console.log("HP clamp");
test("clampHp keeps values in [0, maxHp]", () => {
  assert.equal(clampHp(50, 40), 40);
  assert.equal(clampHp(-5, 40), 0);
  assert.equal(clampHp(0, 40), 0);
  assert.equal(clampHp(40, 40), 40);
  assert.equal(clampHp(25, 40), 25);
  assert.equal(clampHp("junk", 40), 0);
});
test("clamp floors fractional values", () => {
  assert.equal(clamp(3.9, 0, 10), 3);
});
test("every class has a sane max HP", () => {
  for (const [cls, hp] of Object.entries(CLASS_MAX_HP)) {
    assert.ok(Number.isInteger(hp) && hp >= 20 && hp <= 50, `${cls}: ${hp}`);
  }
  assert.deepEqual(Object.keys(CLASS_MAX_HP).sort(), ["Cleric", "Mage", "Ranger", "Rogue", "Warrior"]);
});

console.log("choice parser");
test("1. well-formed reply splits story and 3 choices", () => {
  const raw = `You push open the tavern door. Smoke and laughter spill out.\n\nCHOICES:\n1. Order an ale and listen for rumors\n2. Challenge the arm-wrestling champion\n3. Slip upstairs unnoticed`;
  const { story, choices } = parseChoices(raw);
  assert.equal(story, "You push open the tavern door. Smoke and laughter spill out.");
  assert.deepEqual(choices, [
    "Order an ale and listen for rumors",
    "Challenge the arm-wrestling champion",
    "Slip upstairs unnoticed",
  ]);
});
test("2. tolerates extra whitespace and varied numbering", () => {
  const raw = `The cave yawns before you.\n\n   CHOICES:  \n1) Light a torch\n2 . Draw your sword\n3 - Whisper a prayer`;
  const { story, choices } = parseChoices(raw);
  assert.equal(story, "The cave yawns before you.");
  assert.deepEqual(choices, ["Light a torch", "Draw your sword", "Whisper a prayer"]);
});
test("3. missing marker -> choices null (caller uses fallback)", () => {
  const raw = "The dragon regards you with ancient eyes.";
  const { story, choices } = parseChoices(raw);
  assert.equal(story, raw);
  assert.equal(choices, null);
});
test("4. marker but no parseable options -> choices null", () => {
  const raw = "You hesitate.\n\nCHOICES:\nThe end.";
  const { story, choices } = parseChoices(raw);
  assert.equal(choices, null);
  assert.ok(story.includes("You hesitate."));
});
test("5. short list is padded to 3 with fallback options", () => {
  const raw = `A fork in the road.\nCHOICES:\n1. Go left`;
  const { choices } = parseChoices(raw);
  assert.equal(choices.length, 3);
  assert.equal(choices[0], "Go left");
  for (const c of choices.slice(1)) assert.ok(FALLBACK_CHOICES.includes(c), `unexpected pad: ${c}`);
});
test("6. stray text after the list is ignored", () => {
  const raw = `The gate creaks.\nCHOICES:\n1. Knock\n2. Pick the lock\n3. Climb the wall\nThe DM smiles mysteriously.`;
  const { choices } = parseChoices(raw);
  assert.equal(choices.length, 3);
  assert.deepEqual(choices, ["Knock", "Pick the lock", "Climb the wall"]);
});
test("7. null/empty input is safe", () => {
  assert.deepEqual(parseChoices(null), { story: "", choices: null });
  assert.deepEqual(parseChoices(""), { story: "", choices: null });
});

console.log("escapeHtml");
test("escapes HTML special chars", () => {
  assert.equal(
    escapeHtml(`<script>alert("x") & 'y'</script>`),
    "&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;"
  );
  assert.equal(escapeHtml(null), "");
});

console.log("starting kits + XP curve");
test("every class has a kit with items and gold", () => {
  for (const cls of Object.keys(CLASS_MAX_HP)) {
    const kit = CLASS_STARTING_KIT[cls];
    assert.ok(kit && kit.items.length >= 1, `${cls}: no kit items`);
    assert.ok(Number.isInteger(kit.gold) && kit.gold >= 0, `${cls}: bad gold`);
  }
});
test("xpForNextLevel grows with level", () => {
  assert.equal(xpForNextLevel(1), 100);
  assert.equal(xpForNextLevel(2), 150);
  assert.ok(xpForNextLevel(5) > xpForNextLevel(4));
});

console.log("objectives");
test("pickObjectives draws distinct objectives", () => {
  const picked = pickObjectives(2, () => 0.0);
  assert.equal(picked.length, 2);
  assert.notEqual(picked[0].id, picked[1].id);
  assert.ok(picked.every((o) => o.done === false));
  assert.ok(picked.every((o) => OBJECTIVE_POOL.some((p) => p.id === o.id)));
});

console.log("STATE block parser");
test("parses HP/GOLD/XP deltas, items, foe, objective", () => {
  const raw = `Story.\n\nCHOICES:\n1. Fight\n2. Flee\n3. Hide\nSTATE:\nHP: -5\nGOLD: +20\nXP: +15\nITEM+: Torch\nITEM-: Rusty Key\nFOE: Goblin Chief | 24 | 6\nOBJECTIVE: slay-boss done`;
  const s = parseStateBlock(raw);
  assert.equal(s.found, true);
  assert.equal(s.hp, -5);
  assert.equal(s.gold, 20);
  assert.equal(s.xp, 15);
  assert.deepEqual(s.itemsAdded, ["Torch"]);
  assert.deepEqual(s.itemsRemoved, ["Rusty Key"]);
  assert.deepEqual(s.foe, { name: "Goblin Chief", hp: 24, maxHp: 24, attack: 6 });
  assert.equal(s.objectiveDone, "slay-boss");
});
test("FOE: none clears; unknown keys ignored; missing block -> found false", () => {
  assert.equal(parseStateBlock("No block here").found, false);
  const s = parseStateBlock("STATE:\nFOE: none\nBOGUS: 42\nHP: junk");
  assert.equal(s.foe, null);
  assert.equal(s.hp, 0);
});
test("stripStateBlock removes STATE but keeps CHOICES", () => {
  const raw = `Story.\nSTATE:\nHP: -5\nCHOICES:\n1. Go\n2. Stay\n3. Hide`;
  const stripped = stripStateBlock(raw);
  assert.ok(!stripped.includes("HP: -5"), stripped);
  assert.ok(stripped.includes("CHOICES:"), stripped);
  assert.ok(stripped.includes("Story."), stripped);
});

console.log("applyStateDeltas");
const baseChar = () => ({ hp: 30, maxHp: 40, gold: 10, xp: 0, level: 1, inventory: ["Torch"], quests: [] });
test("applies deltas, clamps HP/gold, adds/removes items", () => {
  const { character, events } = applyStateDeltas(baseChar(), {
    found: true, hp: -5, gold: 20, xp: 0, itemsAdded: ["Rope"], itemsRemoved: ["Torch"], foe: undefined, objectiveDone: null,
  });
  assert.equal(character.hp, 25);
  assert.equal(character.gold, 30);
  assert.deepEqual(character.inventory, ["Rope"]);
  assert.equal(events.died, false);
});
test("level-up at threshold: +5 max HP, +5 heal, XP carries over", () => {
  const { character, events } = applyStateDeltas(baseChar(), {
    found: true, hp: 0, gold: 0, xp: 110, itemsAdded: [], itemsRemoved: [], foe: undefined, objectiveDone: null,
  });
  assert.equal(events.levelsGained, 1);
  assert.equal(character.level, 2);
  assert.equal(character.maxHp, 45);
  assert.equal(character.xp, 10);
  assert.equal(character.hp, 35);
});
test("death is reported when HP hits 0", () => {
  const { events } = applyStateDeltas(baseChar(), {
    found: true, hp: -99, gold: 0, xp: 0, itemsAdded: [], itemsRemoved: [], foe: undefined, objectiveDone: null,
  });
  assert.equal(events.died, true);
});
test("no STATE block is a no-op", () => {
  const { character } = applyStateDeltas(baseChar(), { found: false });
  assert.equal(character.hp, 30);
});

console.log("combat resolution");
const foe = () => ({ name: "Goblin", hp: 12, maxHp: 12, attack: 3 });
test("attack can kill the foe (scripted rolls)", () => {
  // d20 hit (>=9), d8 damage 8 + level 1 = 9... foe has 12 HP; use max damage via two rounds instead.
  const r1 = resolveCombatRound({ action: "attack", playerHp: 30, playerLevel: 5, foe: foe(), roll: (s) => (s === 20 ? 15 : s === 8 ? 8 : 1) });
  assert.equal(r1.outcome, "victory"); // 8 + 5 = 13 >= 12
  assert.equal(r1.foe.hp, 0);
});
test("miss still draws retaliation; defend halves it", () => {
  const roll = (s) => (s === 20 ? 1 : 6); // miss (1), enemy d6 = 6 + 3 = 9
  const undef = resolveCombatRound({ action: "attack", playerHp: 30, playerLevel: 1, foe: foe(), roll });
  assert.equal(undef.playerHp, 21);
  const def = resolveCombatRound({ action: "defend", playerHp: 30, playerLevel: 1, foe: foe(), roll });
  assert.equal(def.playerHp, 30 - Math.floor(9 / 2));
});
test("flee succeeds on high roll, fails on low roll", () => {
  const ok = resolveCombatRound({ action: "flee", playerHp: 30, playerLevel: 1, foe: foe(), roll: () => 20 });
  assert.equal(ok.outcome, "fled");
  const bad = resolveCombatRound({ action: "flee", playerHp: 30, playerLevel: 1, foe: foe(), roll: () => 1 });
  assert.equal(bad.outcome, "ongoing");
  assert.ok(bad.playerHp < 30);
});
test("defeat when HP reaches 0", () => {
  const r = resolveCombatRound({ action: "attack", playerHp: 2, playerLevel: 1, foe: foe(), roll: (s) => (s === 20 ? 1 : 6) });
  assert.equal(r.outcome, "defeat");
  assert.equal(r.playerHp, 0);
});

console.log("achievements");
test("checkAchievements awards each once", () => {
  assert.deepEqual(checkAchievements({ rolls: 1 }, []), ["first-roll"]);
  assert.deepEqual(checkAchievements({ rolls: 1 }, ["first-roll"]), []);
  const many = checkAchievements({ rolls: 5, nat20s: 1, turns: 30, inventoryCount: 12, questsDone: 4, level: 3, combatWins: 1 }, []);
  assert.equal(many.length, ACHIEVEMENTS.length);
});
test("achievement ids are unique", () => {
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
});

console.log("chronicle");
test("formatChronicle renders hero, tale, and final state", () => {
  const md = formatChronicle({
    setup: { name: "Kael", charClass: "Warrior", setting: "the Cursed Forest" },
    messages: [
      { role: "user", content: "I enter the forest." },
      { role: "assistant", content: "Shadows gather.\n\nCHOICES:\n1. Go\n2. Stay\n3. Hide\nSTATE:\nHP: -1" },
    ],
    character: { hp: 10, maxHp: 40, level: 1, gold: 5, inventory: ["Torch"], quests: [{ text: "Find water", done: true }] },
    objectives: [{ id: "x", label: "Escape", done: true }],
    achievements: ["first-roll"],
  });
  assert.ok(md.includes("# The Chronicle of Kael"));
  assert.ok(md.includes("I enter the forest."));
  assert.ok(md.includes("Shadows gather."));
  assert.ok(!md.includes("STATE:"));
  assert.ok(md.includes("First Roll"));
});

console.log(`\n${passed} tests passed${process.exitCode ? " (WITH FAILURES)" : ""}.`);
