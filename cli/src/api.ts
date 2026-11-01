// Brua's API from a system's point of view: a key, a project, and the operations the CLI uses, each named by its
// method and path in the public document (openapi.json, types in openapi.d.ts), so the two are checked against
// each other by the compiler and test/contract.test.ts.
import type { components, paths } from "./openapi.d.ts";

export type Schemas = components["schemas"];
export type AssetResponse = Schemas["AssetResponse"];
export type AssetVersion = Schemas["AssetVersionDto"];
export type AssetDetail = Schemas["AssetDetailDto"];
export type ChangeSet = Schemas["ChangeSetDto"];
export type ErrorBody = Schemas["ErrorDto"];
export type Project = Schemas["ProjectDto"];
export type SourceUpload = Schemas["SourceUploadDto"];
export type CreateAsset = Schemas["CreateAssetRequest"];
export type CreateVersion = Schemas["CreateVersionRequest"];

type Method = "get" | "post" | "put" | "delete";

export const operations = {
  project: ["get", "/v1/projects/{project}"],
  listAssets: ["get", "/v1/projects/{project}/assets"],
  createAsset: ["post", "/v1/projects/{project}/assets"],
  versions: ["get", "/v1/projects/{project}/assets/{id}/versions"],
  createVersion: ["post", "/v1/projects/{project}/assets/{id}/versions"],
  version: ["get", "/v1/projects/{project}/assets/{id}/versions/{version}"],
  uploadUrl: ["post", "/v1/projects/{project}/assets/{id}/versions/{version}/slots/{slot}/upload-url"],
  complete: ["post", "/v1/projects/{project}/assets/{id}/versions/{version}/slots/{slot}/complete"],
  submitVersion: ["post", "/v1/projects/{project}/assets/{id}/versions/{version}/submit"],
  get: ["get", "/v1/projects/{project}/assets/{id}"],
  changeSets: ["get", "/v1/projects/{project}/change-sets"],
  createChangeSet: ["post", "/v1/projects/{project}/change-sets"],
  submitChangeSet: ["post", "/v1/projects/{project}/change-sets/{id}/submit"],
} as const satisfies Record<string, readonly [Method, keyof paths]>;

export interface Settings {
  /** The API, such as https://api.brua.dev. */
  url: string;
  /** A project API key. Pushing takes assets:write; reading, and finding change sets by name, delivery:read. */
  key: string;
  project: string;
}

/** What the API answered when it refused: the status and the error body, with its code and what it is about. */
export class BruaError extends Error {
  readonly status: number;
  readonly body: ErrorBody | undefined;

  constructor(status: number, body: ErrorBody | undefined, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }

  get code(): string | undefined {
    return this.body?.error;
  }
}

export class Api {
  readonly settings: Settings;

  constructor(settings: Settings) {
    this.settings = { ...settings, url: settings.url.replace(/\/+$/, "") };
  }

  project(): Promise<Project> {
    return this.request("project", {});
  }

  listAssets(): Promise<Schemas["AssetSummaryDto"][]> {
    return this.request("listAssets", {});
  }

  createAsset(body: CreateAsset): Promise<AssetVersion> {
    return this.request("createAsset", {}, body);
  }

  versions(id: string): Promise<AssetDetail> {
    return this.request("versions", { id });
  }

  createVersion(id: string, body: CreateVersion): Promise<AssetVersion> {
    return this.request("createVersion", { id }, body);
  }

  version(id: string, version: number): Promise<AssetVersion> {
    return this.request("version", { id, version });
  }

  uploadUrl(id: string, version: number, slot: string): Promise<SourceUpload> {
    return this.request("uploadUrl", { id, version, slot });
  }

  complete(id: string, version: number, slot: string): Promise<AssetVersion> {
    return this.request("complete", { id, version, slot });
  }

  submitVersion(id: string, version: number, changeSet?: string): Promise<ChangeSet> {
    return this.request("submitVersion", { id, version }, { changeSet: changeSet ?? null });
  }

  get(id: string, lang?: string): Promise<AssetResponse> {
    return this.request("get", { id }, undefined, lang ? { "Accept-Language": lang } : {});
  }

  changeSets(): Promise<ChangeSet[]> {
    return this.request("changeSets", {});
  }

  createChangeSet(name: string): Promise<ChangeSet> {
    return this.request("createChangeSet", {}, { name });
  }

  submitChangeSet(id: string): Promise<ChangeSet> {
    return this.request("submitChangeSet", { id });
  }

  private async request<T>(
    operation: keyof typeof operations,
    params: Record<string, string | number>,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const [method, template] = operations[operation];
    const path = template.replace(/\{(\w+)\}/g, (_, name: string) =>
      encodeURIComponent(name === "project" ? this.settings.project : String(params[name])));
    const response = await fetch(`${this.settings.url}${path}`, {
      method: method.toUpperCase(),
      headers: {
        "X-Api-Key": this.settings.key,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      let error: ErrorBody | undefined;
      try { error = JSON.parse(text); } catch { /* not JSON */ }
      throw new BruaError(response.status, error, describe(response.status, error, `${method.toUpperCase()} ${path}`));
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

function describe(status: number, error: ErrorBody | undefined, call: string): string {
  if (status === 401) return "The API key was refused: set BRUA_API_KEY to a key of the project.";
  if (status === 403 && !error) return `The key may not do this (${call}): a push needs the scope assets:write, reading needs delivery:read.`;
  if (!error) return `${call} answered ${status}.`;
  const fields = error.errors ? Object.entries(error.errors).map(([field, messages]) => `${field}: ${messages.join(" ")}`).join("; ") : "";
  return `${error.error}${error.id ? ` (${error.id})` : ""}${fields ? `: ${fields}` : ""}`;
}
