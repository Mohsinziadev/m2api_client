'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ApiResponse, BodySource } from '../core/types';
import type { ApiError } from '../core/errors';
import { formatBytes, formatDuration } from '../utils/format';
import { sanitizeHtml } from '../utils/sanitizeHtml';
import { EnsureRoot, type ThemeMode } from './Root';
import { useOptionalWorkspace, useWorkspaceSelector } from './context';
import { findMatches, renderTokens, tokenizeJson } from './highlight';
import { Tabs, tabPanelProps } from './primitives/Tabs';
import { JsonTree } from './primitives/JsonTree';
import { CopyButton, EmptyState, IconButton, Notice, Spinner, StatusBadge, cx, downloadFile, modKey } from './primitives/misc';
import {
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconClose,
  IconDownload,
  IconError,
  IconGlobe,
  IconInfo,
  IconRefresh,
  IconSearch,
  IconSend,
  IconWarning,
} from './icons';

export type ResponseViewerTab = 'pretty' | 'tree' | 'raw' | 'preview' | 'headers' | 'request';

export interface ResponseViewerProps {
  /** Controlled mode: the response to show. Omit (with `error` and `loading`) to show the workspace's active tab. */
  response?: ApiResponse | null;
  error?: ApiError | null;
  loading?: boolean;
  /** Shown as a Cancel button while loading. */
  onCancel?: () => void;
  /** Shown as a Retry button on errors. */
  onRetry?: () => void;
  /** Connected mode: show a specific tab instead of the active one. */
  tabId?: string;
  defaultTab?: ResponseViewerTab;
  /** Replaces the default "Send a request" empty state. */
  emptyState?: ReactNode;
  theme?: ThemeMode;
  className?: string;
}

/** Text larger than this is not syntax highlighted. */
const HIGHLIGHT_LIMIT = 300_000;
/** Text larger than this is truncated until the user asks for all of it. */
const RENDER_LIMIT = 1_000_000;
/** JSON larger than this is shown as received instead of being re-indented. */
const PRETTY_LIMIT = 5_000_000;

/** Status, timing, size, and Pretty / Tree / Raw / Preview / Headers / Request views of a response. */
export function ResponseViewer(props: ResponseViewerProps) {
  return (
    <EnsureRoot theme={props.theme} className={props.className}>
      <ResponseViewerInner {...props} />
    </EnsureRoot>
  );
}

function ResponseViewerInner({
  response: responseProp,
  error: errorProp,
  loading: loadingProp,
  onCancel,
  onRetry,
  tabId,
  defaultTab,
  emptyState,
}: ResponseViewerProps) {
  const workspace = useOptionalWorkspace();
  const controlled = responseProp !== undefined || errorProp !== undefined || loadingProp !== undefined || !workspace;
  const tab = useWorkspaceSelector((s) => s.tabs.find((t) => t.id === (tabId ?? s.activeTabId)), controlled ? null : workspace);

  const response = controlled ? (responseProp ?? null) : (tab?.response ?? null);
  const error = controlled ? (errorProp ?? null) : (tab?.error ?? null);
  const loading = controlled ? Boolean(loadingProp) : tab?.status === 'loading';
  const cancel = onCancel ?? (!controlled && workspace && tab ? () => workspace.actions.cancel(tab.id) : undefined);
  const retry = onRetry ?? (!controlled && workspace && tab ? () => void workspace.actions.send(tab.id) : undefined);

  let content: ReactNode;
  if (loading) content = <LoadingState startedAt={controlled ? undefined : tab?.startedAt} onCancel={cancel} />;
  else if (error) content = <ErrorState error={error} onRetry={retry} />;
  else if (response) content = <ResponseBody key={responseKey(response)} response={response} defaultTab={defaultTab} />;
  else
    content = emptyState ?? (
      <EmptyState icon={<IconSend size={20} />} title="No response yet">
        Enter a URL and press <strong>Send</strong> or <kbd className="m2a-kbd">{modKey()}</kbd>
        <kbd className="m2a-kbd">Enter</kbd> to see the response here.
      </EmptyState>
    );

  return (
    <section className="m2a-response" aria-label="Response" aria-busy={loading || undefined}>
      {content}
    </section>
  );
}

// A new response resets view state (tab, search, expanded text).
const responseKey = (r: ApiResponse) => `${r.timing.startTime}-${r.status}-${r.size}`;

function LoadingState({ startedAt, onCancel }: { startedAt?: number; onCancel?: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [start] = useState(() => startedAt ?? Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="m2a-response-state">
      <Spinner label="Sending request" />
      <p className="m2a-response-state-title">Sending request…</p>
      <p className="m2a-muted m2a-tabular">{formatDuration(Math.max(0, now - start))}</p>
      {onCancel && (
        <button type="button" className="m2a-btn" onClick={onCancel}>
          <IconClose /> Cancel
        </button>
      )}
    </div>
  );
}

const ERROR_TITLES: Record<ApiError['kind'], string> = {
  network: 'Could not get a response',
  timeout: 'Request timed out',
  aborted: 'Request cancelled',
  http: 'Request failed',
  parse: 'Response could not be parsed',
  'invalid-request': 'The request is not valid',
};

function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const aborted = error.kind === 'aborted';
  return (
    <div className="m2a-response-state m2a-response-error" role={aborted ? 'status' : 'alert'}>
      <span className={cx('m2a-response-state-icon', !aborted && 'm2a-danger')}>
        {aborted ? <IconInfo size={20} /> : <IconError size={20} />}
      </span>
      <p className="m2a-response-state-title">{ERROR_TITLES[error.kind]}</p>
      <p className="m2a-response-error-message">{error.message}</p>
      {error.hint && <p className="m2a-response-error-hint">{error.hint}</p>}
      {error.kind === 'network' && (
        <ul className="m2a-response-error-checks">
          <li>Check the URL and that the server is running.</li>
          <li>
            For cross-origin requests the server must send <code>Access-Control-Allow-Origin</code> (and allow your headers and method).
          </li>
          <li>
            Pages served over HTTPS cannot call plain <code>http://</code> APIs (mixed content).
          </li>
          <li>If you do not control the server, send the request through your own server-side proxy.</li>
        </ul>
      )}
      {error.request && (
        <p className="m2a-response-error-url m2a-mono" title={error.request.url}>
          {error.request.method} {error.request.url}
        </p>
      )}
      {onRetry && (
        <button type="button" className="m2a-btn" onClick={onRetry}>
          <IconRefresh /> {aborted ? 'Send again' : 'Retry'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// Response body
// ---------------------------------------------------------------------------------------------------

type PreviewKind = 'html' | 'image' | null;

function previewKind(response: ApiResponse): PreviewKind {
  const type = response.contentType?.toLowerCase() ?? '';
  if (response.bodyKind === 'text' && /^(text\/html|application\/xhtml\+xml)/.test(type)) return 'html';
  // SVG is shown through <img>, where its scripts never run.
  if (response.raw && /^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon)/.test(type)) return 'image';
  return null;
}

function ResponseBody({ response, defaultTab }: { response: ApiResponse; defaultTab?: ResponseViewerTab }) {
  const prefix = useId();
  const isJson = response.bodyKind === 'json' && !response.parseError;
  const preview = previewKind(response);
  const headerCount = Object.keys(response.headers).length;

  const available: Record<ResponseViewerTab, boolean> = {
    pretty: true,
    tree: isJson,
    raw: response.bodyKind !== 'binary' && response.bodyKind !== 'empty',
    preview: preview !== null,
    headers: true,
    request: true,
  };
  const fallback: ResponseViewerTab = response.bodyKind === 'binary' && preview ? 'preview' : 'pretty';
  const [tab, setTab] = useState<ResponseViewerTab>(defaultTab && available[defaultTab] ? defaultTab : fallback);

  const prettyText = useMemo(() => {
    if (response.text === null) return '';
    if (isJson && response.text.length <= PRETTY_LIMIT) {
      try {
        return JSON.stringify(response.data, null, 2) ?? response.text;
      } catch {
        return response.text;
      }
    }
    return response.text;
  }, [response, isJson]);

  const download = () => {
    const ext = extensionFor(response.contentType, response.bodyKind);
    const blob = new Blob(response.raw ? [response.raw] : [], response.contentType ? { type: response.contentType } : undefined);
    downloadFile(blob, `response-${response.status}${ext}`);
  };

  const bodyText = tab === 'raw' ? (response.text ?? '') : prettyText;

  return (
    <>
      <StatusBar response={response} onDownload={response.size > 0 ? download : undefined} copyText={response.text ?? undefined} />
      <Tabs
        idPrefix={prefix}
        label="Response views"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'pretty', label: isJson ? 'JSON' : 'Body', disabled: !available.pretty },
          { id: 'tree', label: 'Tree', disabled: !available.tree },
          { id: 'raw', label: 'Raw', disabled: !available.raw },
          { id: 'preview', label: 'Preview', disabled: !available.preview },
          { id: 'headers', label: 'Headers', badge: headerCount || undefined },
          { id: 'request', label: 'Request' },
        ]}
      />
      <div className="m2a-response-panel" {...tabPanelProps(prefix, tab)}>
        {response.parseError && (tab === 'pretty' || tab === 'raw') && (
          <Notice tone="warning" icon={<IconWarning />}>
            The server sent <code>{response.contentType}</code> but the body is not valid JSON ({response.parseError}). Showing the raw
            text.
          </Notice>
        )}
        {(tab === 'pretty' || tab === 'raw') &&
          (response.bodyKind === 'binary' ? (
            <BinaryNotice response={response} onDownload={download} />
          ) : response.bodyKind === 'empty' ? (
            <EmptyState title="Empty response body">
              {response.request.method === 'HEAD'
                ? 'HEAD responses never have a body.'
                : `The server returned ${response.status} with no content.`}
            </EmptyState>
          ) : (
            <TextView text={bodyText} json={tab === 'pretty' && isJson} label={tab === 'raw' ? 'Raw response body' : 'Response body'} />
          ))}
        {tab === 'tree' && <TreeView value={response.data} />}
        {tab === 'preview' && preview && <Preview response={response} kind={preview} />}
        {tab === 'headers' && <HeadersView headers={response.headers} />}
        {tab === 'request' && <RequestView response={response} />}
        {response.bodyKind === 'binary' && tab === 'preview' && <BinaryNotice response={response} onDownload={download} />}
      </div>
    </>
  );
}

function StatusBar({ response, onDownload, copyText }: { response: ApiResponse; onDownload?: () => void; copyText?: string }) {
  const { timing } = response;
  const timingTitle = [
    `Total: ${formatDuration(timing.duration)}`,
    timing.ttfb !== undefined ? `Waiting (TTFB): ${formatDuration(timing.ttfb)}` : null,
    timing.download !== undefined ? `Download: ${formatDuration(timing.download)}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <div className="m2a-statusbar">
      <StatusBadge status={response.status} text={response.statusText} />
      <span className="m2a-meta" title={timingTitle}>
        <IconClock size={12} />
        <span className="m2a-sr-only">Time</span>
        {formatDuration(timing.duration)}
      </span>
      <span className="m2a-meta" title={`${response.size.toLocaleString()} bytes`}>
        <span className="m2a-sr-only">Size</span>
        {formatBytes(response.size)}
      </span>
      {response.redirected && (
        <span className="m2a-meta" title={`Redirected to ${response.url}`}>
          <IconGlobe size={12} /> Redirected
        </span>
      )}
      <span className="m2a-statusbar-actions">
        {copyText !== undefined && <CopyButton text={copyText} label="Copy response body" what="Response body copied" size="sm" />}
        {onDownload && (
          <IconButton label="Download response body" size="sm" onClick={onDownload}>
            <IconDownload />
          </IconButton>
        )}
      </span>
    </div>
  );
}

function BinaryNotice({ response, onDownload }: { response: ApiResponse; onDownload: () => void }) {
  return (
    <div className="m2a-binary">
      <p>
        Binary response · <code>{response.contentType ?? 'unknown type'}</code> · {formatBytes(response.size)}
      </p>
      <button type="button" className="m2a-btn" onClick={onDownload}>
        <IconDownload /> Download
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// Text view with search
// ---------------------------------------------------------------------------------------------------

function TextView({ text, json, label }: { text: string; json: boolean; label: string }) {
  const [showAll, setShowAll] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const preRef = useRef<HTMLPreElement>(null);
  const searchId = useId();

  const truncated = !showAll && text.length > RENDER_LIMIT;
  const shown = truncated ? text.slice(0, RENDER_LIMIT) : text;
  const matches = useMemo(() => findMatches(shown, query), [shown, query]);
  const current = matches.length ? Math.min(active, matches.length - 1) : -1;
  const highlight = json && shown.length <= HIGHLIGHT_LIMIT;

  const nodes = useMemo(
    () => renderTokens(highlight ? tokenizeJson(shown) : [{ type: 'text', text: shown }], matches, current),
    [highlight, shown, matches, current],
  );

  useEffect(() => {
    if (current < 0) return;
    const mark = preRef.current?.querySelector<HTMLElement>(`[data-match="${current}"]`);
    mark?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [current, query]);

  const step = (delta: number) => {
    if (!matches.length) return;
    setActive((current + delta + matches.length) % matches.length);
  };

  return (
    <div className="m2a-textview">
      <div className="m2a-textview-toolbar">
        <div className="m2a-search">
          <IconSearch size={14} />
          <label htmlFor={searchId} className="m2a-sr-only">
            Search response
          </label>
          <input
            id={searchId}
            type="search"
            className="m2a-search-input"
            placeholder="Search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
              } else if (e.key === 'Escape' && query) {
                e.preventDefault();
                e.stopPropagation();
                setQuery('');
              }
            }}
          />
          {query && (
            <span className="m2a-search-count m2a-tabular" aria-live="polite">
              {matches.length ? `${current + 1}/${matches.length}${matches.length >= 5000 ? '+' : ''}` : 'No matches'}
            </span>
          )}
          {query && matches.length > 1 && (
            <>
              <IconButton label="Previous match" size="sm" onClick={() => step(-1)}>
                <IconChevronDown style={{ transform: 'rotate(180deg)' }} />
              </IconButton>
              <IconButton label="Next match" size="sm" onClick={() => step(1)}>
                <IconChevronDown />
              </IconButton>
            </>
          )}
        </div>
        <label className="m2a-check-label m2a-check-label-sm">
          <input type="checkbox" className="m2a-checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
          Wrap lines
        </label>
      </div>
      <pre ref={preRef} className={cx('m2a-code-view', wrap && 'm2a-code-view-wrap')} tabIndex={0} aria-label={label}>
        {nodes}
      </pre>
      {truncated && (
        <div className="m2a-truncated">
          Showing the first {formatBytes(RENDER_LIMIT)} of {formatBytes(text.length)}.{' '}
          <button type="button" className="m2a-link-btn" onClick={() => setShowAll(true)}>
            Show everything
          </button>{' '}
          (may be slow)
        </div>
      )}
    </div>
  );
}

function TreeView({ value }: { value: unknown }) {
  const [expandAll, setExpandAll] = useState<{ open: boolean; version: number } | undefined>(undefined);
  const toggle = (open: boolean) => setExpandAll((s) => ({ open, version: (s?.version ?? 0) + 1 }));
  return (
    <div className="m2a-treeview">
      <div className="m2a-textview-toolbar">
        <button type="button" className="m2a-btn m2a-btn-sm" onClick={() => toggle(true)}>
          <IconChevronDown size={12} /> Expand all
        </button>
        <button type="button" className="m2a-btn m2a-btn-sm" onClick={() => toggle(false)}>
          <IconChevronRight size={12} /> Collapse all
        </button>
      </div>
      <JsonTree value={value} expandAll={expandAll} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// Preview, headers, request details
// ---------------------------------------------------------------------------------------------------

function Preview({ response, kind }: { response: ApiResponse; kind: Exclude<PreviewKind, null> }) {
  const imageRef = useRef<HTMLImageElement>(null);
  // The object URL is created and revoked with the effect, so it is valid exactly while it is shown.
  useEffect(() => {
    const image = imageRef.current;
    if (kind !== 'image' || !response.raw || !image) return;
    const url = URL.createObjectURL(new Blob([response.raw], { type: response.contentType ?? undefined }));
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [kind, response]);
  const html = useMemo(() => (kind === 'html' ? sanitizeHtml(response.text ?? '') : ''), [kind, response.text]);

  if (kind === 'image') {
    return (
      <div className="m2a-preview-image">
        <img ref={imageRef} alt="Response image preview" />
      </div>
    );
  }
  return (
    <div className="m2a-preview">
      <p className="m2a-hint">
        <IconInfo size={12} /> Sanitized preview: scripts, frames, forms and network access are disabled.
      </p>
      {/* An empty sandbox blocks scripts, forms, popups and same-origin access; the CSP inside blocks loads. */}
      <iframe className="m2a-preview-frame" title="HTML preview of the response" sandbox="" srcDoc={html} referrerPolicy="no-referrer" />
    </div>
  );
}

function HeadersView({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return (
      <EmptyState title="No readable headers">
        Browsers only expose CORS-safelisted headers on cross-origin responses unless the server sends{' '}
        <code>Access-Control-Expose-Headers</code>.
      </EmptyState>
    );
  }
  return (
    <div className="m2a-headers-view">
      <table className="m2a-data-table">
        <thead>
          <tr>
            <th scope="col">Header</th>
            <th scope="col">Value</th>
            <th scope="col" className="m2a-kv-actions-col">
              <span className="m2a-sr-only">Copy</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, value]) => (
            <tr key={name}>
              <th scope="row" className="m2a-mono">
                {name}
              </th>
              <td className="m2a-mono m2a-break">{value}</td>
              <td className="m2a-kv-actions-col">
                <CopyButton text={`${name}: ${value}`} label={`Copy header ${name}`} what={`Header ${name} copied`} size="sm" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="m2a-hint">Cross-origin responses only expose headers the server lists in Access-Control-Expose-Headers.</p>
    </div>
  );
}

function describeBody(body: BodySource | null): string {
  if (!body) return 'No body';
  if (body.type === 'text') return body.text;
  if (body.type === 'binary') return `Binary body${body.size !== null ? ` (${formatBytes(body.size)})` : ''}`;
  return body.parts.map((p) => ('fileName' in p ? `${p.name}: <file ${p.fileName}>` : `${p.name}: ${p.value}`)).join('\n');
}

function RequestView({ response }: { response: ApiResponse }) {
  const { request, timing } = response;
  const headers = Object.entries(request.headers);
  return (
    <div className="m2a-request-view">
      <h3 className="m2a-section-title">Resolved request</h3>
      <p className="m2a-mono m2a-break m2a-request-line">
        <strong>{request.method}</strong> {request.url}
      </p>
      {response.redirected && <p className="m2a-hint">Final URL after redirects: {response.url}</p>}
      {request.warnings.length > 0 && (
        <Notice tone="warning" icon={<IconWarning />}>
          <ul className="m2a-error-list">
            {request.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Notice>
      )}
      <h3 className="m2a-section-title">Request headers</h3>
      {headers.length ? (
        <table className="m2a-data-table">
          <tbody>
            {headers.map(([name, value]) => (
              <tr key={name}>
                <th scope="row" className="m2a-mono">
                  {name}
                </th>
                <td className="m2a-mono m2a-break">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="m2a-muted">No headers set by the client (the browser adds its own).</p>
      )}
      {request.bodySource && (
        <>
          <h3 className="m2a-section-title">Request body</h3>
          <pre className="m2a-code-view m2a-code-view-wrap m2a-code-view-sm">{describeBody(request.bodySource)}</pre>
        </>
      )}
      <h3 className="m2a-section-title">Timing</h3>
      <TimingBars timing={timing} />
      <p className="m2a-hint">Secrets are masked. Timing is measured in the browser and includes middleware.</p>
    </div>
  );
}

function TimingBars({ timing }: { timing: ApiResponse['timing'] }) {
  const total = Math.max(timing.duration, 1);
  const rows: Array<[string, number, number]> = [];
  if (timing.ttfb !== undefined) rows.push(['Waiting (TTFB)', 0, timing.ttfb]);
  if (timing.download !== undefined) rows.push(['Content download', timing.ttfb ?? 0, timing.download]);
  rows.push(['Total', 0, timing.duration]);
  return (
    <dl className="m2a-timing">
      {rows.map(([label, start, length]) => (
        <div key={label} className="m2a-timing-row">
          <dt>{label}</dt>
          <dd>
            <span className="m2a-timing-track" aria-hidden="true">
              <span
                className="m2a-timing-bar"
                style={{ left: `${(start / total) * 100}%`, width: `${Math.max((length / total) * 100, 0.5)}%` }}
              />
            </span>
            <span className="m2a-tabular">{formatDuration(length)}</span>
          </dd>
        </div>
      ))}
      <div className="m2a-timing-row">
        <dt>Started</dt>
        <dd className="m2a-tabular">{new Date(timing.startTime).toLocaleTimeString()}</dd>
      </div>
    </dl>
  );
}

function extensionFor(contentType: string | null, kind: ApiResponse['bodyKind']): string {
  const type = contentType?.split(';')[0].trim().toLowerCase() ?? '';
  const known: Record<string, string> = {
    'application/json': '.json',
    'application/xml': '.xml',
    'text/xml': '.xml',
    'text/html': '.html',
    'text/csv': '.csv',
    'text/plain': '.txt',
    'application/pdf': '.pdf',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'application/zip': '.zip',
  };
  if (known[type]) return known[type];
  if (/\+json$/.test(type) || kind === 'json') return '.json';
  if (kind === 'text') return '.txt';
  return '.bin';
}
