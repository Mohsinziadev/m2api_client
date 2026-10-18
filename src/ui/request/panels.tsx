'use client';

import { useId } from 'react';
import type { KeyValueEntry } from '../../core/types';
import { createKeyValue, DEFAULT_HEADER_PRESETS, type HeaderPreset } from '../../core/request';
import { syncUrlFromParams } from '../../core/url';
import { redactHeaderValue } from '../../core/redact';
import { containsLiteralSecret } from '../../persistence/sanitize';
import { isForbiddenHeader, isSensitiveHeader } from '../../utils/headers';
import { IconChevronDown } from '../icons';
import { KeyValueEditor } from '../primitives/KeyValueEditor';
import { Menu } from '../primitives/Menu';
import { Field } from './fields';
import { COMMON_HEADERS, type RequestModel } from './model';

const newEntry = ({ id, key, value }: { id: string; key: string; value: string }): KeyValueEntry => ({ ...createKeyValue(key, value), id });

export function ParamsPanel({ model }: { model: RequestModel }) {
  const { request, update, resolver } = model;
  return (
    <div className="m2a-panel-pad-x">
      <KeyValueEditor
        label="Query parameters"
        itemLabel="Parameter"
        entries={request.params}
        onChange={(params) => update((r) => ({ ...r, params, url: syncUrlFromParams(r.url, params) }))}
        resolver={resolver}
        showDescription
        createEntry={newEntry}
      />
    </div>
  );
}

export function HeadersPanel({ model, presets = [] }: { model: RequestModel; presets?: HeaderPreset[] }) {
  const { request, update, resolver, prepared } = model;
  const explicit = new Set(request.headers.filter((h) => h.enabled).map((h) => h.key.trim().toLowerCase()));
  const automatic = prepared ? Object.entries(prepared.headers).filter(([name]) => !explicit.has(name.toLowerCase())) : [];

  const applyPreset = (preset: HeaderPreset) =>
    update((r) => {
      const headers = [...r.headers];
      for (const [key, value] of Object.entries(preset.headers)) {
        const index = headers.findIndex((h) => h.key.toLowerCase() === key.toLowerCase());
        if (index === -1) headers.push(createKeyValue(key, value));
        else headers[index] = { ...headers[index], value, enabled: true };
      }
      return { ...r, headers };
    });

  return (
    <div className="m2a-panel-pad-x">
      <KeyValueEditor
        label="Headers"
        itemLabel="Header"
        keyPlaceholder="Header"
        entries={request.headers}
        onChange={(headers) => update({ headers })}
        resolver={resolver}
        showDescription
        keySuggestions={COMMON_HEADERS}
        createEntry={newEntry}
        warning={(h) => {
          if (isForbiddenHeader(h.key)) return 'Browsers do not allow scripts to set this header; it will be dropped.';
          if (h.enabled && isSensitiveHeader(h.key) && containsLiteralSecret(h.value))
            return 'Literal credential: it is masked in history and never persisted. Prefer a secret variable such as {{apiToken}}.';
          return undefined;
        }}
        toolbar={
          <Menu
            label="Add header preset"
            triggerClassName="m2a-link-btn"
            trigger={
              <>
                Presets <IconChevronDown size={12} />
              </>
            }
            items={[...DEFAULT_HEADER_PRESETS, ...presets].map((p) => ({
              id: p.id,
              label: p.name,
              hint: Object.keys(p.headers).join(', '),
              onSelect: () => applyPreset(p),
            }))}
          />
        }
      />
      {automatic.length > 0 && (
        <div className="m2a-auto-headers">
          <p className="m2a-kv-title">Added automatically</p>
          <ul>
            {automatic.map(([name, value]) => (
              <li key={name}>
                <span className="m2a-auto-header-name">{name}</span>
                <span className="m2a-auto-header-value">{redactHeaderValue(name, value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function SettingsPanel({ model }: { model: RequestModel }) {
  const { request, update } = model;
  const settings = request.settings;
  const timeoutId = useId();
  const redirectId = useId();
  const credentialsId = useId();
  return (
    <div className="m2a-panel-pad m2a-settings">
      <Field label="Timeout (ms)" htmlFor={timeoutId} hint="0 disables the timeout. Default 30 000 ms.">
        <input
          id={timeoutId}
          className="m2a-input m2a-input-sm"
          type="number"
          min={0}
          step={1000}
          inputMode="numeric"
          placeholder="30000"
          value={settings.timeout ?? ''}
          onChange={(e) =>
            update({ settings: { ...settings, timeout: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) } })
          }
        />
      </Field>
      <Field
        label="Redirects"
        htmlFor={redirectId}
        hint="With “Don’t follow”, browsers return an opaque response (status 0) and hide the Location header."
      >
        <select
          id={redirectId}
          className="m2a-select"
          value={settings.redirect ?? 'follow'}
          onChange={(e) =>
            update({
              settings: { ...settings, redirect: e.target.value === 'follow' ? undefined : (e.target.value as 'manual' | 'error') },
            })
          }
        >
          <option value="follow">Follow automatically</option>
          <option value="manual">Don’t follow</option>
          <option value="error">Fail on redirect</option>
        </select>
      </Field>
      <Field
        label="Credentials (cookies)"
        htmlFor={credentialsId}
        hint="“Include” sends cookies cross-origin; the server must reply with Access-Control-Allow-Credentials and an explicit origin."
      >
        <select
          id={credentialsId}
          className="m2a-select"
          value={settings.credentials ?? 'same-origin'}
          onChange={(e) =>
            update({
              settings: { ...settings, credentials: e.target.value === 'same-origin' ? undefined : (e.target.value as 'omit' | 'include') },
            })
          }
        >
          <option value="same-origin">Same origin only (default)</option>
          <option value="include">Include</option>
          <option value="omit">Omit</option>
        </select>
      </Field>
    </div>
  );
}
