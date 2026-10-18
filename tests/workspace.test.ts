import { describe, expect, it, vi } from 'vitest';
import {
  createApiClient,
  createMemoryStorage,
  createMockTransport,
  createWorkspace,
  findNode,
  type MockResponseInit,
  type PreparedRequest,
} from '../src';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function workspace(
  handler: (req: PreparedRequest) => MockResponseInit = () => ({ body: { ok: true } }),
  options: Parameters<typeof createWorkspace>[0] = {},
) {
  return createWorkspace({ client: createApiClient({ transport: createMockTransport(handler) }), ...options });
}

describe('workspace store', () => {
  it('sends the active tab, stores the response and records history (including 4xx)', async () => {
    const ws = workspace(() => ({ status: 404, body: { error: 'nope' } }), { initialRequest: { url: 'https://api.test/x' } });
    const tabId = ws.getState().activeTabId;
    const pending = ws.actions.send();
    expect(ws.getState().tabs[0].status).toBe('loading');
    await pending;
    const tab = ws.getState().tabs.find((t) => t.id === tabId)!;
    expect(tab.status).toBe('success');
    expect(tab.response?.status).toBe(404);
    expect(ws.getState().history[0].outcome).toMatchObject({ type: 'response', status: 404 });
  });

  it('resolves environment, collection and global variables with documented precedence', async () => {
    const seen: string[] = [];
    const ws = workspace(
      (req) => {
        seen.push(req.url);
        return {};
      },
      {
        baseUrl: 'https://fallback.test',
        environments: [{ id: 'dev', name: 'Dev', variables: [{ key: 'host', value: 'https://dev.test' }] }],
        globals: [
          { key: 'host', value: 'https://global.test' },
          { key: 'v', value: 'v1' },
        ],
      },
    );
    ws.actions.updateRequest(ws.getState().activeTabId, { url: '{{host}}/{{v}}' });
    await ws.actions.send();
    ws.actions.setActiveEnvironment(null);
    await ws.actions.send();
    ws.actions.updateRequest(ws.getState().activeTabId, { url: '{{baseUrl}}/x' });
    await ws.actions.send();
    expect(seen).toEqual(['https://dev.test/v1', 'https://global.test/v1', 'https://fallback.test/x']);
  });

  it('shows invalid requests as errors without sending', async () => {
    const handler = vi.fn(() => ({}));
    const ws = workspace(handler, { initialRequest: { url: '{{missing}}/x' } });
    await ws.actions.send();
    expect(handler).not.toHaveBeenCalled();
    expect(ws.getState().tabs[0].error).toMatchObject({ kind: 'invalid-request' });
  });

  it('cancels in-flight requests', async () => {
    const ws = workspace(() => ({ delay: 1000 }), { initialRequest: { url: 'https://api.test' } });
    const pending = ws.actions.send();
    ws.actions.cancel();
    await pending;
    expect(ws.getState().tabs[0]).toMatchObject({ status: 'error', error: { kind: 'aborted' } });
    expect(ws.getState().history).toHaveLength(0);
  });

  it('ignores stale responses when a request is re-sent', async () => {
    let n = 0;
    const ws = workspace(() => ({ delay: n++ === 0 ? 80 : 5, body: { n } }), { initialRequest: { url: 'https://api.test' } });
    const first = ws.actions.send();
    const second = ws.actions.send();
    await Promise.all([first, second]);
    expect(ws.getState().tabs[0].response?.data).toEqual({ n: 2 });
  });

  it('manages tabs: new from template, duplicate, close keeps one tab', () => {
    const ws = workspace();
    const id = ws.actions.newTab('post-json');
    expect(ws.getState().tabs.find((t) => t.id === id)?.request).toMatchObject({ method: 'POST', body: { type: 'json' } });
    const copy = ws.actions.duplicateTab(id)!;
    expect(ws.getState().activeTabId).toBe(copy);
    for (const tab of ws.getState().tabs) ws.actions.closeTab(tab.id);
    expect(ws.getState().tabs).toHaveLength(1);
  });

  it('saves tabs into collections, updates them in place and reopens them', () => {
    const ws = workspace(undefined, { initialRequest: { url: 'https://api.test/a' } });
    const tabId = ws.getState().activeTabId;
    expect(ws.actions.saveTab(tabId, { name: 'A' })).toBe(true); // creates "My collection"
    const saved = ws.getState().tabs[0];
    expect(saved).toMatchObject({ dirty: false, savedId: saved.request.id });
    ws.actions.updateRequest(tabId, { url: 'https://api.test/b' });
    expect(ws.getState().tabs[0].dirty).toBe(true);
    ws.actions.saveTab(tabId);
    const node = findNode(ws.getState().collections, saved.request.id)?.node;
    expect(node).toMatchObject({ url: 'https://api.test/b', name: 'A' });

    expect(ws.actions.openSaved(saved.request.id)).toBe(tabId); // focuses the existing tab
    ws.actions.closeTab(tabId);
    const reopened = ws.actions.openSaved(saved.request.id)!;
    expect(ws.getState().tabs.find((t) => t.id === reopened)?.request.url).toBe('https://api.test/b');

    ws.actions.remove(saved.request.id);
    expect(ws.getState().tabs.find((t) => t.id === reopened)?.savedId).toBeUndefined();
  });

  it('replays history entries in a new tab', async () => {
    const ws = workspace(undefined, { initialRequest: { url: 'https://api.test/h' } });
    await ws.actions.send();
    await ws.actions.replayHistoryEntry(ws.getState().history[0].id);
    expect(ws.getState().tabs).toHaveLength(2);
    expect(ws.getState().history).toHaveLength(2);
  });

  it('imports cURL commands into new tabs', () => {
    const ws = workspace();
    const { tabId } = ws.actions.importCurl(`curl -X DELETE https://api.test/items/1`);
    expect(ws.getState().tabs.find((t) => t.id === tabId)?.request).toMatchObject({ method: 'DELETE', url: 'https://api.test/items/1' });
  });

  it('manages environments and auth profiles', () => {
    const ws = workspace();
    const env = ws.actions.addEnvironment('Staging', [{ key: 'a', value: '1' }]);
    expect(ws.getState().activeEnvironmentId).toBe(env);
    const copy = ws.actions.duplicateEnvironment(env)!;
    ws.actions.updateEnvironment(copy, { name: 'Prod' });
    ws.actions.removeEnvironment(env);
    expect(ws.getState().environments.map((e) => e.name)).toEqual(['Prod']);
    expect(ws.getState().activeEnvironmentId).toBe(copy);
    const profile = ws.actions.addAuthProfile('Main', { type: 'bearer', token: '{{t}}' });
    ws.actions.updateAuthProfile(profile, { name: 'Primary' });
    expect(ws.getState().authProfiles[0].name).toBe('Primary');
  });
});

describe('workspace persistence', () => {
  it('stores nothing unless persistence is enabled', async () => {
    const storage = createMemoryStorage();
    const ws = workspace();
    await ws.hydrate();
    ws.actions.addCollection('X');
    await tick(10);
    expect(storage.dump()).toEqual({});
  });

  it('persists without secrets and restores state', async () => {
    const storage = createMemoryStorage();
    const options = { persistence: { storage, debounce: 0 } } as const;
    const ws = workspace(undefined, {
      ...options,
      initialRequest: { url: 'https://api.test', auth: { type: 'bearer', token: 'literal-token' } },
      environments: [
        {
          id: 'e',
          name: 'E',
          variables: [
            { key: 'apiToken', value: 'secret-value', secret: true },
            { key: 'host', value: 'h' },
          ],
        },
      ],
    });
    expect(ws.getState().hydrated).toBe(false);
    await ws.hydrate();
    expect(ws.getState().hydrated).toBe(true);
    ws.actions.addCollection('Saved');
    await ws.actions.send();
    await tick(10);

    const stored = storage.dump()['m2api-client:workspace'];
    expect(stored).toContain('Saved');
    expect(stored).toContain('"host"');
    expect(stored).not.toContain('literal-token');
    expect(stored).not.toContain('secret-value');

    const restored = workspace(undefined, options);
    await restored.hydrate();
    expect(restored.getState().collections.map((c) => c.name)).toEqual(['Saved']);
    expect(restored.getState().history).toHaveLength(1);
    expect(restored.getState().environments[0].variables[1]).toMatchObject({ key: 'host', value: 'h' });
    expect(restored.getState().tabs[0].request.url).toBe('https://api.test');
    ws.destroy();
    restored.destroy();
  });

  it('respects include and survives corrupted storage', async () => {
    const storage = createMemoryStorage({ 'm2api-client:workspace': '{corrupt' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ws = workspace(undefined, { persistence: { storage, include: ['collections'], debounce: 0 } });
    await ws.hydrate();
    expect(warn).toHaveBeenCalled();
    ws.actions.addCollection('Only this');
    ws.actions.addEnvironment('Not stored');
    await tick(10);
    const stored = JSON.parse(storage.dump()['m2api-client:workspace']);
    expect(Object.keys(stored).sort()).toEqual(['collections', 'version']);
    ws.destroy();
  });
});
