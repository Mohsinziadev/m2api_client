'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import type { PreparedRequest } from '../core/types';
import { toCurl } from '../curl/export';
import { CurlParseError } from '../curl/import';
import { importWorkspace } from '../collections/io';
import { OpenApiImportError } from '../openapi/import';
import type { CollectionNode } from '../collections/collections';
import type { Workspace } from '../state/workspace';
import { useWorkspaceSelector } from './context';
import { Dialog } from './primitives/Dialog';
import { CodeEditor } from './primitives/CodeEditor';
import { Kbd, Notice, downloadFile, modKey, useCopy } from './primitives/misc';
import { IconCheck, IconCopy, IconDownload, IconUpload, IconWarning } from './icons';
import { VariablesTable } from './VariablesTable';
import { useOptionalUi } from './Root';

export function CurlExportDialog({ prepared, onClose }: { prepared: PreparedRequest; onClose: () => void }) {
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [copied, copy] = useCopy();
  const command = useMemo(() => toCurl(prepared, { redact: !includeSecrets }), [prepared, includeSecrets]);
  const checkboxId = useId();
  return (
    <Dialog
      title="Copy as cURL"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <label className="m2a-check-label m2a-footer-start" htmlFor={checkboxId}>
            <input
              id={checkboxId}
              type="checkbox"
              className="m2a-checkbox"
              checked={includeSecrets}
              onChange={(e) => setIncludeSecrets(e.target.checked)}
            />
            Include credentials
          </label>
          <button type="button" className="m2a-btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="m2a-btn m2a-btn-primary" onClick={() => copy(command, 'cURL command copied')}>
            {copied ? <IconCheck /> : <IconCopy />} {copied ? 'Copied' : 'Copy command'}
          </button>
        </>
      }
    >
      <CodeEditor label="cURL command" value={command} readOnly minLines={6} />
      {includeSecrets && (
        <Notice tone="warning" icon={<IconWarning />}>
          The command contains real credentials. Don&apos;t paste it into tickets, chats or shell history you share.
        </Notice>
      )}
    </Dialog>
  );
}

export function CurlImportDialog({ onImport, onClose }: { onImport: (command: string) => { warnings: string[] }; onClose: () => void }) {
  const [command, setCommand] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    try {
      onImport(command);
      onClose();
    } catch (e) {
      setError(e instanceof CurlParseError ? e.message : `Could not import: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return (
    <Dialog
      title="Import cURL"
      description="Paste a cURL command. It opens in a new tab. Tip: pasting a cURL command into the URL field works too."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="m2a-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="m2a-btn m2a-btn-primary" disabled={!command.trim()} onClick={submit}>
            Import
          </button>
        </>
      }
    >
      <CodeEditor
        label="cURL command"
        value={command}
        onChange={setCommand}
        placeholder="curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -d '{&quot;name&quot;:&quot;Ada&quot;}'"
        minLines={6}
      />
      {error && (
        <p className="m2a-field-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

interface FolderOption {
  id: string | null;
  label: string;
}

function folderOptions(items: CollectionNode[], depth = 0, out: FolderOption[] = []): FolderOption[] {
  for (const node of items) {
    if (node.type !== 'folder') continue;
    out.push({ id: node.id, label: `${'  '.repeat(depth)}${node.name}` });
    folderOptions(node.items, depth + 1, out);
  }
  return out;
}

export function SaveRequestDialog({
  workspace,
  tabId,
  onClose,
  onSaved,
}: {
  workspace: Workspace;
  tabId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const tab = workspace.getState().tabs.find((t) => t.id === tabId);
  const collections = useWorkspaceSelector((s) => s.collections, workspace) ?? [];
  const [name, setName] = useState(tab?.request.name || '');
  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? '__new');
  const [newCollection, setNewCollection] = useState('My collection');
  const [folderId, setFolderId] = useState<string>('');
  const ids = { name: useId(), collection: useId(), folder: useId(), newCollection: useId() };
  const collection = collections.find((c) => c.id === collectionId);
  const folders = collection ? folderOptions(collection.items) : [];

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    let target = collectionId;
    if (collectionId === '__new') target = workspace.actions.addCollection(newCollection.trim() || 'My collection');
    workspace.actions.saveTab(tabId, { collectionId: target, parentId: folderId || null, name: name.trim() });
    onSaved?.();
    onClose();
  };

  return (
    <Dialog title="Save request" size="sm" onClose={onClose}>
      <form className="m2a-form" onSubmit={submit}>
        <label className="m2a-label" htmlFor={ids.name}>
          Name
        </label>
        <input
          id={ids.name}
          className="m2a-input"
          value={name}
          placeholder="e.g. List users"
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
        />
        <label className="m2a-label" htmlFor={ids.collection}>
          Collection
        </label>
        <select
          id={ids.collection}
          className="m2a-select"
          value={collectionId}
          onChange={(e) => {
            setCollectionId(e.target.value);
            setFolderId('');
          }}
        >
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="__new">New collection…</option>
        </select>
        {collectionId === '__new' && (
          <>
            <label className="m2a-label" htmlFor={ids.newCollection}>
              New collection name
            </label>
            <input id={ids.newCollection} className="m2a-input" value={newCollection} onChange={(e) => setNewCollection(e.target.value)} />
          </>
        )}
        {folders.length > 0 && (
          <>
            <label className="m2a-label" htmlFor={ids.folder}>
              Folder
            </label>
            <select id={ids.folder} className="m2a-select" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">(collection root)</option>
              {folders.map((f) => (
                <option key={f.id!} value={f.id!}>
                  {f.label}
                </option>
              ))}
            </select>
          </>
        )}
        <div className="m2a-dialog-footer m2a-dialog-footer-inline">
          <button type="button" className="m2a-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="m2a-btn m2a-btn-primary">
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

type Detected = { kind: 'workspace' | 'openapi' | 'curl' | 'unknown' | 'empty'; label: string };

function detect(text: string): Detected {
  const t = text.trim();
  if (!t) return { kind: 'empty', label: '' };
  if (/^curl\s/i.test(t)) return { kind: 'curl', label: 'cURL command' };
  try {
    const json = JSON.parse(t) as Record<string, unknown>;
    if (typeof json.openapi === 'string' || typeof json.swagger === 'string')
      return { kind: 'openapi', label: `OpenAPI ${String(json.openapi ?? json.swagger)} document` };
    return { kind: 'workspace', label: 'm2api-client export' };
  } catch {
    if (/^(openapi|swagger):/m.test(t))
      return { kind: 'unknown', label: 'YAML is not supported. Convert the OpenAPI document to JSON first.' };
    return { kind: 'unknown', label: 'Not valid JSON or a cURL command.' };
  }
}

export function ImportDialog({ workspace, onClose }: { workspace: Workspace; onClose: () => void }) {
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const ui = useOptionalUi();
  const detected = detect(text);
  const fileId = useId();

  const submit = () => {
    setErrors([]);
    try {
      if (detected.kind === 'curl') {
        const result = workspace.actions.importCurl(text);
        ui?.announce(`Imported cURL command${result.warnings.length ? ` with ${result.warnings.length} warning(s)` : ''}`);
      } else if (detected.kind === 'openapi') {
        const result = workspace.actions.importOpenApi(text);
        ui?.announce(`Imported “${result.collection.name}”${result.warnings.length ? ` · ${result.warnings.join(' ')}` : ''}`);
      } else if (detected.kind === 'workspace') {
        const result = importWorkspace(text);
        if (!result.ok) {
          setErrors(result.errors);
          return;
        }
        workspace.actions.importData(result.data);
        ui?.announce(`Imported ${result.data.collections.length} collection(s) and ${result.data.environments.length} environment(s)`);
      } else return;
      onClose();
    } catch (e) {
      setErrors([e instanceof CurlParseError || e instanceof OpenApiImportError ? e.message : String(e)]);
    }
  };

  return (
    <Dialog
      title="Import"
      description="Paste or upload an m2api-client export, an OpenAPI 3 / Swagger 2 document (JSON) or a cURL command."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <label className="m2a-btn m2a-footer-start" htmlFor={fileId}>
            <IconUpload /> Choose file…
            <input
              id={fileId}
              type="file"
              accept=".json,application/json,.txt"
              className="m2a-sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setText(await file.text());
              }}
            />
          </label>
          <button type="button" className="m2a-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="m2a-btn m2a-btn-primary"
            disabled={detected.kind === 'empty' || detected.kind === 'unknown'}
            onClick={submit}
          >
            Import
          </button>
        </>
      }
    >
      <CodeEditor
        label="Import content"
        value={text}
        onChange={setText}
        language={text.trim().startsWith('{') ? 'json' : 'text'}
        minLines={10}
        placeholder="Paste JSON or a cURL command…"
      />
      {detected.kind !== 'empty' && (
        <p className={detected.kind === 'unknown' ? 'm2a-field-error' : 'm2a-hint'} role="status">
          {detected.kind === 'unknown' ? detected.label : `Detected: ${detected.label}`}
        </p>
      )}
      {errors.length > 0 && (
        <Notice tone="danger" icon={<IconWarning />}>
          <p>The file could not be imported:</p>
          <ul className="m2a-error-list">
            {errors.slice(0, 8).map((e) => (
              <li key={e}>{e}</li>
            ))}
            {errors.length > 8 && <li>…and {errors.length - 8} more</li>}
          </ul>
        </Notice>
      )}
    </Dialog>
  );
}

export function ExportDialog({
  workspace,
  onClose,
  collectionIds,
}: {
  workspace: Workspace;
  onClose: () => void;
  collectionIds?: string[];
}) {
  const collections = workspace.getState().collections;
  const [selected, setSelected] = useState<Set<string>>(() => new Set(collectionIds ?? collections.map((c) => c.id)));
  const [includeEnvironments, setIncludeEnvironments] = useState(!collectionIds);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [copied, copy] = useCopy();
  const json = () =>
    JSON.stringify(workspace.actions.exportData({ collectionIds: [...selected], includeEnvironments, includeSecrets }), null, 2);
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog
      title="Export"
      description="Exports use the documented m2api-client JSON format (version 1)."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="m2a-btn" onClick={() => copy(json(), 'Export copied')}>
            {copied ? <IconCheck /> : <IconCopy />} Copy JSON
          </button>
          <button
            type="button"
            className="m2a-btn m2a-btn-primary"
            onClick={() => {
              downloadFile(json(), `m2api-export-${new Date().toISOString().slice(0, 10)}.json`);
              onClose();
            }}
          >
            <IconDownload /> Download
          </button>
        </>
      }
    >
      <fieldset className="m2a-fieldset">
        <legend className="m2a-label">Collections</legend>
        {collections.length === 0 && <p className="m2a-muted">No collections yet.</p>}
        {collections.map((c) => (
          <label key={c.id} className="m2a-check-label">
            <input type="checkbox" className="m2a-checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
            {c.name}
          </label>
        ))}
      </fieldset>
      <label className="m2a-check-label">
        <input
          type="checkbox"
          className="m2a-checkbox"
          checked={includeEnvironments}
          onChange={(e) => setIncludeEnvironments(e.target.checked)}
        />
        Include environments and auth profiles
      </label>
      <label className="m2a-check-label">
        <input type="checkbox" className="m2a-checkbox" checked={includeSecrets} onChange={(e) => setIncludeSecrets(e.target.checked)} />
        Include credentials and secret values
      </label>
      {includeSecrets ? (
        <Notice tone="warning" icon={<IconWarning />}>
          The file will contain real credentials. Store and share it like a password.
        </Notice>
      ) : (
        <p className="m2a-hint">Secret variable values and literal credentials are left empty; {'{{variable}}'} references are kept.</p>
      )}
    </Dialog>
  );
}

export function CollectionVariablesDialog({
  workspace,
  collectionId,
  onClose,
}: {
  workspace: Workspace;
  collectionId: string;
  onClose: () => void;
}) {
  const collection = useWorkspaceSelector((s) => s.collections.find((c) => c.id === collectionId), workspace);
  if (!collection) return null;
  return (
    <Dialog
      title={`Variables · ${collection.name}`}
      description="Collection variables apply to requests saved in this collection. The active environment overrides them."
      size="lg"
      onClose={onClose}
      footer={
        <button type="button" className="m2a-btn m2a-btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <VariablesTable
        label="Collection variables"
        variables={collection.variables}
        onChange={(v) => workspace.actions.setCollectionVariables(collectionId, v)}
      />
    </Dialog>
  );
}

const SHORTCUTS: Array<[ReactNode, string]> = [
  [
    <>
      <Kbd>{modKey()}</Kbd>
      <Kbd>Enter</Kbd>
    </>,
    'Send request',
  ],
  [
    <>
      <Kbd>{modKey()}</Kbd>
      <Kbd>S</Kbd>
    </>,
    'Save request',
  ],
  [
    <>
      <Kbd>{modKey()}</Kbd>
      <Kbd>Shift</Kbd>
      <Kbd>F</Kbd>
    </>,
    'Format JSON body',
  ],
  [<Kbd key="esc">Esc</Kbd>, 'Cancel a running request (when focus is in the URL field)'],
  [
    <>
      <Kbd>Esc</Kbd> then <Kbd>Tab</Kbd>
    </>,
    'Leave a code editor (Tab alone indents)',
  ],
  [
    <>
      <Kbd>←</Kbd>
      <Kbd>→</Kbd>
    </>,
    'Move between tabs; resize panels when a divider is focused',
  ],
  [<Kbd key="enter">Enter</Kbd>, 'Next search match (Shift+Enter: previous)'],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" size="sm" onClose={onClose}>
      <dl className="m2a-shortcuts">
        {SHORTCUTS.map(([keys, label], i) => (
          <div key={i} className="m2a-shortcut">
            <dt>{keys}</dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
