'use client';

import { useState } from 'react';
import type { AuthConfig, AuthProfile, AuthType, OAuth2Auth } from '../../core/types';
import { AUTH_TYPE_LABELS, defaultAuthConfig } from '../../auth/apply';
import type { VariableResolver } from '../../env/variables';
import { createKeyValue } from '../../core/request';
import { useOptionalUi } from '../Root';
import { IconInfo, IconLock, IconWarning } from '../icons';
import { KeyValueEditor } from '../primitives/KeyValueEditor';
import { Notice, Spinner } from '../primitives/misc';
import { SelectField, TemplateField } from './fields';
import type { RequestModel } from './model';

type ProfileAuthConfig = AuthProfile['auth'];

/** Editing form for one (non-profile) auth config. Shared by requests and auth profiles. */
export function AuthFields({
  auth,
  onChange,
  resolver,
  onRequestToken,
  tokenLabel,
}: {
  auth: ProfileAuthConfig;
  onChange: (auth: ProfileAuthConfig) => void;
  resolver?: VariableResolver;
  onRequestToken?: () => Promise<void>;
  tokenLabel?: string;
}) {
  const [fetching, setFetching] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  switch (auth.type) {
    case 'none':
      return <p className="m2a-muted">This request does not send credentials.</p>;
    case 'bearer':
      return (
        <div className="m2a-form-grid">
          <TemplateField
            label="Token"
            value={auth.token}
            onChange={(token) => onChange({ ...auth, token })}
            resolver={resolver}
            placeholder="{{apiToken}}"
            secret
          />
          <TemplateField
            label="Prefix"
            value={auth.prefix ?? ''}
            onChange={(prefix) => onChange({ ...auth, prefix: prefix || undefined })}
            placeholder="Bearer"
          />
        </div>
      );
    case 'basic':
      return (
        <div className="m2a-form-grid">
          <TemplateField
            label="Username"
            value={auth.username}
            onChange={(username) => onChange({ ...auth, username })}
            resolver={resolver}
          />
          <TemplateField
            label="Password"
            value={auth.password}
            onChange={(password) => onChange({ ...auth, password })}
            resolver={resolver}
            placeholder="{{password}}"
            secret
          />
        </div>
      );
    case 'apiKey':
      return (
        <div className="m2a-form-grid">
          <TemplateField
            label="Key"
            value={auth.key}
            onChange={(key) => onChange({ ...auth, key })}
            resolver={resolver}
            placeholder="X-API-Key"
          />
          <TemplateField
            label="Value"
            value={auth.value}
            onChange={(value) => onChange({ ...auth, value })}
            resolver={resolver}
            placeholder="{{apiKey}}"
            secret
          />
          <SelectField
            label="Add to"
            value={auth.in}
            onChange={(where) => onChange({ ...auth, in: where })}
            options={[
              { value: 'header', label: 'Header' },
              { value: 'query', label: 'Query parameter' },
            ]}
          />
          {auth.in === 'query' && (
            <div className="m2a-span-all">
              <Notice tone="warning" icon={<IconWarning />}>
                Keys in the URL end up in server logs, browser history and Referer headers. Prefer a header when the API supports it.
              </Notice>
            </div>
          )}
        </div>
      );
    case 'oauth2':
      return (
        <div className="m2a-form-grid">
          <TemplateField
            label="Access token"
            value={auth.accessToken}
            onChange={(accessToken) => onChange({ ...auth, accessToken })}
            resolver={resolver}
            placeholder="{{accessToken}}"
            secret
          />
          <TemplateField
            label="Header prefix"
            value={auth.headerPrefix ?? ''}
            onChange={(headerPrefix) => onChange({ ...auth, headerPrefix: headerPrefix || undefined })}
            placeholder="Bearer"
          />
          {onRequestToken && (
            <div className="m2a-span-all m2a-row">
              <button
                type="button"
                className="m2a-btn"
                disabled={fetching}
                onClick={async () => {
                  setFetching(true);
                  setTokenError(null);
                  try {
                    await onRequestToken();
                  } catch (error) {
                    setTokenError(error instanceof Error ? error.message : String(error));
                  } finally {
                    setFetching(false);
                  }
                }}
              >
                {fetching ? <Spinner /> : <IconLock />} {tokenLabel ?? 'Get access token'}
              </button>
              {tokenError && (
                <span className="m2a-field-error" role="alert">
                  {tokenError}
                </span>
              )}
            </div>
          )}
          <details className="m2a-span-all m2a-details">
            <summary>Provider details (passed to your token provider)</summary>
            <div className="m2a-form-grid">
              {(['authorizationUrl', 'tokenUrl', 'clientId', 'scope'] as const).map((key) => (
                <TemplateField
                  key={key}
                  label={{ authorizationUrl: 'Authorization URL', tokenUrl: 'Token URL', clientId: 'Client ID', scope: 'Scope' }[key]}
                  value={(auth as OAuth2Auth)[key] ?? ''}
                  onChange={(v) => onChange({ ...auth, [key]: v || undefined })}
                  resolver={resolver}
                />
              ))}
            </div>
          </details>
          <div className="m2a-span-all">
            <Notice icon={<IconInfo />}>
              m2api-client does not run OAuth flows itself. Get tokens with your identity provider&apos;s SDK (Authorization Code + PKCE) or
              a backend, and supply them through the <code>oauth2</code> integration. Never put a client secret in frontend code.
            </Notice>
          </div>
        </div>
      );
    case 'custom':
      return (
        <KeyValueEditor
          label="Authentication headers"
          itemLabel="Auth header"
          keyPlaceholder="Header"
          entries={auth.headers}
          onChange={(headers) => onChange({ ...auth, headers })}
          resolver={resolver}
          createEntry={({ id, key, value }) => ({ ...createKeyValue(key, value), id })}
          bulkEditable={false}
        />
      );
  }
}

const TYPES: AuthType[] = ['none', 'bearer', 'basic', 'apiKey', 'oauth2', 'custom', 'profile'];

export function AuthPanel({ model }: { model: RequestModel }) {
  const { request, update, resolver, authProfiles, workspace, tab } = model;
  const ui = useOptionalUi();
  const auth = request.auth;
  const setAuth = (next: AuthConfig) => update({ auth: next });
  const profile = auth.type === 'profile' ? authProfiles.find((p) => p.id === auth.profileId) : undefined;
  const canUseProfiles = Boolean(workspace) || authProfiles.length > 0;

  const onTypeChange = (type: AuthType) => {
    if (type === 'profile') setAuth({ type: 'profile', profileId: authProfiles[0]?.id ?? '' });
    else setAuth(defaultAuthConfig(type));
  };

  const saveAsProfile = async () => {
    if (!workspace || auth.type === 'profile' || auth.type === 'none') return;
    const name = await ui?.prompt({
      title: 'Save as auth profile',
      label: 'Profile name',
      initialValue: AUTH_TYPE_LABELS[auth.type],
      confirmLabel: 'Create profile',
    });
    if (!name) return;
    const id = workspace.actions.addAuthProfile(name, auth);
    setAuth({ type: 'profile', profileId: id });
    ui?.announce(`Auth profile "${name}" created`);
  };

  const onRequestToken = workspace?.hasOAuth2Integration && tab ? () => workspace.actions.requestOAuth2Token(tab.id) : undefined;

  return (
    <div className="m2a-panel-pad m2a-stack">
      <div className="m2a-row m2a-row-wrap">
        <SelectField
          label="Type"
          value={auth.type}
          onChange={onTypeChange}
          options={TYPES.filter((t) => t !== 'profile' || canUseProfiles).map((t) => ({ value: t, label: AUTH_TYPE_LABELS[t] }))}
        />
        {workspace && auth.type !== 'profile' && auth.type !== 'none' && (
          <button type="button" className="m2a-link-btn m2a-align-end" onClick={saveAsProfile}>
            Save as reusable profile
          </button>
        )}
      </div>

      {auth.type === 'profile' ? (
        authProfiles.length === 0 ? (
          <p className="m2a-muted">
            No auth profiles yet. Configure credentials with another type, then choose “Save as reusable profile”.
          </p>
        ) : (
          <>
            <SelectField
              label="Profile"
              value={auth.profileId}
              onChange={(profileId) => setAuth({ type: 'profile', profileId })}
              options={authProfiles.map((p) => ({ value: p.id, label: p.name }))}
            />
            {profile ? (
              <div className="m2a-subtle-box">
                <p className="m2a-hint">
                  Editing <strong>{profile.name}</strong> ({AUTH_TYPE_LABELS[profile.auth.type]}). Changes apply to every request that uses
                  this profile.
                </p>
                {workspace && (
                  <SelectField
                    label="Profile type"
                    value={profile.auth.type}
                    onChange={(t) => workspace.actions.updateAuthProfile(profile.id, { auth: defaultAuthConfig(t) as ProfileAuthConfig })}
                    options={TYPES.filter((t) => t !== 'profile').map((t) => ({ value: t, label: AUTH_TYPE_LABELS[t] }))}
                  />
                )}
                <AuthFields
                  auth={profile.auth}
                  onChange={(next) => workspace?.actions.updateAuthProfile(profile.id, { auth: next })}
                  resolver={resolver}
                />
                {workspace && (
                  <button
                    type="button"
                    className="m2a-link-btn m2a-link-danger"
                    onClick={async () => {
                      const ok = await ui?.confirm({
                        title: `Delete profile “${profile.name}”?`,
                        message: 'Requests using it will be sent without authentication.',
                        confirmLabel: 'Delete',
                        danger: true,
                      });
                      if (ok) workspace.actions.removeAuthProfile(profile.id);
                    }}
                  >
                    Delete profile
                  </button>
                )}
              </div>
            ) : (
              <Notice tone="warning" icon={<IconWarning />}>
                The selected profile no longer exists. Choose another one.
              </Notice>
            )}
          </>
        )
      ) : (
        <AuthFields
          auth={auth}
          onChange={setAuth}
          resolver={resolver}
          onRequestToken={onRequestToken}
          tokenLabel={workspace?.oauth2Label}
        />
      )}

      {auth.type !== 'none' && (
        <p className="m2a-hint m2a-hint-row">
          <IconLock size={12} /> Reference secrets as <code>{'{{variables}}'}</code> marked secret in Environments. Credentials are masked
          in history and snapshots, and literal values are never persisted.
        </p>
      )}
    </div>
  );
}
