'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { HttpMethod } from '../core/types';
import type { HeaderPreset, RequestDefinitionInput } from '../core/request';
import { describeRequest } from '../core/request';
import type { Workspace, WorkspaceOptions } from '../state/workspace';
import { ApiClientProvider, useWorkspace, useWorkspaceSelector } from './context';
import { UiRoot, useUi, type ThemeMode, type ThemeTokens } from './Root';
import { RequestBuilder } from './RequestBuilder';
import { ResponseViewer } from './ResponseViewer';
import { CollectionExplorer } from './CollectionExplorer';
import { RequestHistory } from './RequestHistory';
import { EnvironmentManager, EnvironmentSelector } from './EnvironmentManager';
import { ExportDialog, ImportDialog, ShortcutsDialog } from './dialogs';
import { SplitPane } from './primitives/SplitPane';
import { Menu } from './primitives/Menu';
import { IconButton, MethodBadge, cx } from './primitives/misc';
import { Tabs, tabPanelProps } from './primitives/Tabs';
import {
  IconClock,
  IconClose,
  IconDownload,
  IconGlobe,
  IconKeyboard,
  IconLayers,
  IconMoon,
  IconPlus,
  IconSidebar,
  IconSun,
  IconUpload,
  Logo,
} from './icons';

export type SidebarView = 'collections' | 'history' | 'environments';
export type WorkspaceLayout = 'horizontal' | 'vertical';

export interface ApiClientProps extends WorkspaceOptions {
  /** `light` (default), `dark` or `system`. The header toggle switches between light and dark. */
  theme?: ThemeMode;
  /** Called when the user toggles the theme. */
  onThemeChange?: (theme: 'light' | 'dark') => void;
  /** Override design tokens, e.g. `{ accent: '#7c3aed', radius: '4px' }`. */
  tokens?: ThemeTokens;
  /** Shorthand for `initialRequest.method`. */
  initialMethod?: HttpMethod;
  /** Shorthand for `initialRequest.url`. Defaults to `baseUrl`. */
  initialUrl?: string;
  /** Request and response side by side (`horizontal`, default) or stacked (`vertical`). Narrow containers always stack. */
  layout?: WorkspaceLayout;
  /** Name shown in the header. Default "m2api". Pass `null` to hide the header. */
  title?: ReactNode | null;
  /** Show the sidebar initially. Default `true` on wide containers. */
  sidebar?: boolean;
  defaultSidebarView?: SidebarView;
  headerPresets?: HeaderPreset[];
  /** Extra content in the header, before the built-in actions. */
  headerActions?: ReactNode;
  /** Use an existing store from `createWorkspace()`; the workspace options above are then ignored. */
  workspace?: Workspace;
  className?: string;
  style?: CSSProperties;
  /** CSS height of the workspace. Default `100%` (give the parent a height) with a 480px minimum. */
  height?: CSSProperties['height'];
}

/**
 * The complete API testing workspace: collections, history and environments in a sidebar, request tabs,
 * the request builder and the response viewer.
 *
 * ```tsx
 * import { ApiClient } from 'm2api-client';
 * import 'm2api-client/styles.css';
 *
 * <ApiClient baseUrl="https://api.example.com" theme="light" initialMethod="GET" />
 * ```
 */
export function ApiClient({
  theme = 'light',
  onThemeChange,
  tokens,
  initialMethod,
  initialUrl,
  layout = 'horizontal',
  title = 'm2api',
  sidebar,
  defaultSidebarView = 'collections',
  headerPresets,
  headerActions,
  workspace,
  className,
  style,
  height = '100%',
  ...options
}: ApiClientProps) {
  const initialRequest: RequestDefinitionInput | undefined =
    initialMethod || initialUrl !== undefined
      ? {
          ...options.initialRequest,
          method: initialMethod ?? options.initialRequest?.method,
          url: initialUrl ?? options.initialRequest?.url,
        }
      : options.initialRequest;

  // The header toggle overrides the prop until the prop changes.
  const [themeOverride, setThemeOverride] = useState<{ base: ThemeMode; value: 'light' | 'dark' } | null>(null);
  const activeTheme = themeOverride && themeOverride.base === theme ? themeOverride.value : theme;

  return (
    <ApiClientProvider {...options} initialRequest={initialRequest} workspace={workspace}>
      <UiRoot theme={activeTheme} tokens={tokens} className={cx('m2a-app', className)} style={{ height, ...style }}>
        <WorkspaceLayoutView
          layout={layout}
          title={title}
          sidebarInitially={sidebar}
          defaultSidebarView={defaultSidebarView}
          headerPresets={headerPresets}
          headerActions={headerActions}
          onToggleTheme={(current) => {
            const next = current === 'dark' ? 'light' : 'dark';
            setThemeOverride({ base: theme, value: next });
            onThemeChange?.(next);
          }}
        />
      </UiRoot>
    </ApiClientProvider>
  );
}

/** Tracks the width of an element (for container-based responsive behaviour). */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(1280);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

const NARROW = 900;
const STACK = 760;

interface LayoutProps {
  layout: WorkspaceLayout;
  title: ReactNode | null;
  sidebarInitially?: boolean;
  defaultSidebarView: SidebarView;
  headerPresets?: HeaderPreset[];
  headerActions?: ReactNode;
  onToggleTheme: (current: 'light' | 'dark') => void;
}

function WorkspaceLayoutView({
  layout,
  title,
  sidebarInitially,
  defaultSidebarView,
  headerPresets,
  headerActions,
  onToggleTheme,
}: LayoutProps) {
  const workspace = useWorkspace();
  const ui = useUi();
  const [rootRef, width] = useWidth<HTMLDivElement>();
  const narrow = width < NARROW;
  const stacked = layout === 'vertical' || width < STACK;
  const [sidebarWide, setSidebarWide] = useState(sidebarInitially ?? true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [view, setView] = useState<SidebarView>(defaultSidebarView);
  const sidebarOpen = narrow ? drawerOpen : sidebarWide;
  const sidebarId = useId();

  const toggleSidebar = () => (narrow ? setDrawerOpen((o) => !o) : setSidebarWide((o) => !o));
  const closeDrawer = () => narrow && setDrawerOpen(false);
  const openEnvironments = () => {
    setView('environments');
    if (narrow) setDrawerOpen(true);
    else setSidebarWide(true);
  };

  const header =
    title === null ? null : (
      <header className="m2a-header">
        <IconButton
          label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          aria-expanded={sidebarOpen}
          aria-controls={sidebarId}
          onClick={toggleSidebar}
        >
          <IconSidebar />
        </IconButton>
        <span className="m2a-brand">
          <Logo size={18} />
          <span className="m2a-brand-name">{title}</span>
        </span>
        <span className="m2a-grow" />
        {headerActions}
        <EnvironmentSelector onManage={openEnvironments} />
        <span className="m2a-header-actions">
          <IconButton label="Import" onClick={() => ui.openDialog((close) => <ImportDialog workspace={workspace} onClose={close} />)}>
            <IconUpload />
          </IconButton>
          <IconButton label="Export" onClick={() => ui.openDialog((close) => <ExportDialog workspace={workspace} onClose={close} />)}>
            <IconDownload />
          </IconButton>
          <IconButton label="Keyboard shortcuts" onClick={() => ui.openDialog((close) => <ShortcutsDialog onClose={close} />)}>
            <IconKeyboard />
          </IconButton>
          <IconButton
            label={ui.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={() => onToggleTheme(ui.theme)}
          >
            {ui.theme === 'dark' ? <IconSun /> : <IconMoon />}
          </IconButton>
        </span>
      </header>
    );

  const sidebar = (
    <Sidebar
      id={sidebarId}
      view={view}
      onViewChange={setView}
      onNavigate={closeDrawer}
      onClose={narrow ? () => setDrawerOpen(false) : undefined}
    />
  );

  const main = (
    <div className="m2a-main">
      <RequestTabsBar />
      <SplitPane
        key={stacked ? 'v' : 'h'}
        direction={stacked ? 'vertical' : 'horizontal'}
        defaultSize={stacked ? 52 : 50}
        minSize={stacked ? 20 : 28}
        maxSize={stacked ? 80 : 72}
        label="Resize request and response panels"
        className="m2a-work"
        first={<RequestBuilder headerPresets={headerPresets} />}
        second={<ResponseViewer />}
      />
    </div>
  );

  return (
    <div ref={rootRef} className={cx('m2a-shell', narrow && 'm2a-shell-narrow', stacked && 'm2a-shell-stacked')}>
      {header}
      <div className="m2a-body">
        {narrow ? (
          <>
            {main}
            {drawerOpen && (
              <div
                className="m2a-drawer-backdrop"
                onMouseDown={(e) => e.target === e.currentTarget && setDrawerOpen(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setDrawerOpen(false);
                  }
                }}
              >
                <div className="m2a-drawer">{sidebar}</div>
              </div>
            )}
          </>
        ) : sidebarOpen ? (
          <SplitPane
            direction="horizontal"
            unit="px"
            defaultSize={272}
            minSize={200}
            maxSize={480}
            label="Resize sidebar"
            className="m2a-layout"
            first={sidebar}
            second={main}
          />
        ) : (
          main
        )}
      </div>
    </div>
  );
}

function Sidebar({
  id,
  view,
  onViewChange,
  onNavigate,
  onClose,
}: {
  id: string;
  view: SidebarView;
  onViewChange: (v: SidebarView) => void;
  onNavigate: () => void;
  onClose?: () => void;
}) {
  const prefix = useId();
  const historyCount = useWorkspaceSelector((s) => s.history.length) ?? 0;
  return (
    <aside id={id} className="m2a-sidebar" aria-label="Sidebar">
      <Tabs
        idPrefix={prefix}
        label="Sidebar sections"
        value={view}
        onChange={onViewChange}
        variant="pill"
        items={[
          {
            id: 'collections',
            label: (
              <>
                <IconLayers size={14} /> Collections
              </>
            ),
          },
          {
            id: 'history',
            label: (
              <>
                <IconClock size={14} /> History
              </>
            ),
            badge: historyCount || undefined,
          },
          {
            id: 'environments',
            label: (
              <>
                <IconGlobe size={14} /> Envs
              </>
            ),
          },
        ]}
        trailing={
          onClose && (
            <IconButton label="Close sidebar" size="sm" onClick={onClose}>
              <IconClose />
            </IconButton>
          )
        }
      />
      <div className="m2a-sidebar-panel" {...tabPanelProps(prefix, view)} tabIndex={-1}>
        {view === 'collections' && <CollectionExplorer onOpenRequest={onNavigate} />}
        {view === 'history' && <RequestHistory onOpenEntry={onNavigate} />}
        {view === 'environments' && <EnvironmentManager />}
      </div>
    </aside>
  );
}

const NO_TABS: never[] = [];

function RequestTabsBar() {
  const workspace = useWorkspace();
  const ui = useUi();
  const tabs = useWorkspaceSelector((s) => s.tabs) ?? NO_TABS;
  const activeTabId = useWorkspaceSelector((s) => s.activeTabId);
  const listRef = useRef<HTMLDivElement>(null);

  const close = async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab?.dirty && tab.savedId) {
      const ok = await ui.confirm({
        title: 'Close without saving?',
        message: `“${describeRequest(tab.request)}” has unsaved changes. Closing the tab discards them.`,
        confirmLabel: 'Discard changes',
        danger: true,
      });
      if (!ok) return;
    }
    workspace.actions.closeTab(tabId);
  };

  const focusTab = (id: string) => listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)?.focus();

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Delete' && activeTabId) {
      event.preventDefault();
      void close(activeTabId);
      return;
    }
    const index = tabs.findIndex((t) => t.id === activeTabId);
    const targets: Record<string, number> = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const next = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    workspace.actions.setActiveTab(tabs[next].id);
    focusTab(tabs[next].id);
  };

  return (
    <div className="m2a-reqtabs">
      <div ref={listRef} role="tablist" aria-label="Open requests" className="m2a-reqtabs-list" onKeyDown={onKeyDown}>
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const name = describeRequest(tab.request);
          return (
            <div
              key={tab.id}
              className={cx('m2a-reqtab', active && 'm2a-reqtab-active')}
              onAuxClick={(e) => e.button === 1 && void close(tab.id)}
            >
              <button
                type="button"
                role="tab"
                data-tab-id={tab.id}
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                className="m2a-reqtab-btn"
                title={`${tab.request.method} ${tab.request.url}`}
                onClick={() => workspace.actions.setActiveTab(tab.id)}
              >
                <MethodBadge method={tab.request.method} compact />
                <span className="m2a-reqtab-name">{name}</span>
                {tab.status === 'loading' && <span className="m2a-reqtab-loading" aria-label="sending" />}
                {tab.dirty && tab.status !== 'loading' && <span className="m2a-reqtab-dirty" aria-label="unsaved changes" />}
              </button>
              <button
                type="button"
                className="m2a-reqtab-close"
                aria-label={`Close ${name}`}
                title="Close tab"
                tabIndex={-1}
                onClick={() => void close(tab.id)}
              >
                <IconClose size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <span className="m2a-reqtabs-actions">
        <IconButton label="New request" size="sm" onClick={() => workspace.actions.newTab()}>
          <IconPlus />
        </IconButton>
        <Menu
          label="New request from template"
          title="Templates"
          triggerClassName="m2a-link-btn m2a-link-btn-sm"
          trigger={<>Templates</>}
          items={[
            { heading: 'New request from template' },
            ...workspace.templates.map((t) => ({
              id: t.id,
              label: t.name,
              hint: t.description,
              onSelect: () => workspace.actions.newTab(t.id),
            })),
          ]}
        />
      </span>
    </div>
  );
}
