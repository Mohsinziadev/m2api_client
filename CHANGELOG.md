# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-18

Initial release.

### Added

- `ApiClient` workspace: collections, history and environments sidebar; request tabs; resizable request and response panels; responsive drawer and stacked layouts; light, dark and system themes.
- `RequestBuilder`: all seven HTTP methods, URL validation and resolved-URL preview, query params and headers tables (enable/disable, descriptions, bulk edit, presets), JSON / text / URL-encoded / multipart bodies, a JSON editor with highlighting, validation and formatting, and timeout, redirect and credentials settings. Works connected or controlled.
- `ResponseViewer`: status, time, size and a timing breakdown; JSON, tree, raw, sanitized HTML/image preview, headers and resolved-request views; search with match navigation; copy and download; readable network, CORS, timeout, cancellation and parse errors; limits for large and binary bodies.
- Authentication: Bearer, Basic, API key (header or query), OAuth 2.0 token integration, custom headers and reusable auth profiles.
- Environments, collection and global variables with documented precedence, secret masking and dynamic variables (`$uuid`, `$timestamp`, `$isoTimestamp`, `$randomInt`).
- Collections with folders: rename, duplicate, move (including drag and drop) and delete with confirmation. A documented JSON import/export format (version 1). OpenAPI 3.x / Swagger 2.0 JSON import.
- Request history with replay; cURL import (paste into the URL bar) and export.
- `createApiClient()` engine: middleware, custom transports (`createFetchTransport`, `createMockTransport`), typed `ApiError`s, timeouts and cancellation.
- `useApiRequest()` and `useApiClient()` hooks; `createWorkspace()` headless store; opt-in persistence with storage adapters that never store secrets by default.
- Design tokens exposed as CSS custom properties, keyboard shortcuts, and accessible tabs, menus, tree and dialogs.
