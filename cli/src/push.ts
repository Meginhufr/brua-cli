// A push: the asset's next version, or the asset itself when it is new, its source files uploaded, processing
// waited for, and the version put in a change set for a person to review (SPEC.md 9 and 21.1).
import { access, readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { Api, BruaError, type AssetVersion, type ChangeSet } from "./api.ts";

export interface PushOptions {
  id: string;
  /** "flexible" (the default), "fixed" or "animated"; only read when the asset is created. */
  preset?: string;
  /** The single source of a flexible asset: the slot any.still.source. */
  file?: string;
  /** Slot name to file, for fixed and animated assets, or several languages. */
  slots?: Record<string, string>;
  /** Alt text per language. Left out, a sidecar next to the file is read: hero.alt.json beside hero.jpg. */
  alt?: Record<string, string>;
  altFile?: string;
  decorative?: boolean;
  width?: number;
  height?: number;
  colorSchemes?: string;
  stillFit?: string;
  languages?: string;
  scales?: string;
  /** The change set to put the version in: a name (opened when there is none) or an id. Left out, a new one for this change. */
  changeSet?: string;
  /** False uploads and stops: no waiting for processing, no change set. */
  wait?: boolean;
  /** False waits for processing but leaves the version out of any change set. */
  submit?: boolean;
  pollInterval?: number;
  timeout?: number;
  log?: (line: string) => void;
}

export interface PushResult {
  id: string;
  version: number;
  status: string;
  /** Whether the push created the asset, as opposed to a new version of it. */
  created: boolean;
  changeSet?: { id: string; name: string };
}

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".riv": "application/x-rive",
};

export async function push(api: Api, options: PushOptions): Promise<PushResult> {
  const log = options.log ?? (() => {});
  const slots = await slotFiles(options);
  const alt = await altText(options);

  // The next version of the asset, or the asset itself: a key that writes needs no right to read, so try first.
  let version: AssetVersion;
  let created = false;
  try {
    version = await api.createVersion(options.id, {
      alt,
      decorative: options.decorative,
      stillFit: options.stillFit,
      preset: options.preset,
      width: options.width,
      height: options.height,
      colorSchemes: options.colorSchemes,
      languages: options.languages,
      scales: options.scales,
    });
  } catch (error) {
    if (!(error instanceof BruaError) || error.status !== 404) throw error;
    version = await api.createAsset({
      id: options.id,
      preset: options.preset ?? "flexible",
      alt,
      decorative: options.decorative ?? false,
      width: options.width,
      height: options.height,
      colorSchemes: options.colorSchemes,
      stillFit: options.stillFit,
      languages: options.languages,
      scales: options.scales,
    });
    created = true;
  }
  const number = version.version;
  log(created ? `Created ${options.id}; uploading version 1.` : `${options.id}: uploading version ${number}.`);

  const known = (version.slots ?? []).map((slot) => slot.name);
  for (const slot of Object.keys(slots)) {
    if (known.length > 0 && !known.includes(slot)) throw new Error(`${options.id} has no slot "${slot}". Its slots: ${known.join(", ")}.`);
  }

  for (const [slot, file] of Object.entries(slots)) {
    const upload = await api.uploadUrl(options.id, number, slot);
    const type = CONTENT_TYPES[extname(file).toLowerCase()];
    const put = await fetch(upload.uploadUrl, { method: upload.method, body: await readFile(file), headers: type ? { "Content-Type": type } : {} });
    if (!put.ok) throw new Error(`Uploading ${file} to ${slot} failed: the storage answered ${put.status}.`);
    version = await api.complete(options.id, number, slot);
    log(`Uploaded ${file} as ${slot}.`);
  }

  if (options.wait === false) return { id: options.id, version: number, status: version.status, created };

  version = await processed(api, options, number, log);
  if (options.submit === false) return { id: options.id, version: number, status: version.status, created };

  const changeSet = await submitTo(api, options, number);
  log(`Version ${number} is in change set "${changeSet.name}" (${changeSet.id}), ready for review.`);
  return { id: options.id, version: number, status: version.status, created, changeSet: { id: changeSet.id, name: changeSet.name } };
}

/** Which file goes in which slot: the slots given, or the single file as the flexible asset's one slot. */
async function slotFiles(options: PushOptions): Promise<Record<string, string>> {
  const slots = { ...(options.slots ?? {}) };
  if (options.file) {
    if (Object.keys(slots).length > 0) throw new Error("Give either a file or slots, not both.");
    slots["any.still.source"] = options.file;
  }
  if (Object.keys(slots).length === 0) throw new Error("Nothing to upload: give a file, or slots such as dark.still.source=dark.png.");
  for (const file of Object.values(slots)) {
    try { await access(file); } catch { throw new Error(`No such file: ${file}.`); }
  }
  return slots;
}

/** Alt text per language from the options, a JSON file, or the sidecar beside the first file; undefined keeps the newest version's. */
async function altText(options: PushOptions): Promise<Record<string, string> | undefined> {
  if (options.alt && Object.keys(options.alt).length > 0) return options.alt;
  const candidates = options.altFile ? [options.altFile] : [];
  const first = options.file ?? Object.values(options.slots ?? {})[0];
  if (!options.altFile && first) {
    const stem = basename(first, extname(first));
    candidates.push(join(dirname(first), `${stem}.alt.json`));
  }
  for (const candidate of candidates) {
    let text: string;
    try { text = await readFile(candidate, "utf8"); } catch {
      if (options.altFile) throw new Error(`No such file: ${candidate}.`);
      continue;
    }
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`${candidate} must hold an object of language to alt text.`);
    return parsed as Record<string, string>;
  }
  return undefined;
}

async function processed(api: Api, options: PushOptions, number: number, log: (line: string) => void): Promise<AssetVersion> {
  const interval = options.pollInterval ?? 2000;
  const deadline = Date.now() + (options.timeout ?? 10 * 60 * 1000);
  let said = false;
  while (true) {
    const version = await api.version(options.id, number);
    const status = version.status.toLowerCase();
    if (status === "ready") {
      log(`Version ${number} is processed.`);
      return version;
    }
    if (status === "failed") throw new Error(`Processing version ${number} failed: ${version.failureCode ?? "unknown"}${version.failureDetail ? `. ${version.failureDetail}` : "."}`);
    if (!said) { log("Waiting for processing…"); said = true; }
    if (Date.now() > deadline) throw new Error(`Version ${number} was not processed within the time given; it is "${version.status}". Check it later with brua versions ${options.id}.`);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Into the change set asked for, by id or by name (opened when there is none), or into a new one. */
async function submitTo(api: Api, options: PushOptions, number: number): Promise<ChangeSet> {
  const wanted = options.changeSet?.trim();
  if (!wanted) return api.submitVersion(options.id, number);
  if (GUID.test(wanted)) return api.submitVersion(options.id, number, wanted);

  let open: ChangeSet[];
  try {
    open = (await api.changeSets()).filter((changeSet) => changeSet.status === "open");
  } catch (error) {
    if (error instanceof BruaError && error.status === 403) {
      throw new Error(`Finding the change set "${wanted}" by name needs a key with delivery:read as well; give the change set's id instead, or add the scope.`);
    }
    throw error;
  }
  const existing = open.find((changeSet) => changeSet.name === wanted);
  const target = existing ?? await api.createChangeSet(wanted);
  return api.submitVersion(options.id, number, target.id);
}
