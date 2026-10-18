'use client';

import { useRef, useState, type ReactNode } from 'react';
import { cx } from './misc';

export interface SplitPaneProps {
  direction: 'horizontal' | 'vertical';
  /** Initial size of the first pane in percent. */
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  first: ReactNode;
  second: ReactNode;
  /** Accessible name of the separator. */
  label: string;
  className?: string;
  /** Size of the first pane in px instead of percent (used for the sidebar). */
  unit?: '%' | 'px';
}

/** Two resizable panes. The separator is keyboard-operable (arrow keys, Home/End). */
export function SplitPane({
  direction,
  defaultSize = 50,
  minSize = 20,
  maxSize = 80,
  first,
  second,
  label,
  className,
  unit = '%',
}: SplitPaneProps) {
  const [size, setSize] = useState(defaultSize);
  const rootRef = useRef<HTMLDivElement>(null);
  const clamp = (v: number) => Math.min(maxSize, Math.max(minSize, v));

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
    root.dataset.resizing = 'true';
    const move = (e: PointerEvent) => {
      const offset = direction === 'horizontal' ? e.clientX - rect.left : e.clientY - rect.top;
      const total = direction === 'horizontal' ? rect.width : rect.height;
      setSize(clamp(unit === 'px' ? offset : (offset / total) * 100));
    };
    const up = () => {
      delete root.dataset.resizing;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = unit === 'px' ? 16 : 2;
    const back = direction === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
    const forward = direction === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    if (event.key === back) setSize((s) => clamp(s - step));
    else if (event.key === forward) setSize((s) => clamp(s + step));
    else if (event.key === 'Home') setSize(minSize);
    else if (event.key === 'End') setSize(maxSize);
    else return;
    event.preventDefault();
  };

  const value = `${size}${unit}`;
  return (
    <div
      ref={rootRef}
      className={cx('m2a-split', `m2a-split-${direction}`, className)}
      style={{ '--m2a-split-size': value } as React.CSSProperties}
    >
      <div className="m2a-split-pane m2a-split-first">{first}</div>
      <div
        role="separator"
        tabIndex={0}
        aria-label={label}
        aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(size)}
        aria-valuemin={minSize}
        aria-valuemax={maxSize}
        className="m2a-split-handle"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDoubleClick={() => setSize(defaultSize)}
      />
      <div className="m2a-split-pane m2a-split-second">{second}</div>
    </div>
  );
}
