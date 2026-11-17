// Pinned conversations. Local to this phone (nothing is sent to Polyfrost),
// stored per Minecraft account so switching accounts keeps each list separate.

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { loadPref, savePref } from '@/auth/storage';

let owner: string | null = null;
let pinned: ReadonlySet<number> = new Set();
const listeners = new Set<() => void>();

const keyFor = (account: string) => `pins.${account.replace(/-/g, '').toLowerCase()}`;
const emit = () => listeners.forEach((l) => l());

async function load(account: string) {
  if (owner === account) return;
  owner = account;
  pinned = new Set();
  emit();
  const ids = await loadPref<number[]>(keyFor(account));
  if (owner !== account) return; // switched accounts meanwhile
  pinned = new Set(Array.isArray(ids) ? ids : []);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePins(account: string) {
  useEffect(() => {
    void load(account);
  }, [account]);

  const set = useSyncExternalStore(subscribe, () => pinned, () => pinned);

  const toggle = useCallback(
    (groupId: number) => {
      if (owner !== account) return;
      const next = new Set(pinned);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      pinned = next;
      emit();
      void savePref(keyFor(account), [...next]).catch(() => undefined);
    },
    [account],
  );

  return { pinned: set, isPinned: (id: number) => set.has(id), toggle };
}
