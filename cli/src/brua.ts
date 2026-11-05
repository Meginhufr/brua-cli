#!/usr/bin/env node
// Brua from the command line: push sources into change sets, and read what the API says. Runs on Node 24 or later.
import { basename, extname } from "node:path";
import { boolFlag, flag, flags, numberFlag, pairs, parseArgs, type Parsed } from "./args.ts";
import { Api, BruaError, type ChangeSet } from "./api.ts";
import { push } from "./push.ts";
import { pull, type Language } from "./pull.ts";

const HELP = `brua: images and animations into Brua, and out again.

  brua push <file> [--id hero] [--alt nb="Rødt ullpledd" --alt en="Red blanket"] [--change-set "Spring campaign"]
  brua push --id gift-icon --preset fixed --width 64 --height 64 --color-schemes any-dark \\
            --slot any.still.source=icon.png --slot dark.still.source=icon-dark.png
  brua pull src/brua/assets.ts     the released asset ids as a source file: .ts, .swift, .kt, .cs or .json
  brua get <id> [--lang nb]        what the current release serves, as the delivery API's JSON
  brua versions <id>               the asset's versions and their status
  brua change-sets                 the project's change sets
  brua submit <change set>         sends a change set for review, by name or id
  brua project                     the project's name and languages

Settings, as flags or environment: --api-url (BRUA_API_URL, default https://api.brua.dev), --key (BRUA_API_KEY),
--project (BRUA_PROJECT). A push needs a key with assets:write; reading, and change sets by name, delivery:read.

push: the asset is created on first push and gets a new version after that. Either way the flags say which files the
version has (--preset flexible, fixed or animated, within the asset's sizing; --width and --height for fixed and
animated; --color-schemes any, any-dark or both; --languages none, optional or required; --scales single or individual;
--still-fit match or fill; --decorative; --object-fit contain or cover and --object-position "50% 35%", how a layout's box
holds it), copied from the version before when left out. Alt text comes from --alt, --alt-file, or
hero.alt.json beside hero.jpg. The version goes into the change set named by --change-set (opened when there is none),
or into a new one; --no-wait uploads and stops, --no-submit waits but leaves it out of change sets. --json prints the
result as JSON.

pull: writes the project's released asset ids as constants named in camel case (gift-icon becomes giftIcon), so a
missing asset is a compile error. --language typescript, swift, kotlin, csharp or json when the extension doesn't say;
--namespace for the Kotlin package or C# namespace; --all includes assets with no release yet; --check writes nothing
and exits 1 when the file is out of date, for CI.`;

async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const json = boolFlag(parsed, "json", false);
  const out = (value: unknown, text: () => string) => console.log(json ? JSON.stringify(value, null, 2) : text());

  switch (parsed.command) {
    case undefined:
    case "help":
      console.log(HELP);
      return;

    case "push": {
      const api = client(parsed);
      const file = parsed.positionals[0];
      const slots = pairs(flags(parsed, "slot"));
      const id = flag(parsed, "id") ?? (file ? idFrom(file) : undefined);
      if (!id) throw new Error("Give --id, or a file to name the asset after.");
      const result = await push(api, {
        id,
        file,
        slots,
        preset: flag(parsed, "preset"),
        alt: pairs(flags(parsed, "alt")),
        altFile: flag(parsed, "alt-file"),
        decorative: flag(parsed, "decorative") === undefined ? undefined : boolFlag(parsed, "decorative", false),
        width: numberFlag(parsed, "width"),
        height: numberFlag(parsed, "height"),
        colorSchemes: flag(parsed, "color-schemes"),
        stillFit: flag(parsed, "still-fit"),
        languages: flag(parsed, "languages"),
        scales: flag(parsed, "scales"),
        objectFit: flag(parsed, "object-fit"),
        objectPosition: flag(parsed, "object-position"),
        changeSet: flag(parsed, "change-set"),
        wait: boolFlag(parsed, "wait", true),
        submit: boolFlag(parsed, "submit", true),
        log: json ? undefined : (line) => console.log(line),
      });
      if (json) console.log(JSON.stringify(result, null, 2));
      return;
    }

    case "pull": {
      const result = await pull(client(parsed), {
        out: positional(parsed, "the file to write, such as src/brua/assets.ts"),
        language: flag(parsed, "language") as Language | undefined,
        namespace: flag(parsed, "namespace"),
        all: boolFlag(parsed, "all", false),
        check: boolFlag(parsed, "check", false),
      });
      const count = `${result.count} ${result.count === 1 ? "asset" : "assets"}`;
      if (result.changed && boolFlag(parsed, "check", false)) {
        out(result, () => `${result.file} is out of date: run brua pull ${result.file}.`);
        process.exitCode = 1;
      } else {
        out(result, () => result.changed ? `Wrote ${count} to ${result.file}.` : `${result.file} is up to date (${count}).`);
      }
      return;
    }

    case "get": {
      const id = positional(parsed, "the asset's id");
      const asset = await client(parsed).get(id, flag(parsed, "lang"));
      console.log(JSON.stringify(asset, null, 2));
      return;
    }

    case "versions": {
      const id = positional(parsed, "the asset's id");
      const detail = await client(parsed).versions(id);
      out(detail, () => [
        `${detail.id}${detail.library ? `, in the library ${detail.library}` : ""}${detail.liveVersion ? `, version ${detail.liveVersion} in prod` : ", not released"}`,
        ...detail.versions.map((v) => `  v${v.version}  ${v.status.toLowerCase().padEnd(10)} ${v.preset.padEnd(9)} ${v.width && v.height ? `${v.width}×${v.height}` : ""}${v.failureCode ? `  ${v.failureCode}` : ""}`),
      ].join("\n"));
      return;
    }

    case "change-sets": {
      const changeSets = await client(parsed).changeSets();
      out(changeSets, () => changeSets.length === 0 ? "No change sets." : changeSets.map(line).join("\n"));
      return;
    }

    case "submit": {
      const api = client(parsed);
      const wanted = positional(parsed, "the change set's name or id");
      const target = /^[0-9a-f-]{36}$/i.test(wanted) ? { id: wanted }
        : (await api.changeSets()).find((c) => c.status === "open" && c.name === wanted)
          ?? (() => { throw new Error(`No open change set named "${wanted}".`); })();
      const submitted = await api.submitChangeSet(target.id);
      out(submitted, () => `"${submitted.name}" is in review (${submitted.id}).`);
      return;
    }

    case "project": {
      const project = await client(parsed).project();
      out(project, () => `${project.name} (${project.slug}): languages ${project.languages.join(", ")}`);
      return;
    }

    default:
      throw new Error(`Unknown command "${parsed.command}". Run brua help.`);
  }
}

function client(parsed: Parsed): Api {
  const key = flag(parsed, "key") ?? process.env.BRUA_API_KEY;
  const project = flag(parsed, "project") ?? process.env.BRUA_PROJECT;
  if (!key) throw new Error("No API key: set BRUA_API_KEY or pass --key.");
  if (!project) throw new Error("No project: set BRUA_PROJECT or pass --project.");
  return new Api({ url: flag(parsed, "api-url") ?? process.env.BRUA_API_URL ?? "https://api.brua.dev", key, project });
}

function positional(parsed: Parsed, what: string): string {
  const value = parsed.positionals[0];
  if (!value) throw new Error(`Give ${what}.`);
  return value;
}

/** An asset id from a file name: hero-image.JPG becomes hero-image. */
function idFrom(file: string): string {
  return basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

function line(changeSet: ChangeSet): string {
  const count = changeSet.changes.length;
  return `${changeSet.status.padEnd(9)} ${changeSet.name}  ${count} ${count === 1 ? "asset" : "assets"}  ${changeSet.id}`;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`brua: ${message}`);
  process.exit(error instanceof BruaError && error.status === 401 ? 2 : 1);
});
