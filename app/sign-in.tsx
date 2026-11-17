import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AUTH_STEPS,
  finishBrowserLogin,
  finishDeviceLogin,
  requestDeviceCode,
  type BrowserLogin,
  type DeviceCode,
} from '@/auth/microsoft';
import { PRIVACY_URL, TOS_URL } from '@/config';
import { AbortError, errorMessage } from '@/lib/http';
import { useAuth } from '@/state/auth';
import { Button, ErrorBanner } from '@/ui/components';
import { MicrosoftWebView } from '@/ui/MicrosoftWebView';
import { makeStyles, radius, spacing, type, useTheme } from '@/ui/theme';

type Phase =
  | { kind: 'intro' }
  | { kind: 'webview' }
  | { kind: 'exchanging'; progress: { label: string; step: number } }
  | { kind: 'requesting' }
  | { kind: 'code'; code: DeviceCode; progress: { label: string; step: number } }
  | { kind: 'polyfrost' };

export default function SignInScreen() {
  return <SignInView />;
}

/**
 * The Microsoft sign-in flow. Shown on its own when signed out, and inside the
 * "Add account" screen (`adding`) to sign in another account alongside the current one.
 */
export function SignInView({ adding = false, onSignedIn }: { adding?: boolean; onSignedIn?: () => void }) {
  const c = useTheme();
  const styles = useStyles();
  const { signIn } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const startWebView = () => {
    setError(null);
    setPhase({ kind: 'webview' });
  };

  const onBrowserCode = async (code: string, login: BrowserLogin) => {
    setPhase({ kind: 'exchanging', progress: { label: 'Signing in to Microsoft', step: 0 } });
    try {
      const account = await finishBrowserLogin(code, login, (label, step) =>
        setPhase((p) => (p.kind === 'exchanging' ? { ...p, progress: { label, step } } : p)),
      );
      setPhase({ kind: 'polyfrost' });
      await signIn(account); // Mojang join + Polyfrost /account/login; the router swaps screens on success.
      onSignedIn?.();
    } catch (err) {
      setError(errorMessage(err));
      setPhase({ kind: 'intro' });
    }
  };

  const startDeviceCode = async () => {
    setError(null);
    setPhase({ kind: 'requesting' });
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const code = await requestDeviceCode();
      setPhase({ kind: 'code', code, progress: { label: 'Waiting for you to sign in', step: 0 } });
      const account = await finishDeviceLogin(code, abort.signal, (label, step) =>
        setPhase((p) => (p.kind === 'code' ? { ...p, progress: { label, step } } : p)),
      );
      setPhase({ kind: 'polyfrost' });
      await signIn(account); // Mojang join + Polyfrost /account/login; Gate navigates on success.
      onSignedIn?.();
    } catch (err) {
      if (err instanceof AbortError) return;
      setError(errorMessage(err));
      setPhase({ kind: 'intro' });
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setPhase({ kind: 'intro' });
  };

  const copyAndOpen = async (code: DeviceCode) => {
    await Clipboard.setStringAsync(code.userCode);
    setCopied(true);
    await Linking.openURL(code.verificationUri);
  };

  return (
    // When adding an account the screen has a header, which already covers the top inset.
    <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }} edges={adding ? ['bottom', 'left', 'right'] : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        {!adding && <View style={styles.brand}>
          <Image source={require('../assets/splash-icon.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.title}>OneClient Mobile</Text>
          <Text style={styles.subtitle}>Chat with your OneClient friends, wherever you are.</Text>
        </View>}

        {error && <ErrorBanner message={error} />}

        {phase.kind === 'intro' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {adding ? 'Add another Minecraft account' : 'Sign in with your Minecraft account'}
            </Text>
            <Text style={styles.body}>
              {adding
                ? "Sign in with the Microsoft account it belongs to. Your other accounts stay signed in, and you can switch between them from Profile."
                : 'Polyfrost verifies you with your Microsoft/Minecraft account, the same way OneClient does on your computer.'}
            </Text>
            <Button title="Sign in with Microsoft" icon="logo-microsoft" onPress={startWebView} />
            <Button title="Use a code on another device" variant="ghost" compact onPress={startDeviceCode} />
            <Text style={styles.legal}>
              By continuing you agree to Polyfrost's{' '}
              <Text style={[styles.link, { color: c.primary }]} onPress={() => Linking.openURL(TOS_URL)}>
                Terms of Service
              </Text>{' '}
              and{' '}
              <Text style={[styles.link, { color: c.primary }]} onPress={() => Linking.openURL(PRIVACY_URL)}>
                Privacy Policy
              </Text>
              .
            </Text>
          </View>
        )}

        {phase.kind === 'exchanging' && (
          <View style={[styles.card, { alignItems: 'center' }]}>
            <ActivityIndicator color={c.primary} />
            <Text style={styles.body}>
              {phase.progress.label}
              {phase.progress.step > 0 ? ` (${phase.progress.step}/${AUTH_STEPS})` : '…'}
            </Text>
          </View>
        )}

        {phase.kind === 'requesting' && (
          <View style={[styles.card, { alignItems: 'center' }]}>
            <ActivityIndicator color={c.primary} />
            <Text style={styles.body}>Contacting Microsoft…</Text>
          </View>
        )}

        {phase.kind === 'code' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Enter this code at Microsoft</Text>
            <Text selectable style={styles.code}>
              {phase.code.userCode}
            </Text>
            <Text style={styles.body}>
              Open <Text style={styles.mono}>{phase.code.verificationUri.replace(/^https?:\/\//, '')}</Text> on this
              phone or any other device, enter the code, and sign in with the account you play Minecraft on.
            </Text>
            <Button
              title={copied ? 'Copied — open Microsoft again' : 'Copy code & open Microsoft'}
              icon="open-outline"
              onPress={() => copyAndOpen(phase.code)}
            />
            <View style={styles.progress}>
              <ActivityIndicator color={c.primary} size="small" />
              <Text style={styles.progressText}>
                {phase.progress.label}
                {phase.progress.step > 0 ? ` (${phase.progress.step}/${AUTH_STEPS})` : '…'}
              </Text>
            </View>
            <Button title="Cancel" variant="secondary" onPress={cancel} />
          </View>
        )}

        {phase.kind === 'polyfrost' && (
          <View style={[styles.card, { alignItems: 'center' }]}>
            <ActivityIndicator color={c.primary} />
            <Text style={styles.body}>Signing in to Polyfrost…</Text>
          </View>
        )}
      </ScrollView>
      <MicrosoftWebView
        visible={phase.kind === 'webview'}
        onCode={onBrowserCode}
        onError={(message) => {
          setError(message);
          setPhase({ kind: 'intro' });
        }}
        onCancel={() => setPhase({ kind: 'intro' })}
      />
    </SafeAreaView>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  brand: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  logo: { width: 88, height: 88, marginBottom: spacing.sm },
  title: { color: c.onSurface, fontSize: 32, lineHeight: 40, fontWeight: '400' },
  subtitle: { color: c.onSurfaceVariant, ...type.bodyLarge, textAlign: 'center' },
  card: { backgroundColor: c.surfaceContainerHigh, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.lg },
  cardTitle: { color: c.onSurface, ...type.titleLarge },
  body: { color: c.onSurfaceVariant, ...type.bodyMedium },
  legal: { color: c.onSurfaceVariant, ...type.bodySmall, textAlign: 'center' },
  link: { fontWeight: '500', textDecorationLine: 'underline' },
  mono: { color: c.onSurface, fontWeight: '500' },
  code: {
    color: c.onPrimaryContainer,
    fontSize: 36,
    fontWeight: '500',
    letterSpacing: 6,
    textAlign: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: c.primaryContainer,
    overflow: 'hidden',
  },
  progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'center' },
  progressText: { color: c.onSurfaceVariant, ...type.bodyMedium },
}));
