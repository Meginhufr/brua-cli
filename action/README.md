# Brua GitHub Actions

Two composite actions that run `brua-cli` from a workflow: `push` sends a source file into a change set for review, `pull` keeps a source file of the project's released asset ids in your repository. Both take a project API key as a secret; neither can approve or merge, which a person does in Brua.

They live with the command line in `Meginhufr/brua-cli`; a workflow references them by that repository and a release tag.

## push

```yaml
- uses: Meginhufr/brua-cli/action/push@v1
  with:
    api-key: ${{ secrets.BRUA_API_KEY }}      # a key with assets:write, and delivery:read to find change sets by name
    project: webshop
    file: brand/hero.jpg                       # the asset is named hero unless id says otherwise
    alt: |
      nb=Rødt ullpledd
      en=Red wool blanket
    change-set: Spring campaign                # opened when there is none; left out, a new one for this change
```

Fixed and animated assets give `slots` instead of `file`, one `slot=file` per line, and on the first push `preset`, `width`, `height` and `color-schemes` (SPEC.md 4 and 9). Alt text can also be a sidecar `hero.alt.json` beside the file, or `alt-file`. `wait: false` uploads without waiting for processing or submitting.

Outputs: `version`, `created`, `change-set` (its id) and `change-set-name`, so a later step can link to the review.

## pull

```yaml
- uses: Meginhufr/brua-cli/action/pull@v1
  with:
    api-key: ${{ secrets.BRUA_API_KEY }}      # a key with delivery:read
    project: webshop
    out: src/brua/assets.ts                    # .ts, .swift, .kt, .cs or .json
    check: true                                # fail when the file is out of date instead of writing it
```

Without `check`, the step writes the file when the project has changed; commit it with a step of your own, or run it in a scheduled workflow that opens a pull request. `namespace` sets the Kotlin package or C# namespace and `all` includes assets with no release yet. Outputs: `count` and `changed`.

Both actions need Node 24 on the runner and set it up themselves.
