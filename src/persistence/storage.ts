/**
 * Minimal async-friendly key/value storage. Implement it to persist the workspace anywhere: IndexedDB,
 * a backend, `chrome.storage`, an encrypted store...
 */
export interface StorageAdapter {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

/** In-memory storage (the default when persistence is enabled without an adapter in tests/SSR). */
export function createMemoryStorage(initial: Record<string, string> = {}): StorageAdapter & { dump(): Record<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    dump: () => Object.fromEntries(data),
  };
}

/**
 * `localStorage`/`sessionStorage` adapter. Safe during SSR and in privacy modes where storage throws:
 * it degrades to a no-op instead of crashing.
 */
export function createWebStorage(kind: 'local' | 'session' = 'local'): StorageAdapter {
  const get = (): Storage | null => {
    try {
      return typeof window === 'undefined' ? null : kind === 'local' ? window.localStorage : window.sessionStorage;
    } catch {
      return null;
    }
  };
  return {
    getItem(key) {
      try {
        return get()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        get()?.setItem(key, value);
      } catch (error) {
        console.warn('[m2api-client] Could not persist workspace:', error);
      }
    },
    removeItem(key) {
      try {
        get()?.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}
