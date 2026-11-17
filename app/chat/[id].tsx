import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, Text, View, type AlertButton, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// React Native's own KeyboardAvoidingView doesn't move content on Android with
// edge-to-edge (Expo's default), which left the message box under the keyboard.
import { KeyboardAvoidingView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useHeaderHeight } from '@react-navigation/elements';
import { plus } from '@/api/plus';
import type { GroupMessage } from '@/api/types';
import { Ionicons } from '@expo/vector-icons';
import { describeLocation, dmPartner, groupTitle, timeLeft } from '@/lib/format';
import { alert } from '@/lib/dialog';
import { renderEmoji } from '@/lib/emoji';
import { errorMessage } from '@/lib/http';
import { outbox, useOutbox } from '@/state/outbox';
import { requestNames, usePlayerNames } from '@/state/players';
import { usePackets, useSocial } from '@/state/social';
import { ChatNotice, Composer, MessageList, type ChatMessage } from '@/ui/chat';
import { Avatar, ErrorBanner, GroupAvatar, IconButton } from '@/ui/components';
import { makeStyles, spacing, type, useTheme } from '@/ui/theme';

const PAGE = 50;
/** After a reconnect, fetch at most this many pages to fill in missed messages. */
const MAX_CATCHUP_PAGES = 10;
/** Backend `SPECIAL_CHAT_COOLDOWN_SECS`. */
const SPECIAL_COOLDOWN_MS = 72 * 60 * 60 * 1000;

/**
 * Keeps the message box just above the keyboard.
 *
 * Android: the chat screen always reaches the bottom of the screen (no tab
 * bar), so the space to leave is simply the keyboard's height. The library's
 * KeyboardAvoidingView works it out from the screen's measured position plus
 * the header offset instead, which comes out far too big with edge-to-edge
 * and left a big gap above the keyboard. iOS keeps the KeyboardAvoidingView.
 */
function ChatKeyboardView({
  style,
  headerHeight,
  children,
}: {
  style: StyleProp<ViewStyle>;
  headerHeight: number;
  children: ReactNode;
}) {
  if (Platform.OS === 'android') return <AndroidKeyboardView style={style}>{children}</AndroidKeyboardView>;
  return (
    <KeyboardAvoidingView style={style} behavior="padding" keyboardVerticalOffset={headerHeight}>
      {children}
    </KeyboardAvoidingView>
  );
}

function AndroidKeyboardView({ style, children }: { style: StyleProp<ViewStyle>; children: ReactNode }) {
  const keyboard = useReanimatedKeyboardAnimation();
  const insets = useSafeAreaInsets();
  const bottom = insets.bottom;
  // `height` runs from 0 to minus the keyboard's height. The keyboard also
  // covers the navigation bar, which the composer already pads for, so swap
  // that padding for a small gap while it's open.
  const lift = useAnimatedStyle(
    () => ({
      paddingBottom: Math.max(0, -keyboard.height.value + keyboard.progress.value * (spacing.sm - bottom)),
    }),
    [bottom],
  );
  return <Animated.View style={[style, lift]}>{children}</Animated.View>;
}

const confirmSpecialSend = () =>
  new Promise<boolean>((resolve) =>
    alert('Send this message?', "Special Chat allows one message every 3 days, so you won't be able to send another until then.", [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Send', onPress: () => resolve(true) },
    ]),
  );

const toChat = (m: GroupMessage): ChatMessage => ({
  id: m.id,
  sender: m.sender,
  content: m.content,
  sent_at: m.sent_at,
  edited_at: m.edited_at,
  inviteStatus: m.session_invite?.status ?? null,
});

export default function ChatScreen() {
  const c = useTheme();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = Number(id);
  const router = useRouter();
  const social = useSocial();
  // Yourself, or the player you're chatting as ("Chat as").
  const me = social.selfId;
  const name = usePlayerNames();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const group = social.groups.find((g) => g.id === groupId);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [older, setOlder] = useState({ loading: false, done: false });
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const pending = useOutbox(groupId);
  const lastReadRef = useRef(0);
  // Context callbacks are recreated on every store update; keep them out of effect deps.
  const socialRef = useRef(social);
  socialRef.current = social;

  // Special Chat: one message per 72 hours, shared across every Special Chat group.
  const special = group?.special === true;
  // Chatting as a Special Chat target (staff answering): no cooldown applies.
  const [answering, setAnswering] = useState(false);
  const limited = special && !answering;
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const locked = limited && cooldownUntil !== null && cooldownUntil > now;

  const refreshCooldown = useCallback(async () => {
    try {
      const status = await plus.specialChat();
      setAnswering(status.is_special_chat_target);
      const until = status.cooldown_until ? Date.parse(status.cooldown_until) : NaN;
      setCooldownUntil(Number.isNaN(until) ? null : until);
      setNow(Date.now());
    } catch {
      // Not fatal: the server still enforces the cooldown when sending.
    }
  }, []);

  useEffect(() => {
    if (special) void refreshCooldown();
  }, [special, refreshCooldown]);

  // Tick the countdown, and unlock the composer when it runs out.
  useEffect(() => {
    if (!locked) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [locked]);

  const merge = useCallback((incoming: ChatMessage[]) => {
    requestNames(incoming.map((m) => m.sender));
    setMessages((current) => {
      const byId = new Map(current.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, { ...byId.get(m.id), ...m });
      return [...byId.values()].sort((a, b) => b.id - a.id);
    });
  }, []);

  const markRead = useCallback(
    (messageId: number) => {
      if (messageId <= lastReadRef.current) return;
      lastReadRef.current = messageId;
      socialRef.current.markGroupRead(groupId);
      plus.markRead(groupId, messageId).catch(() => undefined);
    },
    [groupId],
  );

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  /**
   * Loads the newest page. With `catchUpFrom` (the newest message we had before
   * a disconnect), keeps paging back until it meets that message, so a long
   * disconnect doesn't leave a hole that "load older" would page right past.
   */
  const load = useCallback(
    async (catchUpFrom?: number) => {
      setError(null);
      try {
        let page = await plus.messages(groupId, undefined, PAGE);
        const fetched = [...page];
        const oldestOf = (p: GroupMessage[]) => Math.min(...p.map((m) => m.id));
        const gapRemains = () => !!catchUpFrom && page.length === PAGE && oldestOf(page) > catchUpFrom;
        for (let pages = 1; gapRemains() && pages < MAX_CATCHUP_PAGES; pages++) {
          page = await plus.messages(groupId, oldestOf(page), PAGE);
          fetched.push(...page);
        }
        if (gapRemains()) {
          // Too much was missed to fill in. Drop what's older than the hole so the
          // list stays continuous and "load older" picks up from here.
          const cutoff = oldestOf(fetched);
          setMessages((current) => current.filter((m) => m.id >= cutoff));
          setOlder({ loading: false, done: false });
        } else if (!catchUpFrom) {
          setOlder({ loading: false, done: page.length < PAGE });
        }
        merge(fetched.map(toChat));
        const newest = Math.max(0, ...fetched.map((m) => m.id));
        if (newest) markRead(newest);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [groupId, merge, markRead],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Reload after a reconnect to catch messages missed while offline. Only on the
  // change to connected, not on mount (the load above already covers that).
  // Remember the newest message at the moment we went offline: live messages
  // arriving on the new connection are newer and mustn't count as caught up.
  const wasConnected = useRef(social.connected);
  const newestAtDisconnect = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!social.connected && wasConnected.current) newestAtDisconnect.current = messagesRef.current[0]?.id;
    if (social.connected && !wasConnected.current) void load(newestAtDisconnect.current);
    wasConnected.current = social.connected;
  }, [social.connected, load]);

  // Tell the store this conversation is open so live messages don't flag it unread.
  useEffect(() => {
    socialRef.current.setActiveGroup(groupId);
    return () => socialRef.current.setActiveGroup(null);
  }, [groupId]);

  usePackets((packet) => {
    switch (packet.type) {
      case 'GroupMessageReceived':
        if (packet.group_id !== groupId) return;
        // (A copy of our own send is matched to the outbox by idempotency key in the social store.)
        merge([
          {
            id: packet.message_id,
            sender: packet.sender,
            content: packet.content,
            // Older servers don't send a timestamp; the phone's clock is the fallback.
            sent_at: packet.sent_at ?? new Date().toISOString(),
            inviteStatus: packet.session_invite_id != null ? (packet.session_invite_status ?? 'pending') : null,
          },
        ]);
        markRead(packet.message_id);
        break;
      case 'GroupMessageEdited':
        if (packet.group_id !== groupId) return;
        setMessages((current) =>
          current.map((m) =>
            m.id === packet.message_id
              ? {
                  ...m,
                  content: packet.content,
                  edited_at: new Date().toISOString(),
                  inviteStatus: packet.session_invite_status ?? m.inviteStatus,
                }
              : m,
          ),
        );
        break;
      case 'GroupMessageDeleted':
        if (packet.group_id !== groupId) return;
        setMessages((current) => current.filter((m) => m.id !== packet.message_id));
        break;
    }
  });

  const loadOlder = async () => {
    if (older.loading || older.done || messages.length === 0) return;
    setOlder({ loading: true, done: false });
    try {
      const page = await plus.messages(groupId, messages[messages.length - 1].id, PAGE);
      merge(page.map(toChat));
      setOlder({ loading: false, done: page.length < PAGE });
    } catch (err) {
      setError(errorMessage(err));
      setOlder({ loading: false, done: false });
    }
  };

  // Sends run in the outbox (they finish even if you leave); show their results while we're here.
  // The social store updates the Chats list preview.
  useEffect(
    () =>
      outbox.onSettled((result) => {
        if (result.groupId !== groupId) return;
        if ('message' in result) {
          merge([toChat(result.message)]);
          lastReadRef.current = Math.max(lastReadRef.current, result.message.id);
          setError(null);
        } else {
          setError(result.error);
        }
        if (special) void refreshCooldown();
      }),
    [groupId, merge, special, refreshCooldown],
  );

  /** Lock Special Chat straight away; the server's answer corrects it either way. */
  const lockSpecial = () => {
    if (!limited) return;
    setCooldownUntil(Date.now() + SPECIAL_COOLDOWN_MS);
    setNow(Date.now());
  };

  const send = async (text: string) => {
    if (editing) {
      try {
        const updated = await plus.editMessage(groupId, editing.id, text);
        merge([toChat(updated)]);
        setEditing(null);
        setError(null);
      } catch (err) {
        setError(errorMessage(err));
        throw err; // keeps the edit in the composer
      }
      return;
    }
    // Throwing keeps the draft in the composer.
    if (limited && !(await confirmSpecialSend())) throw new Error('cancelled');
    lockSpecial();
    outbox.send(groupId, text);
  };

  const onPressMessage = (message: ChatMessage) => {
    if (message.status !== 'failed') return;
    const item = pending.find((x) => x.id === message.id);
    if (!item) return;
    alert('Message not sent', item.content, [
      {
        text: 'Retry',
        onPress: () => {
          lockSpecial();
          outbox.retry(item.key);
        },
      },
      { text: 'Delete', style: 'destructive', onPress: () => outbox.discard(item.key) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // Unconfirmed messages sit at the bottom, newest first like the rest of the inverted list.
  const shown: ChatMessage[] = [
    ...[...pending].reverse().map((x) => ({ id: x.id, sender: me, content: x.content, sent_at: x.sent_at, status: x.status })),
    ...messages,
  ];

  const onLongPress = (message: ChatMessage) => {
    if (message.status === 'failed') return onPressMessage(message);
    if (message.status) return;
    const mine = message.sender.toLowerCase() === me.toLowerCase();
    const isInvite = message.inviteStatus != null;
    const actions: AlertButton[] = [];
    // Android 13+ confirms the copy itself with a system popup.
    if (message.content) actions.push({ text: 'Copy text', onPress: () => void Clipboard.setStringAsync(renderEmoji(message.content)) });
    if (mine && !isInvite) {
      actions.push(
        { text: 'Edit', onPress: () => setEditing(message) },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            plus
              .deleteMessage(groupId, message.id)
              .then(() => setMessages((current) => current.filter((m) => m.id !== message.id)))
              .catch((err) => setError(errorMessage(err))),
        },
      );
    }
    if (!actions.length) return;
    // No message body, so it opens as a bottom sheet with the text as its title.
    const shownText = renderEmoji(message.content);
    const preview = shownText.length > 80 ? `${shownText.slice(0, 80)}…` : shownText;
    alert(preview || 'Message', undefined, [...actions, { text: 'Cancel', style: 'cancel' }]);
  };

  const partner = group ? dmPartner(group, me) : undefined;
  const title = group ? groupTitle(group, me, name) : 'Conversation';
  const shared = group ? group.kind !== 'dm' : true;

  return (
    <ChatKeyboardView style={{ flex: 1, backgroundColor: c.surface }} headerHeight={headerHeight}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Pressable
              disabled={!group || !shared}
              onPress={() => router.push(`/group/${groupId}`)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 240 }}
            >
              {partner ? <Avatar uuid={partner} size={32} online={social.isOnline(partner)} /> : <GroupAvatar size={32} icon={special ? 'star' : 'people'} />}
              <View style={{ flexShrink: 1 }}>
                <Text numberOfLines={1} style={{ color: c.onSurface, ...type.titleMedium }}>
                  {title}
                </Text>
                <Text numberOfLines={1} style={{ color: c.onSurfaceVariant, ...type.bodySmall }}>
                  {partner
                    ? describeLocation(social.stateOf(partner), social.isOnline(partner))
                    : special
                      ? 'Special Chat'
                      : group
                        ? `${group.members.length} members`
                        : ''}
                </Text>
              </View>
            </Pressable>
          ),
          headerRight: () =>
            group && shared ? (
              <IconButton icon="information-circle-outline" label="Group info" onPress={() => router.push(`/group/${groupId}`)} />
            ) : null,
        }}
      />
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      <MessageList
        messages={shown}
        me={me}
        name={name}
        showSenders={shared}
        onPress={onPressMessage}
        onLongPress={onLongPress}
        onLoadOlder={loadOlder}
        loadingOlder={older.loading}
        // Goes away on its own as soon as anyone sends something (including us, via the outbox).
        empty={loading || error || pending.length ? undefined : <ChatNotice text="No messages yet. Say hello! 👋" />}
      />
      {locked && !editing ? (
        <View style={[styles.notice, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Ionicons name="time-outline" size={20} color={c.onSecondaryContainer} />
          <Text style={styles.noticeText}>
            You can send another message in {timeLeft(cooldownUntil!, now)}. Replies still show up here.
          </Text>
        </View>
      ) : (
        <>
          {limited && !editing && (
            <View style={styles.hint}>
              <Ionicons name="information-circle-outline" size={16} color={c.onSurfaceVariant} />
              <Text style={styles.hintText}>One message every 3 days. Put everything in a single message.</Text>
            </View>
          )}
          <Composer
            key={editing ? `edit:${editing.id}` : 'new'}
            initialText={editing?.content ?? ''}
            editing={!!editing}
            onCancelEdit={() => setEditing(null)}
            placeholder={partner ? `Message ${name(partner)}` : 'Message'}
            onSend={send}
          />
        </>
      )}
    </ChatKeyboardView>
  );
}

const useStyles = makeStyles((c) => ({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: c.secondaryContainer,
  },
  noticeText: { color: c.onSecondaryContainer, ...type.bodyMedium, flex: 1 },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 2,
    backgroundColor: c.surfaceContainer,
  },
  hintText: { color: c.onSurfaceVariant, ...type.bodySmall, flex: 1 },
}));
