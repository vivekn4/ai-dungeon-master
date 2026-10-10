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

console.log(`\n${passed} tests passed${process.exitCode ? " (WITH FAILURES)" : ""}.`);
