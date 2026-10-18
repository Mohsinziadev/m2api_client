import {
  createCollection,
  fetchTransport,
  createFolder,
  createKeyValue,
  createMockTransport,
  createRequest,
  toCollectionRequest,
  type Collection,
  type Environment,
  type MockResponseInit,
  type RequestDefinitionInput,
  type Transport,
} from 'm2api-client';

const req = (input: RequestDefinitionInput) => toCollectionRequest(createRequest(input));
const json = (value: unknown) => JSON.stringify(value, null, 2);

export const MOCK_ORIGIN = 'https://mock.m2api.dev';

/** Public demo APIs (they allow CORS) plus an offline mock API answered by a custom transport. */
export function demoCollections(): Collection[] {
  const jsonPlaceholder = createCollection('JSONPlaceholder', {
    description: 'Fake REST API for testing: https://jsonplaceholder.typicode.com',
    variables: [{ key: 'baseUrl', value: 'https://jsonplaceholder.typicode.com' }],
    items: [
      createFolder('Posts', [
        req({
          name: 'List posts',
          method: 'GET',
          url: '{{baseUrl}}/posts',
          params: [
            { key: 'userId', value: '{{userId}}' },
            { key: '_limit', value: '5', description: 'Page size' },
          ],
        }),
        req({ name: 'Get post', method: 'GET', url: '{{baseUrl}}/posts/1', headers: { Accept: 'application/json' } }),
        req({
          name: 'Create post',
          method: 'POST',
          url: '{{baseUrl}}/posts',
          body: { type: 'json', content: json({ title: 'Hello from m2api', body: 'Created at {{$isoTimestamp}}', userId: 1 }) },
        }),
        req({
          name: 'Replace post',
          method: 'PUT',
          url: '{{baseUrl}}/posts/1',
          body: { type: 'json', content: json({ id: 1, title: 'Replaced', body: '…', userId: 1 }) },
        }),
        req({
          name: 'Update title',
          method: 'PATCH',
          url: '{{baseUrl}}/posts/1',
          body: { type: 'json', content: json({ title: 'Patched title' }) },
        }),
        req({ name: 'Delete post', method: 'DELETE', url: '{{baseUrl}}/posts/1' }),
      ]),
      req({ name: 'Comments for post', method: 'GET', url: '{{baseUrl}}/comments?postId=1' }),
      req({ name: 'User by id', method: 'GET', url: '{{baseUrl}}/users/{{userId}}' }),
    ],
  });

  const httpbin = createCollection('httpbin', {
    description: 'Echo service: https://httpbin.org',
    variables: [{ key: 'baseUrl', value: 'https://httpbin.org' }],
    items: [
      createFolder('Bodies', [
        req({
          name: 'Echo JSON',
          method: 'POST',
          url: '{{baseUrl}}/anything',
          body: { type: 'json', content: json({ id: '{{$uuid}}', items: [1, 2, 3], nested: { ok: true } }) },
        }),
        req({
          name: 'Form URL-encoded',
          method: 'POST',
          url: '{{baseUrl}}/post',
          body: { type: 'urlencoded', fields: [createKeyValue('name', 'Ada Lovelace'), createKeyValue('role', 'engineer')] },
        }),
        req({
          name: 'Multipart form',
          method: 'POST',
          url: '{{baseUrl}}/post',
          body: {
            type: 'multipart',
            fields: [
              { ...createKeyValue('title', 'Report'), kind: 'text' },
              { ...createKeyValue('file', ''), kind: 'file' },
            ],
          },
        }),
      ]),
      createFolder('Auth', [
        req({
          name: 'Basic auth',
          method: 'GET',
          url: '{{baseUrl}}/basic-auth/{{username}}/{{password}}',
          auth: { type: 'basic', username: '{{username}}', password: '{{password}}' },
        }),
        req({ name: 'Bearer token', method: 'GET', url: '{{baseUrl}}/bearer', auth: { type: 'bearer', token: '{{apiToken}}' } }),
        req({
          name: 'API key header',
          method: 'GET',
          url: '{{baseUrl}}/headers',
          auth: { type: 'apiKey', key: 'X-API-Key', value: '{{apiToken}}', in: 'header' },
        }),
      ]),
      createFolder('Responses', [
        req({ name: 'Status 404', method: 'GET', url: '{{baseUrl}}/status/404' }),
        req({ name: 'Slow (3 s) with 2 s timeout', method: 'GET', url: '{{baseUrl}}/delay/3', settings: { timeout: 2000 } }),
        req({ name: 'HTML page (preview)', method: 'GET', url: '{{baseUrl}}/html' }),
        req({ name: 'PNG image', method: 'GET', url: '{{baseUrl}}/image/png' }),
        req({ name: 'Query params', method: 'GET', url: '{{baseUrl}}/get?search=api&page=2' }),
        req({ name: 'HEAD request', method: 'HEAD', url: '{{baseUrl}}/get' }),
      ]),
    ],
  });

  const weather = createCollection('Open-Meteo', {
    description: 'Free weather API: https://open-meteo.com',
    variables: [{ key: 'baseUrl', value: 'https://api.open-meteo.com/v1' }],
    items: [
      req({
        name: 'Forecast for Dubai',
        method: 'GET',
        url: '{{baseUrl}}/forecast',
        params: { latitude: '25.2', longitude: '55.27', current: 'temperature_2m,wind_speed_10m', timezone: 'auto' },
      }),
    ],
  });

  const mock = createCollection('Mock API (offline)', {
    description: 'Answered in the browser by a custom transport: works without a network.',
    variables: [{ key: 'baseUrl', value: MOCK_ORIGIN }],
    items: [
      req({ name: 'List users', method: 'GET', url: '{{baseUrl}}/users' }),
      req({
        name: 'Create user',
        method: 'POST',
        url: '{{baseUrl}}/users',
        body: { type: 'json', content: json({ name: 'Grace Hopper', email: 'grace@example.com' }) },
      }),
      req({ name: 'Large payload (5 000 rows)', method: 'GET', url: '{{baseUrl}}/large' }),
      req({ name: 'Empty 204', method: 'DELETE', url: '{{baseUrl}}/users/1' }),
      req({ name: 'Server error 500', method: 'GET', url: '{{baseUrl}}/error' }),
      req({ name: 'Invalid JSON', method: 'GET', url: '{{baseUrl}}/broken-json' }),
      req({ name: 'Slow (cancel me)', method: 'GET', url: '{{baseUrl}}/slow' }),
      req({ name: 'Network failure', method: 'GET', url: '{{baseUrl}}/offline' }),
    ],
  });

  return [jsonPlaceholder, httpbin, weather, mock];
}

export function demoEnvironments(): Environment[] {
  return [
    {
      id: 'env-dev',
      name: 'Development',
      variables: [
        { key: 'userId', value: '1' },
        { key: 'username', value: 'demo' },
        { key: 'password', value: 'demo-password', secret: true },
        { key: 'apiToken', value: 'dev-token-123', secret: true },
      ],
    },
    {
      id: 'env-staging',
      name: 'Staging',
      variables: [
        { key: 'userId', value: '2' },
        { key: 'username', value: 'staging' },
        { key: 'password', value: 'staging-password', secret: true },
        { key: 'apiToken', value: 'staging-token-456', secret: true },
      ],
    },
  ];
}

const USERS = [
  { id: 1, name: 'Ada Lovelace', email: 'ada@example.com', active: true },
  { id: 2, name: 'Alan Turing', email: 'alan@example.com', active: true },
  { id: 3, name: 'Katherine Johnson', email: 'katherine@example.com', active: false },
];

const mockTransport = createMockTransport((request): MockResponseInit => {
  const path = new URL(request.url).pathname;
  if (path === '/users' && request.method === 'GET') return { body: USERS, delay: 120, headers: { 'x-total-count': String(USERS.length) } };
  if (path === '/users' && request.method === 'POST') {
    const input = typeof request.body === 'string' ? (JSON.parse(request.body) as object) : {};
    return { status: 201, body: { id: USERS.length + 1, ...input, createdAt: new Date().toISOString() }, delay: 180 };
  }
  if (path.startsWith('/users/') && request.method === 'DELETE') return { status: 204, delay: 80 };
  if (path === '/large') {
    return {
      body: Array.from({ length: 5000 }, (_, i) => ({
        id: i + 1,
        sku: `SKU-${String(i + 1).padStart(5, '0')}`,
        price: Math.round(((i * 37) % 1000) * 100) / 100,
        tags: ['demo', i % 2 ? 'odd' : 'even'],
      })),
      delay: 200,
    };
  }
  if (path === '/error')
    return { status: 500, body: { error: 'internal_error', message: 'Something went wrong on the mock server.' }, delay: 100 };
  if (path === '/broken-json') return { headers: { 'content-type': 'application/json' }, body: '{"name": "unterminated', delay: 60 };
  if (path === '/slow') return { body: { done: true }, delay: 8000 };
  if (path === '/offline') throw new TypeError('Failed to fetch');
  return { status: 404, body: { error: 'not_found', path } };
});

/** A custom transport: the mock origin is answered locally, everything else goes over `fetch`. */
export const demoTransport: Transport = {
  send(request, options) {
    return request.url.startsWith(MOCK_ORIGIN) ? mockTransport.send(request, options) : fetchTransport.send(request, options);
  },
};
