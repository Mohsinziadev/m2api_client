import type {
  AuthConfig,
  AuthProfile,
  Environment,
  KeyValueEntry,
  MultipartField,
  RequestBodyDefinition,
  RequestDefinition,
  RequestSettings,
  Variable,
} from '../core/types';
import { HTTP_METHODS } from '../core/types';
import type { Collection, CollectionNode, CollectionRequest } from './collections';
import { createId } from '../utils/id';
import { sanitizeAuthProfile, sanitizeCollection, sanitizeEnvironment, type SanitizeOptions } from '../persistence/sanitize';

/** Identifies m2api-client export files. */
export const EXPORT_FORMAT = 'm2api-client';
export const EXPORT_VERSION = 1;

/**
 * The documented export file format (version 1).
 *
 * ```json
 * {
 *   "format": "m2api-client",
 *   "version": 1,
 *   "exportedAt": "2026-01-01T00:00:00.000Z",
 *   "collections": [{ "id": "…", "name": "Users API", "variables": [], "items": [
 *     { "type": "folder", "id": "…", "name": "Users", "items": [
 *       { "type": "request", "id": "…", "name": "List users", "method": "GET", "url": "{{baseUrl}}/users",
 *         "params": [], "headers": [], "body": { "type": "none" }, "auth": { "type": "none" }, "settings": {} }
 *     ] }
 *   ] }],
 *   "environments": [{ "id": "…", "name": "Production", "variables": [{ "key": "baseUrl", "value": "https://…" }] }],
 *   "authProfiles": []
 * }
 * ```
 */
export interface WorkspaceExport {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  collections: Collection[];
  environments?: Environment[];
  authProfiles?: AuthProfile[];
}

export interface WorkspaceData {
  collections: Collection[];
  environments: Environment[];
  authProfiles: AuthProfile[];
}

export function exportWorkspace(data: Partial<WorkspaceData>, options: SanitizeOptions = {}): WorkspaceExport {
  const out: WorkspaceExport = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    collections: (data.collections ?? []).map((c) => sanitizeCollection(c, options)),
  };
  if (data.environments?.length) out.environments = data.environments.map((e) => sanitizeEnvironment(e, options));
  if (data.authProfiles?.length) out.authProfiles = data.authProfiles.map((p) => sanitizeAuthProfile(p, options));
  return out;
}

export function serializeWorkspace(data: Partial<WorkspaceData>, options: SanitizeOptions = {}): string {
  return JSON.stringify(exportWorkspace(data, options), null, 2);
}

export type ImportResult = { ok: true; data: WorkspaceData; warnings: string[] } | { ok: false; errors: string[] };

export interface ImportOptions {
  /** Assign fresh ids so imported items never collide with existing ones. Default `true`. */
  regenerateIds?: boolean;
}

const MAX_DEPTH = 32;

class Validator {
  readonly errors: string[] = [];
  readonly warnings: string[] = [];
  constructor(private readonly regenerate: boolean) {}

  id(value: unknown, prefix: string): string {
    return !this.regenerate && typeof value === 'string' && value ? value : createId(prefix);
  }
  fail(path: string, message: string): undefined {
    if (this.errors.length < 50) this.errors.push(`${path}: ${message}`);
    return undefined;
  }
  object(value: unknown, path: string): Record<string, unknown> | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return this.fail(path, 'expected an object');
    return value as Record<string, unknown>;
  }
  array(value: unknown, path: string, optional = false): unknown[] | undefined {
    if (value === undefined && optional) return [];
    if (!Array.isArray(value)) return this.fail(path, 'expected an array');
    return value;
  }
  string(value: unknown, path: string, fallback?: string): string | undefined {
    if (value === undefined && fallback !== undefined) return fallback;
    if (typeof value !== 'string') return this.fail(path, 'expected a string');
    return value;
  }

  entries(value: unknown, path: string): KeyValueEntry[] {
    const list = this.array(value, path, true) ?? [];
    return list.flatMap((raw, i) => {
      const o = this.object(raw, `${path}[${i}]`);
      if (!o) return [];
      const key = this.string(o.key, `${path}[${i}].key`);
      const val = this.string(o.value, `${path}[${i}].value`, '');
      if (key === undefined || val === undefined) return [];
      const entry: KeyValueEntry = { id: this.id(o.id, 'kv'), key, value: val, enabled: o.enabled !== false };
      if (typeof o.description === 'string' && o.description) entry.description = o.description;
      return [entry];
    });
  }

  variables(value: unknown, path: string): Variable[] {
    const list = this.array(value, path, true) ?? [];
    return list.flatMap((raw, i) => {
      const o = this.object(raw, `${path}[${i}]`);
      if (!o) return [];
      const key = this.string(o.key, `${path}[${i}].key`);
      const val = this.string(o.value, `${path}[${i}].value`, '');
      if (key === undefined || val === undefined) return [];
      const variable: Variable = { id: this.id(o.id, 'var'), key, value: val };
      if (o.enabled === false) variable.enabled = false;
      if (o.secret === true) variable.secret = true;
      if (typeof o.description === 'string' && o.description) variable.description = o.description;
      return [variable];
    });
  }

  body(value: unknown, path: string): RequestBodyDefinition {
    if (value === undefined) return { type: 'none' };
    const o = this.object(value, path);
    if (!o) return { type: 'none' };
    switch (o.type) {
      case 'none':
        return { type: 'none' };
      case 'json':
        return { type: 'json', content: this.string(o.content, `${path}.content`, '') ?? '' };
      case 'text': {
        const body: RequestBodyDefinition = { type: 'text', content: this.string(o.content, `${path}.content`, '') ?? '' };
        if (typeof o.contentType === 'string') body.contentType = o.contentType;
        return body;
      }
      case 'urlencoded':
        return { type: 'urlencoded', fields: this.entries(o.fields, `${path}.fields`) };
      case 'multipart': {
        const raw = this.array(o.fields, `${path}.fields`, true) ?? [];
        const fields: MultipartField[] = this.entries(raw, `${path}.fields`).map((entry, i) => {
          const kind = (raw[i] as { kind?: unknown })?.kind === 'file' ? 'file' : 'text';
          const fileName = (raw[i] as { fileName?: unknown })?.fileName;
          return { ...entry, kind, ...(kind === 'file' && typeof fileName === 'string' ? { fileName } : {}) };
        });
        if (fields.some((f) => f.kind === 'file'))
          this.warnings.push('File fields were imported without files; select them again before sending.');
        return { type: 'multipart', fields };
      }
      default:
        this.fail(`${path}.type`, 'expected none, json, text, urlencoded or multipart');
        return { type: 'none' };
    }
  }

  auth(value: unknown, path: string, allowProfile = true): AuthConfig {
    if (value === undefined) return { type: 'none' };
    const o = this.object(value, path);
    if (!o) return { type: 'none' };
    const s = (key: string) => this.string(o[key], `${path}.${key}`, '') ?? '';
    switch (o.type) {
      case 'none':
        return { type: 'none' };
      case 'bearer':
        return { type: 'bearer', token: s('token'), ...(typeof o.prefix === 'string' ? { prefix: o.prefix } : {}) };
      case 'basic':
        return { type: 'basic', username: s('username'), password: s('password') };
      case 'apiKey':
        return { type: 'apiKey', key: s('key'), value: s('value'), in: o.in === 'query' ? 'query' : 'header' };
      case 'oauth2': {
        const auth: AuthConfig = { type: 'oauth2', accessToken: s('accessToken') };
        for (const key of ['headerPrefix', 'authorizationUrl', 'tokenUrl', 'clientId', 'scope'] as const) {
          if (typeof o[key] === 'string') auth[key] = o[key] as string;
        }
        return auth;
      }
      case 'custom':
        return { type: 'custom', headers: this.entries(o.headers, `${path}.headers`) };
      case 'profile':
        if (allowProfile) return { type: 'profile', profileId: s('profileId') };
        this.fail(path, 'auth profiles cannot reference other profiles');
        return { type: 'none' };
      default:
        this.fail(`${path}.type`, 'unknown auth type');
        return { type: 'none' };
    }
  }

  settings(value: unknown, path: string): RequestSettings {
    if (value === undefined) return {};
    const o = this.object(value, path);
    if (!o) return {};
    const settings: RequestSettings = {};
    if (typeof o.timeout === 'number' && o.timeout >= 0) settings.timeout = o.timeout;
    if (o.redirect === 'follow' || o.redirect === 'manual' || o.redirect === 'error') settings.redirect = o.redirect;
    if (o.credentials === 'omit' || o.credentials === 'same-origin' || o.credentials === 'include') settings.credentials = o.credentials;
    return settings;
  }

  request(o: Record<string, unknown>, path: string): CollectionRequest | undefined {
    const method = typeof o.method === 'string' ? o.method.toUpperCase() : 'GET';
    if (!(HTTP_METHODS as readonly string[]).includes(method))
      return this.fail(`${path}.method`, `expected one of ${HTTP_METHODS.join(', ')}`);
    const url = this.string(o.url, `${path}.url`);
    if (url === undefined) return undefined;
    const request: CollectionRequest = {
      type: 'request',
      id: this.id(o.id, 'req'),
      name: this.string(o.name, `${path}.name`, '') ?? '',
      method: method as CollectionRequest['method'],
      url,
      params: this.entries(o.params, `${path}.params`),
      headers: this.entries(o.headers, `${path}.headers`),
      body: this.body(o.body, `${path}.body`),
      auth: this.auth(o.auth, `${path}.auth`),
      settings: this.settings(o.settings, `${path}.settings`),
    };
    if (typeof o.description === 'string' && o.description) request.description = o.description;
    return request;
  }

  nodes(value: unknown, path: string, depth: number): CollectionNode[] {
    if (depth > MAX_DEPTH) return this.fail(path, 'folders are nested too deeply') ?? [];
    const list = this.array(value, path, true) ?? [];
    return list.flatMap((raw, i): CollectionNode[] => {
      const p = `${path}[${i}]`;
      const o = this.object(raw, p);
      if (!o) return [];
      if (o.type === 'folder') {
        const name = this.string(o.name, `${p}.name`);
        if (name === undefined) return [];
        return [{ type: 'folder', id: this.id(o.id, 'fld'), name, items: this.nodes(o.items, `${p}.items`, depth + 1) }];
      }
      if (o.type === 'request') {
        const request = this.request(o, p);
        return request ? [request] : [];
      }
      this.fail(`${p}.type`, 'expected "folder" or "request"');
      return [];
    });
  }

  collection(raw: unknown, path: string): Collection | undefined {
    const o = this.object(raw, path);
    if (!o) return undefined;
    const name = this.string(o.name, `${path}.name`);
    if (name === undefined) return undefined;
    const collection: Collection = {
      id: this.id(o.id, 'col'),
      name,
      variables: this.variables(o.variables, `${path}.variables`),
      items: this.nodes(o.items, `${path}.items`, 0),
    };
    if (typeof o.description === 'string' && o.description) collection.description = o.description;
    return collection;
  }
}

/**
 * Validates and normalises an export file (JSON text or a parsed object). Returns every problem found
 * instead of throwing, so the UI can show them.
 */
export function importWorkspace(input: string | unknown, options: ImportOptions = {}): ImportResult {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (error) {
      return { ok: false, errors: [`The file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
    }
  }
  const v = new Validator(options.regenerateIds !== false);
  const root = v.object(value, 'root');
  if (!root) return { ok: false, errors: v.errors };

  if (
    root.info &&
    typeof root.info === 'object' &&
    'schema' in (root.info as object) &&
    String((root.info as { schema: unknown }).schema).includes('postman')
  ) {
    return { ok: false, errors: ['Postman collections are not supported yet. Export the requests as cURL and import them one by one.'] };
  }
  if (typeof root.openapi === 'string' || typeof root.swagger === 'string') {
    return { ok: false, errors: ['This is an OpenAPI document. Use the OpenAPI import instead.'] };
  }

  let collectionsRaw: unknown;
  if (root.format === EXPORT_FORMAT) {
    if (typeof root.version !== 'number' || root.version > EXPORT_VERSION) {
      return { ok: false, errors: [`Unsupported export version ${String(root.version)}. This build reads version ${EXPORT_VERSION}.`] };
    }
    collectionsRaw = root.collections;
  } else if (typeof root.name === 'string' && Array.isArray(root.items)) {
    collectionsRaw = [root]; // a bare collection object
  } else {
    return { ok: false, errors: ['Unrecognised file. Expected an m2api-client export ("format": "m2api-client").'] };
  }

  const collections = (v.array(collectionsRaw, 'collections', true) ?? []).flatMap((c, i) => {
    const collection = v.collection(c, `collections[${i}]`);
    return collection ? [collection] : [];
  });
  const environments = (v.array(root.environments, 'environments', true) ?? []).flatMap((raw, i): Environment[] => {
    const o = v.object(raw, `environments[${i}]`);
    const name = o && v.string(o.name, `environments[${i}].name`);
    if (!o || name === undefined) return [];
    return [{ id: v.id(o.id, 'env'), name, variables: v.variables(o.variables, `environments[${i}].variables`) }];
  });
  const profileIds = new Map<string, string>();
  const authProfiles = (v.array(root.authProfiles, 'authProfiles', true) ?? []).flatMap((raw, i): AuthProfile[] => {
    const o = v.object(raw, `authProfiles[${i}]`);
    const name = o && v.string(o.name, `authProfiles[${i}].name`);
    if (!o || name === undefined) return [];
    const id = v.id(o.id, 'auth');
    if (typeof o.id === 'string') profileIds.set(o.id, id);
    return [{ id, name, auth: v.auth(o.auth, `authProfiles[${i}].auth`, false) as AuthProfile['auth'] }];
  });

  if (v.errors.length) return { ok: false, errors: v.errors };
  // Point requests at the (possibly re-generated) profile ids.
  const remap = (items: CollectionNode[]): CollectionNode[] =>
    items.map((node) => {
      if (node.type === 'folder') return { ...node, items: remap(node.items) };
      if (node.auth.type === 'profile' && profileIds.has(node.auth.profileId)) {
        return { ...node, auth: { type: 'profile', profileId: profileIds.get(node.auth.profileId)! } };
      }
      return node;
    });
  const remapped = collections.map((c) => ({ ...c, items: remap(c.items) }));
  return { ok: true, data: { collections: remapped, environments, authProfiles }, warnings: [...new Set(v.warnings)] };
}

/** Validates one stored request definition (used when hydrating persisted tabs and history). */
export function parseRequestDefinition(value: unknown): RequestDefinition | null {
  const v = new Validator(false);
  const o = v.object(value, 'request');
  const request = o ? v.request(o, 'request') : undefined;
  if (!request || v.errors.length) return null;
  const { type: _type, ...definition } = request;
  return definition;
}
