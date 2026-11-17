// Exchanges a Minecraft session for a Polyfrost (PolyPlus) bearer token.
// Same handshake as OneLauncher's `oneclient_polyplus/src/session.rs::login`
// and PolyPlus' `PolyAuthorization`:
//   1. "join" a random server id at Mojang's session server with the MC token
//   2. POST /account/login?username=..&server_id=.. — the backend calls
//      Mojang's hasJoined to verify we own the account, then returns a token.

import * as Crypto from 'expo-crypto';
import { MOJANG_SESSION_URL, PLUS_API_URL } from '@/config';
import { fetchWithTimeout, HttpError, readJson, withQuery } from '@/lib/http';
import { AuthError, undashUuid, type MinecraftAccount } from './types';

const MOJANG_JOIN_URL = `${MOJANG_SESSION_URL}/session/minecraft/join`;

/** Thrown when Mojang refuses the join, which usually means the MC token is stale. */
export class JoinRejectedError extends AuthError {
  constructor(public readonly status: number) {
    super(`Mojang rejected the session (HTTP ${status}).`);
    this.name = 'JoinRejectedError';
  }
}

function generateServerId(): string {
  const bytes = Crypto.getRandomBytes(20);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function loginToPolyfrost(account: MinecraftAccount): Promise<string> {
  const serverId = generateServerId();

  const join = await fetchWithTimeout(MOJANG_JOIN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accessToken: account.accessToken,
      selectedProfile: undashUuid(account.id),
      serverId,
    }),
  });
  if (!join.ok) throw new JoinRejectedError(join.status);

  const res = await fetchWithTimeout(
    withQuery(`${PLUS_API_URL}/account/login`, { username: account.username, server_id: serverId }),
    { method: 'POST', headers: { Accept: 'application/json' } },
  );
  try {
    const { token } = await readJson<{ token: string }>(res);
    return token;
  } catch (err) {
    if (err instanceof HttpError) {
      throw new AuthError(`Polyfrost rejected the sign-in for ${account.username}: ${err.message}`);
    }
    throw err;
  }
}
