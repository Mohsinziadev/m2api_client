'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { IconClose } from '../icons';

export interface DialogProps {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Element to focus first (CSS selector inside the dialog). Defaults to the first focusable element. */
  initialFocus?: string;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal dialog scoped to the workspace: traps focus, closes on Escape, restores focus on close. */
export function Dialog({ title, description, onClose, children, footer, size = 'md', initialFocus }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const target =
      (initialFocus && node?.querySelector<HTMLElement>(initialFocus)) ||
      node?.querySelector<HTMLElement>(`.m2a-dialog-body ${FOCUSABLE}`) ||
      node?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    return () => previous?.focus?.();
  }, [initialFocus]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab' || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="m2a-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`m2a-dialog m2a-dialog-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        onKeyDown={onKeyDown}
      >
        <div className="m2a-dialog-header">
          <h2 id={titleId} className="m2a-dialog-title">
            {title}
          </h2>
          <button type="button" className="m2a-icon-btn" aria-label="Close dialog" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        {description && (
          <p id={descId} className="m2a-dialog-description">
            {description}
          </p>
        )}
        <div className="m2a-dialog-body">{children}</div>
        {footer && <div className="m2a-dialog-footer">{footer}</div>}
      </div>
    </div>
  );
}

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger,
  onResult,
}: ConfirmOptions & { onResult: (ok: boolean) => void }) {
  return (
    <Dialog
      title={title}
      size="sm"
      onClose={() => onResult(false)}
      initialFocus="[data-autofocus]"
      footer={
        <>
          <button type="button" className="m2a-btn" onClick={() => onResult(false)}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`m2a-btn ${danger ? 'm2a-btn-danger' : 'm2a-btn-primary'}`}
            data-autofocus
            onClick={() => onResult(true)}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {message && <div className="m2a-dialog-message">{message}</div>}
    </Dialog>
  );
}

export interface PromptOptions {
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Return an error message to block submission. */
  validate?: (value: string) => string | undefined;
}

export function PromptDialog({
  title,
  label,
  initialValue = '',
  placeholder,
  confirmLabel = 'Save',
  validate,
  onResult,
}: PromptOptions & { onResult: (value: string | null) => void }) {
  const [value, setValue] = useState(initialValue);
  const [touched, setTouched] = useState(false);
  const inputId = useId();
  const error = validate?.(value) ?? (value.trim() ? undefined : 'A name is required.');
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!error) onResult(value.trim());
  };
  return (
    <Dialog title={title} size="sm" onClose={() => onResult(null)}>
      <form onSubmit={submit} className="m2a-form">
        <label className="m2a-label" htmlFor={inputId}>
          {label}
        </label>
        <input
          id={inputId}
          className="m2a-input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.target.select()}
          aria-invalid={touched && Boolean(error)}
          autoComplete="off"
        />
        {touched && error && (
          <p className="m2a-field-error" role="alert">
            {error}
          </p>
        )}
        <div className="m2a-dialog-footer m2a-dialog-footer-inline">
          <button type="button" className="m2a-btn" onClick={() => onResult(null)}>
            Cancel
          </button>
          <button type="submit" className="m2a-btn m2a-btn-primary">
            {confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
