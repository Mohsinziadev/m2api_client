import type {
  AuthConfig,
  AuthProfile,
  Environment,
  KeyValueEntry,
  RequestBodyDefinition,
  RequestDefinition,
  Variable,
} from '../core/types';
import type { Collection, CollectionNode } from '../collections/collections';
import { isSensitiveHeader } from '../utils/headers';

export interface SanitizeOptions {
  /**
   * Keep literal credentials and secret variable values. Off by default: only `{{variable}}`
   * references survive, so tokens typed into the UI never reach storage or export files.
   */
  includeSecrets?: boolean;
}

const SENSITIVE_PARAM = /(token|secret|password|passwd|api[-_]?key|apikey|signature|auth|session|credential)/i;

/** True when a value holds credential material, i.e. anything beyond `{{variables}}` and an auth scheme. */
export function containsLiteralSecret(value: string): boolean {
  const remainder = value
    .replace(/\{\{\s*[^{}]+?\s*\}\}/g, '')
    .trim()
    .replace(/^(Bearer|Basic|Token|Digest|Bot|ApiKey)\b\s*/i, '');
  return remainder.length > 0;
}

const scrub = (value: string) => (containsLiteralSecret(value) ? '' : value);

function sanitizeEntries(entries: KeyValueEntry[], isSensitive: (key: string) => boolean): KeyValueEntry[] {
  return entries.map((e) => (isSensitive(e.key) && containsLiteralSecret(e.value) ? { ...e, value: '' } : e));
}

export function sanitizeAuth<A extends AuthConfig>(auth: A, options: SanitizeOptions = {}): A {
  if (options.includeSecrets) return auth;
  switch (auth.type) {
    case 'bearer':
      return { ...auth, token: scrub(auth.token) };
    case 'oauth2':
      return { ...auth, accessToken: scrub(auth.accessToken) };
    case 'basic':
      return { ...auth, password: scrub(auth.password) };
    case 'apiKey':
      return { ...auth, value: scrub(auth.value) };
    case 'custom':
      return { ...auth, headers: auth.headers.map((h) => ({ ...h, value: scrub(h.value) })) };
    default:
      return auth;
  }
}

function sanitizeBody(body: RequestBodyDefinition): RequestBodyDefinition {
  // Files only live in memory; drop them so the definition stays serialisable.
  if (body.type === 'multipart') return { ...body, fields: body.fields.map(({ file: _file, ...field }) => field) };
  return body;
}

export function sanitizeRequest<R extends RequestDefinition>(request: R, options: SanitizeOptions = {}): R {
  const body = sanitizeBody(request.body);
  if (options.includeSecrets) return { ...request, body };
  return {
    ...request,
    params: sanitizeEntries(request.params, (k) => SENSITIVE_PARAM.test(k)),
    headers: sanitizeEntries(request.headers, isSensitiveHeader),
    url: request.url.replace(
      /([?&][^=&#]*(?:token|secret|password|api[-_]?key|apikey|signature|auth|session)[^=&#]*=)([^&#]*)/gi,
      (m, prefix: string, value: string) => (containsLiteralSecret(decodeSafe(value)) ? prefix : m),
    ),
    auth: sanitizeAuth(request.auth, options),
    body,
  };
}

function decodeSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function sanitizeVariables(variables: Variable[], options: SanitizeOptions = {}): Variable[] {
  if (options.includeSecrets) return variables;
  return variables.map((v) => (v.secret ? { ...v, value: '' } : v));
}

export function sanitizeEnvironment(environment: Environment, options: SanitizeOptions = {}): Environment {
  return { ...environment, variables: sanitizeVariables(environment.variables, options) };
}

export function sanitizeAuthProfile(profile: AuthProfile, options: SanitizeOptions = {}): AuthProfile {
  return { ...profile, auth: sanitizeAuth(profile.auth, options) };
}

function sanitizeNode(node: CollectionNode, options: SanitizeOptions): CollectionNode {
  if (node.type === 'folder') return { ...node, items: node.items.map((n) => sanitizeNode(n, options)) };
  return sanitizeRequest(node, options);
}

export function sanitizeCollection(collection: Collection, options: SanitizeOptions = {}): Collection {
  return {
    ...collection,
    variables: sanitizeVariables(collection.variables, options),
    items: collection.items.map((n) => sanitizeNode(n, options)),
  };
}
