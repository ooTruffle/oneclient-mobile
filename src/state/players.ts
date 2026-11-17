// UUID -> username cache, batched through POST /players/resolve.

import { useEffect, useSyncExternalStore } from 'react';
import { plus } from '@/api/plus';

const names = new Map<string, string>();
const pending = new Set<string>();
const failed = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  version++;
  for (const listener of listeners) listener();
}

function flush() {
  timer = null;
  const ids = [...pending];
  pending.clear();
  if (ids.length === 0) return;
  plus
    .resolvePlayers(ids)
    .then((players) => {
      for (const p of players) names.set(p.id.toLowerCase(), p.username);
      for (const id of ids) if (!names.has(id)) failed.add(id);
      notify();
    })
    .catch(() => {
      for (const id of ids) failed.add(id);
    });
}

export function rememberName(id: string, username: string) {
  names.set(id.toLowerCase(), username);
  notify();
}

export function requestNames(ids: Iterable<string>) {
  for (const raw of ids) {
    const id = raw.toLowerCase();
    if (names.has(id) || failed.has(id)) continue;
    pending.add(id);
  }
  if (pending.size > 0 && !timer) timer = setTimeout(flush, 30);
}

export function playerName(id: string): string | undefined {
  return names.get(id.toLowerCase());
}

export function clearNames() {
  names.clear();
  failed.clear();
  pending.clear();
  notify();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getVersion = () => version;

/** Re-renders when any name resolves; returns a lookup with a short-uuid fallback. */
export function usePlayerNames(ids: string[] = []): (id: string) => string {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const key = ids.join(',');
  useEffect(() => {
    if (ids.length) requestNames(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (id: string) => names.get(id.toLowerCase()) ?? `${id.slice(0, 8)}…`;
}
