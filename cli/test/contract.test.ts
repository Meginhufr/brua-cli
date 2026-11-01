// The CLI calls only what the public reference describes: every operation it uses is in openapi.json with that method.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { operations } from "../src/api.ts";

test("every operation the CLI uses is in the public document", async () => {
  const document = JSON.parse(await readFile(new URL("../openapi.json", import.meta.url), "utf8"));
  for (const [name, [method, path]] of Object.entries(operations)) {
    const described = document.paths[path]?.[method];
    assert.ok(described, `${name}: ${method.toUpperCase()} ${path} is not in the public document`);
    assert.ok(described.summary, `${name} has no summary in the document`);
    const security = described.security?.flatMap((s: Record<string, unknown>) => Object.keys(s)) ?? [];
    assert.deepEqual(security, ["ApiKey"], `${name} must take an API key`);
  }
});
