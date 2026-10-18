import { useSyncExternalStore } from 'react';
import type { Workspace } from 'm2api-client';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'm2api-site:theme';
const noSubscribe = () => () => {};

/** False while prerendering and hydrating, true after: the live demos read storage, so they only run in the browser. */
export function useHydrated() {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

/** The page theme lives on <html data-theme>, set before paint by the inline script in index.html. */
function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribeTheme,
    () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
    () => 'light',
  );
}

export function setTheme(next: Theme) {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* storage unavailable */
  }
}

let activeWorkspace: Workspace | null = null;

export function trackWorkspace(workspace: Workspace) {
  activeWorkspace = workspace;
  return workspace;
}

/** Clears the saved demo workspace and reloads the seeded collections. */
export async function resetDemoData() {
  await activeWorkspace?.clearPersisted();
  location.reload();
}
