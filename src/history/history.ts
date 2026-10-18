import type { ApiResponse, RequestDefinition } from '../core/types';
import { isApiError, type ApiError, type ApiErrorKind } from '../core/errors';
import { createId } from '../utils/id';

export type HistoryOutcome =
  | { type: 'response'; status: number; statusText: string; duration: number; size: number }
  | { type: 'error'; kind: ApiErrorKind; message: string };

export interface HistoryEntry {
  id: string;
  timestamp: number;
  /** The request as edited (variables unresolved), so replaying it re-resolves the current environment. */
  request: RequestDefinition;
  outcome: HistoryOutcome;
}

export const DEFAULT_HISTORY_LIMIT = 100;

export function createHistoryEntry(request: RequestDefinition, result: ApiResponse | ApiError, timestamp = Date.now()): HistoryEntry {
  const outcome: HistoryOutcome = isApiError(result)
    ? { type: 'error', kind: result.kind, message: result.message }
    : { type: 'response', status: result.status, statusText: result.statusText, duration: result.timing.duration, size: result.size };
  return { id: createId('hist'), timestamp, request, outcome };
}

/** Prepends an entry (newest first) and trims to `limit`. */
export function addHistoryEntry(history: readonly HistoryEntry[], entry: HistoryEntry, limit = DEFAULT_HISTORY_LIMIT): HistoryEntry[] {
  return [entry, ...history].slice(0, Math.max(0, limit));
}

export function removeHistoryEntry(history: readonly HistoryEntry[], id: string): HistoryEntry[] {
  return history.filter((e) => e.id !== id);
}

/** Groups entries by calendar day (local time), newest first, for display. */
export function groupHistoryByDay(history: readonly HistoryEntry[], now = Date.now()): Array<{ label: string; entries: HistoryEntry[] }> {
  const groups: Array<{ label: string; entries: HistoryEntry[] }> = [];
  const today = startOfDay(now);
  for (const entry of history) {
    const day = startOfDay(entry.timestamp);
    const label =
      day === today
        ? 'Today'
        : day === today - 86_400_000
          ? 'Yesterday'
          : new Date(entry.timestamp).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

function startOfDay(timestamp: number) {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
