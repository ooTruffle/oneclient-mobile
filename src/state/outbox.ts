// Messages we've sent that the server hasn't confirmed yet, per conversation.
// Lives outside the chat screen, so a send keeps going (and a failed one stays
// visible with "tap to retry") after you leave the conversation and come back.
// In memory only: closing the app drops anything still unsent.

import * as Crypto from 'expo-crypto';
import { useCallback, useSyncExternalStore } from 'react';
import { plus } from '@/api/plus';
import { session } from '@/auth/session';
import { chatIdentity } from './chatIdentity';
import type { GroupMessage } from '@/api/types';
import { errorMessage } from '@/lib/http';

export interface Outgoing {
  /** Negative and local only, so it can't collide with a server message id. */
  id: number;
  groupId: number;
  /** Who sent it. A message is only ever posted as this account. */
  accountId: string;
  /** The delegated owner it's sent as ("Chat as"), or null for yourself. Kept for retries. */
  actAs: string | null;
  /** Idempotency key, reused on retry so the server can't post it twice. */
  key: string;
  content: string;
  sent_at: string;
  status: 'sending' | 'failed';
}

export type DeliveryResult =
  | { groupId: number; key: string; message: GroupMessage }
  | { groupId: number; key: string; error: string };

const EMPTY: readonly Outgoing[] = [];

let items: readonly Outgoing[] = [];
let nextId = 0;
const listeners = new Set<() => void>();
const settledListeners = new Set<(result: DeliveryResult) => void>();

const set = (next: readonly Outgoing[]) => {
  items = next;
  listeners.forEach((l) => l());
};
const update = (key: string, change: Partial<Outgoing>) =>
  set(items.map((x) => (x.key === key ? { ...x, ...change } : x)));

async function deliver(item: Outgoing) {
  // The user switched accounts since queueing this; don't post it as someone else.
  if (session.current?.id !== item.accountId) {
    set(items.filter((x) => x.key !== item.key));
    return;
  }
  update(item.key, { status: 'sending' });
  let result: DeliveryResult;
  try {
    const message = await plus.sendMessage(item.groupId, item.content, item.key, item.actAs);
    // Drop it only if it's still queued (the socket echo may have confirmed it already).
    if (items.some((x) => x.key === item.key)) set(items.filter((x) => x.key !== item.key));
    result = { groupId: item.groupId, key: item.key, message };
  } catch (err) {
    if (items.some((x) => x.key === item.key)) update(item.key, { status: 'failed' });
    result = { groupId: item.groupId, key: item.key, error: errorMessage(err) };
  }
  settledListeners.forEach((l) => {
    try {
      l(result);
    } catch (err) {
      console.warn('[outbox] listener failed', err);
    }
  });
}

export const outbox = {
  send(groupId: number, content: string) {
    const accountId = session.current?.id;
    if (!accountId) return;
    const item: Outgoing = {
      id: --nextId,
      groupId,
      accountId,
      actAs: chatIdentity.actAs,
      key: Crypto.randomUUID(),
      content,
      sent_at: new Date().toISOString(),
      status: 'sending',
    };
    set([...items, item]);
    void deliver(item);
  },
  retry(key: string) {
    const item = items.find((x) => x.key === key);
    if (item) void deliver(item);
  },
  discard(key: string) {
    set(items.filter((x) => x.key !== key));
  },
  /** The server confirmed this send over the socket (matched by idempotency key). */
  confirm(key: string) {
    if (items.some((x) => x.key === key)) set(items.filter((x) => x.key !== key));
  },
  /** On sign-out or switching accounts. */
  clear() {
    set([]);
  },
  /** Called after every send attempt, whether or not its chat is open. */
  onSettled(listener: (result: DeliveryResult) => void) {
    settledListeners.add(listener);
    return () => {
      settledListeners.delete(listener);
    };
  },
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Unconfirmed messages for one conversation, oldest first. */
export function useOutbox(groupId: number): readonly Outgoing[] {
  // Filter inside the snapshot but return a cached array, so React sees a stable value.
  const snapshot = useCallback(() => select(groupId), [groupId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

// Per-group results for the current `items`, rebuilt whenever `items` changes.
let cacheSource: readonly Outgoing[] | null = null;
const cache = new Map<number, readonly Outgoing[]>();
function select(groupId: number): readonly Outgoing[] {
  if (cacheSource !== items) {
    cacheSource = items;
    cache.clear();
  }
  let value = cache.get(groupId);
  if (!value) {
    const found = items.filter((x) => x.groupId === groupId);
    value = found.length ? found : EMPTY;
    cache.set(groupId, value);
  }
  return value;
}
