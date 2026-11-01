// The action's step: the same pull as the command line, with the inputs from the environment (action.yml maps them)
// and the result written where the workflow reads it.
import { appendFile } from "node:fs/promises";
import { Api } from "../../cli/src/api.ts";
import { pull, type Language } from "../../cli/src/pull.ts";

const input = (name: string): string | undefined => process.env[`BRUA_INPUT_${name}`]?.trim() || undefined;

async function main(): Promise<void> {
  const key = process.env.BRUA_API_KEY;
  const project = process.env.BRUA_PROJECT;
  const out = input("OUT");
  if (!key) throw new Error("api-key is required.");
  if (!project) throw new Error("project is required.");
  if (!out) throw new Error("out is required: the file to write.");
  const check = input("CHECK") === "true";

  const result = await pull(new Api({ url: process.env.BRUA_API_URL || "https://api.brua.dev", key, project }), {
    out,
    language: input("LANGUAGE") as Language | undefined,
    namespace: input("NAMESPACE"),
    all: input("ALL") === "true",
    check,
  });

  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `count=${result.count}\nchanged=${result.changed}\n`);
  const count = `${result.count} ${result.count === 1 ? "asset" : "assets"}`;
  if (check && result.changed) throw new Error(`${out} is out of date: run brua pull ${out} and commit it.`);
  const line = result.changed ? `Wrote ${count} to ${out}.` : `${out} is up to date (${count}).`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Brua: ${line}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`::error::${message}`);
  process.exit(1);
});
