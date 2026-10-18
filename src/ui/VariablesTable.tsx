'use client';

import { useState } from 'react';
import type { Variable } from '../core/types';
import { createId } from '../utils/id';
import { IconEye, IconEyeOff, IconLock, IconTrash, IconUnlock } from './icons';
import { cx } from './primitives/misc';

export interface VariablesTableProps {
  variables: Variable[];
  onChange: (variables: Variable[]) => void;
  label: string;
}

/** Editable variables with enable toggles and secret masking (secret values are hidden by default). */
export function VariablesTable({ variables, onChange, label }: VariablesTableProps) {
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [ghostId, setGhostId] = useState(() => createId('var'));
  const withIds = variables.map((v, i) => (v.id ? v : { ...v, id: `idx-${i}` }));
  const rows = [...withIds, { id: ghostId, key: '', value: '' } as Variable];

  const set = (id: string, patch: Partial<Variable>) => {
    if (id === ghostId) {
      onChange([...variables, { id: ghostId, key: '', value: '', ...patch }]);
      setGhostId(createId('var'));
      return;
    }
    onChange(withIds.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  };
  const toggleReveal = (id: string) =>
    setRevealed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <table className="m2a-kv-table m2a-vars-table" aria-label={label}>
      <thead>
        <tr>
          <th className="m2a-kv-check">
            <span className="m2a-sr-only">Enabled</span>
          </th>
          <th>Variable</th>
          <th>Value</th>
          <th className="m2a-kv-actions-col">
            <span className="m2a-sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((v, i) => {
          const id = v.id!;
          const ghost = id === ghostId;
          const hidden = Boolean(v.secret) && !revealed.has(id);
          const name = v.key || `${i + 1}`;
          return (
            <tr key={id} className={cx('m2a-kv-row', v.enabled === false && 'm2a-kv-row-disabled', ghost && 'm2a-kv-row-ghost')}>
              <td className="m2a-kv-check">
                {!ghost && (
                  <input
                    type="checkbox"
                    className="m2a-checkbox"
                    aria-label={`Enable variable ${name}`}
                    checked={v.enabled !== false}
                    onChange={(e) => set(id, { enabled: e.target.checked })}
                  />
                )}
              </td>
              <td>
                <input
                  className="m2a-cell-input m2a-mono"
                  value={v.key}
                  placeholder={ghost ? 'Add variable' : 'name'}
                  aria-label={`Variable ${i + 1} name`}
                  spellCheck={false}
                  onChange={(e) => set(id, { key: e.target.value.replace(/[{}\s]/g, '') })}
                />
              </td>
              <td>
                <input
                  className="m2a-cell-input m2a-mono"
                  type={hidden ? 'password' : 'text'}
                  value={v.value}
                  placeholder="value"
                  aria-label={`Variable ${i + 1} value`}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => set(id, { value: e.target.value })}
                />
              </td>
              <td className="m2a-kv-actions-col">
                {!ghost && (
                  <div className="m2a-kv-row-actions">
                    {v.secret && (
                      <button
                        type="button"
                        className="m2a-icon-btn m2a-icon-btn-sm"
                        aria-label={hidden ? `Show value of ${name}` : `Hide value of ${name}`}
                        title={hidden ? 'Show value' : 'Hide value'}
                        onClick={() => toggleReveal(id)}
                      >
                        {hidden ? <IconEye /> : <IconEyeOff />}
                      </button>
                    )}
                    <button
                      type="button"
                      className={cx('m2a-icon-btn m2a-icon-btn-sm', v.secret && 'm2a-icon-btn-on')}
                      aria-pressed={Boolean(v.secret)}
                      aria-label={`Mark ${name} as secret`}
                      title={v.secret ? 'Secret: masked and not persisted' : 'Mark as secret'}
                      onClick={() => set(id, { secret: !v.secret })}
                    >
                      {v.secret ? <IconLock /> : <IconUnlock />}
                    </button>
                    <button
                      type="button"
                      className="m2a-icon-btn m2a-icon-btn-sm"
                      aria-label={`Delete variable ${name}`}
                      title="Delete"
                      onClick={() => onChange(withIds.filter((x) => x.id !== id))}
                    >
                      <IconTrash />
                    </button>
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
