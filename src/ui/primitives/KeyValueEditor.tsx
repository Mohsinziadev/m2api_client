'use client';

import { useId, useState, type ReactNode } from 'react';
import type { KeyValueEntry } from '../../core/types';
import type { VariableResolver } from '../../env/variables';
import { createId } from '../../utils/id';
import { IconTrash, IconWarning } from '../icons';
import { VariableInput } from './VariableInput';
import { cx } from './misc';

export interface KeyValueEditorProps<E extends KeyValueEntry> {
  entries: E[];
  onChange: (entries: E[]) => void;
  /** Accessible name of the table, e.g. "Query parameters". */
  label: string;
  /** Singular noun used in control labels, e.g. "Parameter". */
  itemLabel?: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  showDescription?: boolean;
  resolver?: VariableResolver;
  keySuggestions?: readonly string[];
  /** Per-row warning shown under the row. */
  warning?: (entry: E) => string | undefined;
  /** Custom value cell (for file fields). Return `undefined` for the default input. */
  renderValue?: (entry: E, update: (patch: Partial<E>) => void) => ReactNode | undefined;
  /** Extra cell rendered before the delete button. */
  renderExtra?: (entry: E, update: (patch: Partial<E>) => void) => ReactNode;
  createEntry?: (init: { id: string; key: string; value: string }) => E;
  /** Show a "Bulk edit" toggle (key: value per line). */
  bulkEditable?: boolean;
  toolbar?: ReactNode;
}

/**
 * Editable key/value table with enable toggles, optional descriptions and an always-present empty row:
 * typing into it adds an entry without extra clicks.
 */
export function KeyValueEditor<E extends KeyValueEntry>({
  entries,
  onChange,
  label,
  itemLabel = 'Item',
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  showDescription = false,
  resolver,
  keySuggestions,
  warning,
  renderValue,
  renderExtra,
  createEntry = (init) => ({ ...init, enabled: true }) as E,
  bulkEditable = true,
  toolbar,
}: KeyValueEditorProps<E>) {
  const [ghostId, setGhostId] = useState(() => createId('kv'));
  const [bulk, setBulk] = useState<string | null>(null);
  const listId = useId();
  const all = entries.length > 0 && entries.every((e) => e.enabled);

  const update = (id: string, patch: Partial<E>) => onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const remove = (id: string) => onChange(entries.filter((e) => e.id !== id));
  const addFromGhost = (patch: { key?: string; value?: string; description?: string }) => {
    const entry = {
      ...createEntry({ id: ghostId, key: patch.key ?? '', value: patch.value ?? '' }),
      ...(patch.description ? { description: patch.description } : {}),
    };
    onChange([...entries, entry]);
    setGhostId(createId('kv'));
  };

  const toBulk = () => entries.map((e) => `${e.enabled ? '' : '// '}${e.key}: ${e.value}`).join('\n');
  const fromBulk = (text: string) => {
    const next: E[] = [];
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const disabled = line.startsWith('//');
      const body = disabled ? line.replace(/^\/\/\s*/, '') : line;
      const colon = body.indexOf(':');
      const key = (colon === -1 ? body : body.slice(0, colon)).trim();
      const value = colon === -1 ? '' : body.slice(colon + 1).trim();
      const existing = entries.find((e) => e.key === key && !next.includes(e));
      next.push(
        existing
          ? { ...existing, key, value, enabled: !disabled }
          : { ...createEntry({ id: createId('kv'), key, value }), enabled: !disabled },
      );
    }
    onChange(next);
  };

  const ghost = { id: ghostId, key: '', value: '', enabled: true, description: '' };

  return (
    <div className="m2a-kv">
      {(bulkEditable || toolbar) && (
        <div className="m2a-kv-toolbar">
          <span className="m2a-kv-title">{label}</span>
          <div className="m2a-kv-actions">
            {toolbar}
            {bulkEditable && (
              <button
                type="button"
                className="m2a-link-btn"
                aria-pressed={bulk !== null}
                onClick={() => {
                  if (bulk === null) setBulk(toBulk());
                  else {
                    fromBulk(bulk);
                    setBulk(null);
                  }
                }}
              >
                {bulk === null ? 'Bulk edit' : 'Table view'}
              </button>
            )}
          </div>
        </div>
      )}
      {bulk !== null ? (
        <textarea
          className="m2a-kv-bulk"
          aria-label={`${label} (bulk edit: one "key: value" per line, prefix // to disable)`}
          value={bulk}
          spellCheck={false}
          rows={Math.max(6, bulk.split('\n').length + 1)}
          placeholder={'Content-Type: application/json\n// Disabled-Header: value'}
          onChange={(e) => setBulk(e.target.value)}
          onBlur={() => fromBulk(bulk)}
        />
      ) : (
        <table className="m2a-kv-table" aria-label={label}>
          <thead>
            <tr>
              <th className="m2a-kv-check">
                <input
                  type="checkbox"
                  className="m2a-checkbox"
                  aria-label={`Enable all ${label.toLowerCase()}`}
                  checked={all}
                  disabled={entries.length === 0}
                  onChange={() => onChange(entries.map((e) => ({ ...e, enabled: !all })))}
                />
              </th>
              <th>{keyPlaceholder}</th>
              <th>{valuePlaceholder}</th>
              {showDescription && <th className="m2a-kv-desc-col">Description</th>}
              <th className="m2a-kv-actions-col">
                <span className="m2a-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {[...entries, ghost].map((entry, index) => {
              const isGhost = entry.id === ghostId && index === entries.length;
              const n = index + 1;
              const set = (patch: Partial<E>) =>
                isGhost ? addFromGhost(patch as { key?: string; value?: string }) : update(entry.id, patch);
              const message = !isGhost ? warning?.(entry as E) : undefined;
              const custom = !isGhost ? renderValue?.(entry as E, (p) => update(entry.id, p)) : undefined;
              return [
                <tr key={entry.id} className={cx('m2a-kv-row', !entry.enabled && 'm2a-kv-row-disabled', isGhost && 'm2a-kv-row-ghost')}>
                  <td className="m2a-kv-check">
                    {!isGhost && (
                      <input
                        type="checkbox"
                        className="m2a-checkbox"
                        aria-label={`Enable ${itemLabel.toLowerCase()} ${entry.key || n}`}
                        checked={entry.enabled}
                        onChange={(e) => update(entry.id, { enabled: e.target.checked } as Partial<E>)}
                      />
                    )}
                  </td>
                  <td>
                    <VariableInput
                      value={entry.key}
                      onValueChange={(key) => set({ key } as Partial<E>)}
                      resolver={resolver}
                      placeholder={isGhost ? `Add ${itemLabel.toLowerCase()}` : keyPlaceholder}
                      aria-label={`${itemLabel} ${n} ${keyPlaceholder.toLowerCase()}`}
                      list={keySuggestions ? listId : undefined}
                    />
                  </td>
                  <td>
                    {custom ?? (
                      <VariableInput
                        value={entry.value}
                        onValueChange={(value) => set({ value } as Partial<E>)}
                        resolver={resolver}
                        placeholder={valuePlaceholder}
                        aria-label={`${itemLabel} ${n} ${valuePlaceholder.toLowerCase()}`}
                      />
                    )}
                  </td>
                  {showDescription && (
                    <td className="m2a-kv-desc-col">
                      <input
                        className="m2a-cell-input"
                        value={entry.description ?? ''}
                        placeholder="Description"
                        aria-label={`${itemLabel} ${n} description`}
                        onChange={(e) => set({ description: e.target.value } as Partial<E>)}
                      />
                    </td>
                  )}
                  <td className="m2a-kv-actions-col">
                    {!isGhost && (
                      <div className="m2a-kv-row-actions">
                        {renderExtra?.(entry as E, (p) => update(entry.id, p))}
                        <button
                          type="button"
                          className="m2a-icon-btn m2a-icon-btn-sm"
                          aria-label={`Delete ${itemLabel.toLowerCase()} ${entry.key || n}`}
                          title="Delete"
                          onClick={() => remove(entry.id)}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>,
                message ? (
                  <tr key={`${entry.id}-warning`} className="m2a-kv-warning-row">
                    <td />
                    <td colSpan={showDescription ? 4 : 3}>
                      <span className="m2a-kv-warning">
                        <IconWarning size={12} /> {message}
                      </span>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      )}
      {keySuggestions && (
        <datalist id={listId}>
          {keySuggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  );
}
