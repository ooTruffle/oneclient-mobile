// Microsoft -> Xbox Live -> XSTS -> Minecraft sign-in, ported from
// OneLauncher's `oneclient_auth/src/msa.rs`. Mobile uses the device-code
// flow, which needs no redirect URI: the user enters a short code at
// microsoft.com/link in any browser.

import * as Crypto from 'expo-crypto';
import {
  MC_SERVICES_URL,
  MICROSOFT_CLIENT_ID,
  MINECRAFT_SCOPES,
  MS_LOGIN_URL,
  XBL_URL as XBL_BASE,
  XSTS_URL as XSTS_BASE,
} from '@/config';
import { encodeForm, fetchWithTimeout, HttpError, readJson, sleep, TimeoutError, withQuery } from '@/lib/http';
import { AuthError, dashUuid, type MinecraftAccount } from './types';

const DEVICE_CODE_URL = `${MS_LOGIN_URL}/consumers/oauth2/v2.0/devicecode`;
// The sign-in page itself is always opened directly (never proxied).
const AUTHORIZE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';

/**
 * OneClient's Azure app only allows loopback redirects (that's what the
 * desktop launcher uses). Nothing listens here on the phone: the in-app
 * WebView intercepts the navigation to this URL and reads the `code` from it.
 * Any port is accepted, but adding a path is not.
 */
export const BROWSER_REDIRECT_URI = 'http://127.0.0.1:53682';
const TOKEN_URL = `${MS_LOGIN_URL}/consumers/oauth2/v2.0/token`;
const XBL_URL = `${XBL_BASE}/user/authenticate`;
const XSTS_URL = `${XSTS_BASE}/xsts/authorize`;
const MC_LOGIN_URL = `${MC_SERVICES_URL}/authentication/login_with_xbox`;
const MC_ENTITLEMENTS_URL = `${MC_SERVICES_URL}/entitlements/mcstore`;
const MC_PROFILE_URL = `${MC_SERVICES_URL}/minecraft/profile`;

export interface DeviceCode {
  userCode: string;
  deviceCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

interface MsaToken {
  accessToken: string;
  refreshToken: string;
}

export type ProgressFn = (label: string, step: number, total: number) => void;
export const AUTH_STEPS = 5;

const FORM_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/x-www-form-urlencoded',
};
const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };

// ---- Browser (WebView) sign-in: authorization code + PKCE ----

export interface BrowserLogin {
  url: string;
  state: string;
  verifier: string;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const base64ToUrl = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function beginBrowserLogin(): Promise<BrowserLogin> {
  // 64 hex chars is a valid PKCE verifier (43-128 unreserved characters).
  const verifier = hex(Crypto.getRandomBytes(32));
  const state = hex(Crypto.getRandomBytes(16));
  const challenge = base64ToUrl(
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
      encoding: Crypto.CryptoEncoding.BASE64,
    }),
  );
  const url = withQuery(AUTHORIZE_URL, {
    client_id: MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri: BROWSER_REDIRECT_URI,
    response_mode: 'query',
    scope: MINECRAFT_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return { url, state, verifier };
}

/** Returns the auth code if `url` is our redirect, `null` if it's an unrelated page. Throws on OAuth errors. */
export function parseBrowserRedirect(url: string, login: BrowserLogin): string | null {
  if (!url.startsWith(BROWSER_REDIRECT_URI)) return null;
  const params: Record<string, string> = {};
  const query = url.split('?')[1]?.split('#')[0] ?? '';
  for (const pair of query.split('&')) {
    const [k, v = ''] = pair.split('=');
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  if (params.error) {
    if (params.error === 'access_denied') throw new AuthError('Sign-in was cancelled.');
    throw new AuthError(params.error_description || params.error);
  }
  if (params.state !== login.state) throw new AuthError('Sign-in response did not match the request. Please try again.');
  if (!params.code) throw new AuthError('Microsoft did not return a sign-in code.');
  return params.code;
}

export async function finishBrowserLogin(
  code: string,
  login: BrowserLogin,
  onProgress?: ProgressFn,
): Promise<MinecraftAccount> {
  onProgress?.('Signing in to Microsoft', 0, AUTH_STEPS);
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: FORM_HEADERS,
    body: encodeForm({
      client_id: MICROSOFT_CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: BROWSER_REDIRECT_URI,
      code_verifier: login.verifier,
      scope: MINECRAFT_SCOPES,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new AuthError(body.error_description || `Microsoft sign-in failed (HTTP ${res.status}).`);
  }
  return accountFromMsa({ accessToken: body.access_token, refreshToken: body.refresh_token }, onProgress);
}

// ---- Device-code sign-in (fallback: enter a code on another device) ----

export async function requestDeviceCode(): Promise<DeviceCode> {
  const res = await fetchWithTimeout(DEVICE_CODE_URL, {
    method: 'POST',
    headers: FORM_HEADERS,
    body: encodeForm({ client_id: MICROSOFT_CLIENT_ID, scope: MINECRAFT_SCOPES }),
  });
  const raw = await readJson<{
    user_code: string;
    device_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  }>(res);
  return {
    userCode: raw.user_code,
    deviceCode: raw.device_code,
    verificationUri: raw.verification_uri,
    expiresIn: raw.expires_in,
    interval: raw.interval,
  };
}

/** Polls until the user finishes signing in at microsoft.com/link. */
export async function pollDeviceCode(code: DeviceCode, signal: AbortSignal): Promise<MsaToken> {
  const deadline = Date.now() + code.expiresIn * 1000;
  let interval = Math.max(code.interval, 5);

  while (Date.now() < deadline) {
    await sleep(interval * 1000, signal);
    let res: Response;
    try {
      res = await fetchWithTimeout(TOKEN_URL, {
        method: 'POST',
        headers: FORM_HEADERS,
        body: encodeForm({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: MICROSOFT_CLIENT_ID,
          device_code: code.deviceCode,
        }),
        signal,
      });
    } catch (err) {
      // One stalled poll shouldn't end the sign-in; the next one may get through.
      if (err instanceof TimeoutError) continue;
      throw err;
    }
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { accessToken: body.access_token, refreshToken: body.refresh_token };

    switch (body.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        interval += 5;
        continue;
      case 'expired_token':
        throw new AuthError('The sign-in code expired. Start again to get a new one.');
      case 'authorization_declined':
        throw new AuthError('Sign-in was declined.');
      default:
        throw new AuthError(body.error_description || body.error || `Sign-in failed (HTTP ${res.status})`);
    }
  }
  throw new AuthError('The sign-in code expired. Start again to get a new one.');
}

async function refreshMsa(refreshToken: string): Promise<MsaToken> {
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: FORM_HEADERS,
    body: encodeForm({
      client_id: MICROSOFT_CLIENT_ID,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: MINECRAFT_SCOPES,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { accessToken: body.access_token, refreshToken: body.refresh_token ?? refreshToken };
  // invalid_grant: expired/revoked/password changed. interaction_required: MFA or consent.
  if (body.error === 'invalid_grant' || body.error === 'interaction_required') {
    throw new AuthError('Your Microsoft session has expired. Please sign in again.', true);
  }
  throw new AuthError(body.error_description || `Couldn't refresh your Microsoft session (HTTP ${res.status}).`);
}

const XBOX_ERRORS: Record<number, string> = {
  2148916227: 'This Xbox account is banned.',
  2148916229: 'This account needs adult approval to play online. Ask a parent to change the Xbox privacy settings.',
  2148916233: "This Microsoft account doesn't have an Xbox profile yet. Sign in at minecraft.net once to create one.",
  2148916234: 'You need to accept the Xbox terms of service. Sign in at xbox.com once and try again.',
  2148916235: "Xbox Live isn't available in your region.",
  2148916236: 'This account needs adult verification (South Korea).',
  2148916237: 'This account needs adult verification (South Korea).',
  2148916238: 'This is a child account. It must be added to a Microsoft family by an adult before it can sign in.',
};

interface XboxTokenResponse {
  Token?: string;
  DisplayClaims?: { xui?: { uhs: string }[] };
  XErr?: number;
  Message?: string;
}

async function xbox(url: string, body: unknown, step: string): Promise<XboxTokenResponse> {
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { ...JSON_HEADERS, 'x-xbl-contract-version': '1' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: XboxTokenResponse = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    // fall through to status handling
  }
  if (parsed.XErr) {
    throw new AuthError(XBOX_ERRORS[parsed.XErr] ?? parsed.Message ?? `Xbox rejected sign-in (error ${parsed.XErr}).`);
  }
  if (!res.ok || !parsed.Token) throw new AuthError(`${step} failed (HTTP ${res.status}).`);
  return parsed;
}

async function accountFromMsa(msa: MsaToken, onProgress?: ProgressFn): Promise<MinecraftAccount> {
  onProgress?.('Authenticating with Xbox Live', 1, AUTH_STEPS);
  const xbl = await xbox(
    XBL_URL,
    {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msa.accessToken}` },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    },
    'Xbox Live sign-in',
  );

  onProgress?.('Authorizing access (XSTS)', 2, AUTH_STEPS);
  const xsts = await xbox(
    XSTS_URL,
    {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    },
    'Xbox authorization',
  );
  const uhs = xsts.DisplayClaims?.xui?.[0]?.uhs;
  if (!uhs) throw new AuthError('Xbox authorization returned no user hash.');

  onProgress?.('Requesting Minecraft token', 3, AUTH_STEPS);
  const mc = await readJson<{ access_token: string; expires_in: number }>(
    await fetchWithTimeout(MC_LOGIN_URL, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ identityToken: `XBL3.0 x=${uhs};${xsts.Token}` }),
    }),
  ).catch((err) => {
    throw new AuthError(`Minecraft sign-in failed: ${err instanceof Error ? err.message : err}`);
  });

  onProgress?.('Verifying game ownership', 4, AUTH_STEPS);
  const auth = { Accept: 'application/json', Authorization: `Bearer ${mc.access_token}` };
  // Mirrors the launcher; the profile lookup below is what actually proves ownership.
  await fetchWithTimeout(MC_ENTITLEMENTS_URL, { headers: auth }).catch(() => undefined);

  const profileRes = await fetchWithTimeout(MC_PROFILE_URL, { headers: auth });
  if (profileRes.status === 404) {
    throw new AuthError("This account doesn't own Minecraft: Java Edition, or hasn't picked a username yet.");
  }
  const profile = await readJson<{ id: string; name: string }>(profileRes);
  onProgress?.('Loading profile', AUTH_STEPS, AUTH_STEPS);

  return {
    id: dashUuid(profile.id),
    username: profile.name,
    accessToken: mc.access_token,
    refreshToken: msa.refreshToken,
    expiresAt: Date.now() + mc.expires_in * 1000,
  };
}

export async function finishDeviceLogin(
  code: DeviceCode,
  signal: AbortSignal,
  onProgress?: ProgressFn,
): Promise<MinecraftAccount> {
  onProgress?.('Waiting for sign-in', 0, AUTH_STEPS);
  const msa = await pollDeviceCode(code, signal);
  return accountFromMsa(msa, onProgress);
}

/** Mints a fresh Minecraft token from the stored Microsoft refresh token. */
export async function refreshAccount(account: MinecraftAccount): Promise<MinecraftAccount> {
  const msa = await refreshMsa(account.refreshToken);
  const next = await accountFromMsa(msa);
  if (next.id !== account.id) {
    throw new AuthError('The refreshed Microsoft account belongs to a different player. Please sign in again.', true);
  }
  return next;
}

export { HttpError };
