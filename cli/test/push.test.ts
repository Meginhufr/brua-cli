// A push: create or add a version, upload, wait, and put the version in a change set.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Api } from "../src/api.ts";
import { push } from "../src/push.ts";
import { startFakeApi, type FakeApi } from "./fake-api.ts";

let api: FakeApi;
let dir: string;
const client = (key = "both") => new Api({ url: api.url, key, project: "demo" });
const quick = { pollInterval: 1 };

before(async () => {
  api = await startFakeApi();
  dir = await mkdtemp(join(tmpdir(), "brua-"));
  await writeFile(join(dir, "hero.jpg"), Buffer.alloc(100));
  await writeFile(join(dir, "hero.alt.json"), JSON.stringify({ nb: "Helt", en: "Hero" }));
  await writeFile(join(dir, "icon.png"), Buffer.alloc(10));
  await writeFile(join(dir, "icon-dark.png"), Buffer.alloc(11));
});
after(() => api.close());

test("a first push creates the asset, uploads, waits for processing and opens a change set for it", async () => {
  const log: string[] = [];
  const result = await push(client(), { id: "hero", file: join(dir, "hero.jpg"), ...quick, log: (l) => log.push(l) });

  assert.equal(result.created, true);
  assert.equal(result.version, 1);
  assert.equal(result.status, "Ready");
  assert.equal(result.changeSet?.name, "hero v1");
  assert.deepEqual(api.assets.get("hero")?.alt, { nb: "Helt", en: "Hero" }, "the sidecar's alt text");
  assert.deepEqual(api.uploaded.at(-1), { slot: "any.still.source", bytes: 100, contentType: "image/jpeg" });
  assert.match(log.join("\n"), /Created hero.*\nUploaded .*hero\.jpg as any\.still\.source\.\n(Waiting.*\n)?Version 1 is processed\.\nVersion 1 is in change set "hero v1"/);
});

test("the next push is a new version into the named change set, opened once and reused", async () => {
  const second = await push(client(), { id: "hero", file: join(dir, "hero.jpg"), alt: { nb: "Ny", en: "New" }, changeSet: "Spring", ...quick });
  const third = await push(client(), { id: "hero", file: join(dir, "hero.jpg"), changeSet: "Spring", ...quick });

  assert.equal(second.created, false);
  assert.equal(second.version, 2);
  assert.equal(third.version, 3);
  assert.equal(second.changeSet?.name, "Spring");
  assert.equal(third.changeSet?.id, second.changeSet?.id);
  assert.equal(api.changeSets.filter((c) => c.name === "Spring").length, 1);
  assert.equal(api.changeSets.find((c) => c.name === "Spring")?.changes.at(-1)?.toVersion, 3);
});

test("a fixed asset takes slots, and a slot the preset lacks is refused before anything is uploaded", async () => {
  const uploads = api.uploaded.length;
  await assert.rejects(
    push(client(), { id: "gift-icon", preset: "fixed", colorSchemes: "any-dark", width: 64, height: 64, alt: { nb: "Gave", en: "Gift" }, slots: { "any.still.source": join(dir, "icon.png"), "light.still.source": join(dir, "icon-dark.png") }, ...quick }),
    /has no slot "light\.still\.source"\. Its slots: any\.still\.source, dark\.still\.source\./,
  );
  assert.equal(api.uploaded.length, uploads);

  const result = await push(client(), { id: "gift-icon", slots: { "any.still.source": join(dir, "icon.png"), "dark.still.source": join(dir, "icon-dark.png") }, ...quick });
  assert.equal(result.version, 2, "the refused push had already started version 1");
  assert.deepEqual(api.uploaded.slice(-2).map((u) => [u.slot, u.bytes]), [["any.still.source", 10], ["dark.still.source", 11]]);
});

test("failed processing fails the push with the code, and --no-wait stops after the upload", async () => {
  api.failNext = "wrong_proportions";
  await assert.rejects(push(client(), { id: "hero", file: join(dir, "hero.jpg"), ...quick }), /Processing version 4 failed: wrong_proportions\. The still has other proportions/);

  const result = await push(client(), { id: "hero", file: join(dir, "hero.jpg"), wait: false, ...quick });
  assert.equal(result.status, "Processing");
  assert.equal(result.changeSet, undefined);
});

test("a key with assets:write alone pushes, but needs delivery:read to find a change set by name", async () => {
  const result = await push(client("write"), { id: "banner", file: join(dir, "hero.jpg"), alt: { nb: "Banner", en: "Banner" }, ...quick });
  assert.equal(result.created, true);
  assert.equal(result.changeSet?.name, "banner v1");

  await assert.rejects(push(client("write"), { id: "banner", file: join(dir, "hero.jpg"), changeSet: "Spring", ...quick }), /needs a key with delivery:read as well/);
  const byId = await push(client("write"), { id: "banner", file: join(dir, "hero.jpg"), changeSet: api.changeSets.find((c) => c.name === "Spring")!.id, ...quick });
  assert.equal(byId.changeSet?.name, "Spring");
});

test("a missing file and a missing alt text are said before the API is asked", async () => {
  await assert.rejects(push(client(), { id: "x", file: join(dir, "nothing.jpg") }), /No such file/);
  await assert.rejects(push(client(), { id: "x" }), /Nothing to upload/);
  await assert.rejects(push(client(), { id: "no-alt", file: join(dir, "icon.png"), ...quick }), /validation_failed: alt: Alt text is missing for: nb, en\./);
});
