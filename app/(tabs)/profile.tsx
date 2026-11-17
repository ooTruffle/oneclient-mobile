import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { PLUS_BACKEND_URL, PRIVACY_URL, TOS_URL } from '@/config';
import { alert } from '@/lib/dialog';
import { errorMessage } from '@/lib/http';
import { useAccount, useAuth } from '@/state/auth';
import { PREFS, usePref } from '@/state/prefs';
import { useSocial } from '@/state/social';
import { Avatar, Button, Card, Field, Row, SectionHeader, Toggle } from '@/ui/components';
import { makeStyles, spacing, type } from '@/ui/theme';
import { ACCENT_PRESETS, parseHex, SYSTEM_ACCENT, useAccent } from '@/ui/accent';
import { AccountSwitcher } from '@/ui/AccountSwitcher';
import { LinkedAccounts } from '@/ui/LinkedAccounts';

const APP_VERSION = [
  Constants.expoConfig?.version ?? '?',
  Constants.expoConfig?.android?.versionCode != null ? `(${Constants.expoConfig.android.versionCode})` : '',
]
  .join(' ')
  .trim();

export default function ProfileScreen() {
  const styles = useStyles();
  const { seed, setAccent, isSystem, systemAccent } = useAccent();
  const [hex, setHex] = useState('');
  const typedHex = parseHex(hex);
  const account = useAccount();
  const { signOut, accounts } = useAuth();
  const router = useRouter();
  const nextAccount = accounts.find((a) => a.id !== account.id);
  const social = useSocial();
  const [savingStatus, setSavingStatus] = useState(false);
  const [chatSections, setChatSections] = usePref(PREFS.chatSections, true);
  const [specialFeatures, setSpecialFeatures] = usePref(PREFS.specialFeatures, true);

  const appearOffline = social.myStatus === 'offline';

  const toggleStatus = async (offline: boolean) => {
    setSavingStatus(true);
    try {
      await social.setMyStatus(offline ? 'offline' : 'online');
    } catch (err) {
      alert("Couldn't change status", errorMessage(err));
    } finally {
      setSavingStatus(false);
    }
  };

  const confirmSignOut = () =>
    alert(
      `Sign out ${account.username}?`,
      nextAccount
        ? `You'll switch to ${nextAccount.username}. You can add this account again at any time.`
        : 'You can sign back in with your Microsoft account at any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () =>
            void signOut().then(() => {
              // Another account took over: start it on its Chats list.
              if (nextAccount) router.replace('/');
            }),
        },
      ],
    );

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl * 2 }}>
      <View style={styles.header}>
        <Avatar uuid={account.id} size={88} online={social.connected && !appearOffline} />
        <Text style={styles.name}>{account.username}</Text>
        <Text selectable style={styles.uuid}>
          {account.id}
        </Text>
      </View>

      <SectionHeader title="Accounts" />
      <AccountSwitcher />

      <SectionHeader title="Presence" />
      <Card>
        <Row
          title="Appear offline"
          subtitle="Friends will see you as offline while you're on mobile."
          right={
<Toggle value={appearOffline} onValueChange={toggleStatus} disabled={savingStatus} />
          }
        />
      </Card>

      <SectionHeader title="Linked accounts" />
      <LinkedAccounts />

      <SectionHeader title="Theme colour" />
      {systemAccent && (
        <Card style={{ marginBottom: spacing.md }}>
          <Row
            title="Match wallpaper"
            subtitle="Material You: use the colour Android picked from your wallpaper."
            right={
<Toggle value={isSystem} onValueChange={(on) => setAccent(on ? SYSTEM_ACCENT : systemAccent)} />
            }
          />
        </Card>
      )}
      <Card style={{ padding: spacing.lg, gap: spacing.lg }}>
        <View style={styles.swatches}>
          {ACCENT_PRESETS.map((p) => {
            const active = !isSystem && p.value === seed;
            return (
              <Pressable
                key={p.value}
                onPress={() => setAccent(p.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={p.name}
                style={[styles.swatch, { backgroundColor: p.value }, active && styles.swatchActive]}
              >
                {active && <Ionicons name="checkmark" size={20} color="#fff" />}
              </Pressable>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <View style={[styles.preview, { backgroundColor: typedHex ?? seed }]} />
          <Field
            value={hex}
            onChangeText={setHex}
            placeholder={`Custom hex, e.g. ${seed}`}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={7}
            returnKeyType="done"
            onSubmitEditing={() => typedHex && (setAccent(typedHex), setHex(''))}
            style={{ flex: 1 }}
          />
          <Button
            title="Use"
            compact
            disabled={!typedHex}
            onPress={() => {
              if (typedHex) setAccent(typedHex);
              setHex('');
            }}
          />
        </View>
        <Text style={styles.note}>The whole app's Material 3 colours are generated from this. Saved on this device.</Text>
      </Card>

      <SectionHeader title="Chats" />
      <Card>
        <Row
          title="Sort chats by type"
          subtitle="Fold chats into Pinned, Direct messages, Groups and Party sections. Saved on this device."
          right={
<Toggle value={chatSections} onValueChange={setChatSections} />
          }
        />
        {/* Only for Special Chat staff (targets and their delegates). */}
        {social.hasSpecialFeatures && (
          <Row
            title="Special Chat tools"
            subtitle={
              'Chat as, the Special Chat section and its filters, and Convert to normal chat. ' +
              'Turn off to see the app the way everyone else does. Saved on this device.'
            }
            right={<Toggle value={specialFeatures} onValueChange={setSpecialFeatures} />}
          />
        )}
      </Card>

      <SectionHeader title="Connection" />
      <Card>
        <Row title="Live updates" subtitle={social.connected ? 'Connected' : 'Reconnecting…'} />
        <Row title="Server" subtitle={PLUS_BACKEND_URL.replace(/^https?:\/\//, '')} />
        <Row title="Friends" subtitle={`${social.friends.length} friends · ${social.blocked.length} blocked`} />
      </Card>

      <SectionHeader title="About" />
      <Card>
        <Row title="Terms of Service" onPress={() => Linking.openURL(TOS_URL)} />
        <Row title="Privacy Policy" onPress={() => Linking.openURL(PRIVACY_URL)} />
        <Row title="Version" subtitle={APP_VERSION} />
      </Card>

      <View style={{ padding: spacing.lg }}>
        <Button title="Sign out" icon="log-out-outline" variant="danger" onPress={confirmSignOut} />
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  header: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl },
  name: { color: c.onSurface, ...type.headlineSmall, marginTop: spacing.md },
  uuid: { color: c.onSurfaceVariant, ...type.bodySmall },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  swatch: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  swatchActive: { borderWidth: 3, borderColor: c.onSurface },
  preview: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: c.outline },
  note: { color: c.onSurfaceVariant, ...type.bodySmall },
}));
