# m2api-client

An API testing workspace for React, with a typed request engine you can use without the UI.

**[Live demo and docs →](https://www.m2toolkit.com/npm-packages/m2api-client)**

Drop a Postman-style workspace into your own app (internal tools, developer portals, admin panels, docs), or use the individual panels and hooks to build your own. Requests run from the browser with `fetch`, through a transport you can replace.

```tsx
import { ApiClient } from 'm2api-client';
import 'm2api-client/styles.css';

export default function App() {
  return (
    <div style={{ height: '100vh' }}>
      <ApiClient baseUrl="https://api.example.com" theme="light" initialMethod="GET" />
    </div>
  );
}
```

- **Request builder**: all seven HTTP methods, URL validation, query params and headers tables (enable/disable, descriptions, bulk edit), JSON / raw text / URL-encoded / multipart bodies, a JSON editor with highlighting, validation and formatting, plus timeout, redirect and credentials settings.
- **Response inspector**: status, time, size, timing breakdown; pretty JSON, a collapsible tree, raw text, a sanitized HTML/image preview, headers, and the resolved request. Search with match navigation; copy and download.
- **Auth**: Bearer, Basic, API key (header or query), OAuth 2.0 integration point, custom headers and reusable auth profiles.
- **Environments**: `{{variables}}` in URLs, params, headers, bodies and auth; scoped precedence; secret masking; built-in dynamic values.
- **Collections and history**: folders, rename, duplicate, move (drag and drop), delete with confirmation, a documented JSON import/export format, OpenAPI 3 / Swagger 2 import, and replayable history.
- **cURL**: copy any request as cURL; paste a cURL command into the URL bar to import it.
- **Engine**: `createApiClient()` with middleware, custom transports, typed errors and timeouts. No UI and no React required.
- **Quality**: TypeScript-first, ESM + CJS, tree-shakeable, `'use client'`-ready, keyboard accessible, light and dark themes, zero runtime dependencies besides React.

**Contents:** [Installation](#installation) · [Quick start](#quick-start) · [Components](#components) · [Hooks](#hooks) · [Programmatic client](#programmatic-client) · [Authentication](#authentication) · [Environments and variables](#environments-and-variables) · [Collections, history and import/export](#collections-history-and-importexport) · [Persistence](#persistence) · [Theming](#theming-and-customization) · [Security and CORS](#security-and-cors) · [Troubleshooting](#troubleshooting) · [Features and limitations](#supported-features-and-limitations) · [Development](#development)

## Installation

```bash
npm install m2api-client
# or: pnpm add m2api-client / yarn add m2api-client
```

Requirements:

- React 18 or 19 and React DOM. These are peer dependencies and are never bundled.
- Browsers: Chrome/Edge 111+, Safari 16.4+, Firefox 113+.
- Node 18+ for SSR and for the engine.

Import the stylesheet once, for example in your app entry or root layout:

```ts
import 'm2api-client/styles.css';
```

Every rule in the stylesheet is scoped under `.m2a`, so it does not touch the rest of your page.

## Quick start

### The complete workspace

`<ApiClient>` fills its parent, so give the parent a height:

```tsx
import { ApiClient } from 'm2api-client';
import 'm2api-client/styles.css';

export function ApiPlayground() {
  return (
    <div style={{ height: 720 }}>
      <ApiClient
        baseUrl="https://jsonplaceholder.typicode.com"
        initialMethod="GET"
        initialUrl="{{baseUrl}}/users/1"
        environments={[
          { id: 'dev', name: 'Development', variables: [{ key: 'userId', value: '1' }] },
          { id: 'prod', name: 'Production', variables: [{ key: 'apiToken', value: '', secret: true }] },
        ]}
      />
    </div>
  );
}
```

`baseUrl` does two things: it is prepended to relative URLs, and it is available everywhere as `{{baseUrl}}`.

### Next.js (App Router)

All components are marked `'use client'`, so you can render them from a Server Component page:

```tsx
// app/playground/page.tsx
import { ApiClient } from 'm2api-client';
import 'm2api-client/styles.css';

export default function Page() {
  return (
    <main style={{ height: '100dvh' }}>
      <ApiClient baseUrl="https://api.example.com" theme="system" />
    </main>
  );
}
```

### Data fetching in your own components

```tsx
import { useApiRequest } from 'm2api-client';

interface User {
  id: number;
  name: string;
}

function UserProfile() {
  const { execute, data, loading, error } = useApiRequest<User>();

  async function loadUser() {
    await execute({
      url: 'https://api.example.com/users/1',
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  }

  return (
    <div>
      <button onClick={loadUser} disabled={loading}>
        {loading ? 'Loading...' : 'Load user'}
      </button>
      {error && <p role="alert">{error.message}</p>}
      {data !== undefined && <pre>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
```

More copy-ready examples are in [`examples/`](./examples). They are type-checked against the published package on every build.

## Components

| Export | Purpose |
| --- | --- |
| `ApiClient` | The complete workspace: sidebar (collections, history, environments), request tabs, request builder and response viewer. |
| `ApiClientProvider` | Holds one workspace store for the panels below, so you can compose your own layout. |
| `RequestBuilder` | Method, URL and Send, plus the Params / Headers / Authorization / Body / Settings tabs. Connected or controlled. |
| `ResponseViewer` | Status, timing, size and the response views. Connected or controlled. |
| `CollectionExplorer` | Saved requests in collections and folders. |
| `RequestHistory` | Sent requests grouped by day, with open, replay and save actions. |
| `EnvironmentManager` / `EnvironmentSelector` | Edit environments and globals; switch the active environment. |
| `ThemeProvider` | The themed root element (`.m2a`). Use it to wrap a custom layout. |
| `JsonTree` | The collapsible JSON viewer, on its own. |

### `<ApiClient>` props

`ApiClient` accepts every [workspace option](#workspace-options), plus:

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `theme` | `'light' \| 'dark' \| 'system'` | `'light'` | The header button toggles between light and dark. |
| `onThemeChange` | `(theme) => void` | | Called when the user toggles the theme. |
| `tokens` | `ThemeTokens` | | Design-token overrides, for example `{ accent: '#7c3aed' }`. |
| `initialMethod` / `initialUrl` | `HttpMethod` / `string` | `GET` / `baseUrl` | Shorthand for `initialRequest`. |
| `layout` | `'horizontal' \| 'vertical'` | `'horizontal'` | Request and response side by side, or stacked. Narrow containers always stack. |
| `title` | `ReactNode \| null` | `'m2api'` | Header title. `null` hides the header. |
| `sidebar` | `boolean` | `true` | Whether the sidebar starts open on wide containers. |
| `defaultSidebarView` | `'collections' \| 'history' \| 'environments'` | `'collections'` | |
| `headerPresets` | `HeaderPreset[]` | | Extra entries for the Headers → Presets menu. |
| `headerActions` | `ReactNode` | | Your own controls in the header. |
| `workspace` | `Workspace` | | A store from `createWorkspace()`. When set, the workspace options are ignored. |
| `height`, `className`, `style` | | `height: 100%` | Minimum height is 480px. |

### Workspace options

These are shared by `ApiClient`, `ApiClientProvider` and `createWorkspace()`. They are read once, on mount; callbacks stay live.

| Option | Type | |
| --- | --- | --- |
| `baseUrl` | `string` | Base for relative URLs, and the global `{{baseUrl}}`. |
| `defaultHeaders` | `HeadersInput` | Sent with every workspace request. The request's own headers win. |
| `client` | `ApiClientInstance` | A configured client: transport, middleware, defaults. |
| `initialRequest` | `RequestDefinitionInput` | The first tab. |
| `collections`, `environments`, `globals`, `authProfiles`, `history` | | Initial data. |
| `activeEnvironmentId` | `string \| null` | Defaults to the first environment. |
| `historyLimit` | `number` | Default 100. `0` disables history. |
| `persistence` | `boolean \| PersistenceOptions` | Opt-in. Nothing is stored unless you set it; see [Persistence](#persistence). |
| `templates` | `RequestTemplate[]` | Extra "New request from template" entries. |
| `oauth2` | `{ getAccessToken(auth): Promise<string>; label? }` | Adds a "Get access token" button to the OAuth 2.0 auth type. |
| `onResponse`, `onError` | `(result, request) => void` | Observe every workspace send. |

### Composing your own layout

```tsx
import { ApiClientProvider, CollectionExplorer, RequestBuilder, ResponseViewer, ThemeProvider, useApiClient } from 'm2api-client';

function SendCount() {
  const { state } = useApiClient();
  return <span>{state.history.length} requests sent</span>;
}

export function MyLayout() {
  return (
    <ApiClientProvider baseUrl="https://api.example.com" initialRequest={{ url: '{{baseUrl}}/health' }}>
      <ThemeProvider theme="system" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', height: 640 }}>
        <CollectionExplorer />
        <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr 1fr', minHeight: 0 }}>
          <SendCount />
          <RequestBuilder />
          <ResponseViewer />
        </div>
      </ThemeProvider>
    </ApiClientProvider>
  );
}
```

### Controlled `RequestBuilder` and `ResponseViewer`

Without a provider, both components are controlled: you own the request state and decide what Send does.

```tsx
import { useState } from 'react';
import { createRequest, prepareDefinition, RequestBuilder, ResponseViewer, useApiRequest } from 'm2api-client';

export function Editor() {
  const [request, setRequest] = useState(() => createRequest({ method: 'POST', url: 'https://httpbin.org/anything' }));
  const { execute, response, error, loading, cancel } = useApiRequest({ validateStatus: null });

  return (
    <>
      <RequestBuilder
        request={request}
        onRequestChange={setRequest}
        loading={loading}
        onCancel={cancel}
        onSend={(definition) => {
          const prepared = prepareDefinition(definition, { variables: { name: 'world' } });
          void execute({ url: prepared.url, method: prepared.method, headers: prepared.headers, body: prepared.body });
        }}
      />
      <ResponseViewer response={response ?? null} error={error} loading={loading} onCancel={cancel} />
    </>
  );
}
```

`RequestBuilder` props: `request`, `onRequestChange`, `onSend`, `onCancel`, `loading`, `variables`, `authProfiles`, `tabId` (connected mode: edit a specific tab), `defaultTab`, `headerPresets`, `theme`, `className`.

`ResponseViewer` props: `response`, `error`, `loading`, `onCancel`, `onRetry`, `tabId`, `defaultTab` (`'pretty' | 'tree' | 'raw' | 'preview' | 'headers' | 'request'`), `emptyState`, `theme`, `className`.

Rendered outside `ApiClient` or `ThemeProvider`, a panel creates its own themed root, so it works as a standalone widget.

## Hooks

### `useApiRequest<T>(options?)`

Runs requests from components and tracks loading, data and errors. It handles cancellation and races between overlapping calls.

```ts
const { execute, data, response, error, loading, status, cancel, reset } = useApiRequest<User>({
  client,               // optional: defaults to the surrounding <ApiClient>'s client, else a shared fetch client
  defaults: { baseUrl: 'https://api.example.com', headers: { Accept: 'application/json' } },
  validateStatus: null, // treat every status as success (default: 2xx only)
  abortPrevious: true,  // cancel the in-flight request when execute() runs again (default)
  onSuccess: (res) => {},
  onError: (err) => {},
});

await execute('https://api.example.com/users/1');           // a URL
await execute({ url: '/users', method: 'POST', json: { name: 'Ada' } }); // or a RequestConfig
```

`execute` never rejects. It resolves with the response, or `undefined` when the request failed (see `error`), was cancelled, or was superseded. Requests still running when the component unmounts are cancelled.

### `useApiClient()`

Gives access to the surrounding workspace: `{ state, actions, client, workspace }`.

```ts
const { state, actions } = useApiClient();
actions.newTab({ method: 'GET', url: '{{baseUrl}}/health' });
await actions.send();
actions.importCurl(`curl https://api.example.com/users -H 'Accept: application/json'`);
actions.setActiveEnvironment('prod');
```

The actions are: `newTab`, `openTab`, `closeTab`, `setActiveTab`, `updateRequest`, `duplicateTab`, `send`, `cancel`, `saveTab`, `openSaved`, `addCollection`, `addFolder`, `rename`, `remove`, `duplicate`, `move`, `setCollectionVariables`, `openHistoryEntry`, `replayHistoryEntry`, `removeHistoryEntry`, `clearHistory`, `addEnvironment`, `updateEnvironment`, `removeEnvironment`, `duplicateEnvironment`, `setActiveEnvironment`, `setGlobals`, `addAuthProfile`, `updateAuthProfile`, `removeAuthProfile`, `importData`, `importJson`, `importOpenApi`, `importCurl`, `exportData` and `requestOAuth2Token`.

`useWorkspaceSelector(selector)` subscribes to a single slice of state, so a component re-renders only when that slice changes. `createWorkspace(options)` creates the same store outside React; subscribe to it with `workspace.subscribe(listener)`.

## Programmatic client

`createApiClient()` is the engine behind everything. It has no UI and no React dependency, so it runs in browsers, Node 18+, workers and tests.

```ts
import { createApiClient, isApiError, type Middleware } from 'm2api-client';

const logging: Middleware = async (request, next) => {
  const response = await next(request);
  console.info(request.method, request.url, response.status, `${Math.round(response.timing.duration)} ms`);
  return response; // never log request.headers: they may contain credentials
};

const api = createApiClient({
  baseUrl: 'https://api.example.com',
  headers: { Accept: 'application/json' },
  auth: { type: 'bearer', token: '{{apiToken}}' },
  variables: { apiToken: await getTokenFromYourBackend() },
  timeout: 10_000,
  middleware: [logging],
});

const { data } = await api.get<User[]>('/users', { params: { page: 2, tags: ['a', 'b'] } });
const created = await api.post<User>('/users', { name: 'Ada' }); // objects are sent as JSON

try {
  await api.delete('/users/1');
} catch (error) {
  if (isApiError(error)) {
    error.kind;     // 'http' | 'network' | 'timeout' | 'aborted' | 'parse' | 'invalid-request'
    error.status;   // for 'http'
    error.hint;     // a human-readable suggestion
    error.response; // the full ApiResponse for 'http' and 'parse'
  }
}
```

The client exposes `request`, `get`, `post`, `put`, `patch`, `delete`, `head` and `options`. It also has:

- `prepare(config)`: resolves a config without sending it, for previews and cURL.
- `send(prepared)`: sends an already prepared request.
- `use(middleware)`: adds middleware and returns a function that removes it.
- `extend(options)`: creates a derived client.

**`RequestConfig`** fields: `url`, `method`, `baseUrl`, `params`, `headers`, `body`, `json`, `auth`, `timeout`, `signal`, `responseType` (`'auto' | 'json' | 'text' | 'blob' | 'arrayBuffer'`), `variables`, `credentials`, `redirect`, `validateStatus` and `meta`.

**`ApiResponse<T>`** fields: `ok`, `status`, `statusText`, `url`, `redirected`, `headers` (lower-cased), `data`, `text`, `bodyKind` (`'json' | 'text' | 'binary' | 'empty'`), `contentType`, `size`, `raw`, `timing` (`startTime`, `duration`, `ttfb?`, `download?`), `request` (a redacted snapshot) and `parseError?`.

By default only 2xx responses resolve; anything else rejects with an `http` error. Pass `validateStatus: null` to resolve every status (the workspace does this).

### Custom transports

A transport turns a prepared request into a response. Replace it to route requests through your own proxy, add mocks, or use a different HTTP stack:

```ts
import { createApiClient, createMockTransport, fetchTransport, type Transport } from 'm2api-client';

// Send everything through your own backend proxy (see "When do I need a proxy?").
const viaProxy: Transport = {
  send(request, options) {
    return fetchTransport.send({ ...request, url: `/api/proxy?url=${encodeURIComponent(request.url)}` }, options);
  },
};

// Tests and demos: answer from a function. Supports delay, timeouts and cancellation.
const mock = createMockTransport((request) => ({ status: 200, body: { echo: request.url }, delay: 50 }));

const api = createApiClient({ transport: import.meta.env.DEV ? mock : viaProxy });
```

`createFetchTransport({ fetch })` lets you supply a specific `fetch` implementation.

## Authentication

Set auth per request in the **Authorization** tab, through `auth` in a `RequestConfig`, or as a client default.

| Type | Config | Sends |
| --- | --- | --- |
| None | `{ type: 'none' }` | No credentials. |
| Bearer | `{ type: 'bearer', token, prefix? }` | `Authorization: Bearer <token>` |
| Basic | `{ type: 'basic', username, password }` | `Authorization: Basic <base64>` (UTF-8 safe) |
| API key | `{ type: 'apiKey', key, value, in: 'header' \| 'query' }` | A header (recommended) or a query parameter |
| OAuth 2.0 | `{ type: 'oauth2', accessToken, headerPrefix?, authorizationUrl?, tokenUrl?, clientId?, scope? }` | `Authorization: Bearer <accessToken>` |
| Custom | `{ type: 'custom', headers: KeyValueEntry[] }` | Any headers, such as `X-Signature` |
| Profile | `{ type: 'profile', profileId }` | Whatever the referenced auth profile sends |

**Auth profiles** are named, reusable credentials. In the Authorization tab choose **Save as reusable profile**, then pick it from any request. Changing the profile updates every request that uses it.

**OAuth 2.0.** m2api-client does not run OAuth flows itself. Run the flow with your identity provider's SDK (Authorization Code + PKCE in a popup) or on your backend, then pass the token in through an integration:

```tsx
<ApiClient
  oauth2={{
    label: 'Sign in with Acme',
    getAccessToken: async (auth) => acmeAuth.getTokenSilently({ scope: auth.scope }),
  }}
/>
```

> **Never embed OAuth client secrets, API keys for privileged accounts, or production credentials in frontend code.** Everything shipped to the browser can be read by its users. Use public clients with PKCE, short-lived tokens issued by your backend, or a server-side proxy that adds credentials.

Credentials are protected in several ways:

- Literal credentials are masked in history, request snapshots and errors.
- They are never written to storage unless you opt in.
- The UI suggests `{{secret variables}}` over literal values.
- An API key sent in the query string gets a warning, because query strings leak into server logs and history.

## Environments and variables

Write `{{name}}` anywhere: URL, params, headers, body, form fields and auth fields. Variables that resolve are highlighted; unresolved ones show in red, with a warning under the URL bar.

**Precedence**, highest first:

1. **Request**: variables passed with a programmatic request (`RequestConfig.variables`).
2. **Active environment**: for example Development, Staging or Production.
3. **Collection**: variables of the collection the request is saved in.
4. **Globals**: including `{{baseUrl}}` from the `baseUrl` option.

Further rules:

- Variable values may reference other variables, up to eight levels deep.
- Disabled variables are ignored.
- **Dynamic variables** are computed at send time: `{{$uuid}}`, `{{$timestamp}}` (Unix seconds), `{{$isoTimestamp}}` and `{{$randomInt}}`.

```ts
environments={[
  {
    id: 'staging',
    name: 'Staging',
    variables: [
      { key: 'baseUrl', value: 'https://staging.api.example.com' },
      { key: 'apiToken', value: '', secret: true, description: 'Paste a short-lived token' },
    ],
  },
]}
```

**Secret variables** (the lock icon) are handled carefully:

- Values are masked in the UI.
- They are redacted from snapshots, history and cURL previews unless you reveal them.
- They are never persisted or exported unless you explicitly opt in.

For one-off interpolation, use `interpolate('{{a}}-{{b}}', { a: '1', b: '2' })`.

## Collections, history and import/export

- **Save** (`⌘S` / `Ctrl+S`) stores the current tab in a collection or folder.
- Each item's `⋯` menu has rename (F2), duplicate, move, delete, new request, new folder, collection variables and export.
- You can drag requests and folders onto a folder or collection to move them.
- **History** keeps the last 100 sends: method, URL, status, time and size. Entries can be reopened, replayed (with the *current* environment), saved or deleted.
- **Import** (header button, or the sidebar `⋯` menu) accepts three formats and detects which one you gave it:
  - an m2api-client export,
  - an **OpenAPI 3.x / Swagger 2.0 JSON** document,
  - a **cURL** command.

### Export format (version 1)

```json
{
  "format": "m2api-client",
  "version": 1,
  "exportedAt": "2026-01-01T00:00:00.000Z",
  "collections": [
    {
      "id": "col_1",
      "name": "Users API",
      "variables": [{ "key": "baseUrl", "value": "https://api.example.com" }],
      "items": [
        {
          "type": "folder",
          "id": "fld_1",
          "name": "Users",
          "items": [
            {
              "type": "request",
              "id": "req_1",
              "name": "List users",
              "method": "GET",
              "url": "{{baseUrl}}/users",
              "params": [{ "id": "kv_1", "key": "page", "value": "1", "enabled": true }],
              "headers": [],
              "body": { "type": "none" },
              "auth": { "type": "bearer", "token": "{{apiToken}}" },
              "settings": { "timeout": 10000 }
            }
          ]
        }
      ]
    }
  ],
  "environments": [{ "id": "env_1", "name": "Production", "variables": [{ "key": "apiToken", "value": "", "secret": true }] }],
  "authProfiles": []
}
```

- `body` is one of `{ type: 'none' }`, `{ type: 'json', content }`, `{ type: 'text', content, contentType? }`, `{ type: 'urlencoded', fields }` or `{ type: 'multipart', fields }`. Multipart files are never exported.
- Imports are validated field by field and report every problem with its path. Ids are regenerated, and internal references such as auth profiles are remapped.
- A bare collection object (`{ "name", "items" }`) is accepted too.

The same functions are available in code: `exportWorkspace`, `serializeWorkspace`, `importWorkspace`, `importOpenApi`, `parseCurl` and `toCurl`.

### cURL

- **Export**: in the request `⋯` menu choose **Copy as cURL**. Secrets are masked unless you tick *Include secrets*.
- **Import**: paste a command into the URL bar, or use **Replace from cURL…**.

Supported flags: `-X`, `-H`, `-d` / `--data*`, `--data-urlencode`, `--json`, `-F` / `--form`, `-u`, `--oauth2-bearer`, `-A`, `-e`, `-b`, `-G`, `-I`, `-m` and `--url`. Line continuations and both quote styles are handled. Flags that a browser cannot honour, such as `--proxy` or `-k`, are ignored with a warning.

## Persistence

Nothing is stored by default. Opt in per workspace:

```tsx
<ApiClient
  persistence={{
    storage: createWebStorage('local'), // default; or 'session', createMemoryStorage(), or your own adapter
    key: 'my-app:api-workspace',        // default 'm2api-client:workspace'
    include: ['collections', 'environments', 'history'], // default: collections, history, environments, globals, authProfiles, tabs
    includeSecrets: false,              // default: secret values and literal credentials are NOT stored
    debounce: 300,
  }}
/>
```

A `StorageAdapter` has three methods: `getItem`, `setItem` and `removeItem`. Each may be sync or async, so IndexedDB, `chrome.storage`, an encrypted store or a backend all work. Responses and multipart files are never persisted. Use `workspace.flush()` to write immediately, and `workspace.clearPersisted()` to forget the stored data.

## Theming and customization

```tsx
<ApiClient theme="system" tokens={{ accent: '#7c3aed', radius: '4px', font: 'Inter, sans-serif' }} />
```

Every token is a CSS custom property named `--m2a-<token>`, so you can also theme from CSS:

```css
.m2a {
  --m2a-accent: #7c3aed;
  --m2a-accent-hover: #6d28d9;
  --m2a-font-size: 14px;
}
.m2a[data-theme='dark'] {
  --m2a-bg: #0b0b10;
}
```

Available tokens:

- **Typography and shape**: `font`, `mono`, `font-size`, `radius`
- **Surfaces**: `bg`, `surface`, `surface-2`, `surface-3`, `border`, `border-strong`
- **Text**: `text`, `text-muted`, `text-faint`
- **Accent and status**: `accent`, `accent-hover`, `accent-soft`, `on-accent`, `focus`, `success`, `warning`, `danger`, `info`
- **Methods**: `method-get`, `method-post`, `method-put`, `method-patch`, `method-delete`, `method-head`, `method-options`
- **Syntax and search highlights**: `--m2a-tok-key`, `--m2a-tok-string`, `--m2a-tok-number`, `--m2a-tok-literal`, `--m2a-tok-punct`, `--m2a-mark`, `--m2a-mark-active` (CSS-only)

Layout and responsiveness:

- The workspace adapts to the width of **its container**, not the viewport.
- Below 900px the sidebar becomes a drawer.
- Below 760px the request and response panels stack.
- Both dividers can be dragged, or moved with the arrow keys once focused. Double-click a divider to reset it.

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `⌘/Ctrl + Enter` | Send request |
| `⌘/Ctrl + S` | Save request |
| `⌘/Ctrl + Shift + F` | Format the JSON body |
| `Esc` (in the URL field) | Cancel the running request |
| `Esc`, then `Tab` | Leave a code editor (`Tab` indents) |
| `←` `→` `Home` `End` | Move between tabs |
| `↑` `↓` `←` `→` `Enter` `F2` `Del` | Navigate, expand, open, rename and delete in the collection tree |
| `Enter` / `Shift + Enter` | Next / previous search match |

All controls have accessible names, focus is visible everywhere, dialogs trap and restore focus, and status changes are announced to screen readers.

## Security and CORS

m2api-client runs in the browser, so requests are subject to the same rules as any web page.

- **CORS.** A cross-origin request only succeeds when the server allows your page's origin with `Access-Control-Allow-Origin`. If you send custom headers or methods, the server must also answer the preflight. Frontend code **cannot bypass CORS**, and this library does not try to. When a request is blocked, the browser does not reveal whether CORS, DNS, TLS or a refused connection was the cause. The workspace shows a *network error* with these possibilities, and the browser's devtools console shows the exact reason.
- **Forbidden headers.** Browsers silently drop headers like `Host`, `Cookie`, `Origin`, `Content-Length` or `Connection`. The editor warns you when you set one.
- **Response headers.** On cross-origin responses only CORS-safelisted headers are readable, unless the server lists others in `Access-Control-Expose-Headers`.
- **Bodies on GET/HEAD.** Browsers cannot send them; the body is dropped with a warning.
- **Mixed content.** An HTTPS page cannot call plain `http://` APIs, except `localhost` in most browsers.
- **HTML previews** are sanitized: scripts, event handlers, frames, forms and `javascript:` URLs are removed. They render in a sandboxed `<iframe>` with no script permissions and a CSP that blocks all network loads. Response content is never evaluated, and the library contains no `eval` or `new Function`.
- **Secrets** are masked in the UI, redacted from snapshots, history, errors and cURL previews, and not persisted or exported unless you opt in. The library never logs headers or variable values.

### When do I need a proxy?

Use a small server-side proxy (your backend, an edge function or a dev-server proxy) when any of these apply:

- the API does not send CORS headers for your origin, and you cannot change it;
- the request needs credentials that must not reach the browser, such as client secrets or privileged API keys;
- you need forbidden headers, or a body on a GET request;
- you need to reach private network hosts from a hosted page.

Route through it with a [custom transport](#custom-transports). Lock the proxy down (an allow-list of target hosts, plus authentication) so it does not become an open relay.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| **"Could not get a response / Network request failed"** | Usually CORS, an unreachable host or mixed content. Check the browser console. Enable CORS on the server or use a proxy. |
| **Status 0 / opaque response** | Redirects set to "Don't follow" return opaque responses in browsers. Set Redirects to *Follow*. |
| **A header I set is missing on the server** | It is a [forbidden header](https://developer.mozilla.org/docs/Glossary/Forbidden_header_name); the browser drops it. |
| **Response headers tab is nearly empty** | The server needs `Access-Control-Expose-Headers`. |
| **`{{variable}}` is red / sent literally** | No value in the active environment, the collection or the globals. Check the environment selector and the variable's enabled checkbox. |
| **Cookies are not sent** | Set Credentials to *Include*. The server must reply with `Access-Control-Allow-Credentials: true` and an explicit origin. |
| **The workspace has no height** | `<ApiClient>` fills its parent. Give the parent a height, or pass `height={720}`. |
| **Styles are missing** | Import `m2api-client/styles.css` once. |
| **Saved credentials disappear after reload** | Secrets are not persisted by default. Use `persistence.includeSecrets` with a trusted storage adapter, or re-enter them per session. |
| **"Request timed out"** | The default timeout is 30 s. Change it per request (Settings tab), per call (`timeout`) or per client. `0` disables it. |
| **OpenAPI import fails on YAML** | Only JSON is parsed. Convert the YAML to JSON first. |

## Supported features and limitations

Supported:

- **Requests**: GET, POST, PUT, PATCH, DELETE, HEAD and OPTIONS; query params; headers; JSON, text, URL-encoded and multipart bodies (with files); timeouts; cancellation; redirect and credentials modes.
- **Responses**: JSON, text, HTML (sanitized preview), images, binary download and empty bodies. Large bodies are truncated in the view with a "show everything" option and are never re-indented above 5 MB.
- **Auth**: Bearer, Basic, API key, OAuth 2.0 (token integration), custom headers and profiles.
- **Workspace**: environments, collection and global variables, dynamic variables, collections and folders, history and replay, templates and header presets.
- **Import/export**: the m2api-client JSON format, cURL, and OpenAPI 3.x / Swagger 2.0 (JSON).
- **Engine**: middleware, custom transports, typed errors, and the headless store.

Limitations, by design or not yet implemented:

- **Browser rules apply**: CORS, forbidden headers and opaque redirects. There is no built-in proxy.
- **No OAuth flow runner.** OAuth 2.0 is an integration point: bring your own token provider.
- **OpenAPI import** reads JSON only, resolves local `$ref`s only, and generates simple body examples. It does not cover OpenAPI's `callbacks` or `links`.
- **Not supported yet**: scripting (pre-request/test scripts are deliberately absent), GraphQL schema introspection, WebSockets and server-sent events, Postman collection import, request chaining, and response diffing.
- **Timing** is measured in the browser and includes middleware. Waiting/download phases are reported when the transport provides them.
- **The JSON editor** is a lightweight textarea-based editor without autocomplete or code folding. Very large bodies (over 100 kB) are not highlighted while editing.

## Development

```bash
npm install
npm run dev             # demo app with HMR (consumes src/)
npm test                # Vitest + React Testing Library
npm run lint && npm run typecheck && npm run format:check
npm run build           # dist/: ESM, CJS, .d.ts/.d.cts, styles.css
npm run check:package   # publint + are-the-types-wrong
npm run size            # gzip budgets per entry point
npm run smoke           # pack, install the tarball in a fresh app, type-check examples, SSR (ESM + CJS)
npm run build:demo:dist # build the demo against the compiled dist/ package
npm run verify          # all of the above (runs before publish)
```

The demo (`demo/`) contains:

- a full workspace seeded with public demo APIs ([JSONPlaceholder](https://jsonplaceholder.typicode.com), [httpbin](https://httpbin.org), [Open-Meteo](https://open-meteo.com)) and an offline mock API served by a custom transport;
- a composed-layout page;
- a hooks page.

Source layout:

```
src/
  core/         request types, preparation, transport, client, errors, redaction, URL helpers
  auth/         auth application
  env/          variable resolution
  curl/         cURL import/export
  collections/  collection tree operations, import/export format
  openapi/      OpenAPI import
  history/      history entries
  persistence/  storage adapters, sanitizing
  state/        the workspace store (framework-agnostic)
  hooks/        useApiRequest, useApiClient
  ui/           components and primitives
  styles/       tokens and stylesheet
```

See [CHANGELOG.md](./CHANGELOG.md). Licensed under [MIT](./LICENSE) © Mohsin Zia.
