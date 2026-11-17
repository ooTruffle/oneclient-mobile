import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, FlatList, Platform, RefreshControl, StyleSheet, View } from 'react-native';
import { plus } from '@/api/plus';
import { alert } from '@/lib/dialog';
import { errorMessage, HttpError } from '@/lib/http';
import { describeLocation, relativeTime } from '@/lib/format';
import { useAccount } from '@/state/auth';
import { rememberName, usePlayerNames } from '@/state/players';
import { useSocial } from '@/state/social';
import { Avatar, Button, EmptyState, ErrorBanner, Field, IconButton, Row, SectionHeader, Segmented } from '@/ui/components';
import { spacing, useTheme } from '@/ui/theme';

type Tab = 'friends' | 'requests' | 'blocked';

/** Small cross-platform action sheet. */
function choose(title: string, options: { label: string; destructive?: boolean; run: () => void }[]) {
  if (Platform.OS === 'ios') {
    const destructiveIndex = options.findIndex((o) => o.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options: [...options.map((o) => o.label), 'Cancel'],
        cancelButtonIndex: options.length,
        destructiveButtonIndex: destructiveIndex >= 0 ? destructiveIndex : undefined,
      },
      (i) => options[i]?.run(),
    );
  } else {
    alert(title, undefined, [
      ...options.map((o) => ({ text: o.label, style: o.destructive ? ('destructive' as const) : undefined, onPress: o.run })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }
}

export default function FriendsScreen() {
  const c = useTheme();
  const router = useRouter();
  const account = useAccount();
  const social = useSocial();
  const name = usePlayerNames();
  const [tab, setTab] = useState<Tab>('friends');
  const [username, setUsername] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      await social.refreshRoster();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const addFriend = async () => {
    const wanted = username.trim();
    if (!wanted) return;
    setAdding(true);
    setError(null);
    try {
      const player = await plus.lookupUsername(wanted);
      if (!player) throw new Error(`No OneClient player called "${wanted}" was found.`);
      if (player.id.toLowerCase() === account.id.toLowerCase()) throw new Error("You can't add yourself.");
      rememberName(player.id, player.username);
      await plus.sendFriendRequest(player.id);
      setUsername('');
      await social.refreshRoster();
      alert('Request sent', `Friend request sent to ${player.username}.`);
    } catch (err) {
      setError(err instanceof HttpError && err.status === 409 ? 'You already have a pending request or friendship with that player.' : errorMessage(err));
    } finally {
      setAdding(false);
    }
  };

  // A ref, not state: two taps in the same frame must both see the first one.
  const openingDm = useRef(false);
  const openDm = (player: string) => {
    // Friends are yours, so their DMs are too: stop chatting as someone else first.
    const asSelf = !social.actAs;
    if (!asSelf) social.chatAs(null);
    // Reuse the DM we already know about instead of asking the server again.
    const existing = asSelf && social.groups.find(
      (g) => g.kind === 'dm' && g.members.some((m) => m.toLowerCase() === player.toLowerCase()),
    );
    if (existing) {
      router.push(`/chat/${existing.id}`);
      return;
    }
    if (openingDm.current) return;
    openingDm.current = true;
    void run(`dm:${player}`, async () => {
      const group = await plus.openDirectMessage(player);
      social.upsertGroup(group);
      router.push(`/chat/${group.id}`);
    }).finally(() => {
      openingDm.current = false;
    });
  };

  const friendActions = (player: string) =>
    choose(name(player), [
      { label: 'Message', run: () => openDm(player) },
      {
        label: 'Remove friend',
        destructive: true,
        run: () =>
          alert('Remove friend?', `${name(player)} will be removed from your friends.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => run(`rm:${player}`, () => plus.removeFriend(player)) },
          ]),
      },
      {
        label: 'Block',
        destructive: true,
        run: () =>
          alert('Block player?', `${name(player)} won't be able to message you or send requests.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Block', style: 'destructive', onPress: () => run(`block:${player}`, () => plus.block(player)) },
          ]),
      },
    ]);

  const friends = useMemo(
    () =>
      [...social.friends].sort((a, b) => {
        const online = Number(social.isOnline(b.player)) - Number(social.isOnline(a.player));
        if (online) return online;
        if (a.kind !== b.kind) return a.kind === 'best_friend' ? -1 : 1;
        return name(a.player).localeCompare(name(b.player));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [social.friends, social.presence, name],
  );
  const onlineCount = friends.filter((f) => social.isOnline(f.player)).length;

  const refresh = (
    <RefreshControl
      refreshing={social.loading.roster}
      onRefresh={social.refreshRoster}
      tintColor={c.primary} colors={[c.primary]} progressBackgroundColor={c.surfaceContainerHigh}
    />
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.add}>
        <Field
          value={username}
          onChangeText={setUsername}
          placeholder="Add friend by username"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
          onSubmitEditing={addFriend}
          style={{ flex: 1 }}
        />
        <Button title="Add" icon="person-add" compact onPress={addFriend} loading={adding} disabled={!username.trim()} />
      </View>

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'friends', label: 'Friends' },
          { value: 'requests', label: 'Requests', badge: social.incoming.length },
          { value: 'blocked', label: 'Blocked' },
        ]}
      />

      {(error ?? social.error) && <ErrorBanner message={(error ?? social.error)!} />}

      {tab === 'friends' && (
        <FlatList
          data={friends}
          keyExtractor={(f) => f.player}
          refreshControl={refresh}
          ListHeaderComponent={
            friends.length ? <SectionHeader title={`${onlineCount} online · ${friends.length} friends`} /> : null
          }
          ListEmptyComponent={
            social.loading.roster ? null : (
              <EmptyState icon="people-outline" title="No friends yet" detail="Add someone by their Minecraft username above." />
            )
          }
          renderItem={({ item }) => {
            const online = social.isOnline(item.player);
            return (
              <Row
                left={<Avatar uuid={item.player} size={44} online={online} />}
                title={name(item.player)}
                badge={item.kind === 'best_friend' ? 'Best friend' : undefined}
                subtitle={describeLocation(social.stateOf(item.player), online)}
                onPress={() => openDm(item.player)}
                onLongPress={() => friendActions(item.player)}
                right={
                  busy === `dm:${item.player}` ? (
                    <ActivityIndicator color={c.primary} style={{ width: 40 }} />
                  ) : (
                    <IconButton icon="chatbubble-outline" label={`Message ${name(item.player)}`} onPress={() => openDm(item.player)} />
                  )
                }
              />
            );
          }}
        />
      )}

      {tab === 'requests' && (
        <FlatList
          data={[
            ...social.incoming.map((r) => ({ ...r, direction: 'in' as const })),
            ...social.outgoing.map((r) => ({ ...r, direction: 'out' as const })),
          ]}
          keyExtractor={(r) => `${r.direction}:${r.id}`}
          refreshControl={refresh}
          ListEmptyComponent={<EmptyState icon="mail-open-outline" title="No pending requests" />}
          renderItem={({ item }) => (
            <Row
              left={<Avatar uuid={item.player} size={44} />}
              title={name(item.player)}
              subtitle={`${item.direction === 'in' ? 'Wants to be friends' : 'Request sent'} · ${relativeTime(item.created_at)}`}
              right={
                item.direction === 'in' ? (
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <Button
                      title="Accept"
                      compact
                      loading={busy === `accept:${item.id}`}
                      onPress={() => run(`accept:${item.id}`, () => plus.acceptRequest(item.id))}
                    />
                    <Button
                      title="Decline"
                      variant="secondary"
                      compact
                      loading={busy === `decline:${item.id}`}
                      onPress={() => run(`decline:${item.id}`, () => plus.declineRequest(item.id))}
                    />
                  </View>
                ) : (
                  <Button
                    title="Cancel"
                    variant="secondary"
                    compact
                    loading={busy === `cancel:${item.id}`}
                    onPress={() => run(`cancel:${item.id}`, () => plus.cancelRequest(item.id))}
                  />
                )
              }
            />
          )}
        />
      )}

      {tab === 'blocked' && (
        <FlatList
          data={social.blocked}
          keyExtractor={(b) => b.player}
          refreshControl={refresh}
          ListEmptyComponent={<EmptyState icon="shield-checkmark-outline" title="You haven't blocked anyone" />}
          renderItem={({ item }) => (
            <Row
              left={<Avatar uuid={item.player} size={44} />}
              title={name(item.player)}
              subtitle={`Blocked ${relativeTime(item.since)}`}
              right={
                <Button
                  title="Unblock"
                  variant="secondary"
                  compact
                  loading={busy === `unblock:${item.player}`}
                  onPress={() => run(`unblock:${item.player}`, () => plus.unblock(item.player))}
                />
              }
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  add: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.md },
});
