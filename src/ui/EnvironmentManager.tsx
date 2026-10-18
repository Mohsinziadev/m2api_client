'use client';

import { useId, useState } from 'react';
import type { Variable } from '../core/types';
import { EnsureRoot, useUi, type ThemeMode } from './Root';
import { useWorkspace, useWorkspaceSelector } from './context';
import { Menu } from './primitives/Menu';
import { EmptyState, IconButton, cx } from './primitives/misc';
import { VariablesTable } from './VariablesTable';
import { IconCheck, IconCopy, IconGlobe, IconInfo, IconMore, IconPlus, IconTrash } from './icons';

export interface EnvironmentManagerProps {
  theme?: ThemeMode;
  className?: string;
}

const GLOBALS = '__globals';

/**
 * Create, switch and edit environments and global variables. Needs `<ApiClient>` or `<ApiClientProvider>`.
 * Precedence (highest first): request → active environment → collection → globals.
 */
export function EnvironmentManager(props: EnvironmentManagerProps) {
  return (
    <EnsureRoot theme={props.theme} className={props.className}>
      <EnvironmentManagerInner />
    </EnsureRoot>
  );
}

function EnvironmentManagerInner() {
  const workspace = useWorkspace();
  const ui = useUi();
  const environments = useWorkspaceSelector((s) => s.environments) ?? [];
  const activeId = useWorkspaceSelector((s) => s.activeEnvironmentId) ?? null;
  const globals = useWorkspaceSelector((s) => s.globals) ?? [];
  const [selectedId, setSelectedId] = useState<string>(() => activeId ?? environments[0]?.id ?? GLOBALS);
  const selected = selectedId === GLOBALS ? null : environments.find((e) => e.id === selectedId);
  const editing = selectedId === GLOBALS ? GLOBALS : (selected?.id ?? environments[0]?.id ?? GLOBALS);
  const env = editing === GLOBALS ? null : environments.find((e) => e.id === editing);

  const create = async () => {
    const name = await ui.prompt({
      title: 'New environment',
      label: 'Name',
      placeholder: 'e.g. Staging',
      initialValue: '',
      confirmLabel: 'Create',
    });
    if (name === null) return;
    const id = workspace.actions.addEnvironment(name, [{ key: 'baseUrl', value: '' }]);
    setSelectedId(id);
  };
  const rename = async (id: string, current: string) => {
    const name = await ui.prompt({ title: 'Rename environment', label: 'Name', initialValue: current, confirmLabel: 'Rename' });
    if (name !== null) workspace.actions.updateEnvironment(id, { name });
  };
  const remove = async (id: string, name: string) => {
    const ok = await ui.confirm({
      title: `Delete “${name}”?`,
      message: 'Its variables will be deleted. Requests that use them will show unresolved variables.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    workspace.actions.removeEnvironment(id);
    setSelectedId(GLOBALS);
  };

  return (
    <div className="m2a-envs">
      <div className="m2a-sidebar-toolbar">
        <span className="m2a-sidebar-heading m2a-grow">Environments</span>
        <IconButton label="New environment" size="sm" onClick={() => void create()}>
          <IconPlus />
        </IconButton>
      </div>
      <ul className="m2a-env-list" aria-label="Environments">
        {environments.map((e) => (
          <li key={e.id} className={cx('m2a-env-item', editing === e.id && 'm2a-env-item-selected')}>
            <button
              type="button"
              className="m2a-env-open"
              aria-current={editing === e.id ? 'true' : undefined}
              onClick={() => setSelectedId(e.id)}
            >
              <span className={cx('m2a-env-dot', activeId === e.id && 'm2a-env-dot-active')} aria-hidden="true" />
              <span className="m2a-node-name">{e.name}</span>
              {activeId === e.id && <span className="m2a-pill">Active</span>}
            </button>
            <span className="m2a-node-actions">
              <Menu
                label={`Actions for ${e.name}`}
                trigger={<IconMore size={14} />}
                triggerClassName="m2a-icon-btn m2a-icon-btn-sm"
                items={[
                  {
                    id: 'activate',
                    label: activeId === e.id ? 'Deactivate' : 'Set as active',
                    icon: <IconCheck />,
                    onSelect: () => workspace.actions.setActiveEnvironment(activeId === e.id ? null : e.id),
                  },
                  { id: 'rename', label: 'Rename', onSelect: () => void rename(e.id, e.name) },
                  {
                    id: 'duplicate',
                    label: 'Duplicate',
                    icon: <IconCopy />,
                    onSelect: () => setSelectedId(workspace.actions.duplicateEnvironment(e.id) ?? e.id),
                  },
                  'separator',
                  { id: 'delete', label: 'Delete', icon: <IconTrash />, danger: true, onSelect: () => void remove(e.id, e.name) },
                ]}
              />
            </span>
          </li>
        ))}
        <li className={cx('m2a-env-item', editing === GLOBALS && 'm2a-env-item-selected')}>
          <button
            type="button"
            className="m2a-env-open"
            aria-current={editing === GLOBALS ? 'true' : undefined}
            onClick={() => setSelectedId(GLOBALS)}
          >
            <IconGlobe size={14} />
            <span className="m2a-node-name">Globals</span>
            <span className="m2a-node-count">{globals.length}</span>
          </button>
        </li>
      </ul>

      <div className="m2a-env-editor">
        {env ? (
          <>
            <div className="m2a-env-editor-head">
              <h3 className="m2a-section-title">{env.name}</h3>
              {activeId === env.id ? (
                <span className="m2a-pill">Active</span>
              ) : (
                <button type="button" className="m2a-btn m2a-btn-sm" onClick={() => workspace.actions.setActiveEnvironment(env.id)}>
                  Use this environment
                </button>
              )}
            </div>
            <VariablesTable
              label={`Variables of ${env.name}`}
              variables={env.variables}
              onChange={(variables: Variable[]) => workspace.actions.updateEnvironment(env.id, { variables })}
            />
          </>
        ) : editing === GLOBALS ? (
          <>
            <div className="m2a-env-editor-head">
              <h3 className="m2a-section-title">Globals</h3>
            </div>
            <VariablesTable label="Global variables" variables={globals} onChange={workspace.actions.setGlobals} />
          </>
        ) : (
          <EmptyState title="No environment selected" />
        )}
        {environments.length === 0 && editing === GLOBALS && (
          <EmptyState
            title="No environments yet"
            actions={
              <button type="button" className="m2a-btn" onClick={() => void create()}>
                <IconPlus /> New environment
              </button>
            }
          >
            Environments hold values such as <code>{'{{baseUrl}}'}</code> and <code>{'{{apiToken}}'}</code> for Development, Staging or
            Production.
          </EmptyState>
        )}
        <p className="m2a-hint">
          <IconInfo size={12} /> Use variables as <code>{'{{name}}'}</code> in URLs, params, headers, bodies and auth. Precedence: active
          environment, then collection, then globals. Mark credentials as secret (lock icon): they are masked, redacted from logs and never
          persisted unless you opt in.
        </p>
      </div>
    </div>
  );
}

export interface EnvironmentSelectorProps {
  className?: string;
  /** Called when the user picks "Manage environments…". */
  onManage?: () => void;
}

/** A compact select for switching the active environment. Needs `<ApiClient>` or `<ApiClientProvider>`. */
export function EnvironmentSelector({ className, onManage }: EnvironmentSelectorProps) {
  const workspace = useWorkspace();
  const environments = useWorkspaceSelector((s) => s.environments) ?? [];
  const activeId = useWorkspaceSelector((s) => s.activeEnvironmentId) ?? null;
  const id = useId();
  return (
    <div className={cx('m2a-env-select', className)}>
      <label htmlFor={id} className="m2a-sr-only">
        Active environment
      </label>
      <IconGlobe size={14} />
      <select
        id={id}
        className="m2a-select m2a-select-plain"
        value={activeId ?? ''}
        onChange={(e) => {
          if (e.target.value === '__manage') onManage?.();
          else workspace.actions.setActiveEnvironment(e.target.value || null);
        }}
      >
        <option value="">No environment</option>
        {environments.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
        {onManage && <option value="__manage">Manage environments…</option>}
      </select>
    </div>
  );
}
