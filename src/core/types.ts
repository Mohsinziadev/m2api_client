// Shared domain types. Everything here is plain, serialisable data unless noted otherwise, so it can be
// stored, exported and diffed without the UI.

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** A row in a key/value table (query params, headers, form fields). */
export interface KeyValueEntry {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
}

/** A multipart field. `file` holds an in-memory File/Blob and is never persisted or exported. */
export interface MultipartField extends KeyValueEntry {
  kind: 'text' | 'file';
  file?: Blob | null;
  fileName?: string;
}

export type RequestBodyDefinition =
  | { type: 'none' }
  | { type: 'json'; content: string }
  | { type: 'text'; content: string; contentType?: string }
  | { type: 'urlencoded'; fields: KeyValueEntry[] }
  | { type: 'multipart'; fields: MultipartField[] };

export type RequestBodyType = RequestBodyDefinition['type'];

// ---------------------------------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------------------------------

export interface NoAuth {
  type: 'none';
}
export interface BearerAuth {
  type: 'bearer';
  token: string;
  /** Header prefix, `Bearer` by default. */
  prefix?: string;
}
export interface BasicAuth {
  type: 'basic';
  username: string;
  password: string;
}
export interface ApiKeyAuth {
  type: 'apiKey';
  key: string;
  value: string;
  /** Where to send the key. Header is strongly preferred: query strings leak into logs and history. */
  in: 'header' | 'query';
}
/**
 * OAuth 2.0 integration point. m2api-client does not run OAuth flows itself: obtain the access token
 * with your identity provider's SDK (or a backend) and supply it here or via `ApiClient`'s
 * `oauth2.getAccessToken`. Never embed client secrets in frontend code.
 */
export interface OAuth2Auth {
  type: 'oauth2';
  accessToken: string;
  /** Header prefix, `Bearer` by default. */
  headerPrefix?: string;
  /** Informational metadata passed to your token provider. */
  authorizationUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  scope?: string;
}
export interface CustomAuth {
  type: 'custom';
  headers: KeyValueEntry[];
}
/** Reference to a reusable {@link AuthProfile}. */
export interface ProfileAuth {
  type: 'profile';
  profileId: string;
}

export type AuthConfig = NoAuth | BearerAuth | BasicAuth | ApiKeyAuth | OAuth2Auth | CustomAuth | ProfileAuth;
export type AuthType = AuthConfig['type'];

export interface AuthProfile {
  id: string;
  name: string;
  auth: Exclude<AuthConfig, ProfileAuth>;
}

// ---------------------------------------------------------------------------------------------------
// Variables and environments
// ---------------------------------------------------------------------------------------------------

export interface Variable {
  id?: string;
  key: string;
  value: string;
  enabled?: boolean;
  /** Secret values are masked in the UI, redacted from request snapshots and not persisted by default. */
  secret?: boolean;
  description?: string;
}

/** Either a simple map or a list of {@link Variable}s (which can carry `secret` / `enabled` flags). */
export type VariablesInput = Readonly<Record<string, string>> | readonly Variable[];

export interface Environment {
  id: string;
  name: string;
  variables: Variable[];
}

// ---------------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------------

export interface RequestSettings {
  /** Milliseconds. `0` disables the timeout. Defaults to the client timeout (30 s). */
  timeout?: number;
  redirect?: 'follow' | 'manual' | 'error';
  credentials?: 'omit' | 'same-origin' | 'include';
}

/**
 * The editable, serialisable description of a request used by the workspace, collections and history.
 * `url` holds the raw text the user typed (it may contain a query string and `{{variables}}`); the
 * enabled `params` are the source of truth for the final query string.
 */
export interface RequestDefinition {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValueEntry[];
  headers: KeyValueEntry[];
  body: RequestBodyDefinition;
  auth: AuthConfig;
  settings: RequestSettings;
  description?: string;
}

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParamsInput =
  Readonly<Record<string, QueryValue | readonly QueryValue[]>> | ReadonlyArray<readonly [string, string]> | URLSearchParams;
export type HeadersInput = Readonly<Record<string, string | undefined>> | ReadonlyArray<readonly [string, string]> | Headers;

export type ResponseType = 'auto' | 'json' | 'text' | 'blob' | 'arrayBuffer';

/** Programmatic request configuration accepted by `createApiClient().request()` and `useApiRequest()`. */
export interface RequestConfig {
  url: string;
  method?: HttpMethod | Lowercase<HttpMethod>;
  /** Prepended to relative URLs. */
  baseUrl?: string;
  params?: QueryParamsInput;
  headers?: HeadersInput;
  /**
   * Request body. Strings, `FormData`, `URLSearchParams`, `Blob` and binary buffers are sent as-is;
   * plain objects and arrays are serialised as JSON (with `Content-Type: application/json`).
   */
  body?: unknown;
  /** Explicit JSON body. Takes precedence over `body`. */
  json?: unknown;
  auth?: AuthConfig;
  /** Milliseconds. `0` disables the timeout. */
  timeout?: number;
  signal?: AbortSignal;
  responseType?: ResponseType;
  /** Values for `{{variables}}` in the URL, params, headers, string bodies and auth fields. */
  variables?: VariablesInput;
  credentials?: RequestSettings['credentials'];
  redirect?: RequestSettings['redirect'];
  /** Decides which statuses resolve. Overrides the client's `validateStatus`. */
  validateStatus?: ((status: number) => boolean) | null;
  /** Free-form data for middleware. */
  meta?: Record<string, unknown>;
}

/** A description of the request body suitable for display and cURL export. */
export type BodySource =
  | { type: 'text'; text: string }
  | { type: 'multipart'; parts: Array<{ name: string; value: string } | { name: string; fileName: string }> }
  | { type: 'binary'; size: number | null };

/**
 * A fully resolved request, ready for a transport: variables are interpolated, auth is applied and the
 * body is serialised. Middleware receives and may replace this object.
 */
export interface PreparedRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body: BodyInit | null;
  bodySource: BodySource | null;
  timeout: number;
  responseType: ResponseType;
  credentials?: RequestSettings['credentials'];
  redirect?: RequestSettings['redirect'];
  /** Variable names that had no value (left as literal `{{name}}`). */
  unresolvedVariables: string[];
  /** Non-fatal problems found while preparing (dropped bodies, forbidden headers...). */
  warnings: string[];
  meta: Record<string, unknown>;
}

/** A copy of a {@link PreparedRequest} with credentials masked, safe to display or log. */
export interface RequestSnapshot {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  bodySource: BodySource | null;
  timeout: number;
  warnings: string[];
  unresolvedVariables: string[];
}

// ---------------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------------

export type ResponseBodyKind = 'json' | 'text' | 'binary' | 'empty';

export interface ResponseTiming {
  /** Epoch milliseconds when the request was handed to the transport. */
  startTime: number;
  /** Total time in milliseconds, including middleware. */
  duration: number;
  /** Time until response headers arrived, when the transport reports it. */
  ttfb?: number;
  /** Time spent downloading the body, when the transport reports it. */
  download?: number;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  redirected: boolean;
  /** Lower-cased header names. Browsers hide non-safelisted headers on cross-origin responses. */
  headers: Record<string, string>;
  /** Parsed body: JSON value, string, `Blob` or `ArrayBuffer` depending on `responseType`. */
  data: T;
  /** Decoded text for textual bodies, `null` for binary or empty ones. */
  text: string | null;
  bodyKind: ResponseBodyKind;
  contentType: string | null;
  /** Body size in bytes. */
  size: number;
  raw: ArrayBuffer | null;
  timing: ResponseTiming;
  /** Redacted snapshot of the request that produced this response. */
  request: RequestSnapshot;
  /** Set when the server declared JSON but the body could not be parsed. */
  parseError?: string;
}
