import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { plus } from '@/api/plus';
import { alert } from '@/lib/dialog';
import { errorMessage } from '@/lib/http';
import { useAccount } from '@/state/auth';
import { usePlayerNames } from '@/state/players';
import { useSocial } from '@/state/social';
import { Avatar, Button, EmptyState, ErrorBanner, Field, IconButton, Row, SectionHeader } from '@/ui/components';
import { spacing, type, useTheme } from '@/ui/theme';

export default function GroupInfoScreen() {
  const c = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = Number(id);
  const router = useRouter();
  const account = useAccount();
  const social = useSocial();
  const group = social.groups.find((g) => g.id === groupId);
  const name = usePlayerNames(group?.members ?? []);
  const [title, setTitle] = useState(group?.name ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!group) return <EmptyState icon="help-circle-outline" title="Conversation not found" />;

  const me = social.selfId.toLowerCase();
  // The server refuses rename/leave/member changes on Special Chat, and for
  // anyone chatting as someone else ("Chat as" only covers messages).
  const editable = group.kind === 'group' && !group.special && !social.actAs;
  const members = new Set(group.members.map((m) => m.toLowerCase()));
  const invitable = social.friends.filter((f) => !members.has(f.player.toLowerCase()));

  const run = async (key: string, action: () => Promise<unknown>, after?: () => void) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      after?.();
      await social.refreshGroups();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const rename = () =>
    run('rename', () => plus.renameGroup(groupId, title.trim()), () =>
      social.upsertGroup({ ...group, name: title.trim() }),
    );

  const leave = () =>
    alert('Leave group?', "You'll stop receiving messages from this group.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () =>
          run('leave', () => plus.removeMember(groupId, account.id), () => {
            social.removeGroup(groupId);
            router.dismissAll();
          }),
      },
    ]);

  const removeMember = (player: string) =>
    alert('Remove member?', `Remove ${name(player)} from the group?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => run(`rm:${player}`, () => plus.removeMember(groupId, player)) },
    ]);

  return (
    <ScrollView style={{ backgroundColor: c.surface }} contentContainerStyle={{ paddingBottom: spacing.xl * 2 }}>
      {error && <ErrorBanner message={error} />}

      {group.special && !social.actAs && (
        <Text style={{ color: c.onSurfaceVariant, ...type.bodyMedium, padding: spacing.lg, paddingBottom: 0 }}>
          Special Chat goes straight to Polyfrost. You can send one message every 3 days, and its members can't be
          changed.
        </Text>
      )}

      {editable && (
        <>
          <SectionHeader title="Name" />
          <View style={{ flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md }}>
            <Field value={title} onChangeText={setTitle} placeholder="Group name" maxLength={64} style={{ flex: 1 }} />
            <Button
              title="Save"
              compact
              onPress={rename}
              loading={busy === 'rename'}
              disabled={!title.trim() || title.trim() === group.name}
            />
          </View>
        </>
      )}

      <SectionHeader title={`${group.members.length} members`} />
      {group.members.map((m) => {
        const isMe = m.toLowerCase() === me;
        return (
          <Row
            key={m}
            left={<Avatar uuid={m} size={40} online={isMe ? social.connected : social.isOnline(m)} />}
            title={isMe ? `${social.actAs ? name(m) : account.username} (you)` : name(m)}
            right={
              !isMe && editable ? (
                <IconButton
                  icon="remove-circle-outline"
                  color={c.error}
                  label={`Remove ${name(m)}`}
                  disabled={busy !== null}
                  onPress={() => removeMember(m)}
                />
              ) : null
            }
          />
        );
      })}

      {editable && invitable.length > 0 && (
        <>
          <SectionHeader title="Add friends" />
          {invitable.map((f) => (
            <Row
              key={f.player}
              left={<Avatar uuid={f.player} size={40} online={social.isOnline(f.player)} />}
              title={name(f.player)}
              right={
                <Button
                  title="Add"
                  compact
                  variant="secondary"
                  loading={busy === `add:${f.player}`}
                  onPress={() => run(`add:${f.player}`, () => plus.addMember(groupId, f.player))}
                />
              }
            />
          ))}
        </>
      )}

      {editable && (
        <View style={{ padding: spacing.lg }}>
          <Button title="Leave group" icon="exit-outline" variant="danger" onPress={leave} loading={busy === 'leave'} />
        </View>
      )}
    </ScrollView>
  );
}
