// Which skin each player is wearing right now, straight from Mojang.
//
// Head services cache skins per player and can serve a stale skin or a
// default Steve (minotar did for a player with a custom skin). Mojang's
// session server says exactly which skin texture a player has, and a texture
// ID never changes, so rendering by ID is always the current skin.
//
// Answers are saved on the device and reused for a day, so most launches make
// no Mojang requests at all and heads show straight away. Older answers are
// still shown while a fresh lookup runs in the background.

import { useEffect, useSyncExternalStore } from 'react';
import { loadPref, savePref } from '@/auth/storage';
import { MOJANG_SESSION_URL } from '@/config';
import { fetchWithTimeout } from '@/lib/http';

/** How long a saved answer is trusted before asking Mojang again. */
const FRESH_MS = 24 * 60 * 60 * 1000;

interface Saved {
  /** Texture ID, or null for a default skin. */
  t: string | null;
  /** When Mojang said so (ms). */
  at: number;
}

const storageKey = (id: string) => `skin.${id}`;

/** texture ID, `null` if the player uses a default skin or lookup failed, `undefined` while loading. */
type Entry = string | null | undefined;

const textures = new Map<string, string | null>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

// Mojang rate-limits this endpoint, so look players up a few at a time.
const MAX_IN_FLIGHT = 4;
let inFlight = 0;
const waiting: string[] = [];
const requested = new Set<string>();

const key = (uuid: string) => uuid.replace(/-/g, '').toLowerCase();

async function lookup(id: string): Promise<string | null> {
  const res = await fetchWithTimeout(`${MOJANG_SESSION_URL}/session/minecraft/profile/${id}`);
  // 204: no such player. Anything else that isn't OK is a failure (e.g. 429), not "no skin".
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Mojang ${res.status}`);
  const profile = (await res.json()) as { properties?: { name: string; value: string }[] };
  const encoded = profile.properties?.find((p) => p.name === 'textures')?.value;
  if (!encoded) return null;
  const decoded = JSON.parse(atob(encoded)) as { textures?: { SKIN?: { url?: string } } };
  // .../texture/<id>
  const url = decoded.textures?.SKIN?.url;
  return url ? (url.split('/').pop() ?? null) : null;
}

function pump() {
  while (inFlight < MAX_IN_FLIGHT && waiting.length) {
    const id = waiting.shift()!;
    inFlight++;
    lookup(id)
      .then((texture) => {
        textures.set(id, texture);
        emit();
        void savePref(storageKey(id), { t: texture, at: Date.now() } satisfies Saved).catch(() => undefined);
      })
      // Network or rate-limit trouble: keep any saved answer, else fall back to per-player images.
      .catch(() => {
        if (!textures.has(id)) {
          textures.set(id, null);
          emit();
        }
      })
      .finally(() => {
        inFlight--;
        pump();
      });
  }
}

function request(id: string) {
  if (requested.has(id)) return;
  requested.add(id);
  void loadPref<Saved>(storageKey(id)).then((saved) => {
    if (saved && 'at' in saved) {
      textures.set(id, saved.t);
      emit();
      if (Date.now() - saved.at < FRESH_MS) return;
    }
    waiting.push(id);
    pump();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The player's current skin texture ID (see Entry). Looked up once per app run. */
export function useSkinTexture(uuid: string): Entry {
  const id = key(uuid);
  useEffect(() => request(id), [id]);
  return useSyncExternalStore(
    subscribe,
    () => textures.get(id),
    () => undefined,
  );
}
