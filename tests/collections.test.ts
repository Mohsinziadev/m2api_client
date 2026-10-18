import { describe, expect, it } from 'vitest';
import {
  ApiError,
  addHistoryEntry,
  addNode,
  containsLiteralSecret,
  countRequests,
  createApiClient,
  createCollection,
  createFolder,
  createHistoryEntry,
  createMockTransport,
  createRequest,
  duplicateNode,
  exportWorkspace,
  findNode,
  groupHistoryByDay,
  importOpenApi,
  importWorkspace,
  moveNode,
  removeHistoryEntry,
  removeNode,
  renameNode,
  sanitizeRequest,
  saveRequestToCollection,
  serializeWorkspace,
  toCollectionRequest,
  type Collection,
} from '../src';

function sample(): Collection[] {
  const users = createFolder('Users', [toCollectionRequest(createRequest({ id: 'r1', name: 'List users', url: '{{baseUrl}}/users' }))]);
  return [
    createCollection('Demo', {
      id: 'c1',
      items: [users, toCollectionRequest(createRequest({ id: 'r2', name: 'Health', url: '{{baseUrl}}/health' }))],
    }),
  ];
}

describe('collections', () => {
  it('finds, renames, duplicates and removes nodes without mutating input', () => {
    const collections = sample();
    const snapshot = JSON.stringify(collections);
    expect(findNode(collections, 'r1')?.path).toEqual([collections[0].items[0].id]);

    const renamed = renameNode(collections, 'r1', 'All users');
    expect((findNode(renamed, 'r1')?.node as { name: string }).name).toBe('All users');

    const { collections: duplicated, id } = duplicateNode(collections, 'r1');
    expect(id).not.toBe('r1');
    expect(findNode(duplicated, id!)?.node.name).toBe('List users copy');
    expect(countRequests(duplicated[0].items)).toBe(3);

    expect(countRequests(removeNode(collections, 'r1')[0].items)).toBe(1);
    expect(JSON.stringify(collections)).toBe(snapshot);
  });

  it('adds folders, saves requests in place and moves nodes', () => {
    let collections = sample();
    const folder = createFolder('Admin');
    collections = addNode(collections, 'c1', folder);
    const request = createRequest({ name: 'New', url: 'https://api.test' });
    collections = saveRequestToCollection(collections, request, { collectionId: 'c1', parentId: folder.id });
    expect(findNode(collections, request.id)?.path).toEqual([folder.id]);

    collections = saveRequestToCollection(collections, { ...request, name: 'Renamed' }, { collectionId: 'ignored' });
    expect(findNode(collections, request.id)?.node.name).toBe('Renamed');
    expect(countRequests(collections[0].items)).toBe(3);

    collections = moveNode(collections, request.id, { collectionId: 'c1' });
    expect(findNode(collections, request.id)?.path).toEqual([]);
    // A folder cannot be moved into itself
    expect(moveNode(collections, folder.id, { collectionId: 'c1', parentId: folder.id })).toEqual(collections);
  });
});

describe('import / export', () => {
  it('round-trips collections and environments', () => {
    const json = serializeWorkspace({
      collections: sample(),
      environments: [{ id: 'e1', name: 'Prod', variables: [{ key: 'baseUrl', value: 'https://api.test' }] }],
    });
    const result = importWorkspace(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.collections[0].name).toBe('Demo');
    expect(result.data.collections[0].id).not.toBe('c1'); // ids regenerated
    expect(countRequests(result.data.collections[0].items)).toBe(2);
    expect(result.data.environments[0].variables[0]).toMatchObject({ key: 'baseUrl', value: 'https://api.test' });
  });

  it('strips credentials from exports unless asked to include them', () => {
    const request = createRequest({
      url: 'https://api.test?api_key=literal-key&page=1',
      headers: { Authorization: 'Bearer literal-token', 'X-Api-Key': '{{apiKey}}' },
      auth: { type: 'bearer', token: 'literal-token' },
    });
    const collections = [createCollection('C', { items: [toCollectionRequest(request)] })];
    const env = {
      id: 'e',
      name: 'E',
      variables: [
        { key: 'apiKey', value: 'k', secret: true },
        { key: 'host', value: 'h' },
      ],
    };
    const exported = JSON.stringify(exportWorkspace({ collections, environments: [env] }));
    expect(exported).not.toContain('literal-token');
    expect(exported).not.toContain('literal-key');
    expect(exported).toContain('{{apiKey}}');
    expect(exported).toContain('page=1');
    expect(exported).toContain('"value":"h"');
    expect(JSON.stringify(exportWorkspace({ collections }, { includeSecrets: true }))).toContain('literal-token');
  });

  it('reports validation errors with paths', () => {
    const result = importWorkspace({
      format: 'm2api-client',
      version: 1,
      collections: [{ name: 'Bad', items: [{ type: 'request', method: 'FETCH', url: 'x' }, { type: 'widget' }] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain('collections[0].items[0].method: expected one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS');
    expect(result.errors).toContain('collections[0].items[1].type: expected "folder" or "request"');
  });

  it('rejects invalid JSON, unknown formats, future versions and other tools', () => {
    expect(importWorkspace('{oops')).toMatchObject({ ok: false });
    expect(importWorkspace({ hello: 1 })).toMatchObject({ ok: false, errors: [expect.stringMatching(/Unrecognised/)] });
    expect(importWorkspace({ format: 'm2api-client', version: 99, collections: [] })).toMatchObject({
      ok: false,
      errors: [expect.stringMatching(/version 99/)],
    });
    expect(
      importWorkspace({ info: { schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [] }),
    ).toMatchObject({
      ok: false,
      errors: [expect.stringMatching(/Postman/)],
    });
  });

  it('keeps auth profile references valid when ids are regenerated', () => {
    const request = createRequest({ url: 'https://api.test', auth: { type: 'profile', profileId: 'p-old' } });
    const result = importWorkspace({
      format: 'm2api-client',
      version: 1,
      collections: [{ name: 'C', items: [toCollectionRequest(request)] }],
      authProfiles: [{ id: 'p-old', name: 'Main', auth: { type: 'bearer', token: '{{t}}' } }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const imported = result.data.collections[0].items[0];
    expect(imported.type === 'request' && imported.auth).toEqual({ type: 'profile', profileId: result.data.authProfiles[0].id });
  });
});

describe('sanitizing', () => {
  it('detects literal secrets vs variable references', () => {
    expect(containsLiteralSecret('Bearer {{token}}')).toBe(false);
    expect(containsLiteralSecret('{{token}}')).toBe(false);
    expect(containsLiteralSecret('Bearer abc')).toBe(true);
    expect(containsLiteralSecret('')).toBe(false);
  });

  it('keeps non-sensitive data and basic auth usernames', () => {
    const request = sanitizeRequest(
      createRequest({ url: 'https://x.test', headers: { Accept: 'json' }, auth: { type: 'basic', username: 'ada', password: 'pw' } }),
    );
    expect(request.headers[0].value).toBe('json');
    expect(request.auth).toEqual({ type: 'basic', username: 'ada', password: '' });
  });
});

describe('history', () => {
  it('records responses and errors, newest first, with a limit', async () => {
    const client = createApiClient({ transport: createMockTransport(() => ({ status: 201, body: 'x' })) });
    const response = await client.post('https://api.test', 'x');
    const request = createRequest({ method: 'POST', url: 'https://api.test' });
    let history = addHistoryEntry([], createHistoryEntry(request, response));
    expect(history[0].outcome).toMatchObject({ type: 'response', status: 201, size: 1 });

    const failing = createApiClient({ transport: createMockTransport(() => ({ status: 500 })) });
    const error = await failing.get('https://api.test').catch((e) => e);
    history = addHistoryEntry(history, createHistoryEntry(request, error), 1);
    expect(history).toHaveLength(1);
    expect(history[0].outcome).toMatchObject({ type: 'error', kind: 'http' });
    expect(removeHistoryEntry(history, history[0].id)).toEqual([]);
  });

  it('groups by day', () => {
    const now = new Date(2026, 5, 10, 12).getTime();
    const request = createRequest({ url: 'https://a.test' });
    const entries = [now - 1000, now - 86_400_000, now - 5 * 86_400_000].map((t) => ({
      ...createHistoryEntry(request, new ApiError('network', 'x')),
      timestamp: t,
    }));
    const groups = groupHistoryByDay(entries, now);
    expect(groups.map((g) => g.label).slice(0, 2)).toEqual(['Today', 'Yesterday']);
    expect(groups).toHaveLength(3);
  });
});

describe('OpenAPI import', () => {
  const spec = {
    openapi: '3.0.3',
    info: { title: 'Pets' },
    servers: [{ url: 'https://{env}.pets.test/v1', variables: { env: { default: 'api' } } }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' }, key: { type: 'apiKey', in: 'header', name: 'X-Key' } },
      schemas: {
        Pet: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string', example: 'Rex' },
            tags: { type: 'array', items: { type: 'string' } },
            owner: { $ref: '#/components/schemas/Pet' },
          },
        },
      },
    },
    security: [{ bearer: [] }],
    paths: {
      '/pets': {
        get: {
          tags: ['pets'],
          summary: 'List pets',
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }],
        },
        post: {
          tags: ['pets'],
          operationId: 'createPet',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } },
        },
      },
      '/pets/{petId}': {
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string', example: 'p1' } }],
        delete: { security: [{ key: [] }] },
      },
    },
  };

  it('converts paths into grouped requests with variables, bodies and auth', () => {
    const { collection, environment, warnings } = importOpenApi(JSON.stringify(spec));
    expect(warnings).toEqual([]);
    expect(collection.name).toBe('Pets');
    expect(environment.variables.find((v) => v.key === 'baseUrl')?.value).toBe('https://api.pets.test/v1');
    expect(environment.variables.find((v) => v.key === 'bearerToken')).toMatchObject({ secret: true, value: '' });
    const folder = collection.items[0];
    expect(folder).toMatchObject({ type: 'folder', name: 'pets' });
    if (folder.type !== 'folder') return;
    const [list, create] = folder.items;
    expect(list).toMatchObject({
      name: 'List pets',
      method: 'GET',
      url: '{{baseUrl}}/pets',
      auth: { type: 'bearer', token: '{{bearerToken}}' },
    });
    expect(list.type === 'request' && list.params[0]).toMatchObject({ key: 'limit', value: '20', enabled: true });
    expect(create.type === 'request' && create.body.type === 'json' && JSON.parse(create.body.content)).toMatchObject({
      id: 0,
      name: 'Rex',
      tags: ['string'],
    });
    const del = collection.items[1];
    expect(del).toMatchObject({
      method: 'DELETE',
      url: '{{baseUrl}}/pets/{{petId}}',
      auth: { type: 'apiKey', key: 'X-Key', value: '{{apiKey}}' },
    });
    expect(collection.variables).toMatchObject([{ key: 'petId', value: 'p1' }]);
  });

  it('rejects non-OpenAPI input', () => {
    expect(() => importOpenApi('{"hello":1}')).toThrow(/Not an OpenAPI document/);
    expect(() => importOpenApi('openapi: 3.0.0')).toThrow(/YAML/);
  });
});
