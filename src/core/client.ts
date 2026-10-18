import type { ApiResponse, AuthConfig, AuthProfile, HeadersInput, PreparedRequest, RequestConfig, VariablesInput } from './types';
import { ApiError, toApiError } from './errors';
import { DEFAULT_TIMEOUT, prepareRequest } from './prepare';
import { inheritSecrets, snapshotRequest } from './redact';
import { parseResponse } from './response';
import { fetchTransport, type Transport } from './transport';
import { headersToRecord, setHeader } from '../utils/headers';

/**
 * Middleware wraps every request after it is prepared (variables resolved, auth applied). Call `next`
 * to continue; return or throw to short-circuit. Use it for logging, retries, token refresh or mocks.
 *
 * ```ts
 * const timing: Middleware = async (request, next) => {
 *   const response = await next({ ...request, headers: { ...request.headers, 'X-Trace': crypto.randomUUID() } });
 *   console.info(request.method, response.status, response.timing.duration);
 *   return response;
 * };
 * ```
 */
export type Middleware = (request: PreparedRequest, next: (request: PreparedRequest) => Promise<ApiResponse>) => Promise<ApiResponse>;

export interface ApiClientOptions {
  /** Prepended to relative request URLs. */
  baseUrl?: string;
  /** Headers sent with every request. Request headers win. */
  headers?: HeadersInput;
  /** Default auth for requests that do not set their own. */
  auth?: AuthConfig;
  authProfiles?: readonly AuthProfile[];
  /** Default timeout in milliseconds (30 s). `0` disables it. Applies to each transport attempt. */
  timeout?: number;
  transport?: Transport;
  middleware?: readonly Middleware[];
  /** Default `{{variables}}`. Request-level variables win. */
  variables?: VariablesInput;
  credentials?: RequestConfig['credentials'];
  /**
   * Which statuses resolve; others reject with an `http` {@link ApiError}. Defaults to 2xx. Pass `null`
   * to resolve every status, as the workspace does.
   */
  validateStatus?: ((status: number) => boolean) | null;
}

export interface SendOptions {
  signal?: AbortSignal;
  validateStatus?: ((status: number) => boolean) | null;
}

type BodylessConfig = Omit<RequestConfig, 'url' | 'method'>;
type BodyConfig = Omit<RequestConfig, 'url' | 'method' | 'body'>;

export interface ApiClientInstance {
  /** The options this client was created with. */
  readonly defaults: Readonly<ApiClientOptions>;
  /** Prepares and sends a request. Rejects with an {@link ApiError}. */
  request<T = unknown>(config: RequestConfig): Promise<ApiResponse<T>>;
  get<T = unknown>(url: string, config?: BodylessConfig): Promise<ApiResponse<T>>;
  delete<T = unknown>(url: string, config?: BodylessConfig): Promise<ApiResponse<T>>;
  head<T = unknown>(url: string, config?: BodylessConfig): Promise<ApiResponse<T>>;
  options<T = unknown>(url: string, config?: BodylessConfig): Promise<ApiResponse<T>>;
  post<T = unknown>(url: string, body?: unknown, config?: BodyConfig): Promise<ApiResponse<T>>;
  put<T = unknown>(url: string, body?: unknown, config?: BodyConfig): Promise<ApiResponse<T>>;
  patch<T = unknown>(url: string, body?: unknown, config?: BodyConfig): Promise<ApiResponse<T>>;
  /** Resolves a config into the exact request that would be sent (useful for previews and cURL). */
  prepare(config: RequestConfig): PreparedRequest;
  /** Sends an already prepared request through the middleware chain and transport. */
  send<T = unknown>(request: PreparedRequest, options?: SendOptions): Promise<ApiResponse<T>>;
  /** Adds middleware (runs after existing middleware). Returns a function that removes it. */
  use(middleware: Middleware): () => void;
  /** A new client with merged options and the same middleware. */
  extend(options: ApiClientOptions): ApiClientInstance;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const is2xx = (status: number) => status >= 200 && status < 300;

/**
 * Creates a programmatic, UI-independent HTTP client.
 *
 * ```ts
 * const api = createApiClient({ baseUrl: 'https://api.example.com', timeout: 10_000 });
 * const { data } = await api.get<User>('/users/1');
 * ```
 */
export function createApiClient(options: ApiClientOptions = {}): ApiClientInstance {
  const middleware: Middleware[] = [...(options.middleware ?? [])];
  const transport = options.transport ?? fetchTransport;

  const prepare = (config: RequestConfig) =>
    prepareRequest(config, {
      baseUrl: options.baseUrl,
      headers: options.headers,
      auth: options.auth,
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      variables: options.variables,
      authProfiles: options.authProfiles,
      credentials: options.credentials,
    });

  async function send<T>(prepared: PreparedRequest, sendOptions: SendOptions = {}): Promise<ApiResponse<T>> {
    const outer = sendOptions.signal;
    const snapshot = snapshotRequest(prepared);
    const state = { timedOut: false, timeout: prepared.timeout };
    if (outer?.aborted) throw new ApiError('aborted', 'Request was cancelled', { request: snapshot });

    const startTime = Date.now();
    const started = now();

    const terminal = async (request: PreparedRequest): Promise<ApiResponse> => {
      inheritSecrets(request, prepared);
      const requestSnapshot = request === prepared ? snapshot : snapshotRequest(request, prepared);
      const controller = new AbortController();
      const onAbort = () => controller.abort(outer?.reason);
      outer?.addEventListener('abort', onAbort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (request.timeout > 0) {
        timer = setTimeout(() => {
          state.timedOut = true;
          state.timeout = request.timeout;
          controller.abort(new DOMException('The request timed out.', 'TimeoutError'));
        }, request.timeout);
      }
      const attemptStart = now();
      try {
        const result = await transport.send(request, { signal: controller.signal });
        if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException('Aborted', 'AbortError');
        return parseResponse(result, request, requestSnapshot, {
          startTime,
          duration: now() - attemptStart,
          ttfb: result.timing?.ttfb,
          download: result.timing?.download,
        });
      } catch (error) {
        throw classify(error, requestSnapshot);
      } finally {
        if (timer) clearTimeout(timer);
        outer?.removeEventListener('abort', onAbort);
      }
    };

    const classify = (error: unknown, request = snapshot) => {
      if (error instanceof ApiError) return error;
      if (outer?.aborted && !state.timedOut) return new ApiError('aborted', 'Request was cancelled', { request, cause: error });
      return toApiError(error, request, state);
    };

    const chain = [...middleware];
    const dispatch =
      (index: number) =>
      (request: PreparedRequest): Promise<ApiResponse> => {
        if (index >= chain.length) return terminal(request);
        return chain[index](request, dispatch(index + 1));
      };

    let response: ApiResponse;
    try {
      response = await dispatch(0)(prepared);
    } catch (error) {
      throw classify(error);
    }
    response = { ...response, timing: { ...response.timing, startTime, duration: now() - started } };

    const validate =
      sendOptions.validateStatus !== undefined
        ? sendOptions.validateStatus
        : options.validateStatus !== undefined
          ? options.validateStatus
          : is2xx;
    if (validate && !validate(response.status)) {
      throw new ApiError('http', `Request failed with status ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`, {
        request: response.request,
        response,
      });
    }
    return response as ApiResponse<T>;
  }

  const client: ApiClientInstance = {
    defaults: options,
    prepare,
    send,
    async request<T>(config: RequestConfig) {
      return send<T>(prepare(config), { signal: config.signal, validateStatus: config.validateStatus });
    },
    get: (url, config) => client.request({ ...config, url, method: 'GET' }),
    delete: (url, config) => client.request({ ...config, url, method: 'DELETE' }),
    head: (url, config) => client.request({ ...config, url, method: 'HEAD' }),
    options: (url, config) => client.request({ ...config, url, method: 'OPTIONS' }),
    post: (url, body, config) => client.request({ ...config, url, body, method: 'POST' }),
    put: (url, body, config) => client.request({ ...config, url, body, method: 'PUT' }),
    patch: (url, body, config) => client.request({ ...config, url, body, method: 'PATCH' }),
    use(fn) {
      middleware.push(fn);
      return () => {
        const index = middleware.indexOf(fn);
        if (index !== -1) middleware.splice(index, 1);
      };
    },
    extend(extra) {
      return createApiClient({
        ...options,
        ...extra,
        headers: mergeHeaders(options.headers, extra.headers),
        middleware: [...middleware, ...(extra.middleware ?? [])],
      });
    },
  };
  return client;
}

function mergeHeaders(base: HeadersInput | undefined, extra: HeadersInput | undefined): Record<string, string> {
  const merged = headersToRecord(base);
  for (const [name, value] of Object.entries(headersToRecord(extra))) setHeader(merged, name, value);
  return merged;
}
