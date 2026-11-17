import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { alert } from '@/lib/dialog';
import { errorMessage } from '@/lib/http';
import { useAuth } from '@/state/auth';
import { Avatar, Card, IconButton, Row } from './components';
import { useTheme } from './theme';

/**
 * Accounts card for the Profile tab: every Minecraft account signed in on this
 * phone, tap one to switch to it, or add another.
 */
export function AccountSwitcher() {
  const c = useTheme();
  const router = useRouter();
  const { account, accounts, switchAccount, removeAccount } = useAuth();
  const [switching, setSwitching] = useState<string | null>(null);

  const switchTo = async (id: string) => {
    if (switching || id === account?.id) return;
    setSwitching(id);
    try {
      await switchAccount(id);
      // Start the new account on its Chats list.
      router.replace('/');
    } catch (err) {
      alert("Couldn't switch account", errorMessage(err));
    } finally {
      setSwitching(null);
    }
  };

  const confirmRemove = (id: string, username: string) =>
    alert(`Sign out ${username}?`, 'It will be removed from this phone. You can add it again at any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => void removeAccount(id).catch((err) => alert("Couldn't sign out", errorMessage(err))),
      },
    ]);

  return (
    <Card>
      {accounts.map((a) => {
        const active = a.id === account?.id;
        return (
          <Row
            key={a.id}
            left={<Avatar uuid={a.id} size={36} />}
            title={a.username}
            subtitle={active ? 'Signed in · active' : 'Tap to switch'}
            bold={active}
            onPress={active ? undefined : () => void switchTo(a.id)}
            onLongPress={active ? undefined : () => confirmRemove(a.id, a.username)}
            right={
              switching === a.id ? (
                <ActivityIndicator color={c.primary} />
              ) : active ? (
                <Ionicons name="checkmark-circle" size={22} color={c.primary} accessibilityLabel="Active account" />
              ) : (
                <IconButton
                  icon="close"
                  label={`Sign out ${a.username}`}
                  color={c.onSurfaceVariant}
                  onPress={() => confirmRemove(a.id, a.username)}
                />
              )
            }
          />
        );
      })}
      <Row
        left={
          <View style={{ width: 36, alignItems: 'center' }}>
            <Ionicons name="person-add-outline" size={22} color={c.primary} />
          </View>
        }
        title="Add account"
        subtitle="Sign in with another Minecraft account"
        onPress={() => router.push('/add-account')}
      />
    </Card>
  );
}
