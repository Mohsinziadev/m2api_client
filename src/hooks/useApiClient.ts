'use client';

import { useSyncExternalStore } from 'react';
import type { ApiClientInstance } from '../core/client';
import type { Workspace, WorkspaceActions, WorkspaceState } from '../state/workspace';
import { useWorkspace } from '../ui/context';

export interface UseApiClientResult {
  /** Current workspace state (tabs, collections, history, environments...). */
  state: WorkspaceState;
  /** Every workspace action: send, cancel, newTab, saveTab, addEnvironment, importCurl... */
  actions: WorkspaceActions;
  /** The underlying HTTP client (transport + middleware). */
  client: ApiClientInstance;
  /** The store itself, for advanced use (prepareTab, getResolver, flush...). */
  workspace: Workspace;
}

/**
 * Access the state and actions of the surrounding `<ApiClient>` / `<ApiClientProvider>`.
 *
 * ```tsx
 * const { state, actions } = useApiClient();
 * actions.newTab({ method: 'GET', url: '{{baseUrl}}/health' });
 * ```
 */
export function useApiClient(): UseApiClientResult {
  const workspace = useWorkspace();
  const state = useSyncExternalStore(workspace.subscribe, workspace.getState, workspace.getState);
  return { state, actions: workspace.actions, client: workspace.client, workspace };
}
