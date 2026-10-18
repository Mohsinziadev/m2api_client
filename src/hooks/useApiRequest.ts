'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiResponse, RequestConfig } from '../core/types';
import { ApiError } from '../core/errors';
import { createApiClient, type ApiClientInstance } from '../core/client';
import { useOptionalWorkspace } from '../ui/context';

export type ApiRequestStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UseApiRequestOptions<T> {
  /** Client to send with. Defaults to the surrounding `<ApiClient>`'s client, else a shared fetch client. */
  client?: ApiClientInstance;
  /** Merged into every `execute()` call (headers are merged too). */
  defaults?: Partial<RequestConfig>;
  /** Which statuses count as success. Default 2xx; `null` treats every status as success. */
  validateStatus?: ((status: number) => boolean) | null;
  onSuccess?: (response: ApiResponse<T>) => void;
  onError?: (error: ApiError) => void;
  /** Cancel the in-flight request when `execute` runs again. Default `true`. */
  abortPrevious?: boolean;
}

export interface UseApiRequestResult<T> {
  /** Parsed body of the last successful response. */
  data: T | undefined;
  response: ApiResponse<T> | undefined;
  error: ApiError | null;
  loading: boolean;
  status: ApiRequestStatus;
  /**
   * Sends a request. Never rejects: resolves with the response, or `undefined` when the request failed
   * (see `error`), was cancelled or was superseded by a newer call.
   */
  execute: (config: RequestConfig | string) => Promise<ApiResponse<T> | undefined>;
  /** Cancels the in-flight request. */
  cancel: () => void;
  /** Cancels and clears data, response and error. */
  reset: () => void;
}

let sharedClient: ApiClientInstance | undefined;
const defaultClient = () => (sharedClient ??= createApiClient());

interface State<T> {
  status: ApiRequestStatus;
  data: T | undefined;
  response: ApiResponse<T> | undefined;
  error: ApiError | null;
}

/**
 * Executes HTTP requests from components, with loading/error state, cancellation and race handling.
 *
 * ```tsx
 * const { execute, data, loading, error } = useApiRequest<User>();
 * <button onClick={() => execute('https://api.example.com/users/1')}>Load</button>
 * ```
 */
export function useApiRequest<T = unknown>(options: UseApiRequestOptions<T> = {}): UseApiRequestResult<T> {
  const workspace = useOptionalWorkspace();
  const [state, setState] = useState<State<T>>({ status: 'idle', data: undefined, response: undefined, error: null });
  const optionsRef = useRef(options);
  const clientRef = useRef<ApiClientInstance | undefined>(undefined);
  const controllerRef = useRef<AbortController | null>(null);
  const callRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    optionsRef.current = options;
    clientRef.current = options.client ?? workspace?.client;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const execute = useCallback(async (input: RequestConfig | string): Promise<ApiResponse<T> | undefined> => {
    const opts = optionsRef.current;
    const config: RequestConfig = typeof input === 'string' ? { url: input } : input;
    if (opts.abortPrevious !== false) controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const call = ++callRef.current;
    const onExternalAbort = () => controller.abort(config.signal?.reason);
    config.signal?.addEventListener('abort', onExternalAbort, { once: true });

    setState((s) => ({ ...s, status: 'loading', error: null }));
    const defaults = opts.defaults ?? {};
    const client = opts.client ?? clientRef.current ?? defaultClient();
    try {
      const response = await client.request<T>({
        ...defaults,
        ...config,
        headers: { ...toRecord(defaults.headers), ...toRecord(config.headers) },
        signal: controller.signal,
        validateStatus: config.validateStatus !== undefined ? config.validateStatus : opts.validateStatus,
      });
      if (call !== callRef.current || !mountedRef.current) return undefined;
      setState({ status: 'success', data: response.data, response, error: null });
      opts.onSuccess?.(response);
      return response;
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError('network', String(error), { cause: error });
      if (call !== callRef.current || !mountedRef.current) return undefined;
      if (apiError.kind === 'aborted') {
        setState((s) => ({ ...s, status: s.data !== undefined ? 'success' : 'idle' }));
        return undefined;
      }
      setState((s) => ({ ...s, status: 'error', error: apiError, response: apiError.response as ApiResponse<T> | undefined }));
      opts.onError?.(apiError);
      return undefined;
    } finally {
      config.signal?.removeEventListener('abort', onExternalAbort);
    }
  }, []);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);
  const reset = useCallback(() => {
    controllerRef.current?.abort();
    callRef.current++;
    setState({ status: 'idle', data: undefined, response: undefined, error: null });
  }, []);

  return { ...state, loading: state.status === 'loading', execute, cancel, reset };
}

function toRecord(headers: RequestConfig['headers']): Record<string, string> {
  if (!headers) return {};
  if (typeof Headers !== 'undefined' && headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers as ReadonlyArray<readonly [string, string]>);
  return Object.fromEntries(
    Object.entries(headers as Record<string, string | undefined>).filter((e): e is [string, string] => e[1] !== undefined),
  );
}
