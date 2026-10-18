import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  HTTP_METHODS,
  createApiClient,
  createFetchTransport,
  createMockTransport,
  createRequest,
  interpolate,
  prepareDefinition,
  prepareRequest,
  toCurl,
  type Middleware,
  type PreparedRequest,
} from '../src';

function mockFetch(
  body: BodyInit | null = '{"ok":true}',
  init: ResponseInit = { status: 200, headers: { 'content-type': 'application/json' } },
) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(body, init));
}

function clientWith(fetchImpl: ReturnType<typeof mockFetch>, options: Parameters<typeof createApiClient>[0] = {}) {
  return createApiClient({ ...options, transport: createFetchTransport({ fetch: fetchImpl as unknown as typeof fetch }) });
}

describe('request engine', () => {
  it.each(HTTP_METHODS)('sends %s requests', async (method) => {
    const fetchImpl = mockFetch(method === 'HEAD' ? null : '{"ok":true}');
    const client = clientWith(fetchImpl);
    const response = await client.request({ url: 'https://api.test/items', method });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.test/items');
    expect(init?.method).toBe(method);
    expect(response.status).toBe(200);
    if (method === 'HEAD') expect(response.bodyKind).toBe('empty');
    else expect(response.data).toEqual({ ok: true });
  });

  it('accepts lower-case methods and rejects unknown ones', async () => {
    const client = clientWith(mockFetch());
    await expect(client.request({ url: 'https://api.test', method: 'post' })).resolves.toMatchObject({ status: 200 });
    await expect(client.request({ url: 'https://api.test', method: 'TRACE' as never })).rejects.toMatchObject({ kind: 'invalid-request' });
  });

  it('encodes query params from records, arrays and URLSearchParams, keeping existing query', () => {
    expect(prepareRequest({ url: 'https://api.test/s?x=1', params: { q: 'a b&c', page: 2, flags: ['a', 'b'], skip: undefined } }).url).toBe(
      'https://api.test/s?x=1&q=a%20b%26c&page=2&flags=a&flags=b',
    );
    expect(prepareRequest({ url: 'https://api.test/s', params: [['k', 'v+1']] }).url).toBe('https://api.test/s?k=v%2B1');
    expect(prepareRequest({ url: 'https://api.test/s', params: new URLSearchParams({ a: '1' }) }).url).toBe('https://api.test/s?a=1');
  });

  it('merges client headers, auth and request headers (request wins, case-insensitive)', () => {
    const client = createApiClient({ headers: { Accept: 'text/plain', 'X-App': 'demo' }, auth: { type: 'bearer', token: 'client-token' } });
    const prepared = client.prepare({ url: 'https://api.test', headers: { accept: 'application/json' } });
    expect(prepared.headers).toEqual({ 'X-App': 'demo', Authorization: 'Bearer client-token', accept: 'application/json' });
  });

  it('serialises JSON bodies and sets Content-Type', () => {
    const prepared = prepareRequest({ url: 'https://api.test', method: 'POST', body: { name: 'Ada' } });
    expect(prepared.body).toBe('{"name":"Ada"}');
    expect(prepared.headers['Content-Type']).toBe('application/json');
    expect(prepareRequest({ url: 'https://api.test', method: 'POST', json: [1, 2] }).body).toBe('[1,2]');
  });

  it('passes FormData, URLSearchParams and strings through', () => {
    const form = new FormData();
    form.append('a', '1');
    const multipart = prepareRequest({ url: 'https://api.test', method: 'POST', body: form });
    expect(multipart.body).toBe(form);
    expect(multipart.headers['Content-Type']).toBeUndefined();
    expect(multipart.bodySource).toEqual({ type: 'multipart', parts: [{ name: 'a', value: '1' }] });

    const urlencoded = prepareRequest({ url: 'https://api.test', method: 'POST', body: new URLSearchParams({ a: '1', b: 'x y' }) });
    expect(urlencoded.bodySource).toEqual({ type: 'text', text: 'a=1&b=x+y' });
    expect(urlencoded.headers['Content-Type']).toMatch(/x-www-form-urlencoded/);

    expect(prepareRequest({ url: 'https://api.test', method: 'POST', body: 'raw' }).body).toBe('raw');
  });

  it('drops bodies on GET with a warning', () => {
    const prepared = prepareRequest({ url: 'https://api.test', body: { a: 1 } });
    expect(prepared.body).toBeNull();
    expect(prepared.warnings[0]).toMatch(/cannot have a body/);
  });

  it('joins baseUrl with relative paths', () => {
    const client = createApiClient({ baseUrl: 'https://api.test/v1/' });
    expect(client.prepare({ url: '/users' }).url).toBe('https://api.test/v1/users');
    expect(client.prepare({ url: 'https://other.test/x' }).url).toBe('https://other.test/x');
  });

  it('validates URLs and header names', () => {
    expect(() => prepareRequest({ url: 'ftp://files.test' })).toThrow(/Unsupported protocol/);
    expect(() => prepareRequest({ url: 'javascript:alert(1)' })).toThrow(ApiError);
    expect(() => prepareRequest({ url: 'https://api.test', headers: { 'Bad Header': 'x' } })).toThrow(/not a valid header name/);
    expect(() => prepareRequest({ url: 'https://api.test', headers: { 'X-A': 'a\nb' } })).toThrow(/line break/);
  });

  it('warns about headers browsers refuse to set', () => {
    expect(prepareRequest({ url: 'https://api.test', headers: { Cookie: 'a=1' } }).warnings.join()).toMatch(/Cookie/);
  });
});

describe('authentication', () => {
  const headers = (auth: Parameters<typeof prepareRequest>[0]['auth']) => prepareRequest({ url: 'https://api.test', auth }).headers;

  it('applies bearer, basic, api key and oauth2 auth', () => {
    expect(headers({ type: 'bearer', token: 'abc123' })).toEqual({ Authorization: 'Bearer abc123' });
    expect(headers({ type: 'bearer', token: 'abc', prefix: 'Token' })).toEqual({ Authorization: 'Token abc' });
    expect(headers({ type: 'basic', username: 'ada', password: 'lovelace' })).toEqual({ Authorization: `Basic ${btoa('ada:lovelace')}` });
    expect(headers({ type: 'basic', username: 'zoë', password: 'pässword' }).Authorization).toBe(
      `Basic ${Buffer.from('zoë:pässword').toString('base64')}`,
    );
    expect(headers({ type: 'apiKey', key: 'X-API-Key', value: 'k-1', in: 'header' })).toEqual({ 'X-API-Key': 'k-1' });
    expect(headers({ type: 'oauth2', accessToken: 'oat' })).toEqual({ Authorization: 'Bearer oat' });
    expect(headers({ type: 'none' })).toEqual({});
  });

  it('puts query api keys in the URL with a warning', () => {
    const prepared = prepareRequest({ url: 'https://api.test/x', auth: { type: 'apiKey', key: 'api_key', value: 'k 1', in: 'query' } });
    expect(prepared.url).toBe('https://api.test/x?api_key=k%201');
    expect(prepared.warnings.join()).toMatch(/leak/);
  });

  it('applies custom headers and auth profiles', () => {
    expect(
      headers({
        type: 'custom',
        headers: [
          { id: '1', key: 'X-Sig', value: 's', enabled: true },
          { id: '2', key: 'X-Off', value: 'o', enabled: false },
        ],
      }),
    ).toEqual({ 'X-Sig': 's' });
    const prepared = prepareRequest(
      { url: 'https://api.test', auth: { type: 'profile', profileId: 'p1' } },
      { authProfiles: [{ id: 'p1', name: 'Prod', auth: { type: 'bearer', token: 'from-profile' } }] },
    );
    expect(prepared.headers.Authorization).toBe('Bearer from-profile');
    expect(prepareRequest({ url: 'https://api.test', auth: { type: 'profile', profileId: 'missing' } }).warnings.join()).toMatch(
      /no longer exists/,
    );
  });

  it('redacts credentials from response snapshots', async () => {
    const client = createApiClient({ transport: createMockTransport(() => ({ body: { ok: true } })) });
    const response = await client.request({
      url: 'https://api.test/x',
      auth: { type: 'apiKey', key: 'key', value: 'super-secret', in: 'query' },
      headers: { 'X-Api-Key': 'abcdef', Authorization: 'Bearer zzzz' },
    });
    expect(response.request.url).not.toContain('super-secret');
    expect(response.request.headers['X-Api-Key']).toBe('••••••');
    expect(response.request.headers.Authorization).toBe('Bearer ••••••');
    expect(JSON.stringify(response.request)).not.toMatch(/super-secret|abcdef|zzzz/);
  });
});

describe('variables', () => {
  it('interpolates with scope precedence and reports unresolved names', () => {
    const result = interpolate('{{ baseUrl }}/users/{{id}}?q={{missing}}', {
      environment: [{ key: 'baseUrl', value: 'https://env.test' }],
      global: { baseUrl: 'https://global.test', id: '7' },
    });
    expect(result.value).toBe('https://env.test/users/7?q={{missing}}');
    expect(result.unresolved).toEqual(['missing']);
  });

  it('resolves nested variables and stops on cycles', () => {
    expect(interpolate('{{url}}', { host: 'api.test', url: 'https://{{host}}/v1' }).value).toBe('https://api.test/v1');
    const cyclic = interpolate('{{a}}', { a: '{{b}}', b: '{{a}}' });
    expect(cyclic.unresolved).toContain('a');
  });

  it('ignores disabled variables and supports dynamic ones', () => {
    expect(interpolate('{{x}}', [{ key: 'x', value: '1', enabled: false }]).unresolved).toEqual(['x']);
    expect(interpolate('{{$timestamp}}').value).toMatch(/^\d{10}$/);
    expect(interpolate('{{$uuid}}').value).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('resolves variables in URL, params, headers, body and auth of a definition', () => {
    const definition = createRequest({
      method: 'POST',
      url: '{{baseUrl}}/users',
      params: [{ key: 'tenant', value: '{{tenant}}' }],
      headers: [{ key: 'X-Tenant', value: '{{tenant}}' }],
      body: { type: 'json', content: '{"tenant":"{{tenant}}"}' },
      auth: { type: 'bearer', token: '{{apiToken}}' },
    });
    const prepared = prepareDefinition(definition, {
      variables: {
        environment: [
          { key: 'baseUrl', value: 'https://api.test' },
          { key: 'tenant', value: 'acme' },
          { key: 'apiToken', value: 'tok-secret', secret: true },
        ],
      },
    });
    expect(prepared.url).toBe('https://api.test/users?tenant=acme');
    expect(prepared.headers['X-Tenant']).toBe('acme');
    expect(prepared.headers.Authorization).toBe('Bearer tok-secret');
    expect(prepared.body).toBe('{"tenant":"acme"}');
    expect(toCurl(prepared, { redact: true })).not.toContain('tok-secret');
  });

  it('fails clearly when the URL still contains unresolved variables', () => {
    expect(() => prepareDefinition(createRequest({ url: '{{baseUrl}}/x' }))).toThrow(/Unresolved variable: \{\{baseUrl\}\}/);
  });
});

describe('workspace definitions', () => {
  it('builds urlencoded and multipart bodies from tables', () => {
    const urlencoded = prepareDefinition(
      createRequest({
        method: 'POST',
        url: 'https://api.test',
        body: {
          type: 'urlencoded',
          fields: [
            { id: '1', key: 'a', value: '1 2', enabled: true },
            { id: '2', key: 'b', value: 'x', enabled: false },
          ],
        },
      }),
    );
    expect(urlencoded.body).toBe('a=1+2');
    expect(urlencoded.headers['Content-Type']).toMatch(/x-www-form-urlencoded/);

    const multipart = prepareDefinition(
      createRequest({
        method: 'POST',
        url: 'https://api.test',
        headers: { 'Content-Type': 'multipart/form-data' },
        body: {
          type: 'multipart',
          fields: [{ id: '1', key: 'file', value: '', enabled: true, kind: 'file', file: new Blob(['hi']), fileName: 'hi.txt' }],
        },
      }),
    );
    expect(multipart.body).toBeInstanceOf(FormData);
    expect(multipart.headers['Content-Type']).toBeUndefined();
    expect(multipart.bodySource).toEqual({ type: 'multipart', parts: [{ name: 'file', fileName: 'hi.txt' }] });
  });

  it('uses enabled params as the query and keeps raw values readable', () => {
    const prepared = prepareDefinition(
      createRequest({
        url: 'https://api.test/search?ignored=1',
        params: [
          { key: 'q', value: 'a b' },
          { key: 'sort', value: 'name:asc' },
          { key: 'off', value: '1', enabled: false },
          { key: 'flag', value: '' },
          { key: 'enc', value: 'a%20b' },
        ],
      }),
    );
    expect(prepared.url).toBe('https://api.test/search?q=a%20b&sort=name:asc&flag&enc=a%20b');
  });

  it('adds a default scheme to bare hosts', () => {
    expect(prepareDefinition(createRequest({ url: 'api.test/x' })).url).toBe('https://api.test/x');
    expect(prepareDefinition(createRequest({ url: 'localhost:3000/x' })).url).toBe('http://localhost:3000/x');
  });
});

describe('responses', () => {
  it('parses JSON, text, empty and binary bodies', async () => {
    const text = await clientWith(mockFetch('hello', { headers: { 'content-type': 'text/plain' } })).get('https://api.test');
    expect(text).toMatchObject({ data: 'hello', bodyKind: 'text', size: 5 });

    const empty = await clientWith(mockFetch(null, { status: 204 })).delete('https://api.test');
    expect(empty).toMatchObject({ status: 204, bodyKind: 'empty', data: undefined, statusText: 'No Content' });

    const binary = await clientWith(mockFetch(new Uint8Array([0, 1, 2, 255]), { headers: { 'content-type': 'image/png' } })).get(
      'https://api.test',
    );
    expect(binary.bodyKind).toBe('binary');
    expect(binary.data).toBeInstanceOf(Blob);
    expect(binary.text).toBeNull();

    const sniffed = await clientWith(mockFetch(new TextEncoder().encode('{"a":1}'), { headers: {} })).get('https://api.test');
    expect(sniffed).toMatchObject({ bodyKind: 'json', data: { a: 1 } });
  });

  it('keeps invalid JSON as text in auto mode and rejects it in json mode', async () => {
    const fetchImpl = mockFetch('{nope', { headers: { 'content-type': 'application/json' } });
    const auto = await clientWith(fetchImpl).get('https://api.test');
    expect(auto.data).toBe('{nope');
    expect(auto.parseError).toBeTruthy();
    await expect(
      clientWith(mockFetch('{nope', { headers: { 'content-type': 'application/json' } })).get('https://api.test', { responseType: 'json' }),
    ).rejects.toMatchObject({
      kind: 'parse',
    });
  });

  it('supports explicit text / arrayBuffer response types', async () => {
    const asText = await clientWith(mockFetch('{"a":1}')).get('https://api.test', { responseType: 'text' });
    expect(asText.data).toBe('{"a":1}');
    const asBuffer = await clientWith(mockFetch('abc')).get<ArrayBuffer>('https://api.test', { responseType: 'arrayBuffer' });
    expect(asBuffer.data.byteLength).toBe(3);
  });

  it('rejects non-2xx by default and resolves them with validateStatus: null', async () => {
    const notFound = () =>
      mockFetch('{"error":"missing"}', { status: 404, statusText: 'Not Found', headers: { 'content-type': 'application/json' } });
    const error = await clientWith(notFound())
      .get('https://api.test')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'http', status: 404, message: 'Request failed with status 404 Not Found' });
    expect((error as ApiError).response?.data).toEqual({ error: 'missing' });

    const resolved = await clientWith(notFound(), { validateStatus: null }).get('https://api.test');
    expect(resolved.status).toBe(404);
    expect(resolved.ok).toBe(false);
  });

  it('reports timing and lower-cases header names', async () => {
    const response = await clientWith(mockFetch('{}', { headers: { 'X-Request-Id': 'r1', 'content-type': 'application/json' } })).get(
      'https://api.test',
    );
    expect(response.headers['x-request-id']).toBe('r1');
    expect(response.timing.duration).toBeGreaterThanOrEqual(0);
    expect(response.timing.startTime).toBeLessThanOrEqual(Date.now());
  });
});

describe('failures, timeouts and cancellation', () => {
  it('maps fetch TypeErrors to network errors with a CORS hint', async () => {
    const client = createApiClient({
      transport: createFetchTransport({ fetch: (async () => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch }),
    });
    const error = (await client.get('https://api.test').catch((e: unknown) => e)) as ApiError;
    expect(error.kind).toBe('network');
    expect(error.hint).toMatch(/CORS/);
    expect(error.hint).toMatch(/proxy/);
  });

  it('times out slow requests', async () => {
    const client = createApiClient({ transport: createMockTransport(() => ({ delay: 500, body: 'late' })), timeout: 20 });
    await expect(client.get('https://api.test')).rejects.toMatchObject({ kind: 'timeout', message: 'Request timed out after 20 ms' });
  });

  it('timeout 0 disables the timeout', async () => {
    const client = createApiClient({ transport: createMockTransport(() => ({ delay: 30, body: 'ok' })) });
    await expect(client.get('https://api.test', { timeout: 0 })).resolves.toMatchObject({ data: 'ok' });
  });

  it('cancels with an AbortSignal', async () => {
    const client = createApiClient({ transport: createMockTransport(() => ({ delay: 500, body: 'late' })) });
    const controller = new AbortController();
    const pending = client.get('https://api.test', { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });

    const already = new AbortController();
    already.abort();
    await expect(client.get('https://api.test', { signal: already.signal })).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('cancels real fetch calls through the signal', async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
        ),
    );
    const client = createApiClient({ transport: createFetchTransport({ fetch: fetchImpl as typeof fetch }) });
    const controller = new AbortController();
    const pending = client.get('https://api.test', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('middleware', () => {
  it('runs in order, can modify requests and responses, and can be removed', async () => {
    const seen: string[] = [];
    const transport = createMockTransport((req: PreparedRequest) => ({ body: { trace: req.headers['X-Trace'] } }));
    const client = createApiClient({ transport });
    const first: Middleware = async (req, next) => {
      seen.push('first');
      return next({ ...req, headers: { ...req.headers, 'X-Trace': 't-1' } });
    };
    const second: Middleware = async (req, next) => {
      seen.push('second');
      const res = await next(req);
      return { ...res, data: { ...(res.data as object), wrapped: true } };
    };
    client.use(first);
    const remove = client.use(second);
    expect((await client.get('https://api.test')).data).toEqual({ trace: 't-1', wrapped: true });
    expect(seen).toEqual(['first', 'second']);
    remove();
    expect((await client.get('https://api.test')).data).toEqual({ trace: 't-1' });
  });

  it('supports retries and short-circuit mocks', async () => {
    let calls = 0;
    const transport = createMockTransport(() => {
      calls++;
      if (calls < 3) throw new TypeError('flaky');
      return { body: 'third time' };
    });
    const retry: Middleware = async (req, next) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await next(req);
        } catch (error) {
          if (attempt >= 2 || !(error instanceof ApiError) || error.kind !== 'network') throw error;
        }
      }
    };
    expect((await createApiClient({ transport, middleware: [retry] }).get('https://api.test')).data).toBe('third time');
    expect(calls).toBe(3);
  });

  it('extend() merges options and keeps middleware', async () => {
    const transport = createMockTransport((req) => ({ body: req.headers }));
    const base = createApiClient({ transport, headers: { 'X-A': '1' } });
    base.use(async (req, next) => next({ ...req, headers: { ...req.headers, 'X-M': 'mw' } }));
    const child = base.extend({ headers: { 'X-B': '2' }, baseUrl: 'https://api.test' });
    expect((await child.get('/x')).data).toEqual({ 'X-A': '1', 'X-B': '2', 'X-M': 'mw' });
  });
});
