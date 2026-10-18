'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { ConfirmDialog, PromptDialog, type ConfirmOptions, type PromptOptions } from './primitives/Dialog';

export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Theme tokens that can be overridden through the `tokens` prop or CSS custom properties named
 * `--m2a-<token>` (for example `--m2a-accent`).
 */
export type ThemeToken =
  | 'font'
  | 'mono'
  | 'font-size'
  | 'radius'
  | 'bg'
  | 'surface'
  | 'surface-2'
  | 'surface-3'
  | 'border'
  | 'border-strong'
  | 'text'
  | 'text-muted'
  | 'text-faint'
  | 'accent'
  | 'accent-hover'
  | 'accent-soft'
  | 'on-accent'
  | 'focus'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'method-get'
  | 'method-post'
  | 'method-put'
  | 'method-patch'
  | 'method-delete'
  | 'method-head'
  | 'method-options';

export type ThemeTokens = Partial<Record<ThemeToken, string>>;

export interface UiApi {
  confirm(options: ConfirmOptions): Promise<boolean>;
  prompt(options: PromptOptions): Promise<string | null>;
  /** Renders a custom dialog; call `close` to dismiss it. */
  openDialog(render: (close: () => void) => ReactNode): void;
  /** Announces a short status to screen readers and shows a toast. */
  announce(message: string): void;
  theme: 'light' | 'dark';
}

const UiContext = createContext<UiApi | null>(null);

export function useUi(): UiApi {
  const ui = useContext(UiContext);
  if (!ui) throw new Error('[m2api-client] Missing UI root.');
  return ui;
}

export function useOptionalUi(): UiApi | null {
  return useContext(UiContext);
}

const DARK_QUERY = '(prefers-color-scheme: dark)';
const canMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

function useSystemDark(enabled: boolean): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!enabled || !canMatchMedia()) return () => {};
      const query = window.matchMedia(DARK_QUERY);
      query.addEventListener?.('change', onChange);
      return () => query.removeEventListener?.('change', onChange);
    },
    [enabled],
  );
  return useSyncExternalStore(
    subscribe,
    () => enabled && canMatchMedia() && window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
}

export interface UiRootProps {
  theme?: ThemeMode;
  tokens?: ThemeTokens;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  /** Extra attributes for the root element. */
  rootProps?: React.HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined>;
}

/**
 * The themed root element. Provides dialogs and announcements to everything inside. Standalone panels
 * render one automatically when they are not inside `<ApiClient>`.
 */
export function UiRoot({ theme = 'light', tokens, className, style, children, rootProps }: UiRootProps) {
  const systemDark = useSystemDark(theme === 'system');
  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  const [dialogs, setDialogs] = useState<Array<{ id: number; node: ReactNode }>>([]);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const counter = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const openDialog = useCallback((render: (close: () => void) => ReactNode) => {
    const id = ++counter.current;
    const close = () => setDialogs((list) => list.filter((d) => d.id !== id));
    setDialogs((list) => [...list, { id, node: render(close) }]);
  }, []);

  const announce = useCallback((message: string) => {
    clearTimeout(toastTimer.current);
    setToast({ id: ++counter.current, message });
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const api = useMemo<UiApi>(
    () => ({
      openDialog,
      announce,
      theme: resolvedTheme,
      confirm: (options) =>
        new Promise<boolean>((resolve) =>
          openDialog((close) => (
            <ConfirmDialog
              {...options}
              onResult={(ok) => {
                close();
                resolve(ok);
              }}
            />
          )),
        ),
      prompt: (options) =>
        new Promise<string | null>((resolve) =>
          openDialog((close) => (
            <PromptDialog
              {...options}
              onResult={(value) => {
                close();
                resolve(value);
              }}
            />
          )),
        ),
    }),
    [openDialog, announce, resolvedTheme],
  );

  const tokenStyle: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens ?? {})) if (value) tokenStyle[`--m2a-${name}`] = value;

  return (
    <UiContext.Provider value={api}>
      <div
        {...rootProps}
        className={['m2a', className].filter(Boolean).join(' ')}
        data-theme={resolvedTheme}
        style={{ ...tokenStyle, ...style }}
      >
        {children}
        {dialogs.map((d) => (
          <div key={d.id} className="m2a-dialog-layer">
            {d.node}
          </div>
        ))}
        <div className="m2a-sr-only" role="status" aria-live="polite">
          {toast?.message}
        </div>
        {toast && (
          <div key={toast.id} className="m2a-toast" aria-hidden="true">
            {toast.message}
          </div>
        )}
      </div>
    </UiContext.Provider>
  );
}

/** Renders children inside the existing UI root, or creates a standalone one. */
export function EnsureRoot({ theme, tokens, className, style, children }: Omit<UiRootProps, 'rootProps'>) {
  const ui = useOptionalUi();
  if (ui) return <>{children}</>;
  return (
    <UiRoot theme={theme} tokens={tokens} className={['m2a-standalone', className].filter(Boolean).join(' ')} style={style}>
      {children}
    </UiRoot>
  );
}
