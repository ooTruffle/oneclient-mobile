// Local dev proxy so the web build can talk to services that don't allow
// browser (CORS) requests. Dev-only: binds to 127.0.0.1 and only serves the
// app's own dev origin.
//
//   /proxy/<name>/<path>        -> https://<upstream>/<path>  (HTTP, CORS added)
//   /proxy/plus/websocket?access_token=..  -> wss://plus.../websocket with
//                                            "Authorization: Bearer <token>"
//                                            (browsers can't set WS headers)

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { pathToFileURL } from 'node:url';

const trim = (url) => url.replace(/\/+$/, '');

export const PROXY_PORT = Number(process.env.PROXY_PORT || 53683);
export const APP_ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:53682';

const ROUTES = {
  plus: trim(process.env.EXPO_PUBLIC_PLUS_BACKEND_URL || 'https://plus.polyfrost.org'),
  mslogin: 'https://login.microsoftonline.com',
  xbl: 'https://user.auth.xboxlive.com',
  xsts: 'https://xsts.auth.xboxlive.com',
  mcservices: 'https://api.minecraftservices.com',
  mojang: 'https://sessionserver.mojang.com',
};

const CORS = {
  'access-control-allow-origin': APP_ORIGIN,
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, accept, x-xbl-contract-version',
  'access-control-expose-headers': 'retry-after',
  'access-control-max-age': '600',
  vary: 'origin',
};

// Headers that would make upstreams treat us as a browser (e.g. Microsoft
// refuses token redemption from cross-origin requests for desktop apps).
const STRIP_REQUEST = ['origin', 'referer', 'host', 'connection', 'cookie'];

function resolve(url) {
  const match = /^\/proxy\/([a-z]+)(\/[^?]*)?(\?.*)?$/.exec(url ?? '');
  if (!match || !ROUTES[match[1]]) return null;
  return { name: match[1], target: new URL(`${ROUTES[match[1]]}${match[2] ?? '/'}${match[3] ?? ''}`) };
}

function forbidden(origin) {
  return origin !== undefined && origin !== APP_ORIGIN;
}

function handleHttp(req, res) {
  if (forbidden(req.headers.origin)) {
    res.writeHead(403).end('Origin not allowed');
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS).end();
    return;
  }
  const route = resolve(req.url);
  if (!route) {
    res.writeHead(404, CORS).end('Unknown proxy route');
    return;
  }

  const headers = { ...req.headers };
  for (const name of Object.keys(headers)) {
    if (STRIP_REQUEST.includes(name) || name.startsWith('sec-')) delete headers[name];
  }
  headers.host = route.target.host;

  const client = route.target.protocol === 'https:' ? https : http;
  const upstream = client.request(route.target, { method: req.method, headers }, (up) => {
    const out = {};
    for (const [name, value] of Object.entries(up.headers)) {
      if (!name.startsWith('access-control-') && name !== 'set-cookie') out[name] = value;
    }
    res.writeHead(up.statusCode ?? 502, { ...out, ...CORS });
    up.pipe(res);
  });
  upstream.on('error', (err) => {
    if (!res.headersSent) res.writeHead(502, CORS);
    res.end(`Proxy error: ${err.message}`);
  });
  req.pipe(upstream);
}

function handleUpgrade(req, socket, head) {
  const route = resolve(req.url);
  if (forbidden(req.headers.origin) || route?.name !== 'plus' || route.target.pathname !== '/websocket') {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  const token = route.target.searchParams.get('access_token') ?? '';
  const target = route.target;
  const secure = target.protocol === 'https:';
  const port = Number(target.port) || (secure ? 443 : 80);

  const onConnect = () => {
    const request = [
      `GET /websocket HTTP/1.1`,
      `Host: ${target.host}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${req.headers['sec-websocket-key']}`,
      `Sec-WebSocket-Version: ${req.headers['sec-websocket-version'] ?? '13'}`,
      `Authorization: Bearer ${token}`,
      'User-Agent: OneClient Mobile (web dev proxy)',
    ];
    upstream.write(`${request.join('\r\n')}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  };
  const upstream = secure
    ? tls.connect({ host: target.hostname, port, servername: target.hostname }, onConnect)
    : net.connect({ host: target.hostname, port }, onConnect);

  const close = () => {
    upstream.destroy();
    socket.destroy();
  };
  upstream.on('error', close);
  socket.on('error', close);
  upstream.on('close', () => socket.destroy());
  socket.on('close', () => upstream.destroy());
}

export function startProxy() {
  const server = http.createServer(handleHttp);
  server.on('upgrade', handleUpgrade);
  return new Promise((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(PROXY_PORT, '127.0.0.1', () => {
      console.log(`[proxy] http://127.0.0.1:${PROXY_PORT}/proxy/* -> ${Object.values(ROUTES).join(', ')}`);
      resolveStart(server);
    });
  });
}

// Allow running the proxy on its own: `node scripts/dev-proxy.mjs`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startProxy();
}
