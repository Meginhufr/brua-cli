// The action's step: the same push as the command line, with the inputs from the environment (action.yml maps them)
// and the result written where the workflow reads it.
import { appendFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { pairs } from "../../cli/src/args.ts";
import { Api } from "../../cli/src/api.ts";
import { push } from "../../cli/src/push.ts";

const input = (name: string): string | undefined => process.env[`BRUA_INPUT_${name}`]?.trim() || undefined;
const number = (name: string): number | undefined => {
  const value = input(name);
  if (value === undefined) return undefined;
  if (!Number.isFinite(Number(value))) throw new Error(`${name.toLowerCase().replace("_", "-")} takes a number, not "${value}".`);
  return Number(value);
};

async function main(): Promise<void> {
  const key = process.env.BRUA_API_KEY;
  const project = process.env.BRUA_PROJECT;
  if (!key) throw new Error("api-key is required.");
  if (!project) throw new Error("project is required.");
  const api = new Api({ url: process.env.BRUA_API_URL || "https://api.brua.dev", key, project });

  const file = input("FILE");
  const id = input("ID") ?? (file ? basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") : undefined);
  if (!id) throw new Error("Give id, or a file to name the asset after.");

  const result = await push(api, {
    id,
    file,
    slots: pairs([input("SLOTS") ?? ""]),
    alt: pairs([input("ALT") ?? ""]),
    altFile: input("ALT_FILE"),
    preset: input("PRESET"),
    width: number("WIDTH"),
    height: number("HEIGHT"),
    colorSchemes: input("COLOR_SCHEMES"),
    stillFit: input("STILL_FIT"),
    languages: input("LANGUAGES"),
    scales: input("SCALES"),
    decorative: input("DECORATIVE") === "true",
    changeSet: input("CHANGE_SET"),
    wait: input("WAIT") !== "false",
    log: (line) => console.log(line),
  });

  const outputs = [
    `version=${result.version}`,
    `created=${result.created}`,
    `change-set=${result.changeSet?.id ?? ""}`,
    `change-set-name=${result.changeSet?.name ?? ""}`,
  ];
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, outputs.join("\n") + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) {
    const where = result.changeSet ? ` into the change set "${result.changeSet.name}", ready for review` : "";
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `Brua: pushed \`${result.id}\` version ${result.version}${where}.\n`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`::error::${message}`);
  process.exit(1);
});
