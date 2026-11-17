// Shapes of the PolyPlus backend, from PolyPlus `network/http/responses/*`
// and OneLauncher `oneclient_polyplus/src/models.rs`. UUIDs are dashed strings.

export type RelationshipKind = 'friend' | 'best_friend' | 'unknown';
export type PlayerStatus = 'online' | 'offline';
export type GroupKind = 'dm' | 'group' | 'party' | 'unknown';

export interface CursorPage<T> {
  items: T[];
  cursor?: string | null;
}

export interface Friend {
  player: string;
  kind: RelationshipKind;
  since: string;
  online?: boolean;
  status?: PlayerStatus | 'unknown';
}

export interface FriendRequest {
  id: number;
  player: string;
  created_at: string;
}

export interface BlockedPlayer {
  player: string;
  since: string;
}

export interface LastMessage {
  content: string;
  sender: string;
  sent_at: string;
}

export interface GroupSummary {
  id: number;
  kind: GroupKind;
  name?: string | null;
  members: string[];
  last_message?: LastMessage | null;
  unread?: boolean;
  /** The Polyfrost "Special Chat": fixed members, one message per 72 hours. */
  special?: boolean;
  /** Special Chat whose last message is ours, i.e. waiting on staff. */
  awaiting_reply?: boolean;
}

/** GET /special-chat. Calling it creates the group if the player has none. */
export interface SpecialChatStatus {
  group_id: number | null;
  /** When the next message may be sent; in the past (or null) means now. */
  cooldown_until: string | null;
  is_special_chat_target: boolean;
}

export interface SessionInvite {
  id: number;
  session_id: string;
  status: string;
}

export interface GroupMessage {
  id: number;
  sender: string;
  content: string;
  sent_at: string;
  edited_at?: string | null;
  session_invite?: SessionInvite | null;
}

// ---- Parties (PolyPlus `PartyModels.kt`) ----

export type LocationKind = 'menu' | 'singleplayer' | 'server' | 'hosted_world' | 'unknown';

export interface MemberState {
  location?: { kind?: LocationKind; key?: string | null; display?: string | null };
  voice?: { in_voice?: boolean; muted?: boolean; deafened?: boolean };
}

export interface PartyMember {
  player: string;
  joined_at?: string | null;
  online?: boolean;
  voice_hard_muted?: boolean;
  state?: MemberState | null;
}

export type PartyInvitePolicy = 'leader' | 'members';
/** party = everyone in the party hears each other; proximity = only players nearby in-game. */
export type PartyVoiceMode = 'party' | 'proximity';

export interface PartySettings {
  voice_mode?: PartyVoiceMode | string;
  invite_policy?: PartyInvitePolicy | string;
}

/** GET /v1/social/requests/counts */
export interface RequestCounts {
  incoming: number;
  outgoing: number;
}

/** GET /account/links. Discord is the only provider today. */
export interface LinkedAccount {
  provider: 'discord' | string;
  provider_user_id: string;
  username?: string | null;
  linked_at: string;
}

export interface Party {
  id: string;
  leader: string;
  created_at?: string | null;
  settings?: PartySettings;
  chat_group_id?: number | null;
  members: PartyMember[];
}

export type PartyInviteStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired' | string;

export interface PartyInvite {
  id: string;
  party_id: string;
  sender: string;
  recipient: string;
  status?: PartyInviteStatus;
  created_at?: string | null;
  expires_at?: string | null;
  party_size?: number;
}

/** "Join my world" invite from a player hosting a world in OneClient (PolyPlus `SessionModels.kt`). */
export interface WorldInvite {
  id: number;
  session_id: string;
  sender: string;
  created_at: string;
  status?: string;
  minecraft_version?: string | null;
  loader?: string | null;
}

export interface ResolvedPlayer {
  id: string;
  username: string;
}

/** Websocket packets the app reacts to (discriminated by `type`). */
export type ClientboundPacket =
  | { type: 'Error'; error_code: string; message: string; request_id?: number }
  | { type: 'PlayerPresence'; player: string; online: boolean; status?: string }
  | { type: 'SubscriptionSnapshot'; users?: string[] }
  | { type: 'FriendRequestReceived'; request_id: number; sender: string }
  | { type: 'FriendRequestUpdated'; request_id: number; status: string }
  | { type: 'FriendRemoved'; player: string }
  | {
      type: 'GroupMessageReceived';
      group_id: number;
      message_id: number;
      sender: string;
      content: string;
      session_invite_id?: number | null;
      session_invite_status?: string | null;
      /** Server time of the message. Missing from older servers. */
      sent_at?: string;
      /** The sender's idempotency key, so the sender's own devices can match their pending send. */
      idempotency_key?: string | null;
    }
  | {
      type: 'GroupMessageEdited';
      group_id: number;
      message_id: number;
      content: string;
      session_invite_status?: string | null;
    }
  | { type: 'GroupMessageDeleted'; group_id: number; message_id: number }
  | { type: 'GroupRenamed'; group_id: number; name: string }
  | { type: 'SessionInviteReceived'; invite_id: number; session_id: string; sender: string }
  | { type: 'SessionInviteUpdated'; invite_id: number; status: string }
  | { type: 'PartyUpdated'; party: Party }
  | { type: 'PartyMemberStateChanged'; party_id: string; player: string; state: MemberState }
  | { type: 'PartyLeft'; party_id: string; reason: 'left' | 'kicked' | 'disbanded' | 'expired' | string }
  | { type: 'PartyInviteReceived'; invite: PartyInvite }
  | { type: 'PartyInviteUpdated'; invite_id: string; status: PartyInviteStatus };
