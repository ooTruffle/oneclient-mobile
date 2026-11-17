import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { handleNotificationTaps } from '@/notifications';
import { AuthProvider, useAuth } from '@/state/auth';
import { SocialProvider } from '@/state/social';
import { PREFS, preloadPrefs } from '@/state/prefs';
import { schemeFor, DEFAULT_SEED } from '@/ui/scheme';
import { DialogHost } from '@/ui/DialogHost';
import { type, useTheme } from '@/ui/theme';

// Keep the splash up until the theme colour is read, so the first frame is
// already in the user's colours instead of flashing the default blue scheme.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ fade: true, duration: 200 });
const themeReady = Promise.race([
  preloadPrefs([PREFS.accent, PREFS.chatSections, PREFS.collapsedSections]),
  new Promise<void>((resolve) => setTimeout(resolve, 1500)), // never hang on storage
]);

function Gate() {
  const c = useTheme();
  const { status } = useAuth();
  const signedIn = status === 'signedIn';
  const router = useRouter();

  // Wait until the protected screens exist before routing to one.
  useEffect(() => (signedIn ? handleNotificationTaps(router) : undefined), [signedIn, router]);

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={c.primary} size="large" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.onSurface,
        headerTitleStyle: { ...type.titleLarge, fontSize: 22 },
        headerShadowVisible: false,
        // Chevron only; otherwise iOS labels the back button with the hidden "(tabs)" route name.
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: c.surface },
      }}
    >
      {/* Protected routes unmount the moment the account goes away (sign-out or revoked session). */}
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[id]" options={{ title: '' }} />
        <Stack.Screen name="group/[id]" options={{ title: 'Group info', presentation: 'modal' }} />
        <Stack.Screen name="new-group" options={{ title: 'New group', presentation: 'modal' }} />
        <Stack.Screen name="add-account" options={{ title: 'Add account', presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

// Web only: this window is the Microsoft sign-in popup that just got sent back
// to http://127.0.0.1:53682/?code=... — hand the URL to the main window.
const isOAuthPopup =
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  /[?&]state=/.test(window.location.search) &&
  /[?&](code|error)=/.test(window.location.search) &&
  (window.opener != null || window.name === 'oneclient-ms-login');

if (isOAuthPopup) {
  const channel = new BroadcastChannel('oneclient-ms-login');
  channel.postMessage(window.location.href);
  channel.close();
  setTimeout(() => window.close(), 300);
}

export default function RootLayout() {
  useEffect(() => {
    // One frame after the prefs land, so that render is on screen first.
    void themeReady.then(() => requestAnimationFrame(() => void SplashScreen.hideAsync().catch(() => undefined)));
  }, []);

  if (isOAuthPopup) {
    const c = schemeFor(DEFAULT_SEED);
    return (
      <View style={{ flex: 1, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: c.onSurface }}>Signed in — you can close this window.</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <AuthProvider>
          <SocialProvider>
            <StatusBar style="light" />
            <Gate />
            <DialogHost />
          </SocialProvider>
        </AuthProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
