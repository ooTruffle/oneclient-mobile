# OneClient Mobile

## AI Disclosure
AI was heavily used to develop this app, feel free to pr any fixes / code cleanup
#

A mobile companion app for OneClient. It brings the social features from
[OneLauncher](https://github.com/Polyfrost/OneLauncher) and
[PolyPlus](https://github.com/Polyfrost/PolyPlus) to iOS and Android:

- **Chats**: DMs, group chats, party chats and Special Chat, with live messages, edit/delete, read markers,
  older-history paging, pinned chats and optional sections (Pinned, Direct messages, Groups, Party).
  Messages that fail to send stay in the conversation until you retry or delete them.
- **Friends**: online/offline presence, add friends by username, incoming/outgoing requests, remove, block/unblock
- **Groups**: create, rename, add/remove members, leave
- **Party**: see your party and where each member is playing, open party chat, invite friends (this starts a
  party if you aren't in one), accept or decline party invites, cancel invites you've sent, leave or disband,
  and, as leader, transfer leadership or remove members. World invites show here too, with a Decline button.
  Joining a world still happens from OneClient on desktop.
- **Notifications**: push notifications for new messages and friend requests. No banner appears for the chat
  you already have open.
- **Accounts**: sign in several Minecraft accounts and switch between them from Profile. Each keeps its own
  tokens; push notifications follow the active account.
- **Profile**: appear offline, linked accounts (Discord), theme colour (presets, custom hex, or the Material You
  wallpaper colour on Android), chat sorting, connection status, sign out

Built with Expo (React Native + TypeScript, expo-router).

## How sign-in works

Polyfrost's backend (`plus.polyfrost.org`) only accepts a **Polyfrost token**, and you can
only get one by proving you own a Minecraft account. The app follows the same steps as
OneLauncher (`oneclient_auth/msa.rs` and `oneclient_polyplus/session.rs`):

1. **Microsoft sign-in in a WebView** (`src/ui/MicrosoftWebView.tsx`). The app uses an authorization
   code with PKCE and OneClient's Microsoft client ID. That Azure app only allows loopback redirects
   (`http://127.0.0.1:<port>`, with no path), as the desktop launcher uses. The WebView catches the
   navigation to `http://127.0.0.1:53682`, reads the `code`, and stops the load, so nothing has to
   listen on the phone. The WebView runs incognito, so each sign-in starts fresh and switching
   accounts is easy.
   - Fallback: "Use a code on another device" runs the device-code flow (`microsoft.com/link`).
2. Xbox Live, then XSTS, then `login_with_xbox`, which returns a **Minecraft access token** and profile.
3. **Mojang join**: `POST sessionserver.mojang.com/session/minecraft/join` with a random server id.
4. `POST plus.polyfrost.org/account/login?username=…&server_id=…`. The backend checks
   Mojang's `hasJoined` and returns the **Polyfrost token**.

### Token reuse ("use the Polyfrost token if available")

`src/auth/session.ts` keeps the Polyfrost token in memory and in the Keychain/Keystore
(`expo-secure-store`). It keeps reusing that token across app launches until one of these happens:

- the token is 100 minutes old (the server issues it for about 2 hours), or
- any request or websocket handshake gets a `401`.

Only then does it repeat steps 3 and 4. If the Minecraft token has expired (about 24h), the app
first refreshes it silently from the Microsoft refresh token. If Mojang rejects the join, it
refreshes once and tries again. If Microsoft revokes the refresh token, the app signs the user
out and asks them to sign in again.

## Running

You need Node.js 20 or newer.

```bash
npm install
npx expo install --fix   # align native module versions with the Expo SDK
npm run typecheck
npm start                # scan the QR code with Expo Go, or press a / i
```

Native features like secure storage and WebSocket auth headers work in Expo Go. To build
store binaries, use EAS (`npx eas build`).

### Testing on desktop (browser)

```bash
npm run web
```

Then open **http://127.0.0.1:53682**. It has to be `127.0.0.1`, not `localhost`, because that is where Microsoft sends the sign-in popup back.

The command starts two things:

- **The Expo web dev server.** On web, Microsoft sign-in opens in a popup (`src/ui/MicrosoftWebView.web.tsx`) instead of the WebView, and the code comes back over a `BroadcastChannel`.
- **`scripts/dev-proxy.mjs`** on port 53683. `plus.polyfrost.org`, Mojang and Xbox don't accept browser requests (CORS), and Microsoft won't redeem codes for desktop apps when the request comes from a browser. The proxy:
  - adds CORS headers;
  - strips `Origin`;
  - forwards the WebSocket and turns `?access_token=` into an `Authorization` header;
  - listens only on loopback and only accepts the app's own origin.

On web only, credentials are kept in `localStorage`, and confirmation dialogs use the browser's `confirm` and `prompt`. Native builds aren't affected. Neither are the WebView redirect catching or the secure storage, so test those on a real device before release.

### Configuration

The app reads these optional environment variables (put them in `.env`):

| Variable | Default |
| --- | --- |
| `EXPO_PUBLIC_PLUS_BACKEND_URL` | `https://plus.polyfrost.org` (use `https://plus-staging.polyfrost.org` for staging) |
| `EXPO_PUBLIC_MICROSOFT_CLIENT_ID` | OneClient's Azure app id |

## Project layout

```
app/                    expo-router screens
  _layout.tsx           providers + auth-protected routes
  sign-in.tsx           Microsoft sign-in (WebView, with device-code fallback)
  (tabs)/               Chats, Friends, Party, Profile
  chat/[id].tsx         conversation thread
  group/[id].tsx        group info / members
  new-group.tsx
src/
  auth/                 Microsoft, Xbox and Minecraft auth; Polyfrost token; secure storage
  api/plus.ts           PolyPlus REST client (auto re-auth on 401)
  api/socket.ts         live websocket: presence, messages, friend events
  state/                auth context, social store, outbox, username cache, pins, prefs
  ui/                   theme, Material 3 colour scheme and shared components
  notifications.ts      push registration and notification taps
modules/material-you/   native module that reads the Android wallpaper colour
scripts/                web dev proxy and local APK build (keeps the 3 newest APKs in dist/)
```

## Not included (needs the game)

Joining worlds, Play Together, party voice and pings all need a running Minecraft client.

App icon and splash (`assets/`) are rendered from OneClient's own mark (`oneclient-mark.svg` in OneLauncher).
