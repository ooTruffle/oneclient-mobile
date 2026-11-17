// App settings that live only on this device (nothing is sent to Polyfrost).
// Every screen using the same key sees the same value and updates together.

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { loadPref, savePref } from '@/auth/storage';

const values = new Map<string, unknown>();
const loading = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function ensureLoaded(key: string): Promise<void> {
  if (values.has(key)) return Promise.resolve();
  const pending = loading.get(key);
  if (pending) return pending;
  const load = loadPref<unknown>(key)
    .then((stored) => {
      // A change made while loading wins over what was on disk.
      if (!values.has(key) && stored !== null) {
        values.set(key, stored);
        emit();
      }
    })
    .catch(() => undefined)
    .finally(() => loading.delete(key));
  loading.set(key, load);
  return load;
}

/** Resolves once these settings are read from disk (used to hold the splash screen). */
export function preloadPrefs(keys: string[]): Promise<void> {
  return Promise.all(keys.map(ensureLoaded)).then(() => undefined);
}

/** `[value, setValue]` for a device-local setting, `fallback` until one is saved. */
export function usePref<T>(key: string, fallback: T): [T, (value: T) => void] {
  useEffect(() => {
    void ensureLoaded(key);
  }, [key]);
  const value = useSyncExternalStore(
    subscribe,
    () => (values.has(key) ? (values.get(key) as T) : fallback),
    () => fallback,
  );
  const set = useCallback(
    (next: T) => {
      values.set(key, next);
      emit();
      void savePref(key, next).catch(() => undefined);
    },
    [key],
  );
  return [value, set];
}

/** Setting keys, so the screen that reads one and the one that changes it agree. */
export const PREFS = {
  /** Chats tab: split the list into collapsible Pinned / DMs / Groups / Party sections. */
  chatSections: 'chats.sections',
  /** Which of those sections are collapsed. */
  collapsedSections: 'chats.collapsed',
  /** Special Chat section (targets only): show only unread chats. */
  specialUnreadOnly: 'chats.specialUnreadOnly',
  /**
   * Special Chat staff tools: "Chat as", the separate Special Chat section and
   * its filters, Convert to normal chat. Off shows the app everyone else sees.
   */
  specialFeatures: 'chats.specialFeatures',
  /** Accent colour as "#rrggbb". */
  accent: 'appearance.accent',
} as const;
