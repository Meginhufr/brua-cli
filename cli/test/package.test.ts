// The package as npm publishes it: packed, installed into an empty project and run through its bin, the way
// `npx @meginhufr/brua-cli` runs it. Node strips no types under node_modules, so the bin has to be JavaScript.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("the packed bin runs from node_modules", () => {
  const cli = resolve(import.meta.dirname, "..");
  const dir = mkdtempSync(join(tmpdir(), "brua-cli-pack-"));
  const [packed] = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", dir], { cwd: cli, encoding: "utf8" }));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "consumer", private: true }));
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", join(dir, packed.filename)], { cwd: dir, encoding: "utf8" });

  const run = spawnSync("node", [join(dir, "node_modules", ".bin", "brua"), "help"], { encoding: "utf8" });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /push/);
});
