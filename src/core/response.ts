import type { ApiResponse, PreparedRequest, RequestSnapshot, ResponseBodyKind, ResponseTiming } from './types';
import type { TransportResponse } from './transport';
import { ApiError } from './errors';
import { STATUS_TEXT } from '../utils/format';

const JSON_TYPE = /^application\/(.+\+)?json|^text\/json/i;
const TEXT_TYPE =
  /^text\/|^application\/(.+\+)?(xml|javascript|ecmascript|x-www-form-urlencoded|graphql|yaml|x-yaml|x-ndjson|ld\+json|problem\+json|sql|csv)/i;

export function isJsonContentType(contentType: string | null | undefined): boolean {
  return Boolean(contentType && JSON_TYPE.test(contentType.trim()));
}

export function isTextContentType(contentType: string | null | undefined): boolean {
  return Boolean(contentType && (TEXT_TYPE.test(contentType.trim()) || isJsonContentType(contentType)));
}

function charsetOf(contentType: string | null): string {
  const match = contentType && /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType);
  return match ? match[1] : 'utf-8';
}

function decode(buffer: ArrayBuffer, charset: string, fatal = false): string | null {
  try {
    return new TextDecoder(charset, { fatal }).decode(buffer);
  } catch {
    if (charset.toLowerCase() !== 'utf-8') return decode(buffer, 'utf-8', fatal);
    return null;
  }
}

/** Classifies and decodes a body. Without a Content-Type, valid UTF-8 without NUL bytes counts as text. */
export function classifyBody(raw: ArrayBuffer | null, contentType: string | null): { kind: ResponseBodyKind; text: string | null } {
  if (!raw || raw.byteLength === 0) return { kind: 'empty', text: null };
  if (isJsonContentType(contentType)) return { kind: 'json', text: decode(raw, charsetOf(contentType)) ?? '' };
  if (isTextContentType(contentType)) return { kind: 'text', text: decode(raw, charsetOf(contentType)) ?? '' };
  if (contentType && !/^application\/octet-stream/i.test(contentType)) return { kind: 'binary', text: null };
  const sniff = decode(raw, 'utf-8', true);
  if (sniff === null || sniff.includes('\u0000')) return { kind: 'binary', text: null };
  const trimmed = sniff.trimStart();
  if (/^[[{]/.test(trimmed)) {
    try {
      JSON.parse(sniff);
      return { kind: 'json', text: sniff };
    } catch {
      /* fall through: plain text that happens to start with a brace */
    }
  }
  return { kind: 'text', text: sniff };
}

/** Builds an {@link ApiResponse} from a transport result according to the request's `responseType`. */
export function parseResponse<T>(
  result: TransportResponse,
  request: PreparedRequest,
  snapshot: RequestSnapshot,
  timing: ResponseTiming,
): ApiResponse<T> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(result.headers)) headers[name.toLowerCase()] = value;
  const contentType = headers['content-type'] ?? null;
  const raw = request.method === 'HEAD' ? null : result.body;
  const { kind, text } = classifyBody(raw, contentType);

  const response: ApiResponse<unknown> = {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    statusText: result.statusText || STATUS_TEXT[result.status] || '',
    url: result.url || request.url,
    redirected: result.redirected,
    headers,
    data: undefined,
    text,
    bodyKind: kind,
    contentType,
    size: raw?.byteLength ?? 0,
    raw,
    timing,
    request: snapshot,
  };

  switch (request.responseType) {
    case 'arrayBuffer':
      response.data = raw ?? new ArrayBuffer(0);
      break;
    case 'blob':
      response.data = new Blob(raw ? [raw] : [], contentType ? { type: contentType } : undefined);
      break;
    case 'text':
      response.data = text ?? (raw ? decode(raw, charsetOf(contentType)) : '') ?? '';
      break;
    case 'json': {
      const source = text ?? (raw ? decode(raw, charsetOf(contentType)) : '') ?? '';
      if (!source.trim()) {
        response.data = undefined;
        break;
      }
      try {
        response.data = JSON.parse(source);
      } catch (error) {
        throw new ApiError('parse', 'The response is not valid JSON', {
          request: snapshot,
          response,
          cause: error,
          hint: `Content-Type was ${contentType ?? 'not set'}. Use responseType "text" to read the raw body.`,
        });
      }
      break;
    }
    case 'auto':
      if (kind === 'json') {
        try {
          response.data = JSON.parse(text ?? '');
        } catch (error) {
          response.data = text;
          response.parseError = error instanceof Error ? error.message : 'Invalid JSON';
        }
      } else if (kind === 'text') {
        response.data = text;
      } else if (kind === 'binary' && raw) {
        response.data = new Blob([raw], contentType ? { type: contentType } : undefined);
      }
      break;
  }
  return response as ApiResponse<T>;
}
