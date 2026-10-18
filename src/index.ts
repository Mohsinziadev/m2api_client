// Public API of m2api-client. Everything not exported here is internal and may change.

// Core request engine (UI-independent)
export { HTTP_METHODS } from './core/types';
export type {
  ApiKeyAuth,
  ApiResponse,
  AuthConfig,
  AuthProfile,
  AuthType,
  BasicAuth,
  BearerAuth,
  BodySource,
  CustomAuth,
  Environment,
  HeadersInput,
  HttpMethod,
  KeyValueEntry,
  MultipartField,
  NoAuth,
  OAuth2Auth,
  PreparedRequest,
  ProfileAuth,
  QueryParamsInput,
  QueryValue,
  RequestBodyDefinition,
  RequestBodyType,
  RequestConfig,
  RequestDefinition,
  RequestSettings,
  RequestSnapshot,
  ResponseBodyKind,
  ResponseTiming,
  ResponseType,
  Variable,
  VariablesInput,
} from './core/types';
export { ApiError, isApiError, NETWORK_ERROR_HINT } from './core/errors';
export type { ApiErrorInfo, ApiErrorKind } from './core/errors';
export { createApiClient } from './core/client';
export type { ApiClientInstance, ApiClientOptions, Middleware, SendOptions } from './core/client';
export { createFetchTransport, createMockTransport, fetchTransport } from './core/transport';
export type { FetchTransportOptions, MockResponseInit, Transport, TransportOptions, TransportResponse } from './core/transport';
export { DEFAULT_TIMEOUT, prepareDefinition, prepareRequest } from './core/prepare';
export type { PrepareContext, PrepareDefinitionContext } from './core/prepare';
export { classifyBody, isJsonContentType, isTextContentType } from './core/response';
export { REDACTED, redactPreparedRequest, snapshotRequest } from './core/redact';
export {
  appendQuery,
  joinUrl,
  parseQueryString,
  splitUrl,
  syncParamsFromUrl,
  syncUrlFromParams,
  validateUrl,
  withDefaultScheme,
} from './core/url';
export type { UrlValidation } from './core/url';
export { cloneRequest, createKeyValue, createRequest, DEFAULT_HEADER_PRESETS, DEFAULT_TEMPLATES, describeRequest } from './core/request';
export type { HeaderPreset, RequestDefinitionInput, RequestTemplate } from './core/request';

// Authentication
export { applyAuth, AUTH_TYPE_LABELS, defaultAuthConfig } from './auth/apply';
export type { ApplyAuthOptions, AuthResult } from './auth/apply';

// Environment variables
export {
  DYNAMIC_VARIABLES,
  VARIABLE_SCOPES,
  VariableResolver,
  findVariableReferences,
  interpolate,
  isPureVariableReference,
  mergeVariableScopes,
  tokenizeTemplate,
} from './env/variables';
export type { InterpolationResult, ResolvedVariable, VariableScope, VariableScopes } from './env/variables';

// cURL
export { shellQuote, toCurl } from './curl/export';
export type { CurlExportOptions } from './curl/export';
export { CurlParseError, parseCurl, tokenizeShell } from './curl/import';
export type { CurlImportResult } from './curl/import';

// Collections, import/export, OpenAPI
export {
  addNode,
  cloneNode,
  countRequests,
  createCollection,
  createFolder,
  duplicateNode,
  findNode,
  listRequests,
  moveNode,
  removeNode,
  renameNode,
  saveRequestToCollection,
  toCollectionRequest,
  toRequestDefinition,
} from './collections/collections';
export type { Collection, CollectionFolder, CollectionNode, CollectionRequest, NodeLocation } from './collections/collections';
export { EXPORT_FORMAT, EXPORT_VERSION, exportWorkspace, importWorkspace, serializeWorkspace } from './collections/io';
export type { ImportOptions, ImportResult, WorkspaceData, WorkspaceExport } from './collections/io';
export { importOpenApi, OpenApiImportError } from './openapi/import';
export type { OpenApiImportResult } from './openapi/import';

// History and persistence
export { addHistoryEntry, createHistoryEntry, DEFAULT_HISTORY_LIMIT, groupHistoryByDay, removeHistoryEntry } from './history/history';
export type { HistoryEntry, HistoryOutcome } from './history/history';
export { createMemoryStorage, createWebStorage } from './persistence/storage';
export type { StorageAdapter } from './persistence/storage';
export { containsLiteralSecret, sanitizeCollection, sanitizeEnvironment, sanitizeRequest } from './persistence/sanitize';
export type { SanitizeOptions } from './persistence/sanitize';

// Workspace store
export { createWorkspace } from './state/workspace';
export type {
  OAuth2Integration,
  PersistedSlice,
  PersistenceOptions,
  RequestStatus,
  RequestTab,
  Workspace,
  WorkspaceActions,
  WorkspaceOptions,
  WorkspaceState,
} from './state/workspace';

// Utilities
export { formatBytes, formatDuration } from './utils/format';

// React: components
export { ApiClient } from './ui/ApiClient';
export type { ApiClientProps, SidebarView, WorkspaceLayout } from './ui/ApiClient';
export { ApiClientProvider, useWorkspaceSelector } from './ui/context';
export type { ApiClientProviderProps } from './ui/context';
export { RequestBuilder } from './ui/RequestBuilder';
export type { RequestBuilderProps, RequestBuilderTab } from './ui/RequestBuilder';
export { ResponseViewer } from './ui/ResponseViewer';
export type { ResponseViewerProps, ResponseViewerTab } from './ui/ResponseViewer';
export { RequestHistory } from './ui/RequestHistory';
export type { RequestHistoryProps } from './ui/RequestHistory';
export { CollectionExplorer } from './ui/CollectionExplorer';
export type { CollectionExplorerProps } from './ui/CollectionExplorer';
export { EnvironmentManager, EnvironmentSelector } from './ui/EnvironmentManager';
export type { EnvironmentManagerProps, EnvironmentSelectorProps } from './ui/EnvironmentManager';
export { UiRoot as ThemeProvider } from './ui/Root';
export type { ThemeMode, ThemeToken, ThemeTokens, UiRootProps as ThemeProviderProps } from './ui/Root';
export { JsonTree } from './ui/primitives/JsonTree';
export type { JsonTreeProps } from './ui/primitives/JsonTree';
export { sanitizeHtml } from './utils/sanitizeHtml';

// React: hooks
export { useApiClient } from './hooks/useApiClient';
export type { UseApiClientResult } from './hooks/useApiClient';
export { useApiRequest } from './hooks/useApiRequest';
export type { ApiRequestStatus, UseApiRequestOptions, UseApiRequestResult } from './hooks/useApiRequest';
