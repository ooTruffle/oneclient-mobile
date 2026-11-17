import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, ScrollView, Text, View, type AlertButton } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dialogStore, type DialogRequest } from '@/lib/dialog';
import { ripple } from './components';
import { makeStyles, radius, spacing, type, useTheme, withAlpha } from './theme';

/**
 * Renders the dialogs requested through alert() in lib/dialog: an M3 dialog
 * when there's a message, otherwise an M3 bottom sheet menu. Mount once, near
 * the root.
 */
export function DialogHost() {
  useEffect(() => dialogStore.attachHost(), []);
  const request = useSyncExternalStore(dialogStore.subscribe, dialogStore.current, dialogStore.current);
  if (!request) return null;
  return request.message ? <M3Dialog key={request.id} request={request} /> : <M3Sheet key={request.id} request={request} />;
}

/** Close first, then run the handler, so a handler can open the next dialog. */
function choose(request: DialogRequest, button?: AlertButton) {
  dialogStore.close(request.id);
  button?.onPress?.();
}

const cancelOf = (request: DialogRequest) => request.buttons.find((b) => b.style === 'cancel');

function M3Dialog({ request }: { request: DialogRequest }) {
  const c = useTheme();
  const styles = useStyles();
  const cancel = cancelOf(request);
  // M3: the dismissive action sits left of (or above) the confirming ones.
  const ordered = [...(cancel ? [cancel] : []), ...request.buttons.filter((b) => b !== cancel)];
  const stacked = ordered.length > 2;
  const dismiss = () => choose(request, cancel);

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={dismiss}>
      <Pressable style={styles.scrim} onPress={dismiss} accessibilityLabel="Close dialog">
        {/* Swallow taps on the dialog itself. */}
        <Pressable style={styles.dialog} onPress={() => {}} accessibilityViewIsModal accessibilityRole="alert">
          <Text style={styles.title}>{request.title}</Text>
          {!!request.message && (
            <ScrollView style={{ maxHeight: 320 }}>
              <Text style={styles.message}>{request.message}</Text>
            </ScrollView>
          )}
          <View style={[styles.actions, stacked && styles.actionsStacked]}>
            {ordered.map((b, i) => (
              <Pressable
                key={`${b.text}:${i}`}
                accessibilityRole="button"
                onPress={() => choose(request, b)}
                android_ripple={ripple(c.primary)}
                style={({ pressed }) => [
                  styles.textButton,
                  pressed && Platform.OS !== 'android' && { backgroundColor: withAlpha(c.primary, 0.12) },
                ]}
              >
                <Text style={[styles.textButtonLabel, b.style === 'destructive' && { color: c.error }]}>{b.text}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function M3Sheet({ request }: { request: DialogRequest }) {
  const c = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const cancel = cancelOf(request);
  const actions = request.buttons.filter((b) => b !== cancel);
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: 1,
      duration: 250,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [slide]);

  const dismiss = () => choose(request, cancel);

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={dismiss}>
      <Pressable style={[styles.scrim, styles.scrimSheet]} onPress={dismiss} accessibilityLabel="Close menu">
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, spacing.lg) },
            { transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [320, 0] }) }] },
          ]}
        >
          <Pressable onPress={() => {}} accessibilityViewIsModal>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle} numberOfLines={2}>
              {request.title}
            </Text>
            {actions.map((b, i) => (
              <Pressable
                key={`${b.text}:${i}`}
                accessibilityRole="button"
                onPress={() => choose(request, b)}
                android_ripple={ripple(c.onSurface)}
                style={({ pressed }) => [
                  styles.sheetItem,
                  pressed && Platform.OS !== 'android' && { backgroundColor: withAlpha(c.onSurface, 0.08) },
                ]}
              >
                <Text style={[styles.sheetItemText, b.style === 'destructive' && { color: c.error }]}>{b.text}</Text>
              </Pressable>
            ))}
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  scrim: {
    flex: 1,
    backgroundColor: withAlpha(c.scrim, 0.32),
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  scrimSheet: { justifyContent: 'flex-end', padding: 0 },
  // M3 basic dialog.
  dialog: {
    width: '100%',
    minWidth: 280,
    maxWidth: 400,
    backgroundColor: c.surfaceContainerHigh,
    borderRadius: radius.xl,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  title: { color: c.onSurface, ...type.headlineSmall },
  message: { color: c.onSurfaceVariant, ...type.bodyMedium },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginRight: -spacing.md },
  actionsStacked: { flexDirection: 'column', alignItems: 'flex-end', gap: 0 },
  textButton: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  textButtonLabel: { color: c.primary, ...type.labelLarge },
  // M3 modal bottom sheet.
  sheet: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    backgroundColor: c.surfaceContainerLow,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: withAlpha(c.onSurfaceVariant, 0.4),
    marginTop: 16,
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    color: c.onSurfaceVariant,
    ...type.titleSmall,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  sheetItem: { minHeight: 56, paddingHorizontal: spacing.xl, justifyContent: 'center' },
  sheetItemText: { color: c.onSurface, ...type.bodyLarge },
}));
