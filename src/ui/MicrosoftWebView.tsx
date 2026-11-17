import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { beginBrowserLogin, parseBrowserRedirect, type BrowserLogin } from '@/auth/microsoft';
import { errorMessage } from '@/lib/http';
import { IconButton } from './components';
import { makeStyles, spacing, type, useTheme } from './theme';

/**
 * Full-screen Microsoft sign-in. Resolves with the auth code by catching the
 * navigation to the loopback redirect URI before it is ever loaded.
 */
export function MicrosoftWebView({
  visible,
  onCode,
  onError,
  onCancel,
}: {
  visible: boolean;
  onCode: (code: string, login: BrowserLogin) => void;
  onError: (message: string) => void;
  onCancel: () => void;
}) {
  const c = useTheme();
  const styles = useStyles();
  const [login, setLogin] = useState<BrowserLogin | null>(null);
  const [loading, setLoading] = useState(true);
  const done = useRef(false);
  const webView = useRef<WebView>(null);
  const canGoBack = useRef(false);

  // Android back button: step back through Microsoft's pages (e.g. from the
  // password page to the account picker) and only cancel on the first page.
  const onBack = () => {
    if (canGoBack.current) webView.current?.goBack();
    else onCancel();
  };

  useEffect(() => {
    if (!visible) return;
    done.current = false;
    canGoBack.current = false;
    setLogin(null);
    setLoading(true);
    beginBrowserLogin()
      .then(setLogin)
      .catch((err) => onError(errorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /** Returns false (block the load) when `url` is our redirect. */
  const intercept = (url: string): boolean => {
    if (!login || done.current) return !done.current;
    try {
      const code = parseBrowserRedirect(url, login);
      if (code === null) return true;
      done.current = true;
      onCode(code, login);
    } catch (err) {
      done.current = true;
      onError(errorMessage(err));
    }
    return false;
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onBack}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.bar}>
          <IconButton icon="close" label="Cancel sign-in" onPress={onCancel} />
          <Text style={styles.title}>Sign in with Microsoft</Text>
          <View style={{ width: 40 }}>{loading && <ActivityIndicator color={c.primary} size="small" />}</View>
        </View>
        {login ? (
          <WebView
            ref={webView}
            source={{ uri: login.url }}
            onNavigationStateChange={(nav) => {
              canGoBack.current = nav.canGoBack;
            }}
            // Fresh cookie jar each time, so switching Microsoft accounts just works.
            incognito
            originWhitelist={['*']}
            onShouldStartLoadWithRequest={(req) => intercept(req.url)}
            // Fallbacks for platforms/versions where redirects skip the callback above.
            onLoadStart={(e) => intercept(e.nativeEvent.url)}
            onError={(e) => intercept(e.nativeEvent.url)}
            onLoadEnd={() => setLoading(false)}
            style={{ flex: 1, backgroundColor: '#fff' }}
          />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={c.primary} />
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    minHeight: 64,
  },
  title: { color: c.onSurface, ...type.titleLarge, flex: 1, marginLeft: spacing.xs },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
}));
