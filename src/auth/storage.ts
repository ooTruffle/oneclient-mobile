import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { AccountSummary, MinecraftAccount, PolyToken } from './types';

// expo-secure-store has no web implementation. The web build is only for
// desktop testing, so it keeps credentials in localStorage instead.
const store =
  Platform.OS === 'web'
    ? {
        getItemAsync: async (key: string, _opts?: unknown) => globalThis.localStorage?.getItem(key) ?? null,
        setItemAsync: async (key: string, value: string, _opts?: unknown) => globalThis.localStorage?.setItem(key, value),
        deleteItemAsync: async (key: string, _opts?: unknown) => globalThis.localStorage?.removeItem(key),
      }
    : SecureStore;

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

// Every signed-in account keeps its own tokens. They are split across keys
// because Android's keystore-backed store warns on values above ~2KB, and
// Minecraft/Microsoft tokens are long JWTs. Keys may only use [A-Za-z0-9._-].
const slot = (id: string) => id.replace(/-/g, '').toLowerCase();
const keysFor = (id: string) => ({
  meta: `acct.${slot(id)}.meta`,
  mc: `acct.${slot(id)}.mc`,
  refresh: `acct.${slot(id)}.refresh`,
  poly: `acct.${slot(id)}.poly`,
});
/** Accounts on this phone (no secrets), in the order they were added. */
const LIST_KEY = 'accounts.list';
/** Id of the account in use. */
const ACTIVE_KEY = 'accounts.active';

/** Before multi-account support there was one account under these keys. */
const LEGACY = { meta: 'account.meta', mc: 'account.mc', refresh: 'account.refresh', poly: 'poly.token' } as const;

const parse = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

async function readAccount(keys: { meta: string; mc: string; refresh: string }): Promise<MinecraftAccount | null> {
  const [meta, accessToken, refreshToken] = await Promise.all([
    store.getItemAsync(keys.meta, OPTIONS),
    store.getItemAsync(keys.mc, OPTIONS),
    store.getItemAsync(keys.refresh, OPTIONS),
  ]);
  const parsed = parse<Pick<MinecraftAccount, 'id' | 'username' | 'expiresAt'>>(meta);
  if (!parsed || !accessToken || !refreshToken) return null;
  return { id: parsed.id, username: parsed.username, expiresAt: parsed.expiresAt, accessToken, refreshToken };
}

/** Moves a pre-multi-account sign-in to the new layout, once. */
async function migrateLegacy(): Promise<void> {
  const account = await readAccount(LEGACY);
  if (account) {
    await saveAccount(account);
    const poly = parse<PolyToken>(await store.getItemAsync(LEGACY.poly, OPTIONS));
    if (poly?.accountId === account.id) await savePolyToken(account.id, poly);
    await setActive(account.id);
  } else {
    await store.setItemAsync(LIST_KEY, '[]', OPTIONS);
  }
  await Promise.all(Object.values(LEGACY).map((key) => store.deleteItemAsync(key, OPTIONS)));
}

export async function loadAccounts(): Promise<{ accounts: AccountSummary[]; active: string | null }> {
  let raw = await store.getItemAsync(LIST_KEY, OPTIONS);
  if (raw === null) {
    await migrateLegacy();
    raw = await store.getItemAsync(LIST_KEY, OPTIONS);
  }
  const accounts = parse<AccountSummary[]>(raw) ?? [];
  const active = await store.getItemAsync(ACTIVE_KEY, OPTIONS);
  return { accounts, active: accounts.some((a) => a.id === active) ? active : null };
}

export async function loadAccount(id: string): Promise<MinecraftAccount | null> {
  return readAccount(keysFor(id));
}

/** Saves an account's tokens and adds it to (or renames it in) the account list. */
export async function saveAccount(account: MinecraftAccount): Promise<AccountSummary[]> {
  const { accessToken, refreshToken, ...meta } = account;
  const keys = keysFor(account.id);
  await Promise.all([
    store.setItemAsync(keys.meta, JSON.stringify(meta), OPTIONS),
    store.setItemAsync(keys.mc, accessToken, OPTIONS),
    store.setItemAsync(keys.refresh, refreshToken, OPTIONS),
  ]);
  const list = parse<AccountSummary[]>(await store.getItemAsync(LIST_KEY, OPTIONS)) ?? [];
  const summary = { id: account.id, username: account.username };
  const next = list.some((a) => a.id === account.id)
    ? list.map((a) => (a.id === account.id ? summary : a))
    : [...list, summary];
  await store.setItemAsync(LIST_KEY, JSON.stringify(next), OPTIONS);
  return next;
}

/** Deletes an account's tokens and drops it from the list. */
export async function removeAccount(id: string): Promise<AccountSummary[]> {
  await Promise.all(Object.values(keysFor(id)).map((key) => store.deleteItemAsync(key, OPTIONS)));
  const list = parse<AccountSummary[]>(await store.getItemAsync(LIST_KEY, OPTIONS)) ?? [];
  const next = list.filter((a) => a.id !== id);
  await store.setItemAsync(LIST_KEY, JSON.stringify(next), OPTIONS);
  if ((await store.getItemAsync(ACTIVE_KEY, OPTIONS)) === id) await setActive(null);
  return next;
}

export async function setActive(id: string | null): Promise<void> {
  if (id) await store.setItemAsync(ACTIVE_KEY, id, OPTIONS);
  else await store.deleteItemAsync(ACTIVE_KEY, OPTIONS);
}

export async function loadPolyToken(id: string): Promise<PolyToken | null> {
  return parse<PolyToken>(await store.getItemAsync(keysFor(id).poly, OPTIONS));
}

export async function savePolyToken(id: string, token: PolyToken | null): Promise<void> {
  const key = keysFor(id).poly;
  if (token) await store.setItemAsync(key, JSON.stringify(token), OPTIONS);
  else await store.deleteItemAsync(key, OPTIONS);
}

/** Small on-device preferences (e.g. pinned chats). Kept on sign-out, keyed by the caller. */
export async function loadPref<T>(key: string): Promise<T | null> {
  try {
    return parse<T>(await store.getItemAsync(`pref.${key}`, OPTIONS));
  } catch {
    return null;
  }
}

export async function savePref(key: string, value: unknown): Promise<void> {
  await store.setItemAsync(`pref.${key}`, JSON.stringify(value), OPTIONS);
}
