'use client';

import { useRef, type ReactNode } from 'react';
import { cx } from './misc';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** Count or marker shown after the label. */
  badge?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<T extends string> {
  items: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  /** Accessible name of the tab list. */
  label: string;
  /** Prefix for tab/panel ids; panels should use `tabPanelProps(idPrefix, id)`. */
  idPrefix: string;
  variant?: 'line' | 'pill';
  className?: string;
  trailing?: ReactNode;
}

export const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const panelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

export function tabPanelProps(prefix: string, id: string) {
  return { role: 'tabpanel' as const, id: panelId(prefix, id), 'aria-labelledby': tabId(prefix, id), tabIndex: 0 };
}

/** WAI-ARIA tabs with roving focus (arrow keys, Home, End) and automatic activation. */
export function Tabs<T extends string>({ items, value, onChange, label, idPrefix, variant = 'line', className, trailing }: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const enabled = items.filter((i) => !i.disabled);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = enabled.findIndex((i) => i.id === value);
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % enabled.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    if (next === -1) return;
    event.preventDefault();
    onChange(enabled[next].id);
    listRef.current?.ownerDocument.getElementById(tabId(idPrefix, enabled[next].id))?.focus();
  };

  return (
    <div className={cx('m2a-tabs', `m2a-tabs-${variant}`, className)}>
      <div ref={listRef} role="tablist" aria-label={label} className="m2a-tablist" onKeyDown={onKeyDown}>
        {items.map((item) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={tabId(idPrefix, item.id)}
              aria-selected={selected}
              aria-controls={panelId(idPrefix, item.id)}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              className="m2a-tab"
              onClick={() => onChange(item.id)}
            >
              {item.label}
              {item.badge !== undefined && item.badge !== null && item.badge !== false && (
                <span className="m2a-tab-badge">{item.badge}</span>
              )}
            </button>
          );
        })}
      </div>
      {trailing && <div className="m2a-tabs-trailing">{trailing}</div>}
    </div>
  );
}
