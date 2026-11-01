// The command line and the GitHub Action, run as processes against the fake API.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { seedReleased, startFakeApi, type FakeApi } from "./fake-api.ts";

const run = promisify(execFile);
const bin = fileURLToPath(new URL("../src/brua.ts", import.meta.url));
const action = fileURLToPath(new URL("../../action/push/run.ts", import.meta.url));
let api: FakeApi;
let dir: string;

async function brua(args: string[], env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [bin, ...args], { env: { ...process.env, BRUA_API_URL: api.url, BRUA_API_KEY: "both", BRUA_PROJECT: "demo", ...env } });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

before(async () => {
  api = await startFakeApi();
  seedReleased(api, "wool-blanket-red", { nb: "Rødt ullpledd", en: "Red wool blanket" });
  dir = await mkdtemp(join(tmpdir(), "brua-cli-"));
  await writeFile(join(dir, "Summer Hero.jpg"), Buffer.alloc(50));
});
after(() => api.close());

test("get prints the delivery JSON for the language asked, and versions a table", async () => {
  const got = await brua(["get", "wool-blanket-red", "--lang", "en"]);
  assert.equal(got.code, 0);
  assert.equal(JSON.parse(got.stdout).alt, "Red wool blanket");

  const versions = await brua(["versions", "wool-blanket-red"]);
  assert.match(versions.stdout, /^wool-blanket-red, version 1 in prod\n  v1  ready\s+flexible/);
});

test("push names the asset after the file, repeats --alt per language and prints JSON when asked", async () => {
  const pushed = await brua(["push", join(dir, "Summer Hero.jpg"), "--alt", "nb=Sommer", "--alt", "en=Summer", "--change-set", "Summer", "--json"]);
  assert.equal(pushed.code, 0, pushed.stderr);
  const result = JSON.parse(pushed.stdout);
  assert.equal(result.id, "summer-hero");
  assert.equal(result.changeSet.name, "Summer");

  const listed = await brua(["change-sets"]);
  assert.match(listed.stdout, /open {6}Summer {2}1 asset/);
  const submitted = await brua(["submit", "Summer"]);
  assert.match(submitted.stdout, /"Summer" is in review/);
});

test("errors are one line on stderr with a non-zero exit, and a bad key exits with 2", async () => {
  const noKey = await brua(["project"], { BRUA_API_KEY: "" });
  assert.equal(noKey.code, 1);
  assert.match(noKey.stderr, /^brua: No API key/);

  const badKey = await brua(["project"], { BRUA_API_KEY: "nope" });
  assert.equal(badKey.code, 2);
  assert.match(badKey.stderr, /key was refused/);

  const unknown = await brua(["get", "nothing"]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /^brua: not_found \(nothing\)/);
});

test("the push action reads its inputs from the environment and writes the outputs for the workflow", async () => {
  const outputs = join(dir, "outputs.txt");
  const summary = join(dir, "summary.md");
  await writeFile(outputs, "");
  await writeFile(summary, "");
  const { stdout } = await run(process.execPath, [action], {
    env: {
      ...process.env,
      BRUA_API_URL: api.url, BRUA_API_KEY: "both", BRUA_PROJECT: "demo",
      BRUA_INPUT_FILE: join(dir, "Summer Hero.jpg"), BRUA_INPUT_ID: "action-hero",
      BRUA_INPUT_ALT: "nb=Helt\nen=Hero\n", BRUA_INPUT_CHANGE_SET: "Summer", BRUA_INPUT_WAIT: "true", BRUA_INPUT_DECORATIVE: "false", BRUA_INPUT_PRESET: "flexible",
      GITHUB_OUTPUT: outputs, GITHUB_STEP_SUMMARY: summary,
    },
  });
  assert.match(stdout, /Created action-hero/);
  const written = await readFile(outputs, "utf8");
  assert.match(written, /^version=1\ncreated=true\nchange-set=[0-9a-f-]{36}\nchange-set-name=Summer\n$/);
  assert.match(await readFile(summary, "utf8"), /pushed `action-hero` version 1 into the change set "Summer"/);

  const failed = await run(process.execPath, [action], { env: { ...process.env, BRUA_API_URL: api.url, BRUA_API_KEY: "both", BRUA_PROJECT: "demo", BRUA_INPUT_ID: "x" } }).catch((e) => e);
  assert.equal(failed.code, 1);
  assert.match(failed.stdout, /^::error::Nothing to upload/);
});
