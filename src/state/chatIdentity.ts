// Who chats are read and sent as. Mirrors PolyPlus `ChatIdentity`: the server
// lists the players you're a delegate of (GET /groups/delegations, e.g. a
// Special Chat target staff answer for), and chat requests carry
// `x-polyplus-act-as: <owner uuid>` while you're acting as one of them.
// In memory only, like PolyPlus: every launch starts as yourself.

import { useSyncExternalStore } from 'react';

export const ACT_AS_HEADER = 'x-polyplus-act-as';

interface Snapshot {
  /** Owner uuid being acted as, or null for yourself. */
  actAs: string | null;
  /** Owners this account may act as. */
  delegations: readonly string[];
}

let snapshot: Snapshot = { actAs: null, delegations: [] };
const listeners = new Set<() => void>();

const set = (next: Partial<Snapshot>) => {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
};

const same = (a: string | null, b: string | null) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

export const chatIdentity = {
  get actAs() {
    return snapshot.actAs;
  },
  get delegations() {
    return snapshot.delegations;
  },
  /** Your own uuid, or the owner's while acting as them. */
  selfId(accountId: string) {
    return snapshot.actAs ?? accountId;
  },
  setDelegations(owners: string[]) {
    // Access was taken away: fall back to yourself.
    const keep = snapshot.actAs && owners.some((o) => same(o, snapshot.actAs)) ? snapshot.actAs : null;
    set({ delegations: owners, actAs: keep });
  },
  switchTo(owner: string | null) {
    if (same(owner, snapshot.actAs)) return;
    if (owner && !snapshot.delegations.some((o) => same(o, owner))) return;
    set({ actAs: owner });
  },
  /** On sign-out or switching accounts. */
  reset() {
    if (snapshot.actAs === null && snapshot.delegations.length === 0) return;
    set({ actAs: null, delegations: [] });
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useChatIdentity(): Snapshot {
  return useSyncExternalStore(chatIdentity.subscribe, () => snapshot, () => snapshot);
}
