// Web (desktop testing) version of the Microsoft sign-in: opens a popup
// instead of an embedded WebView. Microsoft redirects the popup to
// http://127.0.0.1:53682/?code=..., which is this app's own dev origin, so we
// can read the code by polling the popup (same origin) or via the
// BroadcastChannel the relay in app/_layout.tsx posts to.

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Text, View } from 'react-native';
import { beginBrowserLogin, BROWSER_REDIRECT_URI, parseBrowserRedirect, type BrowserLogin } from '@/auth/microsoft';
import { errorMessage } from '@/lib/http';
import { Button } from './components';
import { makeStyles, radius, spacing, type, useTheme } from './theme';

export const OAUTH_CHANNEL = 'oneclient-ms-login';

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
  const [blocked, setBlocked] = useState(false);
  const loginRef = useRef<BrowserLogin | null>(null);
  const popupRef = useRef<Window | null>(null);
  const done = useRef(false);

  const finish = (url: string) => {
    const login = loginRef.current;
    if (!login || done.current) return;
    try {
      const code = parseBrowserRedirect(url, login);
      if (code === null) return;
      done.current = true;
      popupRef.current?.close();
      onCode(code, login);
    } catch (err) {
      done.current = true;
      popupRef.current?.close();
      onError(errorMessage(err));
    }
  };

  const openPopup = () => {
    const login = loginRef.current;
    if (!login) return;
    const popup = window.open(login.url, 'oneclient-ms-login', 'width=520,height=720');
    popupRef.current = popup;
    setBlocked(!popup);
  };

  useEffect(() => {
    if (!visible) return;
    done.current = false;
    setBlocked(false);

    if (!window.location.origin.startsWith(BROWSER_REDIRECT_URI)) {
      onError(`Open the app at ${BROWSER_REDIRECT_URI} (not ${window.location.origin}) so Microsoft can return to it.`);
      return;
    }

    let cancelled = false;
    const channel = new BroadcastChannel(OAUTH_CHANNEL);
    channel.onmessage = (event) => typeof event.data === 'string' && finish(event.data);

    beginBrowserLogin()
      .then((login) => {
        if (cancelled) return;
        loginRef.current = login;
        openPopup();
      })
      .catch((err) => onError(errorMessage(err)));

    // Fast path: read the popup's URL once it's back on our origin.
    const poll = setInterval(() => {
      try {
        const href = popupRef.current?.location.href;
        if (href) finish(href);
      } catch {
        // Still on Microsoft's (cross-origin) pages.
      }
    }, 300);

    return () => {
      cancelled = true;
      clearInterval(poll);
      channel.close();
      if (!done.current) popupRef.current?.close();
      popupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ActivityIndicator color={c.primary} />
          <Text style={styles.title}>Finish signing in in the Microsoft window</Text>
          {blocked ? (
            <>
              <Text style={styles.body}>Your browser blocked the popup.</Text>
              <Button title="Open sign-in window" icon="open-outline" onPress={openPopup} />
            </>
          ) : (
            <Text style={styles.body}>Can't see it? It may be behind this window.</Text>
          )}
          <Button title="Cancel" variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}

// M3 dialog.
const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.32)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: c.surfaceContainerHigh,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.lg,
    alignItems: 'stretch',
  },
  title: { color: c.onSurface, ...type.headlineSmall, textAlign: 'center' },
  body: { color: c.onSurfaceVariant, ...type.bodyMedium, textAlign: 'center' },
}));
