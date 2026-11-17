// `npm run web`: starts the dev proxy and the Expo web dev server together.
//
// The app must be served from http://127.0.0.1:53682: that is the loopback
// redirect URI Microsoft sends the sign-in popup back to, so the popup lands
// on our own origin and the app can read the auth code.

import { spawn } from 'node:child_process';
import { APP_ORIGIN, startProxy } from './dev-proxy.mjs';

await startProxy();

const port = new URL(APP_ORIGIN).port;
const expo = spawn('npx', ['expo', 'start', '--web', '--port', port], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, BROWSER: 'none' },
});

console.log(`\n  Open ${APP_ORIGIN} (use 127.0.0.1, not localhost, or Microsoft sign-in can't return to the app)\n`);

const stop = () => {
  expo.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
expo.on('exit', (code) => process.exit(code ?? 0));
