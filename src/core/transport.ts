import type { PreparedRequest } from './types';
import { isAbortError } from './errors';

/** What a transport hands back. The body is read completely. */
export interface TransportResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Final URL after redirects. */
  url: string;
  redirected: boolean;
  body: ArrayBuffer | null;
  /** Optional fine-grained timing in milliseconds. */
  timing?: { ttfb?: number; download?: number };
}

export interface TransportOptions {
  /** Aborted on cancellation and on timeout. Transports must honour it. */
  signal: AbortSignal;
}

/**
 * The pluggable network layer. The default uses `fetch`; supply your own to route requests through a
 * proxy, an Electron bridge, a service worker, or a mock in tests.
 */
export interface Transport {
  send(request: PreparedRequest, options: TransportOptions): Promise<TransportResponse>;
}

export interface FetchTransportOptions {
  /** Custom fetch implementation. Defaults to `globalThis.fetch`, looked up per request. */
  fetch?: typeof fetch;
  /** Extra `RequestInit` fields (for example `mode` or `cache`). */
  init?: Omit<RequestInit, 'method' | 'headers' | 'body' | 'signal'>;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createFetchTransport(options: FetchTransportOptions = {}): Transport {
  return {
    async send(request, { signal }) {
      const fetchImpl = options.fetch ?? globalThis.fetch;
      if (typeof fetchImpl !== 'function') throw new TypeError('fetch is not available in this environment. Provide a transport.');
      const start = now();
      const response = await fetchImpl(request.url, {
        ...options.init,
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal,
        credentials: request.credentials ?? options.init?.credentials,
        redirect: request.redirect ?? options.init?.redirect,
      });
      const headersAt = now();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const body = request.method === 'HEAD' || response.status === 204 || response.status === 304 ? null : await response.arrayBuffer();
      const end = now();
      const opaque = response.type === 'opaqueredirect';
      return {
        status: response.status,
        statusText: opaque ? 'Redirect (not followed)' : response.statusText,
        headers,
        url: response.url,
        redirected: response.redirected,
        body,
        timing: { ttfb: headersAt - start, download: end - headersAt },
      };
    },
  };
}

export const fetchTransport: Transport = createFetchTransport();

export interface MockResponseInit {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  /** Objects/arrays are JSON-encoded with a JSON Content-Type. */
  body?: string | ArrayBuffer | Uint8Array | object | null;
  /** Simulated latency in milliseconds. */
  delay?: number;
  url?: string;
}

/**
 * A transport that answers from a function, for tests, demos and prototyping. Honours cancellation and
 * timeouts like a real network call. Throw a `TypeError` from the handler to simulate a network failure.
 */
export function createMockTransport(handler: (request: PreparedRequest) => MockResponseInit | Promise<MockResponseInit>): Transport {
  return {
    async send(request, { signal }) {
      if (signal.aborted) throw abortError(signal);
      const init = await handler(request);
      if (init.delay) await wait(init.delay, signal);
      if (signal.aborted) throw abortError(signal);
      const headers: Record<string, string> = { ...init.headers };
      let body: ArrayBuffer | null = null;
      const raw = init.body;
      if (typeof raw === 'string') body = toArrayBuffer(new TextEncoder().encode(raw));
      else if (raw instanceof ArrayBuffer) body = raw;
      else if (raw instanceof Uint8Array) body = toArrayBuffer(raw);
      else if (raw !== undefined && raw !== null) {
        body = toArrayBuffer(new TextEncoder().encode(JSON.stringify(raw)));
        if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
      }
      return {
        status: init.status ?? 200,
        statusText: init.statusText ?? '',
        headers,
        url: init.url ?? request.url,
        redirected: false,
        body,
      };
    },
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function abortError(signal: AbortSignal): unknown {
  const reason = signal.reason;
  if (reason !== undefined && (isAbortError(reason) || reason instanceof Error)) return reason;
  return new DOMException('The operation was aborted.', 'AbortError');
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
