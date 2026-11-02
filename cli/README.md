# @meginhufr/brua-cli

Brua from the command line and from CI: push images and animations into change sets for review, pull the released asset ids into your code, and read what the current release serves. One file, no dependencies, Node 24 or later.

```bash
npx @meginhufr/brua-cli push hero.jpg --alt nb="Rødt ullpledd" --alt en="Red wool blanket" --change-set "Spring campaign"
```

Until the package is published, run it from this repository: `node cli/src/brua.ts …`.

## Settings

| Flag | Environment | |
| --- | --- | --- |
| `--api-url` | `BRUA_API_URL` | The API; `https://api.brua.dev` by default, `http://localhost:7800` locally |
| `--key` | `BRUA_API_KEY` | A project API key. Pushing takes `assets:write`; reading, pulling and finding change sets by name take `delivery:read`. Give a pipeline's key both. |
| `--project` | `BRUA_PROJECT` | The project's id |

Errors are one line on stderr and a non-zero exit (2 when the key is refused); `--json` prints results as JSON for scripts.

## push

`brua push <file>` creates the asset on the first push and a new version after that, uploads the source, waits until processing is done and puts the version in a change set, where a person reviews and merges it (SPEC.md 21). The asset is named after the file unless `--id` says otherwise.

- **Alt text** per project language: `--alt nb="…" --alt en="…"`, `--alt-file alt.json`, or a sidecar `hero.alt.json` beside `hero.jpg`. A new version keeps the newest version's alt text when none is given.
- **The first push** also takes `--preset flexible|fixed|animated`, `--width` and `--height` for fixed and animated assets, `--color-schemes any|any-dark|both`, `--languages none|optional|required`, `--scales single|individual`, `--still-fit match|fill` and `--decorative` (SPEC.md 4 and 9).
- **Slots** instead of a file, for fixed and animated assets and per-language files: `--slot any.still.source=icon.png --slot dark.still.source=icon-dark.png` (SPEC.md 9.1). A slot the preset doesn't have is refused before anything is uploaded.
- **The change set:** `--change-set "Spring campaign"` by name, opened when there is none, or by id; left out, a new change set holds just this change. `--no-wait` uploads and stops; `--no-submit` waits for processing but leaves the version out of change sets.

Processing that fails ends the push with the code, such as `aspect_mismatch`.

## pull

`brua pull src/brua/assets.ts` writes the project's released asset ids as constants, so a reference to an asset that doesn't exist is a compile error and a rename shows up as a diff. The extension picks the language, or `--language typescript|swift|kotlin|csharp|json`; `--namespace` sets the Kotlin package or C# namespace; `--all` includes assets with no release yet.

```ts
export const assets = {
  /** Rødt ullpledd · flexible, 1280×853 */
  woolBlanketRed: "wool-blanket-red",
} as const;
```

Names are the ids in camel case, flat: the platform doesn't know an id's hierarchy, so `hero` and `hero-summer` stay `hero` and `heroSummer`. `--check` writes nothing and exits 1 when the file is out of date, for CI.

## Reading

`brua get <id> [--lang nb]` prints the delivery API's response for the current release, `brua versions <id>` the versions and their status, `brua change-sets` the project's change sets, `brua submit <name or id>` sends one for review, and `brua project` the name and languages.

## GitHub Actions

`action/push` and `action/pull` run the same code from a workflow: see `action/README.md`.

## How it is built

The CLI calls only what the public API reference describes: `openapi.json` is the document from `/swagger/v1/swagger.json`, `src/openapi.d.ts` the types generated from it (`npm run generate` against a running API), and `src/api.ts` names each operation by its method and path, which the compiler and `test/contract.test.ts` check against the document. `npm test` type-checks and runs the CLI and both actions against a fake API in `test/fake-api.ts`.
