'use client';

import { useId, useMemo, useState } from 'react';
import { groupHistoryByDay, type HistoryEntry } from '../history/history';
import { formatBytes, formatDuration, formatRelativeTime } from '../utils/format';
import { EnsureRoot, useUi, type ThemeMode } from './Root';
import { useWorkspace, useWorkspaceSelector } from './context';
import { Menu } from './primitives/Menu';
import { EmptyState, IconButton, MethodBadge, statusTone } from './primitives/misc';
import { SaveRequestDialog } from './dialogs';
import { IconClock, IconMore, IconRefresh, IconSave, IconSearch, IconTrash } from './icons';

export interface RequestHistoryProps {
  /** Called after an entry is opened or replayed (e.g. to close a mobile drawer). */
  onOpenEntry?: (entry: HistoryEntry) => void;
  theme?: ThemeMode;
  className?: string;
}

/** Recently sent requests grouped by day: open, replay, save or delete them. Needs `<ApiClient>` or `<ApiClientProvider>`. */
export function RequestHistory(props: RequestHistoryProps) {
  return (
    <EnsureRoot theme={props.theme} className={props.className}>
      <RequestHistoryInner {...props} />
    </EnsureRoot>
  );
}

function Outcome({ entry }: { entry: HistoryEntry }) {
  const { outcome } = entry;
  if (outcome.type === 'error') {
    return (
      <span className="m2a-history-outcome" data-tone={outcome.kind === 'aborted' ? 'neutral' : 'danger'} title={outcome.message}>
        {outcome.kind === 'timeout' ? 'Timeout' : outcome.kind === 'invalid-request' ? 'Invalid' : 'Error'}
      </span>
    );
  }
  return (
    <span
      className="m2a-history-outcome"
      data-tone={statusTone(outcome.status)}
      title={`${outcome.status} ${outcome.statusText} · ${formatDuration(outcome.duration)} · ${formatBytes(outcome.size)}`}
    >
      {outcome.status}
    </span>
  );
}

const NO_HISTORY: HistoryEntry[] = [];

function RequestHistoryInner({ onOpenEntry }: RequestHistoryProps) {
  const workspace = useWorkspace();
  const ui = useUi();
  const history = useWorkspaceSelector((s) => s.history) ?? NO_HISTORY;
  const [filter, setFilter] = useState('');
  const filterId = useId();
  const query = filter.trim().toLowerCase();
  const groups = useMemo(() => {
    const filtered = query
      ? history.filter((e) => `${e.request.method} ${e.request.url} ${e.request.name}`.toLowerCase().includes(query))
      : history;
    return groupHistoryByDay(filtered);
  }, [history, query]);

  const openEntry = (entry: HistoryEntry) => {
    workspace.actions.openHistoryEntry(entry.id);
    onOpenEntry?.(entry);
  };
  const replay = (entry: HistoryEntry) => {
    void workspace.actions.replayHistoryEntry(entry.id);
    onOpenEntry?.(entry);
  };
  const save = (entry: HistoryEntry) => {
    const tabId = workspace.actions.openHistoryEntry(entry.id);
    if (tabId)
      ui.openDialog((close) => (
        <SaveRequestDialog workspace={workspace} tabId={tabId} onClose={close} onSaved={() => ui.announce('Request saved')} />
      ));
  };
  const clear = async () => {
    const ok = await ui.confirm({
      title: 'Clear history?',
      message: `All ${history.length} history entries will be removed. Saved requests are not affected.`,
      confirmLabel: 'Clear history',
      danger: true,
    });
    if (ok) {
      workspace.actions.clearHistory();
      ui.announce('History cleared');
    }
  };

  if (history.length === 0) {
    return (
      <div className="m2a-history">
        <EmptyState icon={<IconClock size={20} />} title="No history yet">
          Requests you send appear here with their status and timing, so you can reopen or replay them.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="m2a-history">
      <div className="m2a-sidebar-toolbar">
        <div className="m2a-search m2a-search-sm">
          <IconSearch size={14} />
          <label htmlFor={filterId} className="m2a-sr-only">
            Filter history
          </label>
          <input
            id={filterId}
            type="search"
            className="m2a-search-input"
            placeholder="Filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <IconButton label="Clear history" size="sm" onClick={() => void clear()}>
          <IconTrash />
        </IconButton>
      </div>
      {groups.length === 0 && <p className="m2a-muted m2a-pad">No history matches “{filter}”.</p>}
      {groups.map((group) => (
        <section key={group.label} className="m2a-history-group" aria-label={group.label}>
          <h3 className="m2a-sidebar-heading">{group.label}</h3>
          <ul className="m2a-history-list">
            {group.entries.map((entry) => {
              const label = entry.request.name || entry.request.url || '(no URL)';
              return (
                <li key={entry.id} className="m2a-history-item">
                  <button
                    type="button"
                    className="m2a-history-open"
                    onClick={() => openEntry(entry)}
                    title={`${entry.request.method} ${entry.request.url}\n${new Date(entry.timestamp).toLocaleString()}`}
                    aria-label={`Open ${entry.request.method} ${label}, ${entry.outcome.type === 'response' ? `status ${entry.outcome.status}` : entry.outcome.message}, ${formatRelativeTime(entry.timestamp)}`}
                  >
                    <MethodBadge method={entry.request.method} compact />
                    <span className="m2a-history-url">{label}</span>
                    <Outcome entry={entry} />
                    <time className="m2a-history-time" dateTime={new Date(entry.timestamp).toISOString()}>
                      {new Date(entry.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </button>
                  <span className="m2a-node-actions">
                    <IconButton label={`Send ${label} again`} size="sm" onClick={() => replay(entry)}>
                      <IconRefresh size={14} />
                    </IconButton>
                    <Menu
                      label={`Actions for ${label}`}
                      trigger={<IconMore size={14} />}
                      triggerClassName="m2a-icon-btn m2a-icon-btn-sm"
                      items={[
                        { id: 'open', label: 'Open in new tab', onSelect: () => openEntry(entry) },
                        { id: 'replay', label: 'Send again', icon: <IconRefresh />, onSelect: () => replay(entry) },
                        { id: 'save', label: 'Save to collection…', icon: <IconSave />, onSelect: () => save(entry) },
                        'separator',
                        {
                          id: 'delete',
                          label: 'Delete',
                          icon: <IconTrash />,
                          danger: true,
                          onSelect: () => workspace.actions.removeHistoryEntry(entry.id),
                        },
                      ]}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
