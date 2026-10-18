import type { KeyValueEntry } from './types';
import { createId } from '../utils/id';
import { encodeQueryComponent } from '../utils/encoding';
import { findVariableReferences } from '../env/variables';

export interface UrlParts {
  base: string;
  query: string;
  hash: string;
}

/** Splits a raw URL into the part before `?`, the query string (without `?`) and the fragment. */
export function splitUrl(raw: string): UrlParts {
  let rest = raw;
  let hash = '';
  const hashIndex = rest.indexOf('#');
  if (hashIndex !== -1) {
    hash = rest.slice(hashIndex + 1);
    rest = rest.slice(0, hashIndex);
  }
  const queryIndex = rest.indexOf('?');
  if (queryIndex === -1) return { base: rest, query: '', hash };
  return { base: rest.slice(0, queryIndex), query: rest.slice(queryIndex + 1), hash };
}

/** Parses a query string into raw (still encoded) key/value pairs. */
export function parseQueryString(query: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const segment of query.replace(/^\?/, '').split('&')) {
    if (!segment) continue;
    const eq = segment.indexOf('=');
    out.push(eq === -1 ? [segment, ''] : [segment.slice(0, eq), segment.slice(eq + 1)]);
  }
  return out;
}

/**
 * Appends query pairs to a URL. `strict` percent-encodes everything outside the unreserved set (use it
 * for programmatic values). `lenient` keeps characters that are legal in a query and leaves existing
 * `%XX` escapes alone, so raw text typed into the workspace is sent the way it reads.
 */
export function appendQuery(url: string, pairs: ReadonlyArray<readonly [string, string]>, mode: 'strict' | 'lenient' = 'strict'): string {
  if (pairs.length === 0) return url;
  const encode = mode === 'strict' ? encodeURIComponent : encodeLenient;
  const query = pairs.map(([k, v]) => (v === '' && mode === 'lenient' ? encode(k) : `${encode(k)}=${encode(v)}`)).join('&');
  const { base, query: existing, hash } = splitUrl(url);
  return `${base}?${existing ? `${existing}&` : ''}${query}${hash ? `#${hash}` : ''}`;
}

function encodeLenient(value: string): string {
  return encodeQueryComponent(value).replace(/%(2C|3A|40|2F|3F|21|24|27|28|29|2A|2B|3B)/gi, (m) => decodeURIComponent(m));
}

export function isAbsoluteUrl(url: string): boolean {
  return /^[a-z][a-z\d+\-.]*:\/\//i.test(url);
}

export function joinUrl(base: string, path: string): string {
  if (!base) return path;
  if (!path) return base;
  if (isAbsoluteUrl(path)) return path;
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/**
 * Adds a scheme to scheme-less input such as `api.example.com/users` (https) or `localhost:3000`
 * (http). Relative paths starting with `/` are left alone.
 */
export function withDefaultScheme(url: string): string {
  const trimmed = url.trim();
  if (!trimmed || isAbsoluteUrl(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('{{')) return trimmed;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(trimmed)) return `http://${trimmed}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|\?|$)/.test(trimmed) || /^[\w-]+:\d+(\/|$)/.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export interface UrlValidation {
  valid: boolean;
  error?: string;
}

/**
 * Validates a final URL: it must parse, use http(s), and contain no unresolved variables. Relative
 * URLs are accepted when `allowRelative` is set and a browser location is available.
 */
export function validateUrl(url: string, options: { allowRelative?: boolean } = {}): UrlValidation {
  const trimmed = url.trim();
  if (!trimmed) return { valid: false, error: 'Enter a request URL.' };
  const unresolved = findVariableReferences(trimmed);
  if (unresolved.length) {
    return {
      valid: false,
      error: `Unresolved variable${unresolved.length > 1 ? 's' : ''}: ${unresolved.map((v) => `{{${v}}}`).join(', ')}`,
    };
  }
  if (/\s/.test(trimmed.split('?')[0])) return { valid: false, error: 'The URL contains spaces. Encode them as %20.' };
  let parsed: URL;
  try {
    const location = typeof window !== 'undefined' ? window.location?.href : undefined;
    parsed = options.allowRelative && location && !isAbsoluteUrl(trimmed) ? new URL(trimmed, location) : new URL(trimmed);
  } catch {
    return {
      valid: false,
      error: isAbsoluteUrl(trimmed) ? 'The URL is not valid.' : 'Enter an absolute URL, such as https://api.example.com.',
    };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: `Unsupported protocol "${parsed.protocol}". Only http and https are allowed.` };
  }
  if (!parsed.hostname) return { valid: false, error: 'The URL has no host.' };
  return { valid: true };
}

// ---------------------------------------------------------------------------------------------------
// Two-way sync between the URL input and the params table
// ---------------------------------------------------------------------------------------------------

/**
 * Re-derives the params table after the user edited the URL text. Enabled rows are replaced by the
 * URL's query (keeping their ids and descriptions by position); disabled rows stay where they are.
 */
export function syncParamsFromUrl(url: string, params: readonly KeyValueEntry[]): KeyValueEntry[] {
  const parsed = parseQueryString(splitUrl(url).query);
  const out: KeyValueEntry[] = [];
  let i = 0;
  for (const param of params) {
    if (!param.enabled) {
      out.push(param);
      continue;
    }
    if (!param.key && !param.value) continue; // blank placeholder rows
    const next = parsed[i++];
    if (next) out.push({ ...param, key: next[0], value: next[1] });
  }
  for (; i < parsed.length; i++) out.push({ id: createId('param'), key: parsed[i][0], value: parsed[i][1], enabled: true });
  return out;
}

/** Rebuilds the URL text from the params table (raw, unencoded), keeping the base and fragment. */
export function syncUrlFromParams(url: string, params: readonly KeyValueEntry[]): string {
  const { base, hash } = splitUrl(url);
  const query = params
    .filter((p) => p.enabled && p.key !== '')
    .map((p) => (p.value === '' ? p.key : `${p.key}=${p.value}`))
    .join('&');
  return `${base}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`;
}
