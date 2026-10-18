import type { BodySource, PreparedRequest, RequestSnapshot } from './types';
import { isSensitiveHeader } from '../utils/headers';
import { encodeQueryComponent } from '../utils/encoding';

export const REDACTED = '••••••';

// Secret values are tracked out-of-band so they never appear on the request object itself (and so
// never in `JSON.stringify(request)` or a casual console.log).
const secretRegistry = new WeakMap<object, string[]>();

export function registerSecrets(request: PreparedRequest, secrets: Iterable<string>): void {
  const existing = secretRegistry.get(request) ?? [];
  const merged = new Set([...existing, ...secrets]);
  secretRegistry.set(
    request,
    [...merged].filter((s) => s.length >= 4).sort((a, b) => b.length - a.length),
  );
}

/** Returns the secrets registered for `request`, falling back to `from` for middleware-created copies. */
function secretsFor(request: PreparedRequest, from?: PreparedRequest): string[] {
  return secretRegistry.get(request) ?? (from ? secretRegistry.get(from) : undefined) ?? [];
}

/** Carries registered secrets over to a copy created by middleware. */
export function inheritSecrets(target: PreparedRequest, source: PreparedRequest): void {
  if (target !== source && !secretRegistry.has(target)) registerSecrets(target, secretsFor(source));
}

export function maskSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.split(secret).join(REDACTED);
    const encoded = encodeQueryComponent(secret);
    if (encoded !== secret) out = out.split(encoded).join(REDACTED);
  }
  return out;
}

export function redactHeaderValue(name: string, value: string, secrets: readonly string[] = []): string {
  if (isSensitiveHeader(name)) {
    const scheme = /^(Bearer|Basic|Digest|Token|Bot|ApiKey)\s+/i.exec(value);
    return scheme ? `${scheme[1]} ${REDACTED}` : value ? REDACTED : value;
  }
  return maskSecrets(value, secrets);
}

/** A display/log-safe copy of a prepared request: credentials and secret variable values are masked. */
export function snapshotRequest(request: PreparedRequest, origin?: PreparedRequest): RequestSnapshot {
  const secrets = secretsFor(request, origin);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) headers[name] = redactHeaderValue(name, value, secrets);
  return {
    method: request.method,
    url: maskSecrets(request.url, secrets),
    headers,
    bodySource: redactBodySource(request.bodySource, secrets),
    timeout: request.timeout,
    warnings: [...request.warnings],
    unresolvedVariables: [...request.unresolvedVariables],
  };
}

function redactBodySource(source: BodySource | null, secrets: readonly string[]): BodySource | null {
  if (!source || secrets.length === 0) return source;
  if (source.type === 'text') return { type: 'text', text: maskSecrets(source.text, secrets) };
  if (source.type === 'multipart') {
    return {
      type: 'multipart',
      parts: source.parts.map((part) => ('value' in part ? { name: part.name, value: maskSecrets(part.value, secrets) } : part)),
    };
  }
  return source;
}

/** A copy of the request with credentials masked, for "copy as cURL without secrets". */
export function redactPreparedRequest(request: PreparedRequest): PreparedRequest {
  const snapshot = snapshotRequest(request);
  return { ...request, url: snapshot.url, headers: snapshot.headers, bodySource: snapshot.bodySource };
}
