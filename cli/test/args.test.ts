// The argument parser on its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boolFlag, flag, parseArgs } from "../src/args.ts";

test("a switch before a file leaves the file a positional", () => {
  const parsed = parseArgs(["push", "--decorative", "hero.jpg", "--json"]);
  assert.deepEqual(parsed.positionals, ["hero.jpg"]);
  assert.equal(boolFlag(parsed, "decorative", false), true);
  assert.equal(boolFlag(parsed, "json", false), true);
});

test("a switch still takes an explicit value, and --no- turns it off", () => {
  assert.equal(boolFlag(parseArgs(["push", "--decorative=false", "hero.jpg"]), "decorative", true), false);
  assert.equal(boolFlag(parseArgs(["push", "--no-wait", "hero.jpg"]), "wait", true), false);
});

test("a flag with a value takes the next argument", () => {
  const parsed = parseArgs(["push", "--id", "hero", "hero.jpg"]);
  assert.equal(flag(parsed, "id"), "hero");
  assert.deepEqual(parsed.positionals, ["hero.jpg"]);
});
