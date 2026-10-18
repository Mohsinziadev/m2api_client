import type {
  ApiResponse,
  AuthProfile,
  Environment,
  HeadersInput,
  OAuth2Auth,
  PreparedRequest,
  RequestDefinition,
  Variable,
} from '../core/types';
import { ApiError } from '../core/errors';
import { createApiClient, type ApiClientInstance } from '../core/client';
import { prepareDefinition } from '../core/prepare';
import { cloneRequest, createRequest, DEFAULT_TEMPLATES, type RequestDefinitionInput, type RequestTemplate } from '../core/request';
import { VariableResolver, type VariableScopes } from '../env/variables';
import {
  addNode,
  createCollection,
  createFolder,
  duplicateCollection,
  duplicateNode,
  findNode,
  moveNode,
  removeCollection,
  removeNode,
  renameCollection,
  renameNode,
  saveRequestToCollection,
  toRequestDefinition,
  updateCollectionVariables,
  type Collection,
} from '../collections/collections';
import { exportWorkspace, importWorkspace, parseRequestDefinition, type WorkspaceData, type WorkspaceExport } from '../collections/io';
import { addHistoryEntry, createHistoryEntry, DEFAULT_HISTORY_LIMIT, removeHistoryEntry, type HistoryEntry } from '../history/history';
import { sanitizeAuthProfile, sanitizeCollection, sanitizeEnvironment, sanitizeRequest, sanitizeVariables } from '../persistence/sanitize';
import type { StorageAdapter } from '../persistence/storage';
import { createWebStorage } from '../persistence/storage';
import { parseCurl } from '../curl/import';
import { importOpenApi } from '../openapi/import';
import { createId } from '../utils/id';

export type RequestStatus = 'idle' | 'loading' | 'success' | 'error';

export interface RequestTab {
  id: string;
  request: RequestDefinition;
  /** Set when the tab edits a saved collection request (its id equals `request.id`). */
  savedId?: string;
  dirty: boolean;
  status: RequestStatus;
  response?: ApiResponse;
  error?: ApiError;
  /** Epoch ms when the in-flight request started. */
  startedAt?: number;
}

export interface WorkspaceState {
  tabs: RequestTab[];
  activeTabId: string;
  collections: Collection[];
  history: HistoryEntry[];
  environments: Environment[];
  activeEnvironmentId: string | null;
  /** Lowest-precedence variables, available everywhere. */
  globals: Variable[];
  authProfiles: AuthProfile[];
  /** `false` until persisted data (if any) has been loaded. */
  hydrated: boolean;
}

export type PersistedSlice = 'collections' | 'history' | 'environments' | 'globals' | 'authProfiles' | 'tabs';

export interface PersistenceOptions {
  /** Where to store the workspace. Defaults to `localStorage`. */
  storage?: StorageAdapter;
  /** Storage key. Default `m2api-client:workspace`. */
  key?: string;
  /** What to persist. Default: everything except responses. */
  include?: readonly PersistedSlice[];
  /**
   * Persist literal credentials and secret variable values. Off by default; only `{{variable}}`
   * references are stored. Enable it only with a storage adapter you trust (never plain localStorage
   * on a shared machine).
   */
  includeSecrets?: boolean;
  /** Debounce for writes in ms. Default 300. */
  debounce?: number;
}

export interface OAuth2Integration {
  /** Obtain an access token (open a popup with PKCE, call your backend...). Never embed client secrets. */
  getAccessToken(auth: OAuth2Auth): Promise<string>;
  /** Label for the button. Default "Get access token". */
  label?: string;
}

export interface WorkspaceOptions {
  /** Base URL for relative request URLs, also exposed as the global `{{baseUrl}}` variable. */
  baseUrl?: string;
  /** Headers added to every request sent from the workspace. */
  defaultHeaders?: HeadersInput;
  /** A preconfigured client (transport, middleware, auth). The workspace never rejects on HTTP status. */
  client?: ApiClientInstance;
  initialRequest?: RequestDefinitionInput;
  collections?: Collection[];
  environments?: Environment[];
  activeEnvironmentId?: string | null;
  globals?: Variable[];
  authProfiles?: AuthProfile[];
  history?: HistoryEntry[];
  /** Maximum history entries. Default 100. `0` disables history. */
  historyLimit?: number;
  /** Opt-in persistence. Nothing is stored unless this is set. */
  persistence?: PersistenceOptions | boolean;
  templates?: RequestTemplate[];
  oauth2?: OAuth2Integration;
  onResponse?: (response: ApiResponse, request: RequestDefinition) => void;
  onError?: (error: ApiError, request: RequestDefinition) => void;
}

type Listener = () => void;
type RequestUpdate = Partial<RequestDefinition> | ((request: RequestDefinition) => RequestDefinition);

const ALL_SLICES: PersistedSlice[] = ['collections', 'history', 'environments', 'globals', 'authProfiles', 'tabs'];
const STORAGE_VERSION = 1;

function blankTab(request: RequestDefinition, savedId?: string): RequestTab {
  return { id: createId('tab'), request, savedId, dirty: false, status: 'idle' };
}

/** Creates the workspace store behind `<ApiClient>`. Framework-agnostic: subscribe from anywhere. */
export function createWorkspace(options: WorkspaceOptions = {}) {
  const client = options.client ?? createApiClient();
  const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  const persistence: PersistenceOptions | null = options.persistence === true ? {} : options.persistence ? options.persistence : null;
  const controllers = new Map<string, AbortController>();
  const tokens = new Map<string, number>();
  let sequence = 0;
  let callbacks = { onResponse: options.onResponse, onError: options.onError, oauth2: options.oauth2 };

  const initialRequest = createRequest({ url: options.baseUrl ?? '', ...options.initialRequest });
  const firstTab = blankTab(initialRequest);
  let state: WorkspaceState = {
    tabs: [firstTab],
    activeTabId: firstTab.id,
    collections: options.collections ?? [],
    history: options.history ?? [],
    environments: options.environments ?? [],
    activeEnvironmentId: options.activeEnvironmentId !== undefined ? options.activeEnvironmentId : (options.environments?.[0]?.id ?? null),
    globals: options.globals ?? [],
    authProfiles: options.authProfiles ?? [],
    hydrated: !persistence,
  };
  const listeners = new Set<Listener>();

  const getState = () => state;
  const setState = (update: Partial<WorkspaceState> | ((s: WorkspaceState) => Partial<WorkspaceState>)) => {
    const patch = typeof update === 'function' ? update(state) : update;
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const subscribe = (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const getTab = (tabId = state.activeTabId) => state.tabs.find((t) => t.id === tabId);
  const patchTab = (tabId: string, patch: Partial<RequestTab> | ((t: RequestTab) => Partial<RequestTab>)) =>
    setState((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)) }));

  // ---------------------------------------------------------------------------------------------
  // Variables
  // ---------------------------------------------------------------------------------------------

  const activeEnvironment = () => state.environments.find((e) => e.id === state.activeEnvironmentId) ?? null;

  /** Variable scopes for a tab: environment > collection > globals (+ `baseUrl`). */
  function getVariableScopes(tabId = state.activeTabId): VariableScopes {
    const tab = getTab(tabId);
    const collection = tab?.savedId ? findNode(state.collections, tab.savedId)?.collection : undefined;
    const globals: Variable[] =
      options.baseUrl && !state.globals.some((v) => v.key === 'baseUrl')
        ? [{ key: 'baseUrl', value: options.baseUrl }, ...state.globals]
        : state.globals;
    return { environment: activeEnvironment()?.variables, collection: collection?.variables, global: globals };
  }

  const getResolver = (tabId?: string) => new VariableResolver(getVariableScopes(tabId));

  /** Resolves a tab's request exactly as it would be sent. Throws an `invalid-request` ApiError. */
  function prepareTab(tabId = state.activeTabId, resolver?: VariableResolver): PreparedRequest {
    const tab = getTab(tabId);
    if (!tab) throw new ApiError('invalid-request', 'No such request tab.');
    return prepareDefinition(tab.request, {
      variables: resolver ?? getResolver(tabId),
      authProfiles: state.authProfiles,
      baseUrl: options.baseUrl,
      headers: options.defaultHeaders,
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Tabs and requests
  // ---------------------------------------------------------------------------------------------

  function openTab(request: RequestDefinition, savedId?: string): string {
    const tab = blankTab(request, savedId);
    setState((s) => {
      // Replace a pristine, empty first tab instead of piling up blank tabs.
      const replace = s.tabs.length === 1 && isPristine(s.tabs[0]);
      return { tabs: replace ? [tab] : [...s.tabs, tab], activeTabId: tab.id };
    });
    return tab.id;
  }

  const isPristine = (tab: RequestTab) =>
    !tab.dirty && !tab.savedId && !tab.response && !tab.error && tab.status === 'idle' && !tab.request.url.trim();

  function newTab(input?: RequestDefinitionInput | string): string {
    const template =
      typeof input === 'string' ? [...(options.templates ?? []), ...DEFAULT_TEMPLATES].find((t) => t.id === input) : undefined;
    const base = typeof input === 'string' ? template?.request : input;
    const tab = blankTab(createRequest({ url: options.baseUrl ?? '', ...base }));
    setState((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
    return tab.id;
  }

  function closeTab(tabId: string) {
    controllers.get(tabId)?.abort();
    setState((s) => {
      const index = s.tabs.findIndex((t) => t.id === tabId);
      if (index === -1) return {};
      const tabs = s.tabs.filter((t) => t.id !== tabId);
      if (tabs.length === 0) {
        const tab = blankTab(createRequest({ url: options.baseUrl ?? '' }));
        return { tabs: [tab], activeTabId: tab.id };
      }
      const activeTabId = s.activeTabId === tabId ? tabs[Math.min(index, tabs.length - 1)].id : s.activeTabId;
      return { tabs, activeTabId };
    });
  }

  function updateRequest(tabId: string, update: RequestUpdate) {
    patchTab(tabId, (t) => ({ request: typeof update === 'function' ? update(t.request) : { ...t.request, ...update }, dirty: true }));
  }

  function duplicateTab(tabId: string): string | null {
    const tab = getTab(tabId);
    if (!tab) return null;
    return openTab(cloneRequest(tab.request, { name: tab.request.name ? `${tab.request.name} copy` : '' }));
  }

  // ---------------------------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------------------------

  function record(request: RequestDefinition, result: ApiResponse | ApiError) {
    if (historyLimit <= 0) return;
    setState((s) => ({ history: addHistoryEntry(s.history, createHistoryEntry(request, result), historyLimit) }));
  }

  async function send(tabId = state.activeTabId): Promise<ApiResponse | undefined> {
    const tab = getTab(tabId);
    if (!tab) return undefined;
    controllers.get(tabId)?.abort();

    let prepared: PreparedRequest;
    try {
      prepared = prepareTab(tabId);
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError('invalid-request', String(error));
      patchTab(tabId, { status: 'error', error: apiError, response: undefined });
      callbacks.onError?.(apiError, tab.request);
      return undefined;
    }

    const controller = new AbortController();
    const token = ++sequence;
    controllers.set(tabId, controller);
    tokens.set(tabId, token);
    patchTab(tabId, { status: 'loading', error: undefined, startedAt: Date.now() });
    const request = tab.request;

    try {
      const response = await client.send(prepared, { signal: controller.signal, validateStatus: null });
      if (tokens.get(tabId) !== token) return response;
      patchTab(tabId, { status: 'success', response, error: undefined, startedAt: undefined });
      record(request, response);
      callbacks.onResponse?.(response, request);
      return response;
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError('network', String(error), { cause: error });
      if (tokens.get(tabId) !== token) return undefined;
      patchTab(tabId, { status: 'error', error: apiError, response: undefined, startedAt: undefined });
      if (apiError.kind !== 'aborted') record(request, apiError);
      callbacks.onError?.(apiError, request);
      return undefined;
    } finally {
      if (tokens.get(tabId) === token) controllers.delete(tabId);
    }
  }

  function cancel(tabId = state.activeTabId) {
    controllers.get(tabId)?.abort();
  }

  async function requestOAuth2Token(tabId = state.activeTabId): Promise<void> {
    const tab = getTab(tabId);
    const integration = callbacks.oauth2;
    if (!tab || tab.request.auth.type !== 'oauth2' || !integration) return;
    const token = await integration.getAccessToken(tab.request.auth);
    updateRequest(tabId, (r) => (r.auth.type === 'oauth2' ? { ...r, auth: { ...r.auth, accessToken: token } } : r));
  }

  // ---------------------------------------------------------------------------------------------
  // Collections
  // ---------------------------------------------------------------------------------------------

  /**
   * Saves a tab. Already-saved requests are updated in place; new ones need a target collection (one
   * is created when the workspace has none).
   */
  function saveTab(tabId = state.activeTabId, target?: { collectionId?: string; parentId?: string | null; name?: string }): boolean {
    const tab = getTab(tabId);
    if (!tab) return false;
    const request = target?.name !== undefined ? { ...tab.request, name: target.name } : tab.request;
    if (tab.savedId && findNode(state.collections, tab.savedId) && !target?.collectionId) {
      setState((s) => ({ collections: saveRequestToCollection(s.collections, request, { collectionId: '' }) }));
      patchTab(tabId, { request, dirty: false });
      return true;
    }
    let collectionId = target?.collectionId;
    let collections = state.collections;
    if (!collectionId) {
      if (collections.length === 0) {
        const created = createCollection('My collection');
        collections = [...collections, created];
        collectionId = created.id;
      } else return false;
    }
    // Saving into a new place from an already-saved tab creates a copy.
    const toSave = tab.savedId && findNode(collections, tab.savedId) ? cloneRequest(request) : request;
    setState({ collections: saveRequestToCollection(collections, toSave, { collectionId, parentId: target?.parentId ?? null }) });
    patchTab(tabId, { request: toSave, savedId: toSave.id, dirty: false });
    return true;
  }

  /** Opens a saved request, focusing its tab if it is already open. */
  function openSaved(requestId: string): string | null {
    const existing = state.tabs.find((t) => t.savedId === requestId);
    if (existing) {
      setState({ activeTabId: existing.id });
      return existing.id;
    }
    const location = findNode(state.collections, requestId);
    if (!location || location.node.type !== 'request') return null;
    return openTab(cloneRequest(toRequestDefinition(location.node), { id: location.node.id }), location.node.id);
  }

  function addCollection(name = 'New collection', init?: Partial<Omit<Collection, 'id' | 'name'>>): string {
    const collection = createCollection(name, init);
    setState((s) => ({ collections: [...s.collections, collection] }));
    return collection.id;
  }

  function addFolder(collectionId: string, name = 'New folder', parentId: string | null = null): string {
    const folder = createFolder(name);
    setState((s) => ({ collections: addNode(s.collections, collectionId, folder, parentId) }));
    return folder.id;
  }

  function rename(id: string, name: string) {
    setState((s) => ({
      collections: s.collections.some((c) => c.id === id) ? renameCollection(s.collections, id, name) : renameNode(s.collections, id, name),
    }));
    // Keep open tabs in sync with renamed saved requests.
    setState((s) => ({ tabs: s.tabs.map((t) => (t.savedId === id ? { ...t, request: { ...t.request, name } } : t)) }));
  }

  function remove(id: string) {
    setState((s) => ({
      collections: s.collections.some((c) => c.id === id) ? removeCollection(s.collections, id) : removeNode(s.collections, id),
    }));
    // Tabs of deleted requests become unsaved drafts.
    setState((s) => ({
      tabs: s.tabs.map((t) => (t.savedId && !findNode(s.collections, t.savedId) ? { ...t, savedId: undefined, dirty: true } : t)),
    }));
  }

  function duplicate(id: string): string | null {
    if (state.collections.some((c) => c.id === id)) {
      const before = new Set(state.collections.map((c) => c.id));
      setState((s) => ({ collections: duplicateCollection(s.collections, id) }));
      return state.collections.find((c) => !before.has(c.id))?.id ?? null;
    }
    const result = duplicateNode(state.collections, id);
    setState({ collections: result.collections });
    return result.id;
  }

  function move(id: string, target: { collectionId: string; parentId?: string | null }) {
    setState((s) => ({ collections: moveNode(s.collections, id, target) }));
  }

  function setCollectionVariables(collectionId: string, variables: Variable[]) {
    setState((s) => ({ collections: updateCollectionVariables(s.collections, collectionId, variables) }));
  }

  // ---------------------------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------------------------

  function openHistoryEntry(entryId: string): string | null {
    const entry = state.history.find((e) => e.id === entryId);
    return entry ? openTab(cloneRequest(entry.request)) : null;
  }

  /** Opens a history entry in a new tab and sends it again. */
  function replayHistoryEntry(entryId: string) {
    const tabId = openHistoryEntry(entryId);
    return tabId ? send(tabId) : Promise.resolve(undefined);
  }

  // ---------------------------------------------------------------------------------------------
  // Environments, globals, auth profiles
  // ---------------------------------------------------------------------------------------------

  function addEnvironment(name = 'New environment', variables: Variable[] = []): string {
    const env: Environment = { id: createId('env'), name, variables };
    setState((s) => ({ environments: [...s.environments, env], activeEnvironmentId: s.activeEnvironmentId ?? env.id }));
    return env.id;
  }
  function updateEnvironment(id: string, patch: Partial<Omit<Environment, 'id'>>) {
    setState((s) => ({ environments: s.environments.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  }
  function removeEnvironment(id: string) {
    setState((s) => ({
      environments: s.environments.filter((e) => e.id !== id),
      activeEnvironmentId: s.activeEnvironmentId === id ? (s.environments.find((e) => e.id !== id)?.id ?? null) : s.activeEnvironmentId,
    }));
  }
  function duplicateEnvironment(id: string): string | null {
    const env = state.environments.find((e) => e.id === id);
    if (!env) return null;
    return addEnvironment(
      `${env.name} copy`,
      env.variables.map((v) => ({ ...v, id: createId('var') })),
    );
  }
  const setActiveEnvironment = (id: string | null) => setState({ activeEnvironmentId: id });
  const setGlobals = (globals: Variable[]) => setState({ globals });

  function addAuthProfile(name: string, auth: AuthProfile['auth']): string {
    const profile: AuthProfile = { id: createId('auth'), name, auth };
    setState((s) => ({ authProfiles: [...s.authProfiles, profile] }));
    return profile.id;
  }
  function updateAuthProfile(id: string, patch: Partial<Omit<AuthProfile, 'id'>>) {
    setState((s) => ({ authProfiles: s.authProfiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  }
  function removeAuthProfile(id: string) {
    setState((s) => ({ authProfiles: s.authProfiles.filter((p) => p.id !== id) }));
  }

  // ---------------------------------------------------------------------------------------------
  // Import / export
  // ---------------------------------------------------------------------------------------------

  /** Adds imported collections, environments and auth profiles to the workspace. */
  function importData(data: Partial<WorkspaceData>) {
    setState((s) => ({
      collections: [...s.collections, ...(data.collections ?? [])],
      environments: [...s.environments, ...(data.environments ?? [])],
      authProfiles: [...s.authProfiles, ...(data.authProfiles ?? [])],
      activeEnvironmentId: s.activeEnvironmentId ?? data.environments?.[0]?.id ?? null,
    }));
  }

  /** Parses and imports an m2api-client export file. */
  function importJson(json: string) {
    const result = importWorkspace(json);
    if (result.ok) importData(result.data);
    return result;
  }

  function importOpenApiDocument(doc: string | object) {
    const result = importOpenApi(doc);
    importData({ collections: [result.collection], environments: [result.environment] });
    return result;
  }

  /** Parses a cURL command and opens it in a new tab. */
  function importCurl(command: string) {
    const result = parseCurl(command);
    const tabId = openTab(result.request);
    return { ...result, tabId };
  }

  function exportData(
    exportOptions: { includeSecrets?: boolean; collectionIds?: string[]; includeEnvironments?: boolean } = {},
  ): WorkspaceExport {
    const collections = exportOptions.collectionIds
      ? state.collections.filter((c) => exportOptions.collectionIds!.includes(c.id))
      : state.collections;
    return exportWorkspace(
      {
        collections,
        environments: exportOptions.includeEnvironments === false ? [] : state.environments,
        authProfiles: exportOptions.includeEnvironments === false ? [] : state.authProfiles,
      },
      { includeSecrets: exportOptions.includeSecrets },
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Persistence (opt-in)
  // ---------------------------------------------------------------------------------------------

  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribePersist: (() => void) | undefined;
  const storageKey = persistence?.key ?? 'm2api-client:workspace';
  const storage = persistence ? (persistence.storage ?? createWebStorage('local')) : null;
  const include = new Set(persistence?.include ?? ALL_SLICES);

  function serialize(): string {
    const secrets = { includeSecrets: persistence?.includeSecrets };
    const out: Record<string, unknown> = { version: STORAGE_VERSION };
    if (include.has('collections')) out.collections = state.collections.map((c) => sanitizeCollection(c, secrets));
    if (include.has('environments')) {
      out.environments = state.environments.map((e) => sanitizeEnvironment(e, secrets));
      out.activeEnvironmentId = state.activeEnvironmentId;
    }
    if (include.has('globals')) out.globals = sanitizeVariables(state.globals, secrets);
    if (include.has('authProfiles')) out.authProfiles = state.authProfiles.map((p) => sanitizeAuthProfile(p, secrets));
    if (include.has('history')) out.history = state.history.map((h) => ({ ...h, request: sanitizeRequest(h.request, secrets) }));
    if (include.has('tabs')) {
      out.tabs = state.tabs.map((t) => ({ id: t.id, request: sanitizeRequest(t.request, secrets), savedId: t.savedId, dirty: t.dirty }));
      out.activeTabId = state.activeTabId;
    }
    return JSON.stringify(out);
  }

  let hydration: Promise<void> | null = null;

  /** Loads persisted data, then keeps storage in sync. Called by `<ApiClient>` on mount; idempotent. */
  function hydrate(): Promise<void> {
    if (!storage) return Promise.resolve();
    return (hydration ??= load(storage));
  }

  async function load(storage: StorageAdapter): Promise<void> {
    try {
      const raw = await storage.getItem(storageKey);
      if (raw) applyPersisted(JSON.parse(raw));
    } catch (error) {
      console.warn('[m2api-client] Ignoring unreadable persisted workspace:', error);
    }
    setState({ hydrated: true });
    let last = {
      c: state.collections,
      h: state.history,
      e: state.environments,
      a: state.activeEnvironmentId,
      g: state.globals,
      p: state.authProfiles,
      t: state.tabs,
      at: state.activeTabId,
    };
    unsubscribePersist = subscribe(() => {
      const next = {
        c: state.collections,
        h: state.history,
        e: state.environments,
        a: state.activeEnvironmentId,
        g: state.globals,
        p: state.authProfiles,
        t: state.tabs,
        at: state.activeTabId,
      };
      const tabsChanged =
        next.t.length !== last.t.length || next.t.some((t, i) => t.request !== last.t[i]?.request || t.savedId !== last.t[i]?.savedId);
      const changed =
        next.c !== last.c ||
        next.h !== last.h ||
        next.e !== last.e ||
        next.a !== last.a ||
        next.g !== last.g ||
        next.p !== last.p ||
        tabsChanged ||
        next.at !== last.at;
      last = next;
      if (!changed) return;
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        persistTimer = undefined;
        void storage.setItem(storageKey, serialize());
      }, persistence?.debounce ?? 300);
    });
  }

  function applyPersisted(data: Record<string, unknown>) {
    if (data.version !== STORAGE_VERSION) return;
    const parsed = importWorkspace(
      {
        format: 'm2api-client',
        version: 1,
        collections: data.collections ?? [],
        environments: data.environments ?? [],
        authProfiles: data.authProfiles ?? [],
      },
      { regenerateIds: false },
    );
    const patch: Partial<WorkspaceState> = {};
    if (parsed.ok) {
      if (include.has('collections') && Array.isArray(data.collections)) patch.collections = parsed.data.collections;
      if (include.has('environments') && Array.isArray(data.environments)) {
        patch.environments = parsed.data.environments;
        const active = typeof data.activeEnvironmentId === 'string' ? data.activeEnvironmentId : null;
        patch.activeEnvironmentId = parsed.data.environments.some((e) => e.id === active)
          ? active
          : (parsed.data.environments[0]?.id ?? null);
      }
      if (include.has('authProfiles') && Array.isArray(data.authProfiles)) patch.authProfiles = parsed.data.authProfiles;
    }
    if (include.has('globals') && Array.isArray(data.globals)) {
      patch.globals = (data.globals as Variable[]).filter((v) => v && typeof v.key === 'string' && typeof v.value === 'string');
    }
    if (include.has('history') && Array.isArray(data.history)) {
      patch.history = (data.history as HistoryEntry[]).flatMap((h) => {
        const request = parseRequestDefinition(h?.request);
        return request && typeof h.timestamp === 'number' && h.outcome
          ? [{ id: String(h.id), timestamp: h.timestamp, outcome: h.outcome, request }]
          : [];
      });
    }
    if (include.has('tabs') && Array.isArray(data.tabs)) {
      const tabs = (data.tabs as Array<{ id?: string; request?: unknown; savedId?: string; dirty?: boolean }>).flatMap((t) => {
        const request = parseRequestDefinition(t?.request);
        if (!request) return [];
        return [
          {
            ...blankTab(request, typeof t.savedId === 'string' ? t.savedId : undefined),
            id: typeof t.id === 'string' ? t.id : createId('tab'),
            dirty: Boolean(t.dirty),
          },
        ];
      });
      if (tabs.length) {
        patch.tabs = tabs;
        patch.activeTabId = tabs.some((t) => t.id === data.activeTabId) ? (data.activeTabId as string) : tabs[0].id;
      }
    }
    setState(patch);
  }

  /** Writes pending changes immediately. */
  async function flush() {
    if (!storage || !unsubscribePersist) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = undefined;
    await storage.setItem(storageKey, serialize());
  }

  async function clearPersisted() {
    await storage?.removeItem(storageKey);
  }

  /** Cancels in-flight requests and writes pending changes. The store stays usable. */
  function destroy() {
    controllers.forEach((c) => c.abort());
    if (persistTimer) void flush();
  }

  function setCallbacks(next: Partial<typeof callbacks>) {
    callbacks = { ...callbacks, ...next };
  }

  const actions = {
    newTab,
    openTab,
    closeTab,
    setActiveTab: (tabId: string) => setState({ activeTabId: tabId }),
    updateRequest,
    duplicateTab,
    send,
    cancel,
    requestOAuth2Token,
    saveTab,
    openSaved,
    addCollection,
    addFolder,
    rename,
    remove,
    duplicate,
    move,
    setCollectionVariables,
    openHistoryEntry,
    replayHistoryEntry,
    removeHistoryEntry: (id: string) => setState((s) => ({ history: removeHistoryEntry(s.history, id) })),
    clearHistory: () => setState({ history: [] }),
    addEnvironment,
    updateEnvironment,
    removeEnvironment,
    duplicateEnvironment,
    setActiveEnvironment,
    setGlobals,
    addAuthProfile,
    updateAuthProfile,
    removeAuthProfile,
    importData,
    importJson,
    importOpenApi: importOpenApiDocument,
    importCurl,
    exportData,
  };

  return {
    client,
    getState,
    subscribe,
    actions,
    getVariableScopes,
    getResolver,
    prepareTab,
    hydrate,
    flush,
    clearPersisted,
    destroy,
    setCallbacks,
    get templates() {
      return [...DEFAULT_TEMPLATES, ...(options.templates ?? [])];
    },
    get hasOAuth2Integration() {
      return Boolean(callbacks.oauth2);
    },
    get oauth2Label() {
      return callbacks.oauth2?.label ?? 'Get access token';
    },
  };
}

export type Workspace = ReturnType<typeof createWorkspace>;
export type WorkspaceActions = Workspace['actions'];
