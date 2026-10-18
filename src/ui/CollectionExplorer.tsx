'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { countRequests, findNode, type Collection, type CollectionNode } from '../collections/collections';
import type { Workspace } from '../state/workspace';
import { EnsureRoot, useUi, type ThemeMode } from './Root';
import { useWorkspace, useWorkspaceSelector } from './context';
import { Menu, type MenuEntry } from './primitives/Menu';
import { Dialog } from './primitives/Dialog';
import { EmptyState, IconButton, MethodBadge, cx } from './primitives/misc';
import { CollectionVariablesDialog, ExportDialog, ImportDialog } from './dialogs';
import {
  IconChevronRight,
  IconCopy,
  IconDownload,
  IconFolder,
  IconGlobe,
  IconLayers,
  IconMore,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUpload,
  IconWand,
} from './icons';

export interface CollectionExplorerProps {
  /** Called after a saved request is opened (e.g. to close a mobile drawer). */
  onOpenRequest?: (requestId: string) => void;
  theme?: ThemeMode;
  className?: string;
}

type Row =
  | { kind: 'collection'; id: string; depth: 0; collection: Collection; expanded: boolean }
  | {
      kind: 'folder';
      id: string;
      depth: number;
      collection: Collection;
      node: Extract<CollectionNode, { type: 'folder' }>;
      expanded: boolean;
    }
  | { kind: 'request'; id: string; depth: number; collection: Collection; node: Extract<CollectionNode, { type: 'request' }> };

/** Saved requests organised in collections and folders. Needs `<ApiClient>` or `<ApiClientProvider>`. */
export function CollectionExplorer(props: CollectionExplorerProps) {
  return (
    <EnsureRoot theme={props.theme} className={props.className}>
      <CollectionExplorerInner {...props} />
    </EnsureRoot>
  );
}

function matchesFilter(node: CollectionNode, filter: string): boolean {
  if (node.type === 'folder') return node.name.toLowerCase().includes(filter) || node.items.some((n) => matchesFilter(n, filter));
  return `${node.method} ${node.name} ${node.url}`.toLowerCase().includes(filter);
}

const NO_COLLECTIONS: Collection[] = [];

function CollectionExplorerInner({ onOpenRequest }: CollectionExplorerProps) {
  const workspace = useWorkspace();
  const ui = useUi();
  const collections = useWorkspaceSelector((s) => s.collections) ?? NO_COLLECTIONS;
  const activeSavedId = useWorkspaceSelector((s) => s.tabs.find((t) => t.id === s.activeTabId)?.savedId);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState('');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const treeId = useId();
  const filterId = useId();
  const query = filter.trim().toLowerCase();

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (collection: Collection, items: CollectionNode[], depth: number) => {
      for (const node of items) {
        if (query && !matchesFilter(node, query)) continue;
        if (node.type === 'folder') {
          const expanded = Boolean(query) || !collapsed.has(node.id);
          out.push({ kind: 'folder', id: node.id, depth, collection, node, expanded });
          if (expanded) walk(collection, node.items, depth + 1);
        } else out.push({ kind: 'request', id: node.id, depth, collection, node });
      }
    };
    for (const collection of collections) {
      const visible = !query || collection.name.toLowerCase().includes(query) || collection.items.some((n) => matchesFilter(n, query));
      if (!visible) continue;
      const expanded = Boolean(query) || !collapsed.has(collection.id);
      out.push({ kind: 'collection', id: collection.id, depth: 0, collection, expanded });
      if (expanded) walk(collection, collection.items, 1);
    }
    return out;
  }, [collections, collapsed, query]);

  const toggle = (id: string, open?: boolean) =>
    setCollapsed((s) => {
      const next = new Set(s);
      const shouldOpen = open ?? next.has(id);
      if (shouldOpen) next.delete(id);
      else next.add(id);
      return next;
    });

  const open = (id: string) => {
    workspace.actions.openSaved(id);
    onOpenRequest?.(id);
  };

  const focusRow = (id: string) => {
    setFocusedId(id);
    const find = () => document.getElementById(treeId)?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
    const row = find();
    // Rows created by this action (new folder, expanded parent) only exist after the next render.
    if (row) row.focus();
    else requestAnimationFrame(() => find()?.focus());
  };

  const onTreeKeyDown = (event: React.KeyboardEvent) => {
    // Key events from a row's action menu are handled by the menu itself.
    const item = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (!item || item !== event.target) return;
    const index = rows.findIndex((r) => r.id === item.dataset.nodeId);
    const row = rows[index];
    if (!row) return;
    const isContainer = row.kind !== 'request';
    switch (event.key) {
      case 'ArrowDown':
        if (rows[index + 1]) focusRow(rows[index + 1].id);
        break;
      case 'ArrowUp':
        if (rows[index - 1]) focusRow(rows[index - 1].id);
        break;
      case 'Home':
        focusRow(rows[0].id);
        break;
      case 'End':
        focusRow(rows[rows.length - 1].id);
        break;
      case 'ArrowRight':
        if (isContainer && !row.expanded) toggle(row.id, true);
        else if (isContainer && rows[index + 1]?.depth > row.depth) focusRow(rows[index + 1].id);
        break;
      case 'ArrowLeft':
        if (isContainer && row.expanded) toggle(row.id, false);
        else {
          for (let i = index - 1; i >= 0; i--) {
            if (rows[i].depth < row.depth) {
              focusRow(rows[i].id);
              break;
            }
          }
        }
        break;
      case 'Enter':
      case ' ':
        if (row.kind === 'request') open(row.id);
        else toggle(row.id);
        break;
      case 'F2':
        void renameNode(row);
        break;
      case 'Delete':
      case 'Backspace':
        void deleteNode(row);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const nameOf = (row: Row) => (row.kind === 'collection' ? row.collection.name : row.node.name || 'Untitled request');

  const renameNode = async (row: Row) => {
    const name = await ui.prompt({
      title: `Rename ${row.kind}`,
      label: 'Name',
      initialValue: nameOf(row),
      confirmLabel: 'Rename',
    });
    if (name !== null) workspace.actions.rename(row.id, name.trim());
  };

  const deleteNode = async (row: Row) => {
    const count =
      row.kind === 'collection' ? countRequests(row.collection.items) : row.kind === 'folder' ? countRequests(row.node.items) : 0;
    const ok = await ui.confirm({
      title: `Delete ${row.kind}?`,
      message:
        row.kind === 'request' ? (
          <>
            “{nameOf(row)}” will be removed from {row.collection.name}. Open tabs keep their contents as unsaved drafts.
          </>
        ) : (
          <>
            “{nameOf(row)}” and the {count} request{count === 1 ? '' : 's'} inside it will be deleted. This cannot be undone.
          </>
        ),
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) {
      workspace.actions.remove(row.id);
      ui.announce(`${nameOf(row)} deleted`);
    }
  };

  const addFolder = async (collectionId: string, parentId: string | null) => {
    const name = await ui.prompt({ title: 'New folder', label: 'Folder name', initialValue: 'New folder', confirmLabel: 'Create' });
    if (name === null) return;
    const id = workspace.actions.addFolder(collectionId, name.trim(), parentId);
    if (parentId) toggle(parentId, true);
    toggle(collectionId, true);
    focusRow(id);
  };

  const addRequest = (collectionId: string, parentId: string | null) => {
    const tabId = workspace.actions.newTab({ name: 'New request' });
    workspace.actions.saveTab(tabId, { collectionId, parentId, name: 'New request' });
    if (parentId) toggle(parentId, true);
    toggle(collectionId, true);
    ui.announce('New request created');
  };

  const addCollection = async () => {
    const name = await ui.prompt({
      title: 'New collection',
      label: 'Collection name',
      initialValue: 'New collection',
      confirmLabel: 'Create',
    });
    if (name === null) return;
    focusRow(workspace.actions.addCollection(name.trim()));
  };

  const menuFor = (row: Row): MenuEntry[] => {
    const containerId = row.kind === 'request' ? null : row.id;
    const entries: MenuEntry[] = [];
    if (row.kind === 'request') entries.push({ id: 'open', label: 'Open', onSelect: () => open(row.id) });
    if (containerId) {
      const parentId = row.kind === 'folder' ? row.id : null;
      entries.push(
        { id: 'new-request', label: 'New request', icon: <IconPlus />, onSelect: () => addRequest(row.collection.id, parentId) },
        { id: 'new-folder', label: 'New folder', icon: <IconFolder />, onSelect: () => void addFolder(row.collection.id, parentId) },
        'separator',
      );
    }
    entries.push(
      { id: 'rename', label: 'Rename', hint: 'F2', onSelect: () => void renameNode(row) },
      { id: 'duplicate', label: 'Duplicate', icon: <IconCopy />, onSelect: () => workspace.actions.duplicate(row.id) },
    );
    if (row.kind !== 'collection' && (collections.length > 1 || hasFolders(collections))) {
      entries.push({
        id: 'move',
        label: 'Move to…',
        onSelect: () => ui.openDialog((close) => <MoveDialog workspace={workspace} nodeId={row.id} onClose={close} />),
      });
    }
    if (row.kind === 'collection') {
      entries.push(
        {
          id: 'variables',
          label: 'Variables…',
          icon: <IconGlobe />,
          onSelect: () =>
            ui.openDialog((close) => <CollectionVariablesDialog workspace={workspace} collectionId={row.id} onClose={close} />),
        },
        {
          id: 'export',
          label: 'Export…',
          icon: <IconDownload />,
          onSelect: () => ui.openDialog((close) => <ExportDialog workspace={workspace} collectionIds={[row.id]} onClose={close} />),
        },
      );
    }
    entries.push('separator', {
      id: 'delete',
      label: 'Delete',
      icon: <IconTrash />,
      danger: true,
      hint: 'Del',
      onSelect: () => void deleteNode(row),
    });
    return entries;
  };

  // Native drag and drop: drop a request or folder on a folder or collection to move it.
  const dropProps = (row: Row) =>
    row.kind === 'request'
      ? {}
      : {
          onDragOver: (e: React.DragEvent) => {
            if (!dragging || dragging === row.id) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDropTarget(row.id);
          },
          onDragLeave: () => setDropTarget((t) => (t === row.id ? null : t)),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const source = dragging;
            setDragging(null);
            setDropTarget(null);
            if (!source || source === row.id) return;
            workspace.actions.move(source, { collectionId: row.collection.id, parentId: row.kind === 'folder' ? row.id : null });
            toggle(row.id, true);
            ui.announce('Moved');
          },
        };

  if (collections.length === 0) {
    return (
      <div className="m2a-explorer">
        <EmptyState
          icon={<IconLayers size={20} />}
          title="No collections yet"
          actions={
            <>
              <button type="button" className="m2a-btn m2a-btn-primary" onClick={() => void addCollection()}>
                <IconPlus /> New collection
              </button>
              <button
                type="button"
                className="m2a-btn"
                onClick={() => ui.openDialog((close) => <ImportDialog workspace={workspace} onClose={close} />)}
              >
                <IconUpload /> Import
              </button>
            </>
          }
        >
          Save requests with <strong>Save</strong> to organise them in collections and folders, or import a collection or OpenAPI document.
        </EmptyState>
      </div>
    );
  }

  const tabbable = rows.some((r) => r.id === focusedId) ? focusedId : (rows.find((r) => r.id === activeSavedId)?.id ?? rows[0]?.id);

  return (
    <div className="m2a-explorer">
      <div className="m2a-sidebar-toolbar">
        <div className="m2a-search m2a-search-sm">
          <IconSearch size={14} />
          <label htmlFor={filterId} className="m2a-sr-only">
            Filter collections
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
        <IconButton label="New collection" size="sm" onClick={() => void addCollection()}>
          <IconPlus />
        </IconButton>
        <Menu
          label="Collection actions"
          trigger={<IconMore />}
          triggerClassName="m2a-icon-btn m2a-icon-btn-sm"
          items={[
            {
              id: 'import',
              label: 'Import…',
              icon: <IconUpload />,
              onSelect: () => ui.openDialog((close) => <ImportDialog workspace={workspace} onClose={close} />),
            },
            {
              id: 'export',
              label: 'Export all…',
              icon: <IconDownload />,
              onSelect: () => ui.openDialog((close) => <ExportDialog workspace={workspace} onClose={close} />),
            },
            'separator',
            {
              id: 'collapse',
              label: 'Collapse all',
              onSelect: () => setCollapsed(new Set(rows.filter((r) => r.kind !== 'request').map((r) => r.id))),
            },
            { id: 'expand', label: 'Expand all', onSelect: () => setCollapsed(new Set()) },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <p className="m2a-muted m2a-pad">No requests match “{filter}”.</p>
      ) : (
        <div id={treeId} role="tree" aria-label="Collections" className="m2a-tree-list" onKeyDown={onTreeKeyDown}>
          {rows.map((row) => {
            const container = row.kind !== 'request';
            const count =
              row.kind === 'collection' ? countRequests(row.collection.items) : row.kind === 'folder' ? countRequests(row.node.items) : 0;
            let content: ReactNode;
            if (row.kind === 'request') {
              content = (
                <>
                  <MethodBadge method={row.node.method} compact />
                  <span className="m2a-node-name">{row.node.name || row.node.url || 'Untitled request'}</span>
                </>
              );
            } else {
              content = (
                <>
                  <span className={cx('m2a-node-chevron', row.expanded && 'm2a-node-chevron-open')} aria-hidden="true">
                    <IconChevronRight size={12} />
                  </span>
                  {row.kind === 'collection' ? <IconLayers size={14} /> : <IconFolder size={14} />}
                  <span className="m2a-node-name">{nameOf(row)}</span>
                  <span className="m2a-node-count" aria-label={`${count} requests`}>
                    {count}
                  </span>
                </>
              );
            }
            return (
              <div
                key={row.id}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-expanded={container ? row.expanded : undefined}
                aria-selected={row.id === activeSavedId}
                aria-label={row.kind === 'request' ? `${row.node.method} ${row.node.name || row.node.url}` : nameOf(row)}
                data-node-id={row.id}
                tabIndex={row.id === tabbable ? 0 : -1}
                className={cx(
                  'm2a-node',
                  `m2a-node-${row.kind}`,
                  row.id === activeSavedId && 'm2a-node-active',
                  dropTarget === row.id && 'm2a-node-drop',
                )}
                style={{ paddingLeft: 8 + row.depth * 14 }}
                draggable={row.kind !== 'collection'}
                onDragStart={(e) => {
                  setDragging(row.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', row.id);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setDropTarget(null);
                }}
                {...dropProps(row)}
                onFocus={(e) => e.target === e.currentTarget && setFocusedId(row.id)}
                onClick={() => {
                  setFocusedId(row.id);
                  if (row.kind === 'request') open(row.id);
                  else toggle(row.id);
                }}
                onDoubleClick={() => row.kind !== 'request' || void renameNode(row)}
              >
                {content}
                <span className="m2a-node-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <Menu
                    label={`Actions for ${nameOf(row)}`}
                    trigger={<IconMore size={14} />}
                    triggerClassName="m2a-icon-btn m2a-icon-btn-sm"
                    items={menuFor(row)}
                  />
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function hasFolders(collections: readonly Collection[]): boolean {
  const walk = (items: CollectionNode[]): boolean => items.some((n) => n.type === 'folder');
  return collections.some((c) => walk(c.items));
}

function MoveDialog({ workspace, nodeId, onClose }: { workspace: Workspace; nodeId: string; onClose: () => void }) {
  const collections = workspace.getState().collections;
  const location = findNode(collections, nodeId);
  const selectId = useId();
  const targets: Array<{ value: string; label: string; collectionId: string; parentId: string | null }> = [];
  const walk = (collection: Collection, items: CollectionNode[], depth: number) => {
    for (const node of items) {
      if (node.type !== 'folder' || node.id === nodeId) continue;
      targets.push({ value: node.id, label: `${'  '.repeat(depth)}${node.name}`, collectionId: collection.id, parentId: node.id });
      walk(collection, node.items, depth + 1);
    }
  };
  for (const c of collections) {
    targets.push({ value: `col:${c.id}`, label: c.name, collectionId: c.id, parentId: null });
    walk(c, c.items, 1);
  }
  const [value, setValue] = useState(targets[0]?.value ?? '');
  if (!location) return null;
  return (
    <Dialog
      title={`Move “${location.node.name || 'Untitled'}”`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="m2a-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="m2a-btn m2a-btn-primary"
            onClick={() => {
              const target = targets.find((t) => t.value === value);
              if (target) workspace.actions.move(nodeId, { collectionId: target.collectionId, parentId: target.parentId });
              onClose();
            }}
          >
            Move
          </button>
        </>
      }
    >
      <label className="m2a-label" htmlFor={selectId}>
        Destination
      </label>
      <select id={selectId} className="m2a-select" value={value} onChange={(e) => setValue(e.target.value)}>
        {targets.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <p className="m2a-hint">
        <IconWand size={12} /> Tip: you can also drag requests and folders onto a folder or collection.
      </p>
    </Dialog>
  );
}
