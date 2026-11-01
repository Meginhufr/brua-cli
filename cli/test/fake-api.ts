// A small Brua API in memory, with the endpoints the CLI uses and the rules that matter to it: keys and scopes,
// slots per preset, processing that finishes on the next look, change sets, and the delivery response.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { AssetResponse, AssetVersion, ChangeSet } from "../src/api.ts";

interface FakeVersion extends AssetVersion {
  uploads: Set<string>;
}

interface FakeAsset {
  id: string;
  preset: string;
  colorSchemes?: string;
  alt: Record<string, string>;
  versions: FakeVersion[];
  live?: number;
}

export interface FakeApi {
  url: string;
  assets: Map<string, FakeAsset>;
  changeSets: ChangeSet[];
  uploaded: { slot: string; bytes: number; contentType: string | undefined }[];
  /** The next processed version fails with this code. */
  failNext?: string;
  close(): Promise<void>;
}

/** Keys: "write" has assets:write, "read" delivery:read, "both" both. */
const SCOPES: Record<string, string[]> = { write: ["assets:write"], read: ["delivery:read"], both: ["assets:write", "delivery:read"] };

export async function startFakeApi(): Promise<FakeApi> {
  const state: FakeApi = { url: "", assets: new Map(), changeSets: [], uploaded: [], close: async () => {} };
  const server = createServer((request, response) => handle(state, request, response).catch((error) => {
    response.writeHead(500).end(String(error));
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("no address");
  state.url = `http://127.0.0.1:${address.port}`;
  state.close = () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return state;
}

export function seedReleased(api: FakeApi, id: string, alt: Record<string, string> = { nb: `${id} nb`, en: `${id} en` }): void {
  api.assets.set(id, {
    id, preset: "flexible", alt,
    versions: [{ id, version: 1, status: "Ready", slots: [{ name: "any.still.source", status: "uploaded", contentType: "image/png", required: true }], uploads: new Set(["any.still.source"]) }],
    live: 1,
  });
}

async function handle(api: FakeApi, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", api.url);
  const send = (status: number, body?: unknown) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(body === undefined ? "" : JSON.stringify(body));
  };
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks);
  const body = raw.length && request.headers["content-type"]?.includes("json") ? JSON.parse(raw.toString()) : undefined;

  // Uploads go to the "storage", with no key.
  let match = url.pathname.match(/^\/upload\/([^/]+)\/(\d+)\/([^/]+)$/);
  if (match && request.method === "PUT") {
    api.uploaded.push({ slot: match[3], bytes: raw.length, contentType: request.headers["content-type"] });
    api.assets.get(match[1])?.versions[Number(match[2]) - 1]?.uploads.add(match[3]);
    return send(200);
  }

  const scopes = SCOPES[request.headers["x-api-key"] as string];
  if (!scopes) return send(401);
  const allow = (scope: string) => scopes.includes(scope) ? true : (send(403), false);
  const error = (status: number, code: string, id?: string) => send(status, { error: code, id });
  const prefix = "/v1/projects/demo";
  if (!url.pathname.startsWith(prefix)) return error(404, "project_not_found");
  const path = url.pathname.slice(prefix.length);
  const method = request.method ?? "GET";

  if (path === "" && method === "GET") {
    if (!allow("delivery:read")) return;
    return send(200, { slug: "demo", name: "Demo", languages: ["nb", "en"] });
  }

  if (path.startsWith("/change-sets")) {
    const answered = changeSetRoutes(api, path, method, body, allow);
    return answered ? send(answered[0], answered[1]) : undefined;
  }

  if (path === "/assets" && method === "POST") {
    if (!allow("assets:write")) return;
    if (api.assets.has(body.id)) return error(409, "asset_exists", body.id);
    const missing = ["nb", "en"].filter((lang) => !body.decorative && !body.alt?.[lang]);
    if (missing.length) return send(400, { error: "validation_failed", errors: { alt: [`Alt text is missing for: ${missing.join(", ")}.`] } });
    const asset: FakeAsset = { id: body.id, preset: body.preset ?? "flexible", colorSchemes: body.colorSchemes, alt: body.alt ?? {}, versions: [] };
    api.assets.set(body.id, asset);
    return send(201, strip(newVersion(asset)));
  }
  if (path === "/assets" && method === "GET") {
    if (!allow("delivery:read")) return;
    return send(200, [...api.assets.values()].map((a) => ({
      id: a.id, preset: a.preset, latestVersion: a.versions.length, latestStatus: a.versions.at(-1)?.status ?? "Draft",
      liveVersion: a.live ?? null, width: 400, height: 300, alt: a.alt.nb ?? null, decorative: false, previews: [],
    })));
  }

  match = path.match(/^\/assets\/([^/]+)(?:\/(.*))?$/);
  if (!match) return error(404, "not_found");
  const [, id, rest = ""] = match;
  const asset = api.assets.get(id);

  if (rest === "" && method === "GET") {
    if (!allow("delivery:read")) return;
    if (!asset) return error(404, "not_found", id);
    if (!asset.live) return error(404, "not_released", id);
    const lang = (request.headers["accept-language"] ?? "nb").split(",")[0].trim();
    const alt = asset.alt[lang] ?? asset.alt.nb;
    const delivered: AssetResponse = { id, version: asset.live, url: `https://cdn.test/assets/org/${id}/${asset.live}`, width: 400, height: 300, alt, lang: asset.alt[lang] ? lang : "nb", variants: [{ type: "image/png", url: `https://cdn.test/assets/org/${id}/${asset.live}/320.png`, pixelWidth: 320 }] };
    return send(200, delivered);
  }
  if (rest === "versions" && method === "GET") {
    if (!allow("delivery:read")) return;
    if (!asset) return error(404, "not_found", id);
    return send(200, { id, sizing: asset.preset === "flexible" ? "flexible" : "fixed", liveVersion: asset.live ?? null, createdAt: new Date().toISOString(), versions: asset.versions.map((v) => ({ version: v.version, status: v.status, failureCode: v.failureCode ?? null, width: 400, height: 300, decorative: false, stillFit: "match", preset: asset.preset, colorSchemes: asset.colorSchemes ?? "any", languages: "none", scales: "single", designWidth: null, designHeight: null, alt: asset.alt, types: [], variantCount: 0, previews: [], variants: [], url: "" })).reverse() });
  }
  if (!allow("assets:write")) return;
  if (!asset) return error(404, "not_found", id);

  if (rest === "versions" && method === "POST") {
    // A version chooses which files it has; what the body leaves out carries over.
    if (body?.preset) asset.preset = body.preset;
    if (body?.colorSchemes) asset.colorSchemes = body.colorSchemes;
    return send(201, strip(newVersion(asset)));
  }

  match = rest.match(/^versions\/(\d+)(?:\/(.*))?$/);
  if (!match) return error(404, "not_found");
  const version = asset.versions[Number(match[1]) - 1];
  if (!version) return error(404, "version_not_found", match[1]);
  const action = match[2] ?? "";

  if (action === "" && method === "GET") {
    // Processing finishes on the look after it started, or fails when told to.
    if (version.status === "Processing") {
      if (api.failNext) { version.status = "Failed"; version.failureCode = api.failNext; version.failureDetail = "The still has other proportions than designed."; api.failNext = undefined; }
      else version.status = "Ready";
    }
    return send(200, strip(version));
  }
  let slot = action.match(/^slots\/([^/]+)\/upload-url$/);
  if (slot && method === "POST") {
    if (!version.slots?.some((s) => s.name === slot![1])) return error(404, "slot_not_in_preset", slot[1]);
    if (version.status !== "Draft") return error(409, "version_not_draft", String(version.version));
    return send(200, { uploadUrl: `${api.url}/upload/${id}/${version.version}/${slot[1]}`, method: "PUT", expiresAt: new Date(Date.now() + 60_000).toISOString() });
  }
  slot = action.match(/^slots\/([^/]+)\/complete$/);
  if (slot && method === "POST") {
    if (!version.uploads.has(slot[1])) return error(409, "upload_not_requested", slot[1]);
    const entry = version.slots?.find((s) => s.name === slot![1]);
    if (entry) { entry.status = "uploaded"; entry.contentType = "image/png"; }
    if (version.slots?.every((s) => !s.required || s.status === "uploaded")) version.status = "Processing";
    return send(202, strip(version));
  }
  if (action === "submit" && method === "POST") {
    if (version.status !== "Ready") return error(409, "version_not_ready", String(version.version));
    let changeSet = body?.changeSet ? api.changeSets.find((c) => c.id === body.changeSet) : undefined;
    if (body?.changeSet && !changeSet) return error(404, "change_set_not_found", body.changeSet);
    if (changeSet && changeSet.status !== "open") return error(409, "change_set_not_open", changeSet.id);
    changeSet ??= open(api, `${id} v${version.version}`);
    changeSet.changes = [...changeSet.changes.filter((c) => c.asset !== id), { asset: id, kind: "set", fromVersion: asset.live ?? null, toVersion: version.version, conflict: false }];
    return send(200, changeSet);
  }
  return error(404, "not_found");
}

function newVersion(asset: FakeAsset): FakeVersion {
  const schemes = asset.colorSchemes === "any-dark" ? ["any", "dark"] : asset.colorSchemes === "both" ? ["light", "dark"] : ["any"];
  const slots = schemes.flatMap((scheme) => [
    ...(asset.preset === "animated" ? [{ name: `${scheme}.animation.source`, status: "empty", contentType: null, required: true }] : []),
    { name: `${scheme}.still.source`, status: "empty", contentType: null, required: true },
  ]);
  const version: FakeVersion = { id: asset.id, version: asset.versions.length + 1, status: "Draft", slots, uploads: new Set() };
  asset.versions.push(version);
  return version;
}

function strip(version: FakeVersion): AssetVersion {
  const { uploads, ...rest } = version;
  return rest;
}

export function open(api: FakeApi, name: string): ChangeSet {
  const changeSet: ChangeSet = { id: randomUUID(), name, status: "open", createdAt: new Date().toISOString(), createdBy: "key:test", approvedBy: null, mergeAt: null, mergedRelease: null, changes: [] };
  api.changeSets.push(changeSet);
  return changeSet;
}

/** Change sets, as the API lists and submits them. */
export function changeSetRoutes(api: FakeApi, path: string, method: string, body: unknown, allow: (scope: string) => boolean): [number, unknown] | undefined {
  if (path === "/change-sets" && method === "GET") return allow("delivery:read") ? [200, api.changeSets] : undefined;
  if (path === "/change-sets" && method === "POST") return allow("assets:write") ? [201, open(api, (body as { name: string }).name)] : undefined;
  const match = path.match(/^\/change-sets\/([^/]+)\/submit$/);
  if (match && method === "POST") {
    if (!allow("assets:write")) return undefined;
    const changeSet = api.changeSets.find((c) => c.id === match[1]);
    if (!changeSet) return [404, { error: "change_set_not_found", id: match[1] }];
    if (changeSet.changes.length === 0) return [409, { error: "change_set_empty", id: changeSet.id }];
    changeSet.status = "inreview";
    return [200, changeSet];
  }
  return undefined;
}
