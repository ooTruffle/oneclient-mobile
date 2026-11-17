import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSocial } from '@/state/social';
import { ConnectionPill, type IconName } from '@/ui/components';
import { type, useTheme, type Scheme } from '@/ui/theme';

/**
 * M3 navigation bar item: filled icon inside a pill indicator when selected,
 * outlined icon when not.
 */
const icon =
  (c: Scheme, filled: IconName, outline: IconName, online = 0) =>
  ({ focused }: { focused: boolean }) => (
    <View
      style={{
        width: 64,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? c.secondaryContainer : 'transparent',
      }}
    >
      <Ionicons name={focused ? filled : outline} size={24} color={focused ? c.onSecondaryContainer : c.onSurfaceVariant} />
      {online > 0 && (
        // Green count bottom-right, so it never collides with the red request badge top-right.
        <View
          style={{
            position: 'absolute',
            right: 6,
            bottom: -3,
            minWidth: 16,
            height: 16,
            paddingHorizontal: 4,
            borderRadius: 8,
            borderWidth: 1.5,
            borderColor: c.surfaceContainer,
            backgroundColor: c.online,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ ...type.labelSmall, fontSize: 10, lineHeight: 12, color: '#0b3d1c' }}>{online > 99 ? '99+' : online}</Text>
        </View>
      )}
    </View>
  );

export default function TabsLayout() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { groups, requestCounts, connected, partyIncoming, worldInvites, friends, isOnline } = useSocial();
  const onlineFriends = friends.filter((f) => isOnline(f.player)).length;
  const unread = groups.filter((g) => g.unread).length;
  const partyBadge = partyIncoming.length + worldInvites.length;

  return (
    <Tabs
      screenOptions={{
        // M3 top app bar.
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.onSurface,
        headerTitleStyle: { ...type.titleLarge, fontSize: 22 },
        headerTitleAlign: 'left',
        headerShadowVisible: false,
        headerRight: () => <ConnectionPill connected={connected} />,
        headerRightContainerStyle: { paddingRight: 16 },
        // M3 navigation bar.
        tabBarStyle: {
          backgroundColor: c.surfaceContainer,
          borderTopWidth: 0,
          elevation: 0,
          height: 80 + insets.bottom,
          paddingTop: 12,
          paddingBottom: 16 + insets.bottom,
        },
        tabBarItemStyle: { gap: 4 },
        tabBarLabelStyle: { ...type.labelMedium },
        tabBarActiveTintColor: c.onSurface,
        tabBarInactiveTintColor: c.onSurfaceVariant,
        tabBarBadgeStyle: { backgroundColor: c.error, color: c.onError, fontSize: 11, fontWeight: '500' },
        sceneStyle: { backgroundColor: c.surface },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Chats',
          tabBarIcon: icon(c, 'chatbubbles', 'chatbubbles-outline'),
          tabBarBadge: unread || undefined,
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Friends',
          tabBarIcon: icon(c, 'people', 'people-outline', onlineFriends),
          tabBarBadge: requestCounts.incoming || undefined,
          tabBarAccessibilityLabel: `Friends, ${onlineFriends} online`,
        }}
      />
      <Tabs.Screen
        name="party"
        options={{
          title: 'Party',
          tabBarIcon: icon(c, 'game-controller', 'game-controller-outline'),
          tabBarBadge: partyBadge || undefined,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: icon(c, 'person-circle', 'person-circle-outline') }}
      />
    </Tabs>
  );
}
