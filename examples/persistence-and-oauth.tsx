import { ApiClient, createWebStorage, type OAuth2Auth } from 'm2api-client';
import 'm2api-client/styles.css';

// Your identity provider's SDK runs the OAuth flow (PKCE in a popup, or a backend). m2api-client never
// handles client secrets; it only needs the resulting access token.
async function getAccessToken(auth: OAuth2Auth): Promise<string> {
  const response = await fetch('/api/dev-token', { method: 'POST', body: JSON.stringify({ scope: auth.scope }) });
  const { access_token } = (await response.json()) as { access_token: string };
  return access_token;
}

export function PersistentWorkspace() {
  return (
    <div style={{ height: '100vh' }}>
      <ApiClient
        theme="system"
        // Opt in to persistence. Secrets and literal credentials are not stored unless includeSecrets is set.
        persistence={{
          storage: createWebStorage('local'),
          key: 'my-app:api-workspace',
          include: ['collections', 'environments', 'history'],
        }}
        oauth2={{ getAccessToken, label: 'Sign in with Acme' }}
        environments={[
          { id: 'dev', name: 'Development', variables: [{ key: 'baseUrl', value: 'http://localhost:3000' }] },
          {
            id: 'prod',
            name: 'Production',
            variables: [
              { key: 'baseUrl', value: 'https://api.example.com' },
              { key: 'apiToken', value: '', secret: true },
            ],
          },
        ]}
        tokens={{ accent: '#7c3aed', radius: '4px' }}
      />
    </div>
  );
}
