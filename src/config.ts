// Endpoints and identifiers mirror OneLauncher's `oneclient_common::constants`
// and PolyPlus' `BackendUrl`, so the mobile app talks to the same backend
// with the same Microsoft app registration as the desktop launcher.

import { Platform } from 'react-native';

const trimSlash = (url: string) => url.replace(/\/+$/, '');

/** PolyPlus backend (social, chat, presence). Override with EXPO_PUBLIC_PLUS_BACKEND_URL for staging. */
export const PLUS_BACKEND_URL = trimSlash(
  process.env.EXPO_PUBLIC_PLUS_BACKEND_URL || 'https://plus.polyfrost.org',
);

// On web (desktop testing) these services reject browser requests, so calls
// go through scripts/dev-proxy.mjs. Native apps call them directly.
const WEB_PROXY =
  Platform.OS === 'web' ? trimSlash(process.env.EXPO_PUBLIC_WEB_PROXY_URL || 'http://127.0.0.1:53683') : null;
const via = (name: string, upstream: string) => (WEB_PROXY ? `${WEB_PROXY}/proxy/${name}` : upstream);

export const PLUS_API_URL = via('plus', PLUS_BACKEND_URL);
export const PLUS_SOCKET_URL = WEB_PROXY
  ? `${WEB_PROXY.replace(/^http/, 'ws')}/proxy/plus/websocket`
  : `${PLUS_BACKEND_URL.replace(/^http/, 'ws')}/websocket`;
/** Browsers can't set WebSocket headers; the dev proxy turns `access_token` into a bearer header. */
export const SOCKET_TOKEN_IN_QUERY = WEB_PROXY !== null;

export const MS_LOGIN_URL = via('mslogin', 'https://login.microsoftonline.com');
export const XBL_URL = via('xbl', 'https://user.auth.xboxlive.com');
export const XSTS_URL = via('xsts', 'https://xsts.auth.xboxlive.com');
export const MC_SERVICES_URL = via('mcservices', 'https://api.minecraftservices.com');
export const MOJANG_SESSION_URL = via('mojang', 'https://sessionserver.mojang.com');

/** OneClient's Microsoft (Azure) public client id; it is enabled for the device-code flow. */
export const MICROSOFT_CLIENT_ID =
  process.env.EXPO_PUBLIC_MICROSOFT_CLIENT_ID || '9419b7ee-1448-4d1b-b52a-550d8f36ab56';

export const MINECRAFT_SCOPES = 'XboxLive.SignIn XboxLive.offline_access';

export const TOS_URL = 'https://polyfrost.org/legal/terms';
export const PRIVACY_URL = 'https://polyfrost.org/legal/privacy';

/** Polyfrost tokens are treated as valid for 100 minutes (the server issues ~2h). */
export const POLY_TOKEN_LIFETIME_MS = 100 * 60 * 1000;

/** Refresh the Minecraft token this long before it actually expires. */
export const MC_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export const MAX_MESSAGE_LENGTH = 512;
export const MAX_RESOLVE_BATCH = 100;
export const CURSOR_PAGE_SIZE = 100;

/**
 * Player head images, in order of preference. With the skin's texture ID (from
 * Mojang, see state/skins.ts) the head is exact. Per-player URLs are only a
 * fallback: those services cache skins and can serve a stale one or a default
 * Steve (minotar did, with a 200, for a player with a custom skin).
 */
export const avatarUrls = (uuid: string, size = 64, texture?: string | null) => {
  const id = uuid.replace(/-/g, '');
  return [
    ...(texture ? [`https://mc-heads.net/avatar/${texture}/${size}`] : []),
    `https://mc-heads.net/avatar/${id}/${size}`,
    `https://minotar.net/helm/${id}/${size}.png`,
  ];
};
