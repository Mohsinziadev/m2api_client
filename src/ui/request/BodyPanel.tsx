'use client';

import { useId, useState } from 'react';
import type { KeyValueEntry, MultipartField, RequestBodyDefinition, RequestBodyType } from '../../core/types';
import { createKeyValue } from '../../core/request';
import { formatBytes } from '../../utils/format';
import { checkJson, formatJson } from '../highlight';
import { IconCheck, IconWand, IconWarning } from '../icons';
import { CodeEditor } from '../primitives/CodeEditor';
import { KeyValueEditor } from '../primitives/KeyValueEditor';
import { Notice, cx, modKey } from '../primitives/misc';
import { useOptionalUi } from '../Root';
import type { RequestModel } from './model';

const BODY_TYPES: Array<{ value: RequestBodyType; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'json', label: 'JSON' },
  { value: 'text', label: 'Text' },
  { value: 'urlencoded', label: 'Form URL-encoded' },
  { value: 'multipart', label: 'Multipart form' },
];

const TEXT_TYPES = [
  'text/plain',
  'application/xml',
  'text/xml',
  'text/html',
  'text/csv',
  'application/javascript',
  'application/graphql',
  'application/x-ndjson',
];

function convert(body: RequestBodyDefinition, type: RequestBodyType): RequestBodyDefinition {
  const text = body.type === 'json' || body.type === 'text' ? body.content : '';
  const fields: KeyValueEntry[] = body.type === 'urlencoded' || body.type === 'multipart' ? body.fields : [];
  switch (type) {
    case 'none':
      return { type: 'none' };
    case 'json':
      return { type: 'json', content: text };
    case 'text':
      return { type: 'text', content: text };
    case 'urlencoded':
      return {
        type: 'urlencoded',
        fields: fields.map(({ id, key, value, enabled, description }) => ({ id, key, value, enabled, description })),
      };
    case 'multipart':
      return { type: 'multipart', fields: fields.map((f) => ({ kind: 'text', ...f }) as MultipartField) };
  }
}

export function BodyPanel({ model }: { model: RequestModel }) {
  const { request, update, resolver } = model;
  const body = request.body;
  const ui = useOptionalUi();
  const groupId = useId();
  const contentTypeId = useId();
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const setBody = (next: RequestBodyDefinition) => update({ body: next });
  const noBodyMethod = (request.method === 'GET' || request.method === 'HEAD') && body.type !== 'none';

  const format = () => {
    if (body.type !== 'json') return;
    const formatted = formatJson(body.content);
    if (formatted === null) ui?.announce('Fix the JSON errors before formatting');
    else setBody({ type: 'json', content: formatted });
  };

  const json = body.type === 'json' ? checkJson(body.content) : null;

  return (
    <div className="m2a-body-panel">
      <div className="m2a-body-toolbar">
        <div role="radiogroup" aria-label="Body type" className="m2a-segmented">
          {BODY_TYPES.map((t) => (
            <label key={t.value} className={cx('m2a-segment', body.type === t.value && 'm2a-segment-active')}>
              <input
                type="radio"
                name={groupId}
                value={t.value}
                checked={body.type === t.value}
                onChange={() => setBody(convert(body, t.value))}
              />
              {t.label}
            </label>
          ))}
        </div>
        {body.type === 'json' && (
          <button type="button" className="m2a-btn m2a-btn-sm" onClick={format} title={`Format JSON (${modKey()}Shift+F)`}>
            <IconWand /> Format
          </button>
        )}
      </div>

      {noBodyMethod && (
        <div className="m2a-panel-pad-x">
          <Notice tone="warning" icon={<IconWarning />}>
            Browsers cannot send a body with {request.method} requests; it will be dropped. Switch the method to POST, PUT or PATCH.
          </Notice>
        </div>
      )}

      {body.type === 'none' && <p className="m2a-muted m2a-panel-pad">This request has no body.</p>}

      {body.type === 'json' && (
        <div
          className="m2a-panel-pad-x m2a-grow"
          onKeyDownCapture={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
              e.preventDefault();
              format();
            }
          }}
        >
          <CodeEditor
            label="JSON body"
            language="json"
            value={body.content}
            onChange={(content) => setBody({ type: 'json', content })}
            placeholder={'{\n  "name": "{{userName}}"\n}'}
            minLines={10}
            onCursor={(l, c) => setCursor([l, c])}
            footer={
              <>
                {json?.valid ? (
                  <span className="m2a-code-status" data-tone="success">
                    <IconCheck size={12} /> {body.content.trim() ? 'Valid JSON' : 'Empty'}
                  </span>
                ) : (
                  <span className="m2a-code-status" data-tone="danger" role="status">
                    <IconWarning size={12} /> {json?.line ? `Line ${json.line}, col ${json.column}: ` : ''}
                    {json?.error}
                  </span>
                )}
                <span className="m2a-code-hint">
                  {cursor ? `Ln ${cursor[0]}, Col ${cursor[1]} · ` : ''}Tab indents · Esc then Tab leaves the editor
                </span>
              </>
            }
          />
        </div>
      )}

      {body.type === 'text' && (
        <div className="m2a-panel-pad-x m2a-grow m2a-stack">
          <div className="m2a-row">
            <label className="m2a-label m2a-label-inline" htmlFor={contentTypeId}>
              Content-Type
            </label>
            <input
              id={contentTypeId}
              className="m2a-input m2a-input-sm"
              list={`${contentTypeId}-list`}
              value={body.contentType ?? ''}
              placeholder="text/plain;charset=UTF-8"
              onChange={(e) => setBody({ ...body, contentType: e.target.value || undefined })}
            />
            <datalist id={`${contentTypeId}-list`}>
              {TEXT_TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
          <CodeEditor label="Text body" value={body.content} onChange={(content) => setBody({ ...body, content })} minLines={10} />
        </div>
      )}

      {body.type === 'urlencoded' && (
        <div className="m2a-panel-pad-x">
          <KeyValueEditor
            label="Form fields"
            itemLabel="Field"
            entries={body.fields}
            onChange={(fields) => setBody({ type: 'urlencoded', fields })}
            resolver={resolver}
            showDescription
            createEntry={({ id, key, value }) => ({ ...createKeyValue(key, value), id })}
          />
        </div>
      )}

      {body.type === 'multipart' && (
        <div className="m2a-panel-pad-x">
          <KeyValueEditor<MultipartField>
            label="Multipart fields"
            itemLabel="Field"
            entries={body.fields}
            onChange={(fields) => setBody({ type: 'multipart', fields })}
            resolver={resolver}
            bulkEditable={false}
            createEntry={({ id, key, value }) => ({ ...createKeyValue(key, value), id, kind: 'text' })}
            renderExtra={(field, set) => (
              <select
                className="m2a-select m2a-select-xs"
                aria-label={`Type of field ${field.key || ''}`}
                value={field.kind}
                onChange={(e) => set({ kind: e.target.value as 'text' | 'file' })}
              >
                <option value="text">Text</option>
                <option value="file">File</option>
              </select>
            )}
            renderValue={(field, set) =>
              field.kind === 'file' ? (
                <label className="m2a-file">
                  <input
                    type="file"
                    aria-label={`File for field ${field.key || ''}`}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      set({ file: file ?? null, fileName: file?.name });
                    }}
                  />
                  <span className="m2a-file-name">
                    {field.file
                      ? `${field.fileName ?? 'file'} · ${formatBytes(field.file.size)}`
                      : field.fileName
                        ? `${field.fileName} (select again)`
                        : 'Choose file…'}
                  </span>
                </label>
              ) : undefined
            }
          />
          <p className="m2a-hint m2a-panel-pad-y">
            The browser sets the multipart boundary automatically. Files stay in memory and are never persisted.
          </p>
        </div>
      )}
    </div>
  );
}
