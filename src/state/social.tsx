// Social store: roster, requests, conversations and live presence, kept
// current by the PolyPlus websocket.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { plus } from '@/api/plus';
import { plusSocket } from '@/api/socket';
import type {
  BlockedPlayer,
  ClientboundPacket,
  Friend,
  FriendRequest,
  GroupSummary,
  LastMessage,
  MemberState,
  Party,
  PartyInvite,
  PlayerStatus,
  WorldInvite,
} from '@/api/types';
import { AccountChangedError, errorMessage } from '@/lib/http';
import { setActiveChat } from '@/notifications';
import { useAuth } from './auth';
import { chatIdentity, useChatIdentity } from './chatIdentity';
import { PREFS, usePref } from './prefs';
import { outbox } from './outbox';
import { clearNames, rememberName, requestNames } from './players';

interface SocialState {
  connected: boolean;
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  /**
   * Pending friend requests, from the cheap counts endpoint. Drives the Friends
   * badge before the full roster has loaded (e.g. right after reopening the app).
   */
  requestCounts: { incoming: number; outgoing: number };
  blocked: BlockedPlayer[];
  groups: GroupSummary[];
  groupsCursor: string | null;
  presence: Record<string, boolean>;
  myStatus: PlayerStatus;
  loading: { roster: boolean; groups: boolean };
  error: string | null;
  /** Conversation currently on screen; its incoming messages aren't marked unread. */
  activeGroupId: number | null;
  party: Party | null;
  partyIncoming: PartyInvite[];
  partyOutgoing: PartyInvite[];
  worldInvites: WorldInvite[];
  /** One-off message such as "You were removed from the party". */
  partyNotice: string | null;
  /**
   * Whoever you're chatting as is a Special Chat target (staff), so every
   * player's Special Chat shows up here. From GET /special-chat, like PolyPlus.
   */
  specialTarget: boolean;
  /** Special Chats where the player has sent something (PolyPlus `SpecialChatResponses`). */
  responded: number[];
  scanningReplies: boolean;
}

interface SocialContextValue extends SocialState {
  /** Delegated owner chats are shown and sent as ("Chat as"), or null for yourself. */
  actAs: string | null;
  /** Players this account may chat as; empty for almost everyone. */
  delegations: readonly string[];
  /** Your uuid, or the owner's while chatting as them: who "you" are in the chat views. */
  selfId: string;
  /** Switch "Chat as" (null for yourself). Reloads the chat list. */
  chatAs: (owner: string | null) => void;
  refreshDelegations: () => Promise<void>;
  /**
   * This account has Special Chat staff tools to show (delegations, or it is a
   * target itself), whether or not they're switched on.
   */
  hasSpecialFeatures: boolean;
  /** The staff tools are switched on (Profile > Chats). Off hides them all. */
  specialFeatures: boolean;
  /** Works out which Special Chats the player has replied in, for the Awaiting/Responded filter. */
  scanReplies: () => Promise<void>;
  /** Special Chat targets: turn a Special Chat into an ordinary group (PolyPlus "Convert to Normal Chat"). */
  claimSpecialChat: (groupId: number) => Promise<void>;
  refreshParty: () => Promise<void>;
  setParty: (party: Party | null) => void;
  dismissPartyNotice: () => void;
  refreshRoster: () => Promise<void>;
  /** Resolves to the first page, or null if it failed. */
  refreshGroups: () => Promise<GroupSummary[] | null>;
  /** Updates a conversation's Chats list preview after one of its messages was edited or deleted. */
  refreshPreview: (groupId: number) => Promise<void>;
  loadMoreGroups: () => Promise<void>;
  setActiveGroup: (id: number | null) => void;
  markGroupRead: (id: number) => void;
  upsertGroup: (group: GroupSummary) => void;
  removeGroup: (id: number) => void;
  setMyStatus: (status: PlayerStatus) => Promise<void>;
  isOnline: (player: string) => boolean;
  /**
   * Where a player is in game. The server only shares this for members of your
   * party, so it's undefined for everyone else.
   */
  stateOf: (player: string) => MemberState | undefined;
}

const initialState: SocialState = {
  connected: false,
  friends: [],
  incoming: [],
  outgoing: [],
  requestCounts: { incoming: 0, outgoing: 0 },
  blocked: [],
  groups: [],
  groupsCursor: null,
  presence: {},
  myStatus: 'online',
  loading: { roster: false, groups: false },
  error: null,
  activeGroupId: null,
  party: null,
  partyIncoming: [],
  partyOutgoing: [],
  worldInvites: [],
  partyNotice: null,
  specialTarget: false,
  responded: [],
  scanningReplies: false,
};

/** PolyPlus scans this many recent messages per Special Chat, 16 chats at a time. */
const REPLY_SCAN_MESSAGES = 200;
const REPLY_SCAN_CONCURRENCY = 16;

const PARTY_LEFT_NOTICE: Record<string, string> = {
  kicked: 'You were removed from the party.',
  disbanded: 'The party leader disbanded the party.',
  expired: 'Your party expired.',
};

const pending = <T extends { status?: string }>(items: T[]) =>
  items.filter((i) => !i.status || i.status === 'pending');

const SocialContext = createContext<SocialContextValue | null>(null);

const dmKey = (g: GroupSummary) =>
  g.kind === 'dm' ? [...g.members].map((m) => m.toLowerCase()).sort().join('|') : null;

/** Of two DMs with the same person, keep the one with messages, else the oldest (the one the server returns). */
const betterDm = (a: GroupSummary, b: GroupSummary) => {
  const at = a.last_message?.sent_at ?? '';
  const bt = b.last_message?.sent_at ?? '';
  if (at !== bt) return at > bt ? a : b;
  return a.id <= b.id ? a : b;
};

/** Moves a conversation's preview to its newest message. */
const withLastMessage = (
  groups: GroupSummary[],
  groupId: number,
  last: LastMessage,
  unread?: (g: GroupSummary) => boolean,
) =>
  groups.map((g) => {
    if (g.id !== groupId) return g;
    // Out-of-order arrivals (a slow HTTP reply after a newer live message) don't roll the preview back.
    if (g.last_message?.sent_at && Date.parse(g.last_message.sent_at) > Date.parse(last.sent_at)) return g;
    return { ...g, last_message: last, ...(unread ? { unread: unread(g) } : {}) };
  });

/** Catch-up refreshes closer together than this (e.g. launch, then the socket's first connect) are skipped. */
const RESYNC_GAP_MS = 10_000;

/**
 * Newest first, with duplicate DMs collapsed. The backend used to create two
 * DMs for the same pair when "open DM" raced (e.g. a double tap); see
 * plus-backend get_or_create_dm_group.
 */
const sortGroups = (groups: GroupSummary[]) => {
  const byPair = new Map<string, GroupSummary>();
  const rest: GroupSummary[] = [];
  for (const g of groups) {
    const key = dmKey(g);
    if (!key) rest.push(g);
    else byPair.set(key, byPair.has(key) ? betterDm(byPair.get(key)!, g) : g);
  }
  return [...rest, ...byPair.values()].sort((a, b) =>
    (b.last_message?.sent_at ?? '').localeCompare(a.last_message?.sent_at ?? ''),
  );
};

export function SocialProvider({ children }: { children: ReactNode }) {
  const { account } = useAuth();
  const [state, setState] = useState<SocialState>(initialState);
  const activeGroupRef = useRef<number | null>(null);
  const identity = useChatIdentity();
  const [specialFeatures] = usePref(PREFS.specialFeatures, true);
  // Switched off: back to yourself, like any other player.
  useEffect(() => {
    if (!specialFeatures) chatIdentity.switchTo(null);
  }, [specialFeatures]);
  const me = (identity.actAs ?? account?.id)?.toLowerCase() ?? null;
  // Read by the packet handler, so switching "Chat as" doesn't reconnect the socket.
  const meRef = useRef(me);
  meRef.current = me;

  const patch = useCallback((update: Partial<SocialState> | ((s: SocialState) => Partial<SocialState>)) => {
    setState((s) => ({ ...s, ...(typeof update === 'function' ? update(s) : update) }));
  }, []);

  /** Shows an error, unless it only means the user switched accounts mid-request. */
  const fail = useCallback(
    (err: unknown) => {
      if (!(err instanceof AccountChangedError)) patch({ error: errorMessage(err) });
    },
    [patch],
  );

  const refreshRoster = useCallback(async () => {
    patch((s) => ({ loading: { ...s.loading, roster: true } }));
    try {
      const [friends, incoming, outgoing, blocked] = await Promise.all([
        plus.friends(),
        plus.incomingRequests(),
        plus.outgoingRequests(),
        plus.blocked(),
      ]);
      requestNames([
        ...friends.map((f) => f.player),
        ...incoming.map((r) => r.player),
        ...outgoing.map((r) => r.player),
        ...blocked.map((b) => b.player),
      ]);
      patch((s) => {
        const presence = { ...s.presence };
        for (const f of friends) {
          const key = f.player.toLowerCase();
          if (!(key in presence)) presence[key] = !!f.online;
        }
        return {
          friends,
          incoming,
          outgoing,
          blocked,
          presence,
          requestCounts: { incoming: incoming.length, outgoing: outgoing.length },
          error: null,
        };
      });
    } catch (err) {
      fail(err);
    } finally {
      patch((s) => ({ loading: { ...s.loading, roster: false } }));
    }
  }, [patch, fail]);

  const refreshRequestCounts = useCallback(async () => {
    try {
      const counts = await plus.requestCounts();
      patch({ requestCounts: { incoming: counts.incoming ?? 0, outgoing: counts.outgoing ?? 0 } });
    } catch {
      // Badge only; the roster refresh corrects it.
    }
  }, [patch]);

  const refreshGroups = useCallback(async () => {
    patch((s) => ({ loading: { ...s.loading, groups: true } }));
    try {
      const page = await plus.groupsPage();
      requestNames(page.items.flatMap((g) => g.members));
      patch({ groups: sortGroups(page.items), groupsCursor: page.cursor ?? null, error: null });
      return page.items;
    } catch (err) {
      fail(err);
      return null;
    } finally {
      patch((s) => ({ loading: { ...s.loading, groups: false } }));
    }
  }, [patch, fail]);

  /**
   * Re-reads a conversation's newest message for its Chats list preview, after a
   * message in it was edited or deleted. The preview has no message id, so we
   * can't tell whether the changed message was the one shown.
   */
  const refreshPreview = useCallback(
    async (groupId: number) => {
      const before = groupsRef.current.find((g) => g.id === groupId);
      if (!before) return;
      try {
        const [newest] = (await plus.messages(groupId, undefined, 1)).sort((a, b) => b.id - a.id);
        patch((s) => ({
          groups: sortGroups(
            s.groups.map((g) =>
              // A message that arrived meanwhile is newer than what we fetched; leave it.
              g.id !== groupId || g.last_message !== before.last_message
                ? g
                : {
                    ...g,
                    last_message: newest ? { content: newest.content, sender: newest.sender, sent_at: newest.sent_at } : null,
                  },
            ),
          ),
        }));
      } catch {
        // Only the preview text; the next full refresh corrects it.
      }
    },
    [patch],
  );

  // PolyPlus `ChatIdentity.refreshDelegations`: who this account may chat as.
  const refreshDelegations = useCallback(async () => {
    try {
      const owners = await plus.delegations();
      requestNames(owners);
      chatIdentity.setDelegations(owners);
    } catch (err) {
      // Optional feature; the chats still work as yourself.
      if (!(err instanceof AccountChangedError)) console.warn('[social] delegations failed', err);
    }
  }, []);

  // PolyPlus `SpecialChatRepository.refreshTargets`. Like PolyPlus, this also
  // creates the player's own Special Chat group the first time it's called.
  const refreshSpecialStatus = useCallback(async () => {
    try {
      const status = await plus.specialChat();
      patch({ specialTarget: status.is_special_chat_target });
    } catch {
      // Only changes how Special Chats are listed.
    }
  }, [patch]);

  // PolyPlus `SpecialChatResponses.refresh`.
  const scannedReplies = useRef(new Set<number>());
  const replyScanRunning = useRef(false);
  const scanReplies = useCallback(async () => {
    const specials = groupsRef.current.filter((g) => g.special);
    const self = (chatIdentity.actAs ?? account?.id ?? '').toLowerCase();
    // The targets are whoever is in every Special Chat (with only one, just us).
    const memberSets = specials.map((g) => new Set(g.members.map((m) => m.toLowerCase())));
    const targets =
      memberSets.length < 2
        ? new Set([self])
        : memberSets.reduce((common, members) => new Set([...common].filter((m) => members.has(m))));
    const isPlayer = (sender: string) => !targets.has(sender.toLowerCase());
    const addResponded = (ids: number[]) =>
      ids.length && patch((s) => ({ responded: [...new Set([...s.responded, ...ids])] }));

    addResponded(specials.filter((g) => g.last_message && isPlayer(g.last_message.sender)).map((g) => g.id));
    if (replyScanRunning.current) return;
    const pending = specials.map((g) => g.id).filter((id) => !scannedReplies.current.has(id));
    if (!pending.length) return;

    replyScanRunning.current = true;
    patch({ scanningReplies: true });
    try {
      for (let i = 0; i < pending.length; i += REPLY_SCAN_CONCURRENCY) {
        const batch = await Promise.all(
          pending.slice(i, i + REPLY_SCAN_CONCURRENCY).map((id) =>
            plus
              .messages(id, undefined, REPLY_SCAN_MESSAGES)
              .then((messages) => ({ id, messages }))
              // Includes switching identity mid-scan: those answers are dropped.
              .catch(() => ({ id, messages: null })),
          ),
        );
        const replied: number[] = [];
        for (const { id, messages } of batch) {
          if (!messages) continue;
          scannedReplies.current.add(id);
          if (messages.some((m) => isPlayer(m.sender))) replied.push(id);
        }
        addResponded(replied);
      }
    } finally {
      replyScanRunning.current = false;
      patch({ scanningReplies: false });
    }
  }, [account, patch]);

  const refreshParty = useCallback(async () => {
    try {
      const [party, partyIncoming, partyOutgoing, worldInvites] = await Promise.all([
        plus.party(),
        plus.incomingPartyInvites(),
        plus.outgoingPartyInvites(),
        // World invites are secondary; don't let them break the party view.
        plus.worldInvites().catch(() => [] as WorldInvite[]),
      ]);
      requestNames([
        ...(party?.members.map((m) => m.player) ?? []),
        ...partyIncoming.map((i) => i.sender),
        ...partyOutgoing.map((i) => i.recipient),
        ...worldInvites.map((i) => i.sender),
      ]);
      patch({
        party,
        partyIncoming: pending(partyIncoming),
        partyOutgoing: pending(partyOutgoing),
        worldInvites: pending(worldInvites),
      });
    } catch (err) {
      fail(err);
    }
  }, [patch, fail]);

  const cursorRef = useRef<string | null>(null);
  cursorRef.current = state.groupsCursor;
  const groupsRef = useRef<GroupSummary[]>([]);
  groupsRef.current = state.groups;
  // A delegate's socket also gets the live events of the chats it can act in,
  // whichever identity is shown, and packets don't say which one they're for.
  // Groups a reload showed aren't ours (right now) are skipped, so they don't
  // reload the list on every message. Cleared when the identity changes.
  const otherIdentityGroups = useRef(new Set<number>());
  const checkingGroups = useRef(new Set<number>());
  const loadMoreGroups = useCallback(async () => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    try {
      const page = await plus.groupsPage(cursor);
      requestNames(page.items.flatMap((g) => g.members));
      patch((s) => {
        const known = new Set(s.groups.map((g) => g.id));
        return {
          groups: sortGroups([...s.groups, ...page.items.filter((g) => !known.has(g.id))]),
          groupsCursor: page.cursor ?? null,
        };
      });
    } catch (err) {
      fail(err);
    }
  }, [patch, fail]);

  const handlePacket = useCallback(
    (packet: ClientboundPacket) => {
      switch (packet.type) {
        case 'PlayerPresence':
          patch((s) => ({ presence: { ...s.presence, [packet.player.toLowerCase()]: packet.online } }));
          break;
        case 'SubscriptionSnapshot':
          if (packet.users?.length) {
            patch((s) => {
              const presence = { ...s.presence };
              for (const u of packet.users ?? []) presence[u.toLowerCase()] = true;
              return { presence };
            });
          }
          break;
        case 'FriendRequestReceived':
          requestNames([packet.sender]);
          void refreshRoster();
          break;
        case 'FriendRequestUpdated':
        case 'FriendRemoved':
          void refreshRoster();
          break;
        case 'GroupMessageReceived': {
          const fromMe = packet.sender.toLowerCase() === meRef.current;
          const known = groupsRef.current.some((g) => g.id === packet.group_id);
          if (packet.idempotency_key) outbox.confirm(packet.idempotency_key);
          const last = {
            content: packet.content,
            sender: packet.sender,
            // Older servers don't send a timestamp; the phone's clock is the fallback.
            sent_at: packet.sent_at ?? new Date().toISOString(),
          };
          patch((s) => ({
            groups: sortGroups(
              withLastMessage(s.groups, packet.group_id, last, (g) =>
                fromMe || activeGroupRef.current === g.id ? !!g.unread : true,
              ),
            ),
          }));
          // First message in a conversation we haven't seen yet.
          const id = packet.group_id;
          if (!known && !otherIdentityGroups.current.has(id) && !checkingGroups.current.has(id)) {
            checkingGroups.current.add(id);
            void refreshGroups().then((items) => {
              checkingGroups.current.delete(id);
              // Still missing after a reload: it belongs to the identity we're not showing.
              if (items && chatIdentity.delegations.length > 0 && !items.some((g) => g.id === id)) {
                otherIdentityGroups.current.add(id);
              }
            });
          }
          break;
        }
        case 'GroupMessageEdited':
        case 'GroupMessageDeleted':
          void refreshPreview(packet.group_id);
          break;
        case 'GroupRenamed':
          patch((s) => ({
            groups: s.groups.map((g) => (g.id === packet.group_id ? { ...g, name: packet.name } : g)),
          }));
          break;
        case 'PartyUpdated':
          requestNames(packet.party.members.map((m) => m.player));
          patch({ party: packet.party });
          break;
        case 'PartyMemberStateChanged':
          patch((s) =>
            s.party?.id === packet.party_id
              ? {
                  party: {
                    ...s.party,
                    members: s.party.members.map((m) =>
                      m.player.toLowerCase() === packet.player.toLowerCase() ? { ...m, state: packet.state } : m,
                    ),
                  },
                }
              : {},
          );
          break;
        case 'PartyLeft':
          patch((s) =>
            s.party?.id === packet.party_id
              ? { party: null, partyOutgoing: [], partyNotice: PARTY_LEFT_NOTICE[packet.reason] ?? null }
              : {},
          );
          break;
        case 'PartyInviteReceived':
          requestNames([packet.invite.sender]);
          patch((s) => ({
            partyIncoming: [packet.invite, ...s.partyIncoming.filter((i) => i.id !== packet.invite.id)],
          }));
          break;
        case 'PartyInviteUpdated':
          if (packet.status !== 'pending') {
            patch((s) => ({
              partyIncoming: s.partyIncoming.filter((i) => i.id !== packet.invite_id),
              partyOutgoing: s.partyOutgoing.filter((i) => i.id !== packet.invite_id),
            }));
          }
          break;
        case 'SessionInviteReceived':
        case 'SessionInviteUpdated':
          plus
            .worldInvites()
            .then((invites) => {
              requestNames(invites.map((i) => i.sender));
              patch({ worldInvites: pending(invites) });
            })
            .catch(() => undefined);
          break;
      }
    },
    [patch, refreshGroups, refreshRoster, refreshPreview],
  );

  // Connect while signed in; pause in the background to save battery.
  const shownAccount = useRef<string | null>(null);
  useEffect(() => {
    // Signed out, or switched to another account: nothing of the old one may show.
    if (shownAccount.current !== (account?.id ?? null)) {
      shownAccount.current = account?.id ?? null;
      plusSocket.stop();
      outbox.clear();
      chatIdentity.reset();
      otherIdentityGroups.current.clear();
      scannedReplies.current.clear();
      clearNames();
      activeGroupRef.current = null;
      setActiveChat(null);
      setState(initialState);
    }
    if (!account) return;
    rememberName(account.id, account.username);
    let lastSync = 0;
    const syncAll = () => {
      lastSync = Date.now();
      void refreshRoster();
      void refreshGroups();
      void refreshParty();
      void refreshDelegations();
      void refreshSpecialStatus();
    };
    const offPacket = plusSocket.onPacket(handlePacket);
    const offStatus = plusSocket.onStatus((connected) => {
      patch({ connected });
      // Catch up on anything missed while disconnected, unless we only just loaded
      // everything (the first connect right after launch).
      if (connected && Date.now() - lastSync > RESYNC_GAP_MS) syncAll();
    });
    // Our sends finish even if their chat was closed; keep the Chats list preview current.
    const offSent = outbox.onSettled((result) => {
      if (!('message' in result)) return;
      const { content, sender, sent_at } = result.message;
      patch((s) => ({ groups: sortGroups(withLastMessage(s.groups, result.groupId, { content, sender, sent_at })) }));
    });
    plusSocket.start();
    void refreshRequestCounts();
    syncAll();
    plus
      .status()
      .then((myStatus) => patch({ myStatus }))
      .catch(() => undefined);

    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        // Requests that arrived while the socket was paused show up on the badge at once.
        void refreshRequestCounts();
        plusSocket.start();
      }
      else if (next === 'background') plusSocket.stop();
    });

    return () => {
      offPacket();
      offStatus();
      offSent();
      appState.remove();
      plusSocket.stop();
    };
  }, [account, handlePacket, patch, refreshGroups, refreshRoster, refreshParty, refreshRequestCounts, refreshDelegations, refreshSpecialStatus]);

  // Switching "Chat as" shows the other identity's conversations (PolyPlus resets its groups too).
  const shownIdentity = useRef(identity.actAs);
  useEffect(() => {
    if (shownIdentity.current === identity.actAs) return;
    shownIdentity.current = identity.actAs;
    otherIdentityGroups.current.clear();
    scannedReplies.current.clear();
    activeGroupRef.current = null;
    setActiveChat(null);
    patch({ groups: [], groupsCursor: null, activeGroupId: null, specialTarget: false, responded: [] });
    if (account) {
      void refreshGroups();
      void refreshSpecialStatus();
    }
  }, [identity.actAs, account, patch, refreshGroups, refreshSpecialStatus]);

  // Watch presence of friends and DM partners.
  useEffect(() => {
    const watched = new Set(state.friends.map((f) => f.player));
    for (const g of state.groups) if (g.kind === 'dm') for (const m of g.members) watched.add(m);
    for (const m of state.party?.members ?? []) watched.add(m.player);
    if (me) watched.delete(me);
    if (account) watched.delete(account.id.toLowerCase());
    plusSocket.setWatched([...watched]);
  }, [state.friends, state.groups, state.party, me, account]);

  const value = useMemo<SocialContextValue>(
    () => ({
      ...state,
      // With the staff tools off, nothing below shows them.
      specialTarget: specialFeatures && state.specialTarget,
      hasSpecialFeatures: identity.delegations.length > 0 || state.specialTarget,
      specialFeatures,
      actAs: specialFeatures ? identity.actAs : null,
      delegations: specialFeatures ? identity.delegations : [],
      selfId: (specialFeatures ? identity.actAs : null) ?? account?.id ?? '',
      chatAs: (owner) => chatIdentity.switchTo(owner),
      refreshDelegations,
      scanReplies,
      claimSpecialChat: async (groupId) => {
        const group = await plus.claimSpecialChat(groupId);
        requestNames(group.members);
        patch((s) => ({ groups: sortGroups(s.groups.map((g) => (g.id === group.id ? group : g))) }));
        void refreshSpecialStatus();
      },
      refreshParty,
      setParty: (party) => {
        if (party) requestNames(party.members.map((m) => m.player));
        patch({ party });
      },
      dismissPartyNotice: () => patch({ partyNotice: null }),
      refreshRoster,
      refreshGroups,
      refreshPreview,
      loadMoreGroups,
      setActiveGroup: (id) => {
        activeGroupRef.current = id;
        setActiveChat(id);
        patch({ activeGroupId: id });
      },
      markGroupRead: (id) =>
        patch((s) => ({ groups: s.groups.map((g) => (g.id === id ? { ...g, unread: false } : g)) })),
      upsertGroup: (group) => {
        requestNames(group.members);
        patch((s) => {
          const exists = s.groups.some((g) => g.id === group.id);
          const groups = exists ? s.groups.map((g) => (g.id === group.id ? { ...g, ...group } : g)) : [group, ...s.groups];
          return { groups: sortGroups(groups) };
        });
      },
      removeGroup: (id) => patch((s) => ({ groups: s.groups.filter((g) => g.id !== id) })),
      setMyStatus: async (status) => {
        await plus.setStatus(status);
        patch({ myStatus: status });
      },
      isOnline: (player) => !!state.presence[player.toLowerCase()],
      stateOf: (player) =>
        state.party?.members.find((m) => m.player.toLowerCase() === player.toLowerCase())?.state ?? undefined,
    }),
    [state, identity, specialFeatures, account, refreshDelegations, scanReplies, refreshSpecialStatus, refreshParty, refreshRoster, refreshGroups, refreshPreview, loadMoreGroups, patch],
  );

  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}

export function useSocial(): SocialContextValue {
  const ctx = useContext(SocialContext);
  if (!ctx) throw new Error('useSocial must be used inside SocialProvider');
  return ctx;
}

/** Subscribe a screen to raw websocket packets. */
export function usePackets(listener: (packet: ClientboundPacket) => void) {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => plusSocket.onPacket((p) => ref.current(p)), []);
}
