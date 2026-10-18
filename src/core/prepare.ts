import type {
  AuthConfig,
  AuthProfile,
  BodySource,
  HeadersInput,
  HttpMethod,
  PreparedRequest,
  QueryParamsInput,
  RequestConfig,
  RequestDefinition,
  VariablesInput,
} from './types';
import { HTTP_METHODS } from './types';
import { ApiError } from './errors';
import { appendQuery, isAbsoluteUrl, joinUrl, splitUrl, validateUrl, withDefaultScheme } from './url';
import { registerSecrets, snapshotRequest } from './redact';
import { applyAuth } from '../auth/apply';
import { VariableResolver, toResolver, type VariableScopes } from '../env/variables';
import { getHeader, hasHeader, headersToRecord, isForbiddenHeader, isValidHeaderName, setHeader, deleteHeader } from '../utils/headers';

export const DEFAULT_TIMEOUT = 30_000;

export interface PrepareContext {
  baseUrl?: string;
  headers?: HeadersInput;
  auth?: AuthConfig;
  timeout?: number;
  /** Lower-precedence variables (for example the client's). Request variables override them. */
  variables?: VariablesInput;
  authProfiles?: readonly AuthProfile[];
  credentials?: RequestConfig['credentials'];
}

/** Collects unresolved names and used secrets while interpolating. */
class Tracker {
  readonly unresolved = new Set<string>();
  readonly secrets = new Set<string>();
  readonly warnings: string[] = [];
  constructor(readonly resolver: VariableResolver) {}
  resolve = (value: string): string => {
    if (!value.includes('{{')) return value;
    const result = this.resolver.interpolate(value);
    result.unresolved.forEach((v) => this.unresolved.add(v));
    result.secretsUsed.forEach((v) => this.secrets.add(v));
    return result.value;
  };
  warn(message: string) {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }
}

function normalizeMethod(method: string | undefined): HttpMethod {
  const upper = (method ?? 'GET').toUpperCase();
  if (!(HTTP_METHODS as readonly string[]).includes(upper)) {
    throw new ApiError('invalid-request', `Unsupported HTTP method "${method}".`);
  }
  return upper as HttpMethod;
}

function queryPairs(params: QueryParamsInput | undefined, resolve: (v: string) => string): Array<[string, string]> {
  if (!params) return [];
  if (typeof URLSearchParams !== 'undefined' && params instanceof URLSearchParams) return [...params.entries()];
  if (Array.isArray(params)) return (params as ReadonlyArray<readonly [string, string]>).map(([k, v]) => [resolve(k), resolve(v)]);
  const out: Array<[string, string]> = [];
  for (const [key, raw] of Object.entries(params as Record<string, unknown>)) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (value === undefined || value === null) continue;
      out.push([key, resolve(String(value))]);
    }
  }
  return out;
}

function isJsonSerialisable(body: unknown): boolean {
  if (typeof body === 'number' || typeof body === 'boolean') return true;
  if (typeof body !== 'object' || body === null) return false;
  if (Array.isArray(body)) return true;
  const proto = Object.getPrototypeOf(body);
  return proto === Object.prototype || proto === null;
}

function describeFormData(form: FormData): BodySource {
  const parts: Array<{ name: string; value: string } | { name: string; fileName: string }> = [];
  form.forEach((value, name) => {
    if (typeof value === 'string') parts.push({ name, value });
    else parts.push({ name, fileName: (value as File).name || 'blob' });
  });
  return { type: 'multipart', parts };
}

function finalize(
  base: Omit<PreparedRequest, 'unresolvedVariables' | 'warnings'>,
  tracker: Tracker,
  extraSecrets: string[],
): PreparedRequest {
  const request: PreparedRequest = {
    ...base,
    unresolvedVariables: [...tracker.unresolved],
    warnings: tracker.warnings,
  };
  if ((request.method === 'GET' || request.method === 'HEAD') && request.body !== null) {
    request.body = null;
    request.bodySource = null;
    tracker.warn(`${request.method} requests cannot have a body in browsers; the body was not sent.`);
  }
  for (const [name, value] of Object.entries(request.headers)) {
    if (!isValidHeaderName(name)) {
      throw new ApiError('invalid-request', `"${name}" is not a valid header name.`, { request: snapshotRequest(request) });
    }
    if (/[\r\n]/.test(value)) {
      throw new ApiError('invalid-request', `The value of header "${name}" contains a line break.`, { request: snapshotRequest(request) });
    }
    if (isForbiddenHeader(name)) tracker.warn(`Browsers do not allow scripts to set the "${name}" header; it will be dropped.`);
  }
  registerSecrets(request, [...tracker.secrets, ...tracker.resolver.secretValues(), ...extraSecrets]);
  const validation = validateUrl(request.url, { allowRelative: true });
  if (!validation.valid) {
    throw new ApiError('invalid-request', validation.error ?? 'Invalid URL', { request: snapshotRequest(request) });
  }
  return request;
}

/**
 * Prepares a programmatic {@link RequestConfig}: interpolates variables, joins the base URL, applies
 * auth and serialises the body. Throws an `invalid-request` {@link ApiError} for unusable input.
 */
export function prepareRequest(config: RequestConfig, context: PrepareContext = {}): PreparedRequest {
  const method = normalizeMethod(config.method);
  const tracker = new Tracker(new VariableResolver({ request: config.variables, global: context.variables }));
  const r = tracker.resolve;

  let url = r(config.url.trim());
  const baseUrl = config.baseUrl ?? context.baseUrl;
  if (baseUrl && !isAbsoluteUrl(url)) url = joinUrl(r(baseUrl), url);

  const headers = headersToRecord(context.headers);
  const auth = applyAuth(config.auth ?? context.auth, { resolve: r, profiles: context.authProfiles });
  auth.warnings.forEach((w) => tracker.warn(w));
  for (const [name, value] of auth.headers) setHeader(headers, name, value);
  for (const [name, value] of Object.entries(headersToRecord(config.headers))) setHeader(headers, r(name), r(value));

  let body: BodyInit | null = null;
  let bodySource: BodySource | null = null;
  const payload = config.json !== undefined ? config.json : config.body;
  if (config.json !== undefined || (payload !== undefined && payload !== null && isJsonSerialisable(payload))) {
    const text = JSON.stringify(payload);
    body = text;
    bodySource = { type: 'text', text };
    if (!hasHeader(headers, 'content-type')) setHeader(headers, 'Content-Type', 'application/json');
  } else if (typeof payload === 'string') {
    const text = r(payload);
    body = text;
    bodySource = { type: 'text', text };
  } else if (typeof URLSearchParams !== 'undefined' && payload instanceof URLSearchParams) {
    body = payload;
    bodySource = { type: 'text', text: payload.toString() };
    if (!hasHeader(headers, 'content-type')) setHeader(headers, 'Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8');
  } else if (typeof FormData !== 'undefined' && payload instanceof FormData) {
    body = payload;
    bodySource = describeFormData(payload);
  } else if (payload !== undefined && payload !== null) {
    body = payload as BodyInit;
    const size =
      payload instanceof Blob ? payload.size : payload instanceof ArrayBuffer || ArrayBuffer.isView(payload) ? payload.byteLength : null;
    bodySource = { type: 'binary', size };
  }

  url = appendQuery(url, [...queryPairs(config.params, r), ...auth.query], 'strict');

  return finalize(
    {
      method,
      url,
      headers,
      body,
      bodySource,
      timeout: config.timeout ?? context.timeout ?? DEFAULT_TIMEOUT,
      responseType: config.responseType ?? 'auto',
      credentials: config.credentials ?? context.credentials,
      redirect: config.redirect,
      meta: { ...config.meta },
    },
    tracker,
    auth.secrets,
  );
}

export interface PrepareDefinitionContext {
  /** Values for `{{variables}}`: a map or list, scopes (`{ environment, collection, ... }`) or a resolver. */
  variables?: VariablesInput | VariableScopes | VariableResolver;
  authProfiles?: readonly AuthProfile[];
  /** Used for URLs that are relative after interpolation. */
  baseUrl?: string;
  /** Headers added to every request; the request's own headers win. */
  headers?: HeadersInput;
  timeout?: number;
}

/** Prepares a workspace {@link RequestDefinition} (key/value tables, body editor state, auth tab). */
export function prepareDefinition(definition: RequestDefinition, context: PrepareDefinitionContext = {}): PreparedRequest {
  const method = normalizeMethod(definition.method);
  const tracker = new Tracker(toResolver(context.variables));
  const r = tracker.resolve;

  let url = r(splitUrl(definition.url.trim()).base);
  url = context.baseUrl && !isAbsoluteUrl(url) ? joinUrl(r(context.baseUrl), url) : withDefaultScheme(url);

  const query: Array<[string, string]> = definition.params.filter((p) => p.enabled && p.key.trim()).map((p) => [r(p.key), r(p.value)]);

  const headers = headersToRecord(context.headers);
  const auth = applyAuth(definition.auth, { resolve: r, profiles: context.authProfiles });
  auth.warnings.forEach((w) => tracker.warn(w));
  for (const [name, value] of auth.headers) setHeader(headers, name, value);
  for (const entry of definition.headers) {
    if (!entry.enabled || !entry.key.trim()) continue;
    const name = r(entry.key).trim();
    if (auth.headers.some(([n]) => n.toLowerCase() === name.toLowerCase())) {
      tracker.warn(`The "${name}" header overrides the value generated by the Authorization tab.`);
    }
    setHeader(headers, name, r(entry.value));
  }

  let body: BodyInit | null = null;
  let bodySource: BodySource | null = null;
  const def = definition.body;
  switch (def.type) {
    case 'none':
      break;
    case 'json': {
      const text = r(def.content);
      if (text.trim()) {
        body = text;
        bodySource = { type: 'text', text };
        if (!hasHeader(headers, 'content-type')) setHeader(headers, 'Content-Type', 'application/json');
        try {
          JSON.parse(text);
        } catch {
          tracker.warn('The JSON body is not valid JSON; it is sent as written.');
        }
      }
      break;
    }
    case 'text': {
      const text = r(def.content);
      body = text;
      bodySource = { type: 'text', text };
      if (!hasHeader(headers, 'content-type')) setHeader(headers, 'Content-Type', def.contentType || 'text/plain;charset=UTF-8');
      break;
    }
    case 'urlencoded': {
      const params = new URLSearchParams();
      for (const field of def.fields) if (field.enabled && field.key.trim()) params.append(r(field.key), r(field.value));
      const text = params.toString();
      body = text;
      bodySource = { type: 'text', text };
      if (!hasHeader(headers, 'content-type')) setHeader(headers, 'Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8');
      break;
    }
    case 'multipart': {
      const form = new FormData();
      for (const field of def.fields) {
        if (!field.enabled || !field.key.trim()) continue;
        if (field.kind === 'file') {
          if (field.file) form.append(r(field.key), field.file, field.fileName || (field.file as File).name || 'file');
          else tracker.warn(`No file selected for form field "${field.key}".`);
        } else {
          form.append(r(field.key), r(field.value));
        }
      }
      body = form;
      bodySource = describeFormData(form);
      const contentType = getHeader(headers, 'content-type');
      if (contentType && /multipart\/form-data/i.test(contentType)) {
        deleteHeader(headers, 'content-type');
        tracker.warn('The manual multipart Content-Type header was removed so the browser can add the boundary.');
      }
      break;
    }
  }

  url = appendQuery(url, [...query, ...auth.query], 'lenient');

  return finalize(
    {
      method,
      url,
      headers,
      body,
      bodySource,
      timeout: definition.settings.timeout ?? context.timeout ?? DEFAULT_TIMEOUT,
      responseType: 'auto',
      credentials: definition.settings.credentials,
      redirect: definition.settings.redirect,
      meta: { requestId: definition.id },
    },
    tracker,
    auth.secrets,
  );
}
