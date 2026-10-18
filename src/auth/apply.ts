import type { AuthConfig, AuthProfile, AuthType } from '../core/types';
import { base64Encode } from '../utils/encoding';

export interface AuthResult {
  headers: Array<[string, string]>;
  query: Array<[string, string]>;
  /** Credential values to redact from snapshots. */
  secrets: string[];
  warnings: string[];
}

export interface ApplyAuthOptions {
  /** Interpolates `{{variables}}` in credential fields. */
  resolve?: (value: string) => string;
  profiles?: readonly AuthProfile[];
}

export const AUTH_TYPE_LABELS: Record<AuthType, string> = {
  none: 'No auth',
  bearer: 'Bearer token',
  basic: 'Basic auth',
  apiKey: 'API key',
  oauth2: 'OAuth 2.0',
  custom: 'Custom headers',
  profile: 'Auth profile',
};

/** Turns an {@link AuthConfig} into headers / query parameters. Pure: never touches storage or the network. */
export function applyAuth(auth: AuthConfig | undefined, options: ApplyAuthOptions = {}): AuthResult {
  const resolve = options.resolve ?? ((v: string) => v);
  const result: AuthResult = { headers: [], query: [], secrets: [], warnings: [] };
  if (!auth) return result;

  let config: AuthProfile['auth'];
  if (auth.type === 'profile') {
    const profile = options.profiles?.find((p) => p.id === auth.profileId);
    if (!profile) {
      result.warnings.push('The selected auth profile no longer exists; the request is sent without authentication.');
      return result;
    }
    config = profile.auth;
  } else {
    config = auth;
  }

  switch (config.type) {
    case 'none':
      break;
    case 'bearer': {
      const token = resolve(config.token).trim();
      if (!token) {
        result.warnings.push('Bearer token is empty.');
        break;
      }
      result.headers.push(['Authorization', `${config.prefix?.trim() || 'Bearer'} ${token}`]);
      result.secrets.push(token);
      break;
    }
    case 'oauth2': {
      const token = resolve(config.accessToken).trim();
      if (!token) {
        result.warnings.push('OAuth 2.0 access token is empty. Request a token or paste one first.');
        break;
      }
      result.headers.push(['Authorization', `${config.headerPrefix?.trim() || 'Bearer'} ${token}`]);
      result.secrets.push(token);
      break;
    }
    case 'basic': {
      const username = resolve(config.username);
      const password = resolve(config.password);
      if (!username && !password) {
        result.warnings.push('Basic auth username and password are empty.');
        break;
      }
      const encoded = base64Encode(`${username}:${password}`);
      result.headers.push(['Authorization', `Basic ${encoded}`]);
      result.secrets.push(encoded);
      if (password) result.secrets.push(password);
      break;
    }
    case 'apiKey': {
      const key = resolve(config.key).trim();
      const value = resolve(config.value);
      if (!key) {
        result.warnings.push('API key name is empty.');
        break;
      }
      if (config.in === 'query') {
        result.query.push([key, value]);
        result.warnings.push('The API key is sent in the URL, where it can leak into logs, history and referrers. Prefer a header.');
      } else {
        result.headers.push([key, value]);
      }
      if (value) result.secrets.push(value);
      break;
    }
    case 'custom': {
      for (const entry of config.headers) {
        if (!entry.enabled || !entry.key.trim()) continue;
        const value = resolve(entry.value);
        result.headers.push([resolve(entry.key).trim(), value]);
        if (value) result.secrets.push(value);
      }
      break;
    }
  }
  return result;
}

export function defaultAuthConfig(type: AuthType): AuthConfig {
  switch (type) {
    case 'none':
      return { type: 'none' };
    case 'bearer':
      return { type: 'bearer', token: '' };
    case 'basic':
      return { type: 'basic', username: '', password: '' };
    case 'apiKey':
      return { type: 'apiKey', key: 'X-API-Key', value: '', in: 'header' };
    case 'oauth2':
      return { type: 'oauth2', accessToken: '' };
    case 'custom':
      return { type: 'custom', headers: [] };
    case 'profile':
      return { type: 'profile', profileId: '' };
  }
}
