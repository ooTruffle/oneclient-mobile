import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { plus } from '@/api/plus';
import type { PartyInvite, PartyInvitePolicy, PartyMember, PartyVoiceMode } from '@/api/types';
import { alert } from '@/lib/dialog';
import { describeLocation, relativeTime } from '@/lib/format';
import { errorMessage, HttpError } from '@/lib/http';
import { useAccount } from '@/state/auth';
import { usePlayerNames } from '@/state/players';
import { useSocial } from '@/state/social';
import { Avatar, Button, Card, EmptyState, ErrorBanner, Row, SectionHeader, Segmented } from '@/ui/components';
import { makeStyles, spacing, type, useTheme } from '@/ui/theme';

export default function PartyScreen() {
  const c = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const account = useAccount();
  const social = useSocial();
  const name = usePlayerNames();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const me = account.id.toLowerCase();
  const party = social.party;
  const amLeader = party?.leader.toLowerCase() === me;
  const invitePolicy: PartyInvitePolicy = party?.settings?.invite_policy === 'members' ? 'members' : 'leader';
  const voiceMode: PartyVoiceMode = party?.settings?.voice_mode === 'proximity' ? 'proximity' : 'party';
  const canInvite = !party || amLeader || invitePolicy === 'members';
  const inParty = new Set(party?.members.map((m) => m.player.toLowerCase()) ?? []);
  const invited = new Set(social.partyOutgoing.map((i) => i.recipient.toLowerCase()));
  const invitable = social.friends.filter((f) => !inParty.has(f.player.toLowerCase()));

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
      void social.refreshParty();
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await social.refreshParty();
    setRefreshing(false);
  };

  const accept = (invite: PartyInvite) => {
    const doAccept = (leaveCurrent: boolean) =>
      run(`accept:${invite.id}`, async () => {
        try {
          social.setParty(await plus.acceptPartyInvite(invite.id, leaveCurrent));
        } catch (err) {
          // The server knows we're in a party even if our copy is stale.
          if (!leaveCurrent && err instanceof HttpError && err.status === 409) {
            confirmLeave();
            return;
          }
          throw err;
        }
      });
    const confirmLeave = () =>
      alert('Leave your current party?', `Joining ${name(invite.sender)}'s party will take you out of your current one.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Join', onPress: () => void doAccept(true) },
      ]);
    if (party) confirmLeave();
    else void doAccept(false);
  };

  const memberActions = (member: PartyMember) => {
    if (!amLeader || member.player.toLowerCase() === me) return;
    alert(name(member.player), undefined, [
      { text: 'Make leader', onPress: () => void run(`lead:${member.player}`, async () => social.setParty(await plus.transferLeader(member.player))) },
      { text: 'Remove from party', style: 'destructive', onPress: () => void run(`kick:${member.player}`, () => plus.kickFromParty(member.player)) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const leave = () =>
    amLeader && party && party.members.length > 1
      ? alert('Leave or disband?', 'Leaving hands the party to someone else. Disbanding ends it for everyone.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Leave party', onPress: () => void run('leave', async () => { await plus.leaveParty(); social.setParty(null); }) },
          { text: 'Disband', style: 'destructive', onPress: () => void run('leave', async () => { await plus.disbandParty(); social.setParty(null); }) },
        ])
      : alert('Leave the party?', undefined, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Leave', style: 'destructive', onPress: () => void run('leave', async () => { await plus.leaveParty(); social.setParty(null); }) },
        ]);

  const hasInvites = social.partyIncoming.length > 0 || social.worldInvites.length > 0;

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: spacing.xl * 2 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} colors={[c.primary]} progressBackgroundColor={c.surfaceContainerHigh} />}
    >
      {social.partyNotice && <ErrorBanner message={social.partyNotice} onRetry={social.dismissPartyNotice} actionLabel="Dismiss" />}
      {error && <ErrorBanner message={error} />}

      {hasInvites && <SectionHeader title="Invites" />}
      {social.partyIncoming.map((invite) => (
        <Row
          key={invite.id}
          left={<Avatar uuid={invite.sender} size={44} online={social.isOnline(invite.sender)} />}
          title={`${name(invite.sender)}'s party`}
          subtitle={`${invite.party_size ?? 1} member${invite.party_size === 1 ? '' : 's'} · ${relativeTime(invite.created_at)}`}
          right={
            <View style={styles.actions}>
              <Button title="Join" compact loading={busy === `accept:${invite.id}`} onPress={() => accept(invite)} />
              <Button
                title="Decline"
                variant="secondary"
                compact
                loading={busy === `decline:${invite.id}`}
                onPress={() => run(`decline:${invite.id}`, () => plus.declinePartyInvite(invite.id))}
              />
            </View>
          }
        />
      ))}
      {social.worldInvites.map((invite) => (
        <Row
          key={`world:${invite.id}`}
          left={<Avatar uuid={invite.sender} size={44} online={social.isOnline(invite.sender)} />}
          title={`${name(invite.sender)} invited you to their world`}
          subtitle={[invite.minecraft_version, invite.loader, 'join from OneClient on your computer'].filter(Boolean).join(' · ')}
          right={
            <Button
              title="Decline"
              variant="secondary"
              compact
              loading={busy === `world:${invite.id}`}
              onPress={() => run(`world:${invite.id}`, () => plus.declineWorldInvite(invite.id))}
            />
          }
        />
      ))}

      {party ? (
        <>
          <SectionHeader title={`Your party · ${party.members.length}`} />
          <Card>
            {party.members.map((member) => {
              const isMe = member.player.toLowerCase() === me;
              const leader = member.player.toLowerCase() === party.leader.toLowerCase();
              const online = isMe || member.online || social.isOnline(member.player);
              return (
                <Row
                  key={member.player}
                  left={<Avatar uuid={member.player} size={44} online={online} />}
                  title={`${isMe ? `${account.username} (you)` : name(member.player)}${leader ? '  👑' : ''}`}
                  subtitle={isMe ? 'On mobile' : describeLocation(member.state, online)}
                  onLongPress={() => memberActions(member)}
                  right={
                    member.state?.voice?.in_voice ? (
                      <Ionicons
                        name={member.state.voice.muted || member.state.voice.deafened ? 'mic-off' : 'mic'}
                        size={18}
                        color={c.onSurfaceVariant}
                      />
                    ) : null
                  }
                />
              );
            })}
          </Card>
          {amLeader && party.members.length > 1 && (
            <Text style={styles.hint}>Long-press a member to make them leader or remove them.</Text>
          )}

          <SectionHeader title="Settings" />
          {amLeader ? (
            <Card style={{ paddingTop: spacing.md }}>
              <Text style={styles.settingLabel}>Who can invite</Text>
              <Segmented
                value={invitePolicy}
                onChange={(invite_policy) =>
                  invite_policy !== invitePolicy &&
                  void run('settings', async () => social.setParty(await plus.setPartySettings({ invite_policy })))
                }
                options={[
                  { value: 'leader', label: 'Only me' },
                  { value: 'members', label: 'Everyone' },
                ]}
              />
              <Text style={styles.settingLabel}>Voice chat</Text>
              <Segmented
                value={voiceMode}
                onChange={(voice_mode) =>
                  voice_mode !== voiceMode &&
                  void run('settings', async () => social.setParty(await plus.setPartySettings({ voice_mode })))
                }
                options={[
                  { value: 'party', label: 'Whole party' },
                  { value: 'proximity', label: 'Proximity' },
                ]}
              />
              <Text style={[styles.hint, { paddingTop: 0, paddingBottom: spacing.md }]}>
                {voiceMode === 'proximity'
                  ? 'In game, members only hear people standing near them.'
                  : 'In game, everyone in the party hears each other wherever they are.'}
              </Text>
            </Card>
          ) : (
            <Card>
              <Row title="Who can invite" subtitle={invitePolicy === 'members' ? 'Everyone in the party' : 'Only the leader'} />
              <Row title="Voice chat" subtitle={voiceMode === 'proximity' ? 'Proximity' : 'Whole party'} />
            </Card>
          )}

          <View style={styles.buttons}>
            {party.chat_group_id != null && (
              <Button
                title="Party chat"
                icon="chatbubbles-outline"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => router.push(`/chat/${party.chat_group_id}`)}
              />
            )}
            <Button
              title={amLeader && party.members.length > 1 ? 'Leave / disband' : 'Leave'}
              icon="exit-outline"
              variant="danger"
              style={{ flex: 1 }}
              loading={busy === 'leave'}
              onPress={leave}
            />
          </View>
        </>
      ) : (
        <EmptyState
          icon="people-circle-outline"
          title="You're not in a party"
          detail="Invite friends below to start one. When you launch OneClient on your computer, you'll play together."
        />
      )}

      {social.partyOutgoing.length > 0 && <SectionHeader title="Waiting for" />}
      {social.partyOutgoing.map((invite) => (
        <Row
          key={invite.id}
          left={<Avatar uuid={invite.recipient} size={40} />}
          title={name(invite.recipient)}
          subtitle={`Invited ${relativeTime(invite.created_at)}`}
          right={
            <Button
              title="Cancel"
              variant="secondary"
              compact
              loading={busy === `cancel:${invite.id}`}
              onPress={() => run(`cancel:${invite.id}`, () => plus.cancelPartyInvite(invite.id))}
            />
          }
        />
      ))}

      {canInvite && invitable.length > 0 && (
        <>
          <SectionHeader title="Invite friends" />
          {invitable.map((friend) => {
            const pendingInvite = invited.has(friend.player.toLowerCase());
            return (
              <Row
                key={friend.player}
                left={<Avatar uuid={friend.player} size={40} online={social.isOnline(friend.player)} />}
                title={name(friend.player)}
                subtitle={describeLocation(social.stateOf(friend.player), social.isOnline(friend.player))}
                right={
                  <Button
                    title={pendingInvite ? 'Invited' : 'Invite'}
                    compact
                    variant={pendingInvite ? 'secondary' : 'primary'}
                    disabled={pendingInvite}
                    loading={busy === `invite:${friend.player}`}
                    onPress={() => run(`invite:${friend.player}`, () => plus.inviteToParty(friend.player))}
                  />
                }
              />
            );
          })}
        </>
      )}
      {party && !canInvite && <Text style={styles.hint}>Only the party leader can invite people.</Text>}
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  actions: { flexDirection: 'row', gap: spacing.sm },
  buttons: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  settingLabel: { color: c.onSurface, ...type.titleSmall, paddingHorizontal: spacing.lg },
  hint: { color: c.onSurfaceVariant, ...type.bodySmall, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
}));
