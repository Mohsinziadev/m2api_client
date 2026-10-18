'use client';

import { useRef, type InputHTMLAttributes } from 'react';
import { tokenizeTemplate, type VariableResolver } from '../../env/variables';
import { cx } from './misc';

export interface VariableInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onValueChange: (value: string) => void;
  /** Used to colour `{{variables}}`: known ones in the accent colour, unknown ones in red. */
  resolver?: VariableResolver;
  /** Render as a password field (no highlighting). */
  masked?: boolean;
}

/**
 * A text input that highlights `{{variables}}` with a mirrored overlay. The overlay is purely visual
 * (aria-hidden); the input stays a normal, accessible text field.
 */
export function VariableInput({ value, onValueChange, resolver, masked, className, onScroll, ...props }: VariableInputProps) {
  const mirrorRef = useRef<HTMLDivElement>(null);
  const hasVariables = !masked && value.includes('{{');
  return (
    <div className={cx('m2a-vinput', hasVariables && 'm2a-vinput-active', className)}>
      {hasVariables && (
        <div ref={mirrorRef} className="m2a-vinput-mirror" aria-hidden="true">
          {tokenizeTemplate(value).map((part, i) =>
            part.type === 'text' ? (
              <span key={i}>{part.text}</span>
            ) : (
              <span key={i} className={resolver?.has(part.name!) ? 'm2a-var' : 'm2a-var m2a-var-missing'}>
                {part.text}
              </span>
            ),
          )}
        </div>
      )}
      <input
        {...props}
        type={masked ? 'password' : 'text'}
        className="m2a-vinput-field"
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onValueChange(e.target.value)}
        onScroll={(e) => {
          if (mirrorRef.current) mirrorRef.current.scrollLeft = e.currentTarget.scrollLeft;
          onScroll?.(e);
        }}
        onSelect={(e) => {
          if (mirrorRef.current) mirrorRef.current.scrollLeft = e.currentTarget.scrollLeft;
        }}
      />
    </div>
  );
}
