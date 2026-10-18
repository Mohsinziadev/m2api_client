import { useState } from 'react';
import { ApiClient, createApiClient, createWorkspace, ThemeProvider } from 'm2api-client';
import { UserProfile } from '../../examples/user-profile';
import { ControlledEditor } from '../../examples/controlled';
import { ComposedLayout } from '../../examples/composed-layout';
import { setTheme, trackWorkspace, useHydrated, type Theme } from './client';
import { demoCollections, demoEnvironments, demoTransport, MOCK_ORIGIN } from './seed';

function Placeholder({ label, height }: { label: string; height?: number }) {
  return (
    <div className="live-placeholder" style={height ? { height } : undefined} aria-hidden="true">
      <span className="mono">{label}</span>
    </div>
  );
}

function Workspace({ theme }: { theme: Theme }) {
  // One store for the lifetime of the page, persisted to localStorage (secrets excluded by default).
  const [workspace] = useState(() =>
    trackWorkspace(
      createWorkspace({
        client: createApiClient({ transport: demoTransport }),
        collections: demoCollections(),
        environments: demoEnvironments(),
        initialRequest: { name: '', method: 'GET', url: `${MOCK_ORIGIN}/users` },
        persistence: { key: 'm2api-demo:v1' },
      }),
    ),
  );
  return <ApiClient workspace={workspace} theme={theme} onThemeChange={setTheme} height="100%" />;
}

/** The complete workspace, seeded with public demo APIs plus an offline mock API. */
export function LiveWorkspace({ theme }: { theme: Theme }) {
  return useHydrated() ? <Workspace theme={theme} /> : <Placeholder label="loading workspace…" />;
}

export type ExampleId = 'composed' | 'controlled' | 'hook';

/** The copy-ready files in examples/, running live. */
export function LiveExample({ id, theme }: { id: ExampleId; theme: Theme }) {
  const hydrated = useHydrated();
  if (!hydrated) return <Placeholder label="loading example…" height={id === 'composed' ? 640 : 260} />;
  if (id === 'composed') return <ComposedLayout />;
  if (id === 'controlled')
    return (
      <ThemeProvider theme={theme} className="live-plain">
        <ControlledEditor />
      </ThemeProvider>
    );
  return (
    <div className="live-hook">
      <UserProfile />
    </div>
  );
}
