import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, RefreshControl, SectionList, Text, View } from 'react-native';
import type { GroupSummary } from '@/api/types';
import { alert } from '@/lib/dialog';
import { renderEmoji } from '@/lib/emoji';
import { dmPartner, groupTitle, relativeTime } from '@/lib/format';
import { useAccount } from '@/state/auth';
import { usePins } from '@/state/pins';
import { usePlayerNames } from '@/state/players';
import { PREFS, usePref } from '@/state/prefs';
import { useSocial } from '@/state/social';
import { Avatar, Badge, EmptyState, ErrorBanner, GroupAvatar, ripple, Row } from '@/ui/components';
import { makeStyles, radius, spacing, type, useTheme } from '@/ui/theme';

type SectionKey = 'pinned' | 'dm' | 'group' | 'party' | 'all' | 'special';

/** PolyPlus's reply filter for Special Chat targets: has the player sent anything yet? */
type ReplyFilter = 'all' | 'awaiting' | 'responded';
const REPLY_FILTERS: { key: ReplyFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'awaiting', label: 'Awaiting' },
  { key: 'responded', label: 'Responded' },
];

interface ChatSection {
  key: SectionKey;
  title: string;
  /** Every chat in the section, even while collapsed (for the counts). */
  all: GroupSummary[];
  data: GroupSummary[];
}

const TYPE_SECTIONS: { key: Exclude<SectionKey, 'pinned' | 'all'>; title: string }[] = [
  { key: 'dm', title: 'Direct messages' },
  { key: 'group', title: 'Groups' }, // Special Chat included
  { key: 'party', title: 'Party' },
];

// Stable fallback: usePref compares snapshots by identity.
const NONE_COLLAPSED: SectionKey[] = [];

export default function ChatsScreen() {
  const c = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const account = useAccount();
  const social = useSocial();
  const name = usePlayerNames();
  // Yourself, or the player you're chatting as ("Chat as").
  const me = social.selfId;
  const pins = usePins(account.id);
  const [bySection] = usePref(PREFS.chatSections, true);
  const [collapsed, setCollapsed] = usePref<SectionKey[]>(PREFS.collapsedSections, NONE_COLLAPSED);
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>('all');
  const [unreadFirst, setUnreadFirst] = usePref(PREFS.specialUnreadFirst, false);
  const chooseReplyFilter = (filter: ReplyFilter) => {
    setReplyFilter(filter);
    if (filter !== 'all') void social.scanReplies();
  };

  const preview = (g: GroupSummary) => {
    const last = g.last_message;
    if (!last) return 'No messages yet';
    const who = last.sender.toLowerCase() === me.toLowerCase() ? 'You' : name(last.sender);
    const body = last.content ? renderEmoji(last.content) : 'World invite';
    // Special Chat members are just you and staff, so a last message from you means it's their turn.
    // (Answering as staff it's the other way round; the server says which.)
    if (g.special && social.specialTarget) return g.awaiting_reply ? `Awaiting your reply · ${body}` : `${who}: ${body}`;
    if (g.special && who === 'You') return `Waiting for a reply · ${body}`;
    return g.kind === 'dm' && who !== 'You' ? body : `${who}: ${body}`;
  };

  // Each section keeps the store's newest-activity order.
  const sections = useMemo<ChatSection[]>(() => {
    // Special Chat targets see every player's Special Chat, so (like PolyPlus)
    // those get a section of their own instead of filling up Groups.
    const apart = (g: GroupSummary) => social.specialTarget && !!g.special;
    const responded = new Set(social.responded);
    const specials = social.groups.filter(apart);
    const filtered =
      replyFilter === 'all' ? specials : specials.filter((g) => responded.has(g.id) === (replyFilter === 'responded'));
    // Partitioned rather than sorted, so each half keeps the newest-activity order.
    const shownSpecials = unreadFirst
      ? [...filtered.filter((g) => g.unread), ...filtered.filter((g) => !g.unread)]
      : filtered;
    const special: ChatSection[] = specials.length
      ? [{ key: 'special', title: 'Special Chat', all: specials, data: collapsed.includes('special') ? [] : shownSpecials }]
      : [];
    const mine = social.groups.filter((g) => !apart(g));
    const pinned = mine.filter((g) => pins.pinned.has(g.id));
    const rest = mine.filter((g) => !pins.pinned.has(g.id));
    const make = (key: SectionKey, title: string, all: GroupSummary[]): ChatSection => ({
      key,
      title,
      all,
      data: bySection && collapsed.includes(key) ? [] : all,
    });
    if (!bySection) return [make('all', '', [...pinned, ...rest]), ...special];
    return [
      make('pinned', 'Pinned', pinned),
      ...TYPE_SECTIONS.map((s) => make(s.key, s.title, rest.filter((g) => g.kind === s.key))),
      ...special,
    ].filter((s) => s.all.length > 0);
  }, [social.groups, social.specialTarget, social.responded, replyFilter, unreadFirst, pins.pinned, bySection, collapsed]);

  const toggleSection = (key: SectionKey) =>
    setCollapsed(collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key]);

  const actions = (g: GroupSummary) => {
    const pinned = pins.isPinned(g.id);
    alert(groupTitle(g, me, name), undefined, [
      { text: pinned ? 'Unpin' : 'Pin to top', onPress: () => pins.toggle(g.id) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={{ flex: 1 }}>
      {social.error && <ErrorBanner message={social.error} onRetry={social.refreshGroups} />}
      {social.delegations.length > 0 && <ChatAsPicker />}
      <SectionList
        sections={sections}
        keyExtractor={(g) => String(g.id)}
        stickySectionHeadersEnabled={false}
        // Room for the + button, so it never covers the last chat.
        contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={
          <RefreshControl
            refreshing={social.loading.groups}
            onRefresh={social.refreshGroups}
            tintColor={c.primary}
            colors={[c.primary]}
            progressBackgroundColor={c.surfaceContainerHigh}
          />
        }
        onEndReached={social.loadMoreGroups}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          social.loading.groups || social.groups.length > 0 ? null : (
            <EmptyState
              icon="chatbubbles-outline"
              title="No conversations yet"
              detail="Message a friend from the Friends tab, or start a group with the + button."
            />
          )
        }
        renderSectionHeader={({ section }) =>
          section.key === 'all' ? null : (
            <View>
              <SectionToggle
                title={section.title}
                count={section.all.length}
                unread={section.all.filter((g) => g.unread).length}
                open={!collapsed.includes(section.key)}
                onPress={() => toggleSection(section.key)}
              />
              {section.key === 'special' && !collapsed.includes('special') && (
                <View style={styles.replyFilters}>
                  {REPLY_FILTERS.map((f) => {
                    const selected = f.key === replyFilter;
                    return (
                      <Pressable
                        key={f.key}
                        onPress={() => chooseReplyFilter(f.key)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        android_ripple={ripple(c.onSurface)}
                        style={[styles.replyChip, selected && styles.replyChipSelected]}
                      >
                        <Text style={[styles.replyChipText, selected && styles.replyChipTextSelected]}>{f.label}</Text>
                      </Pressable>
                    );
                  })}
                  <Pressable
                    onPress={() => setUnreadFirst(!unreadFirst)}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: unreadFirst }}
                    accessibilityLabel="Sort unread first"
                    android_ripple={ripple(c.onSurface)}
                    style={[styles.replyChip, styles.sortChip, unreadFirst && styles.replyChipSelected]}
                  >
                    <Ionicons
                      name={unreadFirst ? 'checkmark' : 'swap-vertical'}
                      size={16}
                      color={unreadFirst ? c.onSecondaryContainer : c.onSurfaceVariant}
                    />
                    <Text style={[styles.replyChipText, unreadFirst && styles.replyChipTextSelected]}>Unread first</Text>
                  </Pressable>
                  {social.scanningReplies && <Text style={styles.replyNote}>Checking replies…</Text>}
                  {!social.scanningReplies && section.data.length === 0 && replyFilter !== 'all' && (
                    <Text style={styles.replyNote}>None</Text>
                  )}
                </View>
              )}
            </View>
          )
        }
        renderItem={({ item }) => {
          const partner = dmPartner(item, me);
          const pinned = pins.pinned.has(item.id);
          return (
            <Row
              left={
                partner ? (
                  <Avatar uuid={partner} size={48} online={social.isOnline(partner)} />
                ) : (
                  <GroupAvatar size={48} icon={item.special ? 'star' : item.kind === 'party' ? 'game-controller' : 'people'} />
                )
              }
              title={groupTitle(item, me, name)}
              badge={item.special ? 'Special' : undefined}
              subtitle={preview(item)}
              bold={item.unread}
              right={
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Text style={[styles.time, item.unread && { color: c.primary, fontWeight: '600' }]}>
                    {relativeTime(item.last_message?.sent_at)}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 14 }}>
                    {/* In the sectioned view the Pinned header already says so. */}
                    {pinned && !bySection && (
                      <Ionicons name="pin" size={14} color={c.onSurfaceVariant} accessibilityLabel="Pinned" />
                    )}
                    {item.unread && <View style={styles.unread} />}
                  </View>
                </View>
              }
              onPress={() => router.push(`/chat/${item.id}`)}
              onLongPress={() => actions(item)}
            />
          );
        }}
      />
      {/* New groups are always yours, so only offer it while chatting as yourself. */}
      {!social.actAs && <Pressable
        accessibilityLabel="New group"
        onPress={() => router.push('/new-group')}
        android_ripple={ripple(c.onPrimaryContainer)}
        style={({ pressed }) => [styles.fab, pressed && Platform.OS !== 'android' && { opacity: 0.9 }]}
      >
        <Ionicons name="create-outline" size={24} color={c.onPrimaryContainer} />
      </Pressable>}
    </View>
  );
}

/**
 * PolyPlus's "Chat as" select: only shown to players with delegations (e.g.
 * staff who answer Special Chat), switching whose conversations are shown and
 * who messages are sent as.
 */
function ChatAsPicker() {
  const c = useTheme();
  const styles = useStyles();
  const account = useAccount();
  const social = useSocial();
  const name = usePlayerNames(social.delegations as string[]);
  const current = social.actAs ? name(social.actAs) : account.username;
  const pick = () =>
    alert('Chat as', undefined, [
      { text: `${account.username} (you)`, onPress: () => social.chatAs(null) },
      ...social.delegations.map((owner) => ({ text: name(owner), onPress: () => social.chatAs(owner) })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  return (
    <Pressable
      onPress={pick}
      accessibilityRole="button"
      accessibilityLabel={`Chat as ${current}. Change`}
      android_ripple={ripple(c.onSurface)}
      style={({ pressed }) => [
        styles.chatAs,
        social.actAs && { backgroundColor: c.secondaryContainer },
        pressed && Platform.OS !== 'android' && { opacity: 0.7 },
      ]}
    >
      <Avatar uuid={social.selfId} size={28} />
      <Text style={styles.chatAsLabel}>Chat as</Text>
      <Text numberOfLines={1} style={styles.chatAsName}>
        {current}
      </Text>
      <Ionicons name="chevron-down" size={18} color={c.onSurfaceVariant} />
    </Pressable>
  );
}

/** Tappable section header that folds its chats away. */
function SectionToggle({
  title,
  count,
  unread,
  open,
  onPress,
}: {
  title: string;
  count: number;
  unread: number;
  open: boolean;
  onPress: () => void;
}) {
  const c = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${title}, ${count} chats${unread ? `, ${unread} unread` : ''}`}
      android_ripple={ripple(c.onSurface)}
      style={({ pressed }) => [styles.section, pressed && Platform.OS !== 'android' && { opacity: 0.7 }]}
    >
      <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={18} color={c.primary} />
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionCount}>{count}</Text>
      {/* Unread count only matters when you can't see the chats. */}
      {!open && unread > 0 && (
        <Badge count={unread} style={{ marginLeft: 'auto' }} />
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  time: { color: c.onSurfaceVariant, ...type.labelSmall },
  unread: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.primary },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    minHeight: 48,
  },
  sectionTitle: { color: c.primary, ...type.titleSmall },
  chatAs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceContainerHigh,
    overflow: 'hidden',
  },
  replyFilters: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  replyChip: {
    paddingHorizontal: spacing.md,
    minHeight: 32,
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: c.outlineVariant,
    overflow: 'hidden',
  },
  sortChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  replyChipSelected: { backgroundColor: c.secondaryContainer, borderColor: c.secondaryContainer },
  replyChipText: { color: c.onSurfaceVariant, ...type.labelLarge },
  replyChipTextSelected: { color: c.onSecondaryContainer },
  replyNote: { color: c.onSurfaceVariant, ...type.labelMedium },
  chatAsLabel: { color: c.onSurfaceVariant, ...type.labelLarge },
  chatAsName: { color: c.onSurface, ...type.titleSmall, flex: 1, textAlign: 'right' },
  sectionCount: { color: c.onSurfaceVariant, ...type.labelMedium },
  // M3 FAB: 56dp, large-ish corner, primary container.
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: c.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
}));
