// Live connection to wss://plus.polyfrost.org/websocket, the same socket
// PolyPlus (`PolyConnection`) and OneLauncher (`session.rs`) use for
// presence, chat and friend events.

import { session } from '@/auth/session';
import { PLUS_SOCKET_URL, SOCKET_TOKEN_IN_QUERY } from '@/config';
import { withQuery } from '@/lib/http';
import type { ClientboundPacket } from './types';

// React Native's WebSocket accepts a third `options` argument with headers.
type RNWebSocketCtor = new (
  url: string,
  protocols?: string | string[] | null,
  options?: { headers: Record<string, string> },
) => WebSocket;
const RNWebSocket = WebSocket as unknown as RNWebSocketCtor;

const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 60_000;
const MAX_PLAYERS_PER_PACKET = 64;
const MAX_WATCHED = 512;
// Liveness. A connection can die without closing (e.g. Wi-Fi to mobile data),
// and the server sends no pings, so after a quiet spell we send an empty
// SubscribePlayers, which the server always answers with a SubscriptionSnapshot.
// No answer in time means the socket is dead: drop it and reconnect.
const CHECK_EVERY_MS = 10_000;
const IDLE_BEFORE_PROBE_MS = 30_000;
const PROBE_TIMEOUT_MS = 10_000;

type PacketListener = (packet: ClientboundPacket) => void;
type StatusListener = (connected: boolean) => void;

class PlusSocket {
  private ws: WebSocket | null = null;
  private running = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private staleToken: string | undefined;
  private packetListeners = new Set<PacketListener>();
  private statusListeners = new Set<StatusListener>();
  private wanted = new Set<string>();
  private subscribed = new Set<string>();
  private liveness: ReturnType<typeof setInterval> | null = null;
  private lastHeard = 0;
  private probeSentAt: number | null = null;
  connected = false;

  onPacket(listener: PacketListener) {
    this.packetListeners.add(listener);
    return () => {
      this.packetListeners.delete(listener);
    };
  }

  onStatus(listener: StatusListener) {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    void this.connect();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stopLiveness();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.setConnected(false);
  }

  private startLiveness() {
    this.stopLiveness();
    this.lastHeard = Date.now();
    this.probeSentAt = null;
    this.liveness = setInterval(() => this.checkLiveness(), CHECK_EVERY_MS);
  }

  private stopLiveness() {
    if (this.liveness) clearInterval(this.liveness);
    this.liveness = null;
    this.probeSentAt = null;
  }

  private checkLiveness() {
    const ws = this.ws;
    if (!ws || !this.connected) return;
    const now = Date.now();
    if (this.probeSentAt !== null) {
      if (now - this.probeSentAt < PROBE_TIMEOUT_MS) return;
      // No answer: the connection is gone even though it never closed.
      this.stopLiveness();
      this.ws = null; // its late onclose is ignored
      ws.close();
      this.setConnected(false);
      this.attempt = 0; // reconnect quickly, this isn't a server problem
      this.scheduleReconnect();
      return;
    }
    if (now - this.lastHeard >= IDLE_BEFORE_PROBE_MS) {
      this.probeSentAt = now;
      this.send({ type: 'SubscribePlayers', players: [] });
    }
  }

  /** Players whose presence we want pushed to us (friends, DM partners). */
  setWatched(players: string[]) {
    this.wanted = new Set(players.slice(0, MAX_WATCHED));
    this.syncWatched();
  }

  private setConnected(value: boolean) {
    if (this.connected === value) return;
    this.connected = value;
    for (const listener of this.statusListeners) listener(value);
  }

  private async connect() {
    if (!this.running) return;
    let token: string;
    try {
      token = await session.token(this.staleToken);
      this.staleToken = undefined;
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (!this.running) return;

    const ws = SOCKET_TOKEN_IN_QUERY
      ? new WebSocket(withQuery(PLUS_SOCKET_URL, { access_token: token }))
      : new RNWebSocket(PLUS_SOCKET_URL, null, { headers: { Authorization: `Bearer ${token}` } });
    this.ws = ws;
    let opened = false;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      opened = true;
      this.attempt = 0;
      this.subscribed.clear();
      this.setConnected(true);
      this.startLiveness();
      this.syncWatched();
    };
    ws.onmessage = (event) => {
      // A socket we already dropped (e.g. the previous account's) can still deliver a last message.
      if (this.ws !== ws) return;
      this.lastHeard = Date.now();
      this.probeSentAt = null;
      if (typeof event.data !== 'string') return;
      let packet: ClientboundPacket;
      try {
        packet = JSON.parse(event.data);
      } catch {
        return;
      }
      for (const listener of this.packetListeners) {
        try {
          listener(packet);
        } catch (err) {
          console.warn('[socket] listener failed', err);
        }
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopLiveness();
      this.setConnected(false);
      // A handshake that never opened is most often a rejected (expired) token.
      if (!opened && this.attempt >= 1) this.staleToken = token;
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose follows and handles reconnecting.
    };
  }

  private scheduleReconnect() {
    if (!this.running || this.timer) return;
    this.attempt++;
    const delay = Math.min(BASE_DELAY_MS * 2 ** (this.attempt - 1), MAX_DELAY_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, delay);
  }

  private send(packet: object) {
    if (this.ws && this.connected) this.ws.send(JSON.stringify(packet));
  }

  private syncWatched() {
    if (!this.connected) return;
    const removed = [...this.subscribed].filter((p) => !this.wanted.has(p));
    const added = [...this.wanted].filter((p) => !this.subscribed.has(p));
    for (let i = 0; i < removed.length; i += MAX_PLAYERS_PER_PACKET) {
      this.send({ type: 'UnsubscribePlayers', players: removed.slice(i, i + MAX_PLAYERS_PER_PACKET) });
    }
    for (let i = 0; i < added.length; i += MAX_PLAYERS_PER_PACKET) {
      this.send({ type: 'SubscribePlayers', players: added.slice(i, i + MAX_PLAYERS_PER_PACKET) });
    }
    this.subscribed = new Set(this.wanted);
  }
}

export const plusSocket = new PlusSocket();
