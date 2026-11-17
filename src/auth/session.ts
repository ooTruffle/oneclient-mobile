// Owns the signed-in accounts and hands out Polyfrost tokens for the active one.
//
// Several Minecraft accounts can be signed in at once; one is active and every
// request, the websocket and push notifications use it. Switching is instant
// because each account keeps its own tokens in secure storage.
//
// Token policy ("use the Polyfrost token if it's available"):
//   - A cached Polyfrost token (in memory or SecureStore) is reused until it
//     ages out or the server answers 401, so app launches don't re-auth.
//   - Otherwise we re-run the Mojang join + /account/login handshake, first
//     refreshing the Minecraft token from the Microsoft refresh token if needed.

import { MC_TOKEN_REFRESH_MARGIN_MS, POLY_TOKEN_LIFETIME_MS } from '@/config';
import { refreshAccount } from './microsoft';
import { JoinRejectedError, loginToPolyfrost } from './polyfrost';
import * as storage from './storage';
import { AuthError, type AccountSummary, type MinecraftAccount, type PolyToken } from './types';

export interface SessionState {
  account: MinecraftAccount | null;
  /** Every account signed in on this phone, including the active one. */
  accounts: AccountSummary[];
}

type Listener = (state: SessionState) => void;
/**
 * Runs just before an account is signed out because Microsoft revoked its
 * refresh token. `polyToken` is the last Polyfrost token it had, which the
 * server may still accept; it can't be renewed any more.
 */
type RevokedListener = (accountId: string, polyToken: string | null) => Promise<void>;

class Session {
  private account: MinecraftAccount | null = null;
  private accounts: AccountSummary[] = [];
  private poly: PolyToken | null = null;
  private inflight: { accountId: string; promise: Promise<string> } | null = null;
  private refreshing = new Map<string, Promise<MinecraftAccount>>();
  private listeners = new Set<Listener>();
  private revokedListeners = new Set<RevokedListener>();
  private loaded = false;

  get current(): MinecraftAccount | null {
    return this.account;
  }

  get state(): SessionState {
    return { account: this.account, accounts: this.accounts };
  }

  async load(): Promise<SessionState> {
    if (this.loaded) return this.state;
    const { accounts, active } = await storage.loadAccounts();
    this.accounts = accounts;
    await this.activate(active ?? accounts[0]?.id ?? null);
    this.loaded = true;
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onRevoked(listener: RevokedListener): () => void {
    this.revokedListeners.add(listener);
    return () => this.revokedListeners.delete(listener);
  }

  private async notifyRevoked(accountId: string): Promise<void> {
    const poly = this.poly?.accountId === accountId ? this.poly : await storage.loadPolyToken(accountId);
    for (const listener of this.revokedListeners) {
      try {
        await listener(accountId, poly?.token ?? null);
      } catch (err) {
        console.warn('[session] revoked listener failed', err);
      }
    }
  }

  private emit() {
    const state = this.state;
    for (const listener of this.listeners) listener(state);
  }

  /** Makes `id` the active account (or none), loading its tokens from storage. */
  private async activate(id: string | null): Promise<void> {
    this.inflight = null;
    const account = id ? await storage.loadAccount(id) : null;
    const poly = account ? await storage.loadPolyToken(account.id) : null;
    this.account = account;
    this.poly = account && poly?.accountId === account.id ? poly : null;
    await storage.setActive(account?.id ?? null);
  }

  /** Signs in a new account (or the same one again) and makes it active. */
  async signIn(account: MinecraftAccount): Promise<void> {
    const previous = this.account?.id ?? null;
    const known = this.accounts.some((a) => a.id === account.id);
    this.accounts = await storage.saveAccount(account);
    await storage.savePolyToken(account.id, null);
    await this.activate(account.id);
    try {
      // Fail sign-in early if Polyfrost won't accept this account.
      await this.token();
    } catch (err) {
      // Put things back the way they were: drop a brand-new account, return to the previous one.
      if (!known) this.accounts = await storage.removeAccount(account.id);
      await this.activate(previous);
      throw err;
    }
    this.emit();
  }

  /** Switches to another account that is already signed in on this phone. */
  async switchTo(id: string): Promise<void> {
    if (this.account?.id === id) return;
    if (!this.accounts.some((a) => a.id === id)) throw new AuthError('That account is not signed in.');
    await this.activate(id);
    if (!this.account) {
      // Its tokens are gone (e.g. storage was cleared); forget it.
      this.accounts = await storage.removeAccount(id);
      this.emit();
      throw new AuthError('That account needs to sign in again.', true);
    }
    this.emit();
  }

  /** Signs out one account (the active one by default). Another account, if any, becomes active. */
  async signOut(id = this.account?.id): Promise<void> {
    if (!id) return;
    this.accounts = await storage.removeAccount(id);
    this.refreshing.delete(id);
    if (this.account?.id === id) await this.activate(this.accounts[0]?.id ?? null);
    this.emit();
  }

  /**
   * Returns a Polyfrost bearer token for the active account. Pass the token
   * that just got a 401 as `stale` to force a fresh login.
   */
  async token(stale?: string): Promise<string> {
    const account = this.account;
    if (!account) throw new AuthError('Not signed in.', true);

    const cached = this.poly;
    if (
      cached &&
      cached.accountId === account.id &&
      cached.token !== stale &&
      Date.now() - cached.issuedAt < POLY_TOKEN_LIFETIME_MS
    ) {
      return cached.token;
    }

    if (this.inflight?.accountId !== account.id) {
      const promise = this.login(account.id).finally(() => {
        if (this.inflight?.promise === promise) this.inflight = null;
      });
      this.inflight = { accountId: account.id, promise };
    }
    return this.inflight.promise;
  }

  private async login(accountId: string): Promise<string> {
    let account = await this.freshMinecraftAccount(accountId, false);
    let token: string;
    try {
      token = await loginToPolyfrost(account);
    } catch (err) {
      // Mojang refused the join: the MC token was revoked early. Refresh once and retry.
      if (!(err instanceof JoinRejectedError)) throw err;
      account = await this.freshMinecraftAccount(accountId, true);
      token = await loginToPolyfrost(account);
    }
    const poly = { token, issuedAt: Date.now(), accountId };
    // Keep the token for this account even if the user switched away meanwhile.
    await storage.savePolyToken(accountId, poly);
    if (this.account?.id !== accountId) throw new AuthError('Account changed during sign-in.');
    this.poly = poly;
    return token;
  }

  private async freshMinecraftAccount(accountId: string, force: boolean): Promise<MinecraftAccount> {
    const account = this.account?.id === accountId ? this.account : await storage.loadAccount(accountId);
    if (!account) throw new AuthError('Not signed in.', true);
    if (!force && account.expiresAt - MC_TOKEN_REFRESH_MARGIN_MS > Date.now()) return account;

    let refreshing = this.refreshing.get(accountId);
    if (!refreshing) {
      refreshing = refreshAccount(account)
        .then(async (next) => {
          // Microsoft may rotate the refresh token, so always store the new one.
          if (this.accounts.some((a) => a.id === next.id)) this.accounts = await storage.saveAccount(next);
          if (this.account?.id === next.id) this.account = next;
          return next;
        })
        .catch(async (err) => {
          if (err instanceof AuthError && err.requiresSignIn) {
            await this.notifyRevoked(accountId);
            await this.signOut(accountId);
          }
          throw err;
        })
        .finally(() => {
          this.refreshing.delete(accountId);
        });
      this.refreshing.set(accountId, refreshing);
    }
    return refreshing;
  }
}

export const session = new Session();
