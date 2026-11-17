// Background push notifications. The backend sends through Expo's push
// service to the token registered here (PUT /account/push-token) for new
// DMs/group messages and friend requests.

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import type { Router } from 'expo-router';
import { Platform } from 'react-native';
import { plus } from '@/api/plus';
import { session } from '@/auth/session';
import { loadPref, savePref } from '@/auth/storage';

/** Must match ANDROID_CHANNEL_ID in plus-backend `src/api/push.rs`. */
const ANDROID_CHANNEL_ID = 'social';

/** OCM_NO_PUSH=1 test builds (free Apple ID) have no push entitlement; see plugins/with-no-push.js. */
const pushDisabled = Constants.expoConfig?.extra?.pushDisabled === true;

const supported = Platform.OS !== 'web' && !pushDisabled;

/**
 * The Expo token this device last registered and the account it went to, so
 * sign-out can remove it. Kept on disk too: an account is often found revoked
 * at launch, before this launch's registration has run.
 */
interface Registration {
  token: string;
  accountId: string;
}
const REGISTRATION_PREF = 'push.registration';
let registration: Registration | null | undefined; // undefined = not read from disk yet

async function currentRegistration(): Promise<Registration | null> {
  if (registration === undefined) registration = (await loadPref<Registration>(REGISTRATION_PREF)) ?? null;
  return registration;
}

async function setRegistration(next: Registration | null): Promise<void> {
  registration = next;
  try {
    await savePref(REGISTRATION_PREF, next);
  } catch {
    // Only used for clean-up later; not worth failing over.
  }
}

/** Conversation on screen right now; its pushes are dropped while the app is open. */
let activeChat: number | null = null;

/** Called by the social store when a chat opens or closes. */
export function setActiveChat(groupId: number | null) {
  activeChat = groupId;
}

if (supported) {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data as Partial<PushData> | undefined;
      // The message is already arriving live in the open chat.
      const onScreen = data?.type === 'group_message' && activeChat !== null && Number(data.group_id) === activeChat;
      return {
        shouldShowBanner: !onScreen,
        shouldShowList: !onScreen,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    },
  });
}

/**
 * Asks for permission and registers this device with the backend. Safe to
 * call on every launch; returns false when notifications are unavailable or denied.
 */
export async function registerForPush(): Promise<boolean> {
  if (!supported || !Device.isDevice) return false;
  const accountId = session.current?.id;
  if (!accountId) return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Messages and friend requests',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') return false;

  const projectId: string | undefined =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

  await plus.registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
  // The backend moves a token to whoever registers it last, so this replaces any earlier owner.
  if (session.current?.id === accountId) await setRegistration({ token, accountId });
  return true;
}

/** Best effort: stop pushes to this device before the session goes away. */
export async function unregisterForPush(): Promise<void> {
  const current = await currentRegistration();
  if (!current || current.accountId !== session.current?.id) return;
  await setRegistration(null);
  try {
    await plus.unregisterPushToken(current.token);
  } catch {
    // Signing out must not fail because the backend is unreachable.
  }
}

/**
 * Microsoft revoked an account's sign-in, so it's about to be signed out
 * without a working session. Its pushes must still stop. Try the last
 * Polyfrost token it had; if the server won't take it, invalidate this
 * device's push token so Expo reports it as gone and the backend forgets it.
 * (If another account takes over, it registers a fresh token right after.)
 */
async function forgetRevokedAccount(accountId: string, polyToken: string | null): Promise<void> {
  if (!supported) return;
  const current = await currentRegistration();
  if (!current || current.accountId !== accountId) return;
  await setRegistration(null);
  if (polyToken) {
    try {
      await plus.unregisterPushTokenWith(polyToken, current.token);
      return;
    } catch {
      // Expired or unreachable: fall through.
    }
  }
  await Notifications.unregisterForNotificationsAsync().catch(() => undefined);
}

session.onRevoked(forgetRevokedAccount);

/**
 * Re-registers when the OS rotates this device's push token while the app is
 * running (FCM and APNs both do this occasionally). Returns an unsubscribe.
 */
export function watchPushTokenChanges(): () => void {
  if (!supported) return () => {};
  const sub = Notifications.addPushTokenListener(() => {
    registerForPush().catch((err) => console.warn('Push re-registration failed', err));
  });
  return () => sub.remove();
}

type PushData =
  | { type: 'group_message'; group_id: number }
  | { type: 'friend_request' | 'friend_accepted' };

function open(router: Router, response: Notifications.NotificationResponse | null) {
  const data = response?.notification.request.content.data as PushData | undefined;
  if (!data) return;
  if (data.type === 'group_message' && data.group_id) router.push(`/chat/${data.group_id}`);
  else if (data.type === 'friend_request' || data.type === 'friend_accepted') router.push('/friends');
}

/** Opens the right screen when a notification is tapped, including the one that launched the app. */
export function handleNotificationTaps(router: Router): () => void {
  if (!supported) return () => {};

  const launch = Notifications.getLastNotificationResponse();
  if (launch) {
    open(router, launch);
    Notifications.clearLastNotificationResponse();
  }

  const sub = Notifications.addNotificationResponseReceivedListener((response) => open(router, response));
  return () => sub.remove();
}
