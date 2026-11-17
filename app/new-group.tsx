import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { plus } from '@/api/plus';
import { errorMessage } from '@/lib/http';
import { usePlayerNames } from '@/state/players';
import { useSocial } from '@/state/social';
import { Avatar, Button, EmptyState, ErrorBanner, Field, Row, SectionHeader } from '@/ui/components';
import { spacing, useTheme } from '@/ui/theme';

export default function NewGroupScreen() {
  const c = useTheme();
  const router = useRouter();
  const social = useSocial();
  const name = usePlayerNames();
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (player: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(player)) next.delete(player);
      else next.add(player);
      return next;
    });

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const group = await plus.createGroup(title.trim(), [...selected]);
      social.upsertGroup(group);
      router.dismiss();
      router.push(`/chat/${group.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      {error && <ErrorBanner message={error} />}
      <View style={{ padding: spacing.md, gap: spacing.md }}>
        <Field value={title} onChangeText={setTitle} placeholder="Group name" maxLength={64} autoFocus />
        <Button
          title={selected.size ? `Create with ${selected.size} friend${selected.size === 1 ? '' : 's'}` : 'Create group'}
          icon="people"
          onPress={create}
          loading={creating}
          disabled={!title.trim() || selected.size === 0}
        />
      </View>
      <FlatList
        data={social.friends}
        keyExtractor={(f) => f.player}
        ListHeaderComponent={<SectionHeader title="Choose friends" />}
        ListEmptyComponent={<EmptyState icon="people-outline" title="Add some friends first" />}
        renderItem={({ item }) => {
          const on = selected.has(item.player);
          return (
            <Row
              left={<Avatar uuid={item.player} size={40} online={social.isOnline(item.player)} />}
              title={name(item.player)}
              onPress={() => toggle(item.player)}
              right={
                <Ionicons
                  name={on ? 'checkmark-circle' : 'ellipse-outline'}
                  size={24}
                  color={on ? c.primary : c.onSurfaceVariant}
                />
              }
            />
          );
        }}
      />
    </View>
  );
}
