import type { ApiResponse, RequestSnapshot } from './types';

export type ApiErrorKind = 'network' | 'timeout' | 'aborted' | 'http' | 'parse' | 'invalid-request';

export interface ApiErrorOptions {
  request?: RequestSnapshot;
  response?: ApiResponse;
  cause?: unknown;
  hint?: string;
}

/** The single error type produced by the request engine. Branch on `kind`, not on the message. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly kind: ApiErrorKind;
  /** Redacted snapshot of the request, when it got far enough to be prepared. */
  readonly request?: RequestSnapshot;
  /** The response for `http` and `parse` errors. */
  readonly response?: ApiResponse;
  /** A human-readable suggestion for fixing the problem. */
  readonly hint?: string;
  override readonly cause?: unknown;

  constructor(kind: ApiErrorKind, message: string, options: ApiErrorOptions = {}) {
    super(message);
    this.kind = kind;
    this.request = options.request;
    this.response = options.response;
    this.hint = options.hint;
    this.cause = options.cause;
  }

  get status(): number | undefined {
    return this.response?.status;
  }

  /** A plain, serialisable summary (no response body, no credentials). */
  toJSON(): ApiErrorInfo {
    return { kind: this.kind, message: this.message, hint: this.hint, status: this.status };
  }
}

export interface ApiErrorInfo {
  kind: ApiErrorKind;
  message: string;
  hint?: string;
  status?: number;
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export const NETWORK_ERROR_HINT =
  'The server could not be reached, or the browser blocked the response because the server does not allow ' +
  'cross-origin requests (CORS). Browsers do not reveal which one happened; the devtools console shows the ' +
  'exact reason. CORS must be enabled on the server, or the request must go through a server-side proxy.';

/** Converts anything thrown by a transport or middleware into an {@link ApiError}. */
export function toApiError(error: unknown, request: RequestSnapshot | undefined, context: { timedOut: boolean; timeout: number }) {
  if (error instanceof ApiError) return error;
  if (context.timedOut) {
    return new ApiError('timeout', `Request timed out after ${formatTimeout(context.timeout)}`, {
      request,
      cause: error,
      hint: 'Increase the timeout in the request settings, or check that the server is responding.',
    });
  }
  if (isAbortError(error)) {
    return new ApiError('aborted', 'Request was cancelled', { request, cause: error });
  }
  if (error instanceof TypeError) {
    return new ApiError('network', 'Network request failed', { request, cause: error, hint: NETWORK_ERROR_HINT });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ApiError('network', message || 'Request failed', { request, cause: error });
}

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

function formatTimeout(ms: number) {
  return ms >= 1000 && ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
}
