import type { HeadersInput } from '../core/types';

/** Case-insensitive lookup in a plain header record. */
export function getHeader(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) if (key.toLowerCase() === lower) return headers[key];
  return undefined;
}

export function hasHeader(headers: Readonly<Record<string, string>>, name: string): boolean {
  return getHeader(headers, name) !== undefined;
}

/** Sets a header, replacing any existing entry with a different casing. Mutates `headers`. */
export function setHeader(headers: Record<string, string>, name: string, value: string): void {
  deleteHeader(headers, name);
  headers[name] = value;
}

export function deleteHeader(headers: Record<string, string>, name: string): void {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) if (key.toLowerCase() === lower) delete headers[key];
}

export function headersToRecord(input: HeadersInput | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input) return out;
  if (typeof Headers !== 'undefined' && input instanceof Headers) {
    input.forEach((value, key) => setHeader(out, key, value));
  } else if (Array.isArray(input)) {
    for (const [key, value] of input as ReadonlyArray<readonly [string, string]>) appendHeader(out, key, value);
  } else {
    for (const [key, value] of Object.entries(input as Record<string, string | undefined>)) {
      if (value !== undefined) setHeader(out, key, value);
    }
  }
  return out;
}

/** Appends a value, combining duplicates with `, ` as the Fetch spec does. Mutates `headers`. */
export function appendHeader(headers: Record<string, string>, name: string, value: string): void {
  const lower = name.toLowerCase();
  const key = Object.keys(headers).find((k) => k.toLowerCase() === lower);
  if (key === undefined) headers[name] = value;
  else headers[key] = `${headers[key]}, ${value}`;
}

/**
 * Headers that browsers refuse to let scripts set (Fetch spec "forbidden request headers"). Fetch drops
 * them silently, so the workspace warns about them instead.
 */
const FORBIDDEN = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
]);

export function isForbiddenHeader(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return FORBIDDEN.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-');
}

const SENSITIVE = /(authorization|cookie|token|secret|password|passwd|api[-_]?key|session|credential)/i;

/** Header names whose values are masked in snapshots, history and logs. */
export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE.test(name);
}

export function isValidHeaderName(name: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name);
}
