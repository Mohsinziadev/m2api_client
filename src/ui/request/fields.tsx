'use client';

import { useId, useState, type ReactNode } from 'react';
import type { VariableResolver } from '../../env/variables';
import { containsLiteralSecret } from '../../persistence/sanitize';
import { IconEye, IconEyeOff } from '../icons';
import { VariableInput } from '../primitives/VariableInput';

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="m2a-field">
      <label className="m2a-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="m2a-hint">{hint}</p>}
    </div>
  );
}

/** A text field for templates, with variable highlighting. */
export function TemplateField({
  label,
  value,
  onChange,
  resolver,
  placeholder,
  hint,
  secret,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  resolver?: VariableResolver;
  placeholder?: string;
  hint?: ReactNode;
  /** Mask literal values (variable references stay visible) with a reveal toggle. */
  secret?: boolean;
}) {
  const id = useId();
  const [reveal, setReveal] = useState(false);
  const masked = Boolean(secret) && !reveal && containsLiteralSecret(value);
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="m2a-input-group">
        <VariableInput
          id={id}
          className="m2a-input-like"
          value={value}
          onValueChange={onChange}
          resolver={resolver}
          placeholder={placeholder}
          masked={masked}
        />
        {secret && containsLiteralSecret(value) && (
          <button
            type="button"
            className="m2a-icon-btn m2a-input-addon"
            aria-label={reveal ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            aria-pressed={reveal}
            onClick={() => setReveal((r) => !r)}
          >
            {reveal ? <IconEyeOff /> : <IconEye />}
          </button>
        )}
      </div>
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <select id={id} className="m2a-select" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
