import type { HttpMethod, KeyValueEntry, MultipartField, RequestBodyDefinition, RequestDefinition } from './types';
import { createId } from '../utils/id';
import { syncParamsFromUrl } from './url';

export type RequestDefinitionInput = Partial<Omit<RequestDefinition, 'params' | 'headers'>> & {
  params?: Array<Partial<KeyValueEntry> & { key: string }> | Record<string, string>;
  headers?: Array<Partial<KeyValueEntry> & { key: string }> | Record<string, string>;
};

export function createKeyValue(key = '', value = '', extra: Partial<KeyValueEntry> = {}): KeyValueEntry {
  return { id: createId('kv'), key, value, enabled: true, ...extra };
}

function toEntries(input: RequestDefinitionInput['params']): KeyValueEntry[] {
  if (!input) return [];
  if (Array.isArray(input))
    return input.map((e) => ({
      id: e.id ?? createId('kv'),
      key: e.key,
      value: e.value ?? '',
      enabled: e.enabled ?? true,
      description: e.description,
    }));
  return Object.entries(input).map(([key, value]) => createKeyValue(key, value));
}

/**
 * Creates a complete {@link RequestDefinition} from partial input. A query string in `url` is mirrored
 * into `params` when no params are given.
 */
export function createRequest(input: RequestDefinitionInput = {}): RequestDefinition {
  const url = input.url ?? '';
  const params = toEntries(input.params);
  return {
    id: input.id ?? createId('req'),
    name: input.name ?? '',
    method: input.method ?? 'GET',
    url,
    params: params.length ? params : syncParamsFromUrl(url, []),
    headers: toEntries(input.headers),
    body: input.body ?? { type: 'none' },
    auth: input.auth ?? { type: 'none' },
    settings: { ...input.settings },
    ...(input.description ? { description: input.description } : {}),
  };
}

/** Deep copy with fresh ids (for duplicating). Files in multipart fields are carried over by reference. */
export function cloneRequest(request: RequestDefinition, overrides: Partial<RequestDefinition> = {}): RequestDefinition {
  const copyEntries = <T extends KeyValueEntry>(entries: T[]): T[] => entries.map((e) => ({ ...e, id: createId('kv') }));
  let body: RequestBodyDefinition = request.body;
  if (body.type === 'urlencoded') body = { type: 'urlencoded', fields: copyEntries(body.fields) };
  else if (body.type === 'multipart') body = { type: 'multipart', fields: copyEntries<MultipartField>(body.fields) };
  else body = { ...body };
  const auth =
    request.auth.type === 'custom' ? { type: 'custom' as const, headers: copyEntries(request.auth.headers) } : { ...request.auth };
  return {
    ...request,
    id: createId('req'),
    params: copyEntries(request.params),
    headers: copyEntries(request.headers),
    body,
    auth,
    settings: { ...request.settings },
    ...overrides,
  };
}

/** A display name for unnamed requests: `GET /users/1`. */
export function describeRequest(request: Pick<RequestDefinition, 'name' | 'method' | 'url'>): string {
  if (request.name.trim()) return request.name.trim();
  const path = request.url.replace(/^\w+:\/\/[^/]+/, '').replace(/^\{\{[^}]+\}\}/, '') || request.url;
  return path ? `${request.method} ${path}` : 'Untitled request';
}

export interface RequestTemplate {
  id: string;
  name: string;
  description?: string;
  request: Omit<RequestDefinitionInput, 'id'>;
}

/** Starting points offered by the workspace "New request" menu. Extend with `ApiClient`'s `templates`. */
export const DEFAULT_TEMPLATES: RequestTemplate[] = [
  { id: 'blank', name: 'Blank request', request: { method: 'GET' } },
  {
    id: 'get-json',
    name: 'GET JSON',
    description: 'Accepts application/json',
    request: { method: 'GET', headers: { Accept: 'application/json' } },
  },
  {
    id: 'post-json',
    name: 'POST JSON',
    description: 'JSON body with Content-Type',
    request: { method: 'POST', headers: { Accept: 'application/json' }, body: { type: 'json', content: '{\n  \n}' } },
  },
  {
    id: 'form',
    name: 'Form submission',
    description: 'application/x-www-form-urlencoded',
    request: { method: 'POST', body: { type: 'urlencoded', fields: [createKeyValue('field', 'value')] } },
  },
  {
    id: 'graphql',
    name: 'GraphQL query',
    description: 'POST with a query document',
    request: {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: { type: 'json', content: '{\n  "query": "query { __typename }",\n  "variables": {}\n}' },
    },
  },
];

export interface HeaderPreset {
  id: string;
  name: string;
  headers: Record<string, string>;
}

/** Reusable header sets offered in the Headers tab. Extend with `ApiClient`'s `headerPresets`. */
export const DEFAULT_HEADER_PRESETS: HeaderPreset[] = [
  { id: 'json', name: 'JSON API', headers: { Accept: 'application/json', 'Content-Type': 'application/json' } },
  { id: 'no-cache', name: 'Bypass caches', headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } },
  { id: 'bearer', name: 'Bearer token variable', headers: { Authorization: 'Bearer {{apiToken}}' } },
  { id: 'trace', name: 'Request id', headers: { 'X-Request-Id': '{{$uuid}}' } },
];

export function isHttpMethod(value: string): value is HttpMethod {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(value);
}
