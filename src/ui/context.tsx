'use client';

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createWorkspace, type Workspace, type WorkspaceOptions, type WorkspaceState } from '../state/workspace';

const WorkspaceContext = createContext<Workspace | null>(null);

export interface ApiClientProviderProps extends WorkspaceOptions {
  /** Use an existing store (from `createWorkspace`) instead of creating one from the props. */
  workspace?: Workspace;
  children?: ReactNode;
}

/**
 * Provides a workspace store to `RequestBuilder`, `ResponseViewer`, `CollectionExplorer`,
 * `RequestHistory`, `EnvironmentManager` and `useApiClient()`. `<ApiClient>` renders one for you; use
 * this directly to compose your own layout. Options are read once, on mount (callbacks stay live).
 */
export function ApiClientProvider({ workspace: external, children, ...options }: ApiClientProviderProps) {
  const [workspace] = useState(() => external ?? createWorkspace(options));
  const { onResponse, onError, oauth2 } = options;

  useEffect(() => {
    workspace.setCallbacks({ onResponse, onError, oauth2 });
  }, [workspace, onResponse, onError, oauth2]);

  useEffect(() => {
    void workspace.hydrate();
    return () => workspace.destroy();
  }, [workspace]);

  return <WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider>;
}

/** The nearest workspace, or `null` outside an `ApiClientProvider`. */
export function useOptionalWorkspace(): Workspace | null {
  return useContext(WorkspaceContext);
}

export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) {
    throw new Error('[m2api-client] This component must be rendered inside <ApiClient> or <ApiClientProvider>.');
  }
  return workspace;
}

const EMPTY_SUBSCRIBE = () => () => {};

/**
 * Subscribes to a slice of workspace state. The selector must return a value that is stable between
 * unrelated updates (a state field, not a newly built object).
 */
export function useWorkspaceSelector<T>(selector: (state: WorkspaceState) => T, explicit?: Workspace | null): T | undefined {
  const context = useOptionalWorkspace();
  const workspace = explicit !== undefined ? explicit : context;
  return useSyncExternalStore(
    workspace ? workspace.subscribe : EMPTY_SUBSCRIBE,
    () => (workspace ? selector(workspace.getState()) : undefined),
    () => (workspace ? selector(workspace.getState()) : undefined),
  );
}
