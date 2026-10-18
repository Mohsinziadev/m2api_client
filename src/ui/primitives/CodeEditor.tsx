'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { renderTokens, tokenizeJson } from '../highlight';
import { cx } from './misc';

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: 'json' | 'text';
  readOnly?: boolean;
  /** Accessible label. */
  label: string;
  placeholder?: string;
  minLines?: number;
  className?: string;
  footer?: ReactNode;
  /** Called with the caret line/column. */
  onCursor?: (line: number, column: number) => void;
}

const HIGHLIGHT_LIMIT = 100_000;
const INDENT = '  ';

/**
 * A lightweight code editor: a native textarea over a syntax-highlighted mirror. Tab indents (Shift+Tab
 * outdents); press Escape first to move focus with Tab. Enter keeps the current indentation.
 */
export function CodeEditor({
  value,
  onChange,
  language = 'text',
  readOnly,
  label,
  placeholder,
  minLines = 8,
  className,
  footer,
  onCursor,
}: CodeEditorProps) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const escaped = useRef(false);
  const [focused, setFocused] = useState(false);
  const highlighted = useMemo(
    () => (language === 'json' && value.length <= HIGHLIGHT_LIMIT ? renderTokens(tokenizeJson(value)) : value),
    [language, value],
  );

  const apply = (next: string, selStart: number, selEnd = selStart) => {
    onChange?.(next);
    requestAnimationFrame(() => {
      areaRef.current?.setSelectionRange(selStart, selEnd);
    });
  };

  const reportCursor = () => {
    const el = areaRef.current;
    if (!el || !onCursor) return;
    const before = el.value.slice(0, el.selectionStart);
    onCursor(before.split('\n').length, before.length - before.lastIndexOf('\n'));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (readOnly) return;
    const el = event.currentTarget;
    const { selectionStart: start, selectionEnd: end, value: text } = el;
    if (event.key === 'Escape') {
      escaped.current = true;
      return;
    }
    if (event.key === 'Tab' && !escaped.current && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      if (event.shiftKey) {
        const block = text.slice(lineStart, end);
        const outdented = block.replace(/^ {1,2}/gm, '');
        const removedFirst = block.length - block.replace(/^ {1,2}/, '').length;
        apply(
          text.slice(0, lineStart) + outdented + text.slice(end),
          Math.max(lineStart, start - removedFirst),
          end - (block.length - outdented.length),
        );
      } else if (start !== end && text.slice(start, end).includes('\n')) {
        const block = text.slice(lineStart, end);
        const indented = block.replace(/^/gm, INDENT);
        apply(text.slice(0, lineStart) + indented + text.slice(end), start + INDENT.length, end + (indented.length - block.length));
      } else {
        apply(text.slice(0, start) + INDENT + text.slice(end), start + INDENT.length);
      }
      return;
    }
    escaped.current = false;
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const indent = /^[ \t]*/.exec(text.slice(lineStart, start))?.[0] ?? '';
      const prev = text.slice(0, start).trimEnd().slice(-1);
      const next = text.slice(end).trimStart()[0];
      const opens = prev === '{' || prev === '[';
      if (!indent && !opens) return;
      event.preventDefault();
      if (opens && (next === '}' || next === ']')) {
        const inner = `\n${indent}${INDENT}`;
        apply(text.slice(0, start) + inner + `\n${indent}` + text.slice(end), start + inner.length);
      } else {
        const insert = `\n${indent}${opens ? INDENT : ''}`;
        apply(text.slice(0, start) + insert + text.slice(end), start + insert.length);
      }
    }
  };

  const lines = Math.max(minLines, value.split('\n').length);
  return (
    <div className={cx('m2a-code', focused && 'm2a-code-focused', readOnly && 'm2a-code-readonly', className)}>
      <div className="m2a-code-scroll" style={{ minHeight: `calc(${Math.min(lines, minLines)} * var(--m2a-code-line) + 16px)` }}>
        <pre className="m2a-code-mirror" aria-hidden="true">
          {highlighted}
          {'\n'}
        </pre>
        <textarea
          ref={areaRef}
          className="m2a-code-input"
          aria-label={label}
          value={value}
          placeholder={placeholder}
          readOnly={readOnly}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={onKeyDown}
          onKeyUp={reportCursor}
          onClick={reportCursor}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            escaped.current = false;
          }}
        />
      </div>
      {footer && <div className="m2a-code-footer">{footer}</div>}
    </div>
  );
}
