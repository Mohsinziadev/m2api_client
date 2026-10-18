'use client';

import { useCallback, useMemo } from 'react';
import type { AuthProfile, PreparedRequest, RequestDefinition, VariablesInput } from '../../core/types';
import { ApiError } from '../../core/errors';
import { prepareDefinition } from '../../core/prepare';
import { VariableResolver, toResolver, type VariableScopes } from '../../env/variables';
import type { RequestTab, Workspace } from '../../state/workspace';
import { useOptionalWorkspace, useWorkspaceSelector } from '../context';

export interface RequestModelInput {
  request?: RequestDefinition;
  onRequestChange?: (request: RequestDefinition) => void;
  onSend?: (request: RequestDefinition) => void;
  onCancel?: () => void;
  loading?: boolean;
  variables?: VariableScopes | VariablesInput;
  authProfiles?: AuthProfile[];
  tabId?: string;
}

export interface RequestModel {
  request: RequestDefinition;
  update: (update: Partial<RequestDefinition> | ((r: RequestDefinition) => RequestDefinition)) => void;
  send: () => void;
  cancel: () => void;
  loading: boolean;
  resolver: VariableResolver;
  authProfiles: AuthProfile[];
  prepared: PreparedRequest | null;
  prepareError: ApiError | null;
  workspace: Workspace | null;
  tab: RequestTab | undefined;
  controlled: boolean;
}

const EMPTY_PROFILES: AuthProfile[] = [];

/** Connects request-editing UI either to the workspace (active or given tab) or to controlled props. */
export function useRequestModel(input: RequestModelInput): RequestModel {
  const workspace = useOptionalWorkspace();
  const controlled = input.request !== undefined;
  const tab = useWorkspaceSelector((s) => s.tabs.find((t) => t.id === (input.tabId ?? s.activeTabId)), controlled ? null : workspace);
  // Variable sources (stable slices) so the resolver only changes when they do.
  const environments = useWorkspaceSelector((s) => s.environments, controlled ? null : workspace);
  const activeEnvironmentId = useWorkspaceSelector((s) => s.activeEnvironmentId, controlled ? null : workspace);
  const globals = useWorkspaceSelector((s) => s.globals, controlled ? null : workspace);
  const collections = useWorkspaceSelector((s) => s.collections, controlled ? null : workspace);
  const workspaceProfiles = useWorkspaceSelector((s) => s.authProfiles, controlled ? null : workspace);

  const request = controlled ? input.request! : tab?.request;
  const tabId = tab?.id;

  const resolver = useMemo(() => {
    if (controlled || !workspace) return toResolver(input.variables as VariableScopes | VariablesInput | undefined);
    return workspace.getResolver(tabId);
    // The slices are listed so the resolver refreshes when any variable source changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlled, workspace, tabId, input.variables, environments, activeEnvironmentId, globals, collections, tab?.savedId]);

  const authProfiles = controlled ? (input.authProfiles ?? EMPTY_PROFILES) : (workspaceProfiles ?? EMPTY_PROFILES);
  const { onRequestChange, onSend, onCancel } = input;

  const update = useCallback(
    (u: Partial<RequestDefinition> | ((r: RequestDefinition) => RequestDefinition)) => {
      if (controlled) {
        const current = input.request!;
        onRequestChange?.(typeof u === 'function' ? u(current) : { ...current, ...u });
      } else if (workspace && tabId) {
        workspace.actions.updateRequest(tabId, u);
      }
    },
    [controlled, input.request, onRequestChange, workspace, tabId],
  );

  const send = useCallback(() => {
    if (controlled) onSend?.(input.request!);
    else if (workspace && tabId) void workspace.actions.send(tabId);
  }, [controlled, onSend, input.request, workspace, tabId]);

  const cancel = useCallback(() => {
    if (controlled) onCancel?.();
    else if (workspace && tabId) workspace.actions.cancel(tabId);
  }, [controlled, onCancel, workspace, tabId]);

  const { prepared, prepareError } = useMemo(() => {
    if (!request) return { prepared: null, prepareError: null };
    try {
      return {
        prepared:
          workspace && !controlled && tabId
            ? workspace.prepareTab(tabId, resolver)
            : prepareDefinition(request, { variables: resolver, authProfiles }),
        prepareError: null,
      };
    } catch (error) {
      return { prepared: null, prepareError: error instanceof ApiError ? error : new ApiError('invalid-request', String(error)) };
    }
  }, [request, resolver, authProfiles, workspace, controlled, tabId]);

  if (!request) {
    throw new Error('[m2api-client] <RequestBuilder> needs a `request` prop or an <ApiClientProvider> ancestor.');
  }

  return {
    request,
    update,
    send,
    cancel,
    loading: controlled ? Boolean(input.loading) : tab?.status === 'loading',
    resolver,
    authProfiles,
    prepared,
    prepareError,
    workspace: controlled ? null : workspace,
    tab: controlled ? undefined : tab,
    controlled,
  };
}

export const COMMON_HEADERS = [
  'Accept',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Content-Type',
  'If-Match',
  'If-None-Match',
  'If-Modified-Since',
  'Idempotency-Key',
  'Origin',
  'Pragma',
  'Prefer',
  'Range',
  'User-Agent',
  'X-API-Key',
  'X-Correlation-Id',
  'X-Request-Id',
  'X-Requested-With',
];
