// REST client for the PolyPlus social API. Endpoints match PolyPlus
// `SocialApi`/`GroupsApi`/`PlayersApi`/`AccountApi` and
// OneLauncher `oneclient_polyplus/src/rest.rs`.

import * as Crypto from 'expo-crypto';
import { session } from '@/auth/session';
import { ACT_AS_HEADER, chatIdentity } from '@/state/chatIdentity';
import { CURSOR_PAGE_SIZE, MAX_RESOLVE_BATCH, PLUS_API_URL } from '@/config';
import { AccountChangedError, fetchWithTimeout, HttpError, readJson, withQuery } from '@/lib/http';
import type {
  BlockedPlayer,
  CursorPage,
  Friend,
  FriendRequest,
  GroupMessage,
  GroupSummary,
  LinkedAccount,
  Party,
  PartyInvite,
  PartyInvitePolicy,
  PartyVoiceMode,
  PlayerStatus,
  RequestCounts,
  ResolvedPlayer,
  SpecialChatStatus,
  WorldInvite,
} from './types';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Query = Record<string, string | number | undefined | null>;

interface RequestOptions {
  body?: unknown;
  query?: Query;
  /**
   * Chat routes only (PolyPlus `applyActAs`): the delegated owner to act as,
   * or null for yourself. Other routes reject the header.
   */
  actAs?: string | null;
  /** Drop the answer if the chat identity changed while this was in flight (reads only). */
  identityBound?: boolean;
}

async function request<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
  const url = withQuery(`${PLUS_API_URL}${path}`, opts.query ?? {});
  const owner = session.current?.id;
  const identity = chatIdentity.actAs;
  let stale: string | undefined;

  // One retry with a fresh Polyfrost token if the cached one was rejected.
  for (let attempt = 0; ; attempt++) {
    const token = await session.token(stale);
    // Never send one account's request with another account's token.
    if (session.current?.id !== owner) throw new AccountChangedError();
    const res = await fetchWithTimeout(url, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(opts.actAs ? { [ACT_AS_HEADER]: opts.actAs } : {}),
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401 && attempt === 0) {
      stale = token;
      continue;
    }
    const result = await readJson<T>(res);
    // The user switched accounts while this was in flight; its answer belongs to the other account.
    if (session.current?.id !== owner) throw new AccountChangedError();
    if (opts.identityBound && chatIdentity.actAs !== identity) throw new AccountChangedError();
    return result;
  }
}

async function allPages<T>(path: string, max = 1000): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await request<CursorPage<T>>('GET', path, { query: { limit: CURSOR_PAGE_SIZE, cursor } });
    items.push(...page.items);
    cursor = page.cursor ?? undefined;
  } while (cursor && items.length < max);
  if (cursor) console.warn(`[plus] ${path}: stopped at ${items.length} items (limit ${max}); the rest weren't loaded`);
  return items;
}

const seg = encodeURIComponent;

/** Chat reads made as whoever is selected in "Chat as"; dropped if that changes mid-flight. */
const asCurrent = (opts: RequestOptions = {}): RequestOptions => ({ ...opts, actAs: chatIdentity.actAs, identityBound: true });
/** Chat writes made as whoever is selected in "Chat as". */
const asSelected = (opts: RequestOptions = {}): RequestOptions => ({ ...opts, actAs: chatIdentity.actAs });

export const plus = {
  // Friends
  friends: () => allPages<Friend>('/v1/social/friends'),
  removeFriend: (player: string) => request<void>('DELETE', `/social/friends/${seg(player)}`),
  requestCounts: () => request<RequestCounts>('GET', '/v1/social/requests/counts'),
  incomingRequests: () => allPages<FriendRequest>('/v1/social/requests/incoming'),
  outgoingRequests: () => allPages<FriendRequest>('/v1/social/requests/outgoing'),
  sendFriendRequest: (player: string) =>
    request<FriendRequest | null>('POST', `/social/requests/${seg(player)}`),
  acceptRequest: (id: number) => request<void>('POST', `/social/requests/${id}/accept`),
  declineRequest: (id: number) => request<void>('POST', `/social/requests/${id}/decline`),
  cancelRequest: (id: number) => request<void>('DELETE', `/social/requests/${id}`),
  blocked: () => allPages<BlockedPlayer>('/v1/social/blocked'),
  block: (player: string) => request<void>('POST', `/social/blocked/${seg(player)}`),
  unblock: (player: string) => request<void>('DELETE', `/social/blocked/${seg(player)}`),

  // Conversations (DMs, groups, party chats)
  groupsPage: (cursor?: string, limit = 50) =>
    request<CursorPage<GroupSummary>>('GET', '/v1/groups', asCurrent({ query: { limit, cursor } })),
  /** Players whose chats you can act as (Special Chat targets you answer for, etc.). */
  delegations: () => request<string[]>('GET', '/groups/delegations'),
  openDirectMessage: (player: string) => request<GroupSummary>('POST', `/groups/dm/${seg(player)}`),
  createGroup: (name: string, members: string[]) =>
    request<GroupSummary>('POST', '/groups', { body: { name, members } }),
  renameGroup: (groupId: number, name: string) =>
    request<void>('PATCH', `/v1/groups/${groupId}`, { body: { name } }),
  addMember: (groupId: number, player: string) =>
    request<void>('POST', `/groups/${groupId}/members/${seg(player)}`),
  removeMember: (groupId: number, player: string) =>
    request<void>('DELETE', `/groups/${groupId}/members/${seg(player)}`),
  messages: (groupId: number, before?: number, limit = 50) =>
    request<GroupMessage[]>('GET', `/groups/${groupId}/messages`, asCurrent({ query: { before, limit } })),
  /**
   * Reuse `idempotencyKey` when retrying, so a send that did reach the server isn't posted twice.
   * `actAs` is fixed when the message is queued, so a retry goes out as the same identity.
   */
  sendMessage: (
    groupId: number,
    content: string,
    idempotencyKey: string = Crypto.randomUUID(),
    actAs: string | null = chatIdentity.actAs,
  ) =>
    request<GroupMessage>('POST', `/groups/${groupId}/messages`, {
      body: { content, idempotency_key: idempotencyKey },
      actAs,
    }),
  editMessage: (groupId: number, messageId: number, content: string) =>
    request<GroupMessage>('PATCH', `/groups/${groupId}/messages/${messageId}`, asSelected({ body: { content } })),
  deleteMessage: (groupId: number, messageId: number) =>
    request<void>('DELETE', `/groups/${groupId}/messages/${messageId}`, asSelected()),
  markRead: (groupId: number, messageId: number) =>
    request<void>('POST', `/groups/${groupId}/read/${messageId}`, asSelected()),
  /** Special Chat cooldown. The cooldown is per player, shared by every Special Chat group. */
  specialChat: () => request<SpecialChatStatus>('GET', '/special-chat', asCurrent()),

  // Party (PolyPlus `PartyApi`, OneLauncher `party.rs`). GET returns 204 when not in a party.
  party: async () => (await request<Party | undefined>('GET', '/v1/party')) ?? null,
  createParty: () => request<Party>('POST', '/v1/party', { body: {} }),
  leaveParty: () => request<void>('POST', '/v1/party/leave'),
  disbandParty: () => request<void>('DELETE', '/v1/party'),
  /** Leader only. Omitted fields are left as they are. */
  setPartySettings: (settings: { voice_mode?: PartyVoiceMode; invite_policy?: PartyInvitePolicy }) =>
    request<Party>('PUT', '/v1/party/settings', { body: settings }),
  transferLeader: (player: string) => request<Party>('POST', '/v1/party/leader', { body: { player } }),
  kickFromParty: (player: string) => request<void>('DELETE', `/v1/party/members/${seg(player)}`),
  /** Creates a party first if you aren't in one. */
  inviteToParty: (player: string) => request<PartyInvite>('POST', '/v1/party/invites', { body: { player } }),
  incomingPartyInvites: () => request<PartyInvite[]>('GET', '/v1/party/invites/incoming'),
  outgoingPartyInvites: () => request<PartyInvite[]>('GET', '/v1/party/invites/outgoing'),
  acceptPartyInvite: (id: string, leaveCurrent: boolean) =>
    request<Party>('POST', `/v1/party/invites/${seg(id)}/accept`, { body: { leave_current: leaveCurrent } }),
  declinePartyInvite: (id: string) => request<void>('POST', `/v1/party/invites/${seg(id)}/decline`),
  cancelPartyInvite: (id: string) => request<void>('DELETE', `/v1/party/invites/${seg(id)}`),

  // World invites. Joining needs the game, so mobile can only see and decline them.
  worldInvites: () => request<WorldInvite[]>('GET', '/sessions/invites/incoming'),
  declineWorldInvite: (id: number) => request<void>('POST', `/sessions/invites/${id}/decline`),

  // Account
  linkedAccounts: () => request<LinkedAccount[]>('GET', '/account/links'),
  /** Returns the Discord consent page to open in the browser; the server finishes the link. */
  startDiscordLink: () => request<{ url: string }>('POST', '/account/links/discord'),
  unlinkAccount: (provider: string) => request<void>('DELETE', `/account/links/${seg(provider)}`),
  status: async () => (await request<{ status: PlayerStatus }>('GET', '/account/status')).status,
  setStatus: (status: PlayerStatus) => request<void>('PUT', '/account/status', { body: { status } }),
  registerPushToken: (token: string, platform: 'android' | 'ios') =>
    request<void>('PUT', '/account/push-token', { body: { token, platform } }),
  unregisterPushToken: (token: string) => request<void>('DELETE', '/account/push-token', { body: { token } }),
  /**
   * Same as unregisterPushToken, but with a given Polyfrost token and no re-login on 401.
   * For an account whose Microsoft sign-in was revoked, so `session` can't get a new token.
   */
  async unregisterPushTokenWith(bearer: string, token: string): Promise<void> {
    const res = await fetchWithTimeout(`${PLUS_API_URL}/account/push-token`, {
      method: 'DELETE',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ token }),
    });
    await readJson<void>(res);
  },

  // Players
  async resolvePlayers(ids: string[]): Promise<ResolvedPlayer[]> {
    const out: ResolvedPlayer[] = [];
    for (let i = 0; i < ids.length; i += MAX_RESOLVE_BATCH) {
      const chunk = ids.slice(i, i + MAX_RESOLVE_BATCH);
      const res = await request<{ players: ResolvedPlayer[] }>('POST', '/players/resolve', { body: { ids: chunk } });
      out.push(...res.players);
    }
    return out;
  },
  async lookupUsername(username: string): Promise<ResolvedPlayer | null> {
    try {
      return await request<ResolvedPlayer>('GET', `/players/by-username/${seg(username)}`);
    } catch (err) {
      if (err instanceof HttpError && err.isNotFound) return null;
      throw err;
    }
  },
};
