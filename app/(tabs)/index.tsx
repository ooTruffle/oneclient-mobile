import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
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

type SectionKey = 'pinned' | 'dm' | 'group' | 'party' | 'all';

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
  const pins = usePins(account.id);
  const [bySection] = usePref(PREFS.chatSections, true);
  const [collapsed, setCollapsed] = usePref<SectionKey[]>(PREFS.collapsedSections, NONE_COLLAPSED);

  const preview = (g: GroupSummary) => {
    const last = g.last_message;
    if (!last) return 'No messages yet';
    const who = last.sender.toLowerCase() === account.id.toLowerCase() ? 'You' : name(last.sender);
    const body = last.content ? renderEmoji(last.content) : 'World invite';
    // Special Chat members are just you and staff, so a last message from you means it's their turn.
    if (g.special && who === 'You') return `Waiting for a reply · ${body}`;
    return g.kind === 'dm' && who !== 'You' ? body : `${who}: ${body}`;
  };

  // Each section keeps the store's newest-activity order.
  const sections = useMemo<ChatSection[]>(() => {
    const pinned = social.groups.filter((g) => pins.pinned.has(g.id));
    const rest = social.groups.filter((g) => !pins.pinned.has(g.id));
    const make = (key: SectionKey, title: string, all: GroupSummary[]): ChatSection => ({
      key,
      title,
      all,
      data: bySection && collapsed.includes(key) ? [] : all,
    });
    if (!bySection) return [make('all', '', [...pinned, ...rest])];
    return [
      make('pinned', 'Pinned', pinned),
      ...TYPE_SECTIONS.map((s) => make(s.key, s.title, rest.filter((g) => g.kind === s.key))),
    ].filter((s) => s.all.length > 0);
  }, [social.groups, pins.pinned, bySection, collapsed]);

  const toggleSection = (key: SectionKey) =>
    setCollapsed(collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key]);

  const actions = (g: GroupSummary) => {
    const pinned = pins.isPinned(g.id);
    alert(groupTitle(g, account.id, name), undefined, [
      { text: pinned ? 'Unpin' : 'Pin to top', onPress: () => pins.toggle(g.id) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={{ flex: 1 }}>
      {social.error && <ErrorBanner message={social.error} onRetry={social.refreshGroups} />}
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
            <SectionToggle
              title={section.title}
              count={section.all.length}
              unread={section.all.filter((g) => g.unread).length}
              open={!collapsed.includes(section.key)}
              onPress={() => toggleSection(section.key)}
            />
          )
        }
        renderItem={({ item }) => {
          const partner = dmPartner(item, account.id);
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
              title={groupTitle(item, account.id, name)}
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
      <Pressable
        accessibilityLabel="New group"
        onPress={() => router.push('/new-group')}
        android_ripple={ripple(c.onPrimaryContainer)}
        style={({ pressed }) => [styles.fab, pressed && Platform.OS !== 'android' && { opacity: 0.9 }]}
      >
        <Ionicons name="create-outline" size={24} color={c.onPrimaryContainer} />
      </Pressable>
    </View>
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
