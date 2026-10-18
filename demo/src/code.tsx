import type { ReactNode } from 'react';

/** The snippets shown on the page. Each mirrors a README example. */
export const FILES = [
  {
    path: 'src/App.tsx',
    label: 'drop in the workspace',
    code: `import { ApiClient } from 'm2api-client';
import 'm2api-client/styles.css';

export default function App() {
  return (
    <div style={{ height: '100vh' }}>
      <ApiClient baseUrl="https://api.example.com" theme="light" initialMethod="GET" />
    </div>
  );
}`,
  },
  {
    path: 'app/playground/page.tsx',
    label: 'next.js app router',
    code: `// app/playground/page.tsx
import { ApiClient } from 'm2api-client';
import 'm2api-client/styles.css';

export default function Page() {
  return (
    <main style={{ height: '100dvh' }}>
      <ApiClient baseUrl="https://api.example.com" theme="system" />
    </main>
  );
}`,
  },
  {
    path: 'src/user-profile.tsx',
    label: 'data fetching hook',
    code: `import { useApiRequest } from 'm2api-client';

function UserProfile() {
  const { execute, data, loading, error } = useApiRequest<User>();

  async function loadUser() {
    await execute({
      url: 'https://api.example.com/users/1',
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  }

  return (
    <button onClick={loadUser} disabled={loading}>
      {loading ? 'Loading...' : 'Load user'}
    </button>
  );
}`,
  },
  {
    path: 'src/api.ts',
    label: 'engine, no react',
    code: `import { createApiClient, isApiError } from 'm2api-client';

const api = createApiClient({
  baseUrl: 'https://api.example.com',
  headers: { Accept: 'application/json' },
  auth: { type: 'bearer', token: '{{apiToken}}' },
  timeout: 10_000,
  middleware: [logging],
});

const { data } = await api.get<User[]>('/users', { params: { page: 2 } });

try {
  await api.delete('/users/1');
} catch (error) {
  if (isApiError(error)) {
    error.kind;     // 'http' | 'network' | 'timeout' | 'aborted' | 'parse' | 'invalid-request'
    error.hint;     // a human-readable suggestion
  }
}`,
  },
] as const;

const TOKENS =
  /(?<comment>\/\/[^\n]*)|(?<string>'[^'\n]*'|"[^"\n]*"|`[^`]*`)|(?<tag><\/?[A-Za-z][\w.]*)|(?<keyword>\b(?:import|from|export|default|function|const|async|await|return|try|catch|if|interface|type|new)\b)|(?<attr>\b[a-zA-Z]+(?==))|(?<number>\b\d[\d_]*\b)/g;

/** A tiny, deterministic TSX highlighter (same output on the server and in the browser). */
export function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of code.matchAll(TOKENS)) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const kind = Object.entries(m.groups ?? {}).find(([, v]) => v !== undefined)?.[0] ?? 'plain';
    if (kind === 'tag') {
      const slash = m[0].startsWith('</') ? 2 : 1;
      out.push(
        m[0].slice(0, slash),
        <span key={i++} className="tok-tag">
          {m[0].slice(slash)}
        </span>,
      );
    } else
      out.push(
        <span key={i++} className={`tok-${kind}`}>
          {m[0]}
        </span>,
      );
    last = m.index + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}
