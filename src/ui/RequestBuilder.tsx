'use client';

import { useId, useState } from 'react';
import type { AuthProfile, HttpMethod, RequestDefinition, VariablesInput } from '../core/types';
import { HTTP_METHODS } from '../core/types';
import { syncParamsFromUrl } from '../core/url';
import type { HeaderPreset } from '../core/request';
import { parseCurl } from '../curl/import';
import { findNode } from '../collections/collections';
import type { VariableScopes } from '../env/variables';
import { snapshotRequest } from '../core/redact';
import { EnsureRoot, useOptionalUi, type ThemeMode } from './Root';
import { useWorkspaceSelector } from './context';
import { Tabs, tabPanelProps } from './primitives/Tabs';
import { Menu } from './primitives/Menu';
import { VariableInput } from './primitives/VariableInput';
import { cx, modKey } from './primitives/misc';
import { IconClose, IconCode, IconCopy, IconMore, IconSave, IconSend, IconUpload, IconWarning } from './icons';
import { CurlExportDialog, CurlImportDialog, SaveRequestDialog } from './dialogs';
import { AuthPanel } from './request/AuthPanel';
import { BodyPanel } from './request/BodyPanel';
import { HeadersPanel, ParamsPanel, SettingsPanel } from './request/panels';
import { useRequestModel, type RequestModel } from './request/model';

export type RequestBuilderTab = 'params' | 'headers' | 'auth' | 'body' | 'settings';

export interface RequestBuilderProps {
  /** Controlled mode: the request to edit. Omit to edit the workspace's active (or `tabId`) tab. */
  request?: RequestDefinition;
  onRequestChange?: (request: RequestDefinition) => void;
  /** Controlled mode: called on Send / ⌘↵. */
  onSend?: (request: RequestDefinition) => void;
  onCancel?: () => void;
  loading?: boolean;
  /** Controlled mode: variables for highlighting and preview. */
  variables?: VariableScopes | VariablesInput;
  authProfiles?: AuthProfile[];
  /** Connected mode: edit a specific tab instead of the active one. */
  tabId?: string;
  defaultTab?: RequestBuilderTab;
  headerPresets?: HeaderPreset[];
  theme?: ThemeMode;
  className?: string;
}

/** The request editor: method, URL, Send, and the Params / Headers / Authorization / Body / Settings tabs. */
export function RequestBuilder(props: RequestBuilderProps) {
  return (
    <EnsureRoot theme={props.theme} className={props.className}>
      <RequestBuilderInner {...props} />
    </EnsureRoot>
  );
}

function RequestBuilderInner({ defaultTab = 'params', headerPresets, ...input }: RequestBuilderProps) {
  const model = useRequestModel(input);
  const [tab, setTab] = useState<RequestBuilderTab>(defaultTab);
  const prefix = useId();
  const { request } = model;
  const enabledParams = request.params.filter((p) => p.enabled && p.key).length;
  const enabledHeaders = request.headers.filter((h) => h.enabled && h.key).length;
  const dot = <span className="m2a-dot" aria-label="configured" />;

  return (
    <section
      className="m2a-request"
      aria-label="Request"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          model.send();
        }
      }}
    >
      <RequestTitle model={model} />
      <UrlBar model={model} />
      <Tabs
        idPrefix={prefix}
        label="Request sections"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'params', label: 'Params', badge: enabledParams || undefined },
          { id: 'headers', label: 'Headers', badge: enabledHeaders || undefined },
          { id: 'auth', label: 'Authorization', badge: request.auth.type !== 'none' ? dot : undefined },
          { id: 'body', label: 'Body', badge: request.body.type !== 'none' ? dot : undefined },
          { id: 'settings', label: 'Settings' },
        ]}
      />
      <div className="m2a-request-panel" {...tabPanelProps(prefix, tab)}>
        {tab === 'params' && <ParamsPanel model={model} />}
        {tab === 'headers' && <HeadersPanel model={model} presets={headerPresets} />}
        {tab === 'auth' && <AuthPanel model={model} />}
        {tab === 'body' && <BodyPanel model={model} />}
        {tab === 'settings' && <SettingsPanel model={model} />}
      </div>
    </section>
  );
}

function RequestTitle({ model }: { model: RequestModel }) {
  const { request, update, workspace, tab } = model;
  const collections = useWorkspaceSelector((s) => s.collections, workspace);
  const location = tab?.savedId && collections ? findNode(collections, tab.savedId) : undefined;
  const crumbs = location
    ? [location.collection.name, ...location.path.map((id) => findNode([location.collection], id)?.node.name ?? '')]
    : [];
  const nameId = useId();
  return (
    <div className="m2a-request-title">
      {crumbs.length > 0 && (
        <span className="m2a-crumbs" aria-label="Saved in">
          {crumbs.map((c, i) => (
            <span key={i} className="m2a-crumb">
              {c}
            </span>
          ))}
        </span>
      )}
      <label htmlFor={nameId} className="m2a-sr-only">
        Request name
      </label>
      <input
        id={nameId}
        className="m2a-title-input"
        value={request.name}
        placeholder={tab?.savedId ? 'Untitled request' : 'Untitled request (not saved)'}
        onChange={(e) => update({ name: e.target.value })}
        onBlur={() => {
          if (tab?.savedId && request.name.trim() && workspace) workspace.actions.rename(tab.savedId, request.name.trim());
        }}
        autoComplete="off"
      />
      {tab?.dirty && tab.savedId && <span className="m2a-unsaved">Unsaved changes</span>}
    </div>
  );
}

function UrlBar({ model }: { model: RequestModel }) {
  const { request, update, resolver, loading, send, cancel, prepared, prepareError, workspace, tab } = model;
  const ui = useOptionalUi();
  const urlId = useId();
  const methodId = useId();
  const [touched, setTouched] = useState(false);

  const onUrlChange = (url: string) => {
    setTouched(true);
    update((r) => ({ ...r, url, params: syncParamsFromUrl(url, r.params) }));
  };

  const importCurl = (command: string) => {
    const result = parseCurl(command);
    update((r) => ({ ...result.request, id: r.id, name: r.name }));
    ui?.announce(result.warnings.length ? `cURL imported with warnings: ${result.warnings.join(' ')}` : 'cURL command imported');
    return result;
  };

  const save = () => {
    if (!workspace || !tab) return;
    if (tab.savedId && findNode(workspace.getState().collections, tab.savedId)) {
      workspace.actions.saveTab(tab.id);
      ui?.announce('Request saved');
    } else {
      ui?.openDialog((close) => (
        <SaveRequestDialog workspace={workspace} tabId={tab.id} onClose={close} onSaved={() => ui.announce('Request saved')} />
      ));
    }
  };

  const showError = prepareError && (touched || request.url.trim() !== '') && request.url.trim() !== '';
  const finalUrl = prepared ? snapshotRequest(prepared).url : null;
  const showPreview =
    finalUrl &&
    (request.url.includes('{{') ||
      request.params.some((p) => p.enabled && (p.key.includes('{{') || p.value.includes('{{'))) ||
      finalUrl !== request.url);

  return (
    <div className="m2a-urlbar-wrap">
      <form
        className="m2a-urlbar"
        onSubmit={(e) => {
          e.preventDefault();
          if (loading) cancel();
          else send();
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && workspace) {
            e.preventDefault();
            e.stopPropagation();
            save();
          }
        }}
      >
        <label htmlFor={methodId} className="m2a-sr-only">
          HTTP method
        </label>
        <select
          id={methodId}
          className="m2a-method-select"
          data-method={request.method}
          value={request.method}
          onChange={(e) => update({ method: e.target.value as HttpMethod })}
        >
          {HTTP_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <label htmlFor={urlId} className="m2a-sr-only">
          Request URL
        </label>
        <VariableInput
          id={urlId}
          className="m2a-url-input"
          value={request.url}
          onValueChange={onUrlChange}
          resolver={resolver}
          placeholder="https://api.example.com/users or paste a cURL command"
          aria-invalid={showError ? true : undefined}
          aria-describedby={`${urlId}-status`}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (!/^\s*curl\s/i.test(text)) return;
            e.preventDefault();
            try {
              importCurl(text);
            } catch (error) {
              ui?.announce(error instanceof Error ? error.message : 'Could not parse the cURL command');
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && loading) {
              e.preventDefault();
              cancel();
            }
          }}
        />
        {loading ? (
          <button type="submit" className="m2a-btn m2a-btn-send m2a-btn-cancel" title="Cancel request (Esc)">
            <IconClose /> Cancel
          </button>
        ) : (
          <button type="submit" className="m2a-btn m2a-btn-send" title={`Send request (${modKey()}Enter)`}>
            Send <IconSend />
          </button>
        )}
        {workspace && tab && (
          <button
            type="button"
            className={cx('m2a-btn m2a-btn-icon-text', tab.dirty && 'm2a-btn-dirty')}
            onClick={save}
            title={`Save (${modKey()}S)`}
            aria-label={tab.dirty ? 'Save request (unsaved changes)' : 'Save request'}
          >
            <IconSave />
            <span className="m2a-hide-narrow">Save</span>
          </button>
        )}
        <Menu
          label="More request actions"
          trigger={<IconMore />}
          items={[
            {
              id: 'copy-curl',
              label: 'Copy as cURL',
              icon: <IconCode />,
              disabled: !prepared,
              onSelect: () => prepared && ui?.openDialog((close) => <CurlExportDialog prepared={prepared} onClose={close} />),
            },
            {
              id: 'import-curl',
              label: 'Replace from cURL…',
              icon: <IconUpload />,
              onSelect: () => ui?.openDialog((close) => <CurlImportDialog onImport={importCurl} onClose={close} />),
            },
            ...(workspace && tab
              ? [
                  {
                    id: 'duplicate',
                    label: 'Duplicate in new tab',
                    icon: <IconCopy />,
                    onSelect: () => workspace.actions.duplicateTab(tab.id),
                  },
                ]
              : []),
          ]}
        />
      </form>
      <div id={`${urlId}-status`} className="m2a-url-status" aria-live="polite">
        {showError ? (
          <span className="m2a-url-error">
            <IconWarning size={12} /> {prepareError.message}
          </span>
        ) : showPreview ? (
          <span className="m2a-url-preview" title={finalUrl ?? undefined}>
            <span className="m2a-url-preview-label">Resolved</span> {finalUrl}
          </span>
        ) : null}
        {prepared && prepared.unresolvedVariables.length > 0 && !showError && (
          <span className="m2a-url-error">
            <IconWarning size={12} /> Unresolved: {prepared.unresolvedVariables.map((v) => `{{${v}}}`).join(', ')}
          </span>
        )}
      </div>
    </div>
  );
}
