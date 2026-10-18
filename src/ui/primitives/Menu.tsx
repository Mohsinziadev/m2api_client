'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cx } from './misc';

export interface MenuItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export type MenuEntry = MenuItem | 'separator' | { heading: string };

export interface MenuProps {
  /** Accessible label of the trigger button. */
  label: string;
  /** Visible trigger content. */
  trigger: ReactNode;
  items: MenuEntry[];
  align?: 'start' | 'end';
  triggerClassName?: string;
  title?: string;
}

/** Menu button (WAI-ARIA): opens on click/Enter/ArrowDown, arrow-key navigation, Escape closes. */
export function Menu({ label, trigger, items, align = 'end', triggerClassName, title }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const menuItems = () => [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    requestAnimationFrame(() => menuItems()[0]?.focus());
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const close = (focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) buttonRef.current?.focus();
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const list = menuItems();
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') list[(index + 1) % list.length]?.focus();
    else if (event.key === 'ArrowUp') list[(index - 1 + list.length) % list.length]?.focus();
    else if (event.key === 'Home') list[0]?.focus();
    else if (event.key === 'End') list[list.length - 1]?.focus();
    else if (event.key === 'Escape') close();
    else if (event.key === 'Tab') close(false);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className="m2a-menu-root" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={cx(triggerClassName ?? 'm2a-icon-btn')}
        aria-label={label}
        title={title ?? label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className={cx('m2a-menu', align === 'end' ? 'm2a-menu-end' : 'm2a-menu-start')}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, i) => {
            if (item === 'separator') return <div key={`sep-${i}`} role="separator" className="m2a-menu-separator" />;
            if ('heading' in item)
              return (
                <div key={`h-${i}`} className="m2a-menu-heading" role="presentation">
                  {item.heading}
                </div>
              );
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={item.disabled || undefined}
                className={cx('m2a-menu-item', item.danger && 'm2a-menu-item-danger')}
                onClick={() => {
                  if (item.disabled) return;
                  close();
                  item.onSelect();
                }}
              >
                {item.icon && <span className="m2a-menu-icon">{item.icon}</span>}
                <span className="m2a-menu-label">{item.label}</span>
                {item.hint && <span className="m2a-menu-hint">{item.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
