'use client';

import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { HttpMethod } from '../../core/types';
import { useOptionalUi } from '../Root';
import { IconCheck, IconCopy } from '../icons';

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  /** Keyboard shortcut shown in the tooltip, e.g. "⌘↵". */
  shortcut?: string;
  size?: 'sm' | 'md';
}

/** Icon-only button with an accessible label and a native tooltip. */
export function IconButton({ label, shortcut, size = 'md', className, children, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cx('m2a-icon-btn', size === 'sm' && 'm2a-icon-btn-sm', className)}
      {...props}
    >
      {children}
    </button>
  );
}

export function MethodBadge({ method, compact }: { method: HttpMethod; compact?: boolean }) {
  const label = compact ? (({ DELETE: 'DEL', OPTIONS: 'OPT', PATCH: 'PATCH' } as Record<string, string>)[method] ?? method) : method;
  return (
    <span className="m2a-method" data-method={method}>
      {label}
    </span>
  );
}

export function statusTone(status: number): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  if (status >= 200 && status < 300) return 'success';
  if (status >= 300 && status < 400) return 'info';
  if (status >= 400 && status < 500) return 'warning';
  if (status >= 500) return 'danger';
  return 'neutral';
}

export function StatusBadge({ status, text }: { status: number; text?: string }) {
  return (
    <span className="m2a-status" data-tone={statusTone(status)}>
      <span className="m2a-status-dot" aria-hidden="true" />
      {status || '—'}
      {text ? <span className="m2a-status-text"> {text}</span> : null}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  actions,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="m2a-empty">
      {icon && <div className="m2a-empty-icon">{icon}</div>}
      <p className="m2a-empty-title">{title}</p>
      {children && <div className="m2a-empty-text">{children}</div>}
      {actions && <div className="m2a-empty-actions">{actions}</div>}
    </div>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Copy-to-clipboard with a transient "copied" flag and a screen-reader announcement. */
export function useCopy(): [copied: boolean, copy: (text: string, what?: string) => Promise<void>] {
  const [copied, setCopied] = useState(false);
  const ui = useOptionalUi();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(
    async (text: string, what = 'Copied') => {
      const ok = await copyText(text);
      ui?.announce(ok ? `${what} to clipboard` : 'Copy failed: clipboard access was denied');
      if (!ok) return;
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    },
    [ui],
  );
  return [copied, copy];
}

export function CopyButton({
  text,
  label = 'Copy',
  what,
  size = 'md',
}: {
  text: string | (() => string);
  label?: string;
  what?: string;
  size?: 'sm' | 'md';
}) {
  const [copied, copy] = useCopy();
  return (
    <IconButton label={copied ? 'Copied' : label} size={size} onClick={() => copy(typeof text === 'function' ? text() : text, what)}>
      {copied ? <IconCheck /> : <IconCopy />}
    </IconButton>
  );
}

export function Notice({ tone = 'info', icon, children }: { tone?: 'info' | 'warning' | 'danger'; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="m2a-notice" data-tone={tone} role={tone === 'danger' ? 'alert' : undefined}>
      {icon && <span className="m2a-notice-icon">{icon}</span>}
      <div className="m2a-notice-body">{children}</div>
    </div>
  );
}

export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = () => (isMac() ? '⌘' : 'Ctrl+');

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="m2a-kbd">{children}</kbd>;
}

export function Spinner({ label }: { label?: string }) {
  return <span className="m2a-spinner" role={label ? 'status' : undefined} aria-label={label} />;
}

/** Triggers a browser download of a Blob or string. */
export function downloadFile(content: Blob | string, fileName: string, type = 'application/json') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
