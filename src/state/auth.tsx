import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { session, type SessionState } from '@/auth/session';
import type { AccountSummary, MinecraftAccount } from '@/auth/types';
import { registerForPush, unregisterForPush, watchPushTokenChanges } from '@/notifications';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: AuthStatus;
  account: MinecraftAccount | null;
  /** Every account signed in on this phone, including the active one. */
  accounts: AccountSummary[];
  /** Signs in an account (new or existing) and makes it active. */
  signIn: (account: MinecraftAccount) => Promise<void>;
  switchAccount: (id: string) => Promise<void>;
  /** Signs out the active account; another one, if any, takes over. */
  signOut: () => Promise<void>;
  /** Removes an account that isn't active. */
  removeAccount: (id: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ account: null, accounts: [] });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const unsubscribe = session.subscribe(setState);
    session
      .load()
      .then(setState)
      .catch(() => setState({ account: null, accounts: [] }))
      .finally(() => setLoaded(true));
    return unsubscribe;
  }, []);

  // Register on every signed-in launch and after switching accounts: Expo
  // tokens can rotate, and the backend moves a token to whoever registers it,
  // so pushes follow the active account.
  const { account, accounts } = state;
  const accountId = account?.id;
  useEffect(() => {
    if (!accountId) return;
    registerForPush().catch((err) => console.warn('Push registration failed', err));
    return watchPushTokenChanges();
  }, [accountId]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: !loaded ? 'loading' : account ? 'signedIn' : 'signedOut',
      account,
      accounts,
      signIn: (next) => session.signIn(next),
      switchAccount: (id) => session.switchTo(id),
      signOut: async () => {
        await unregisterForPush();
        await session.signOut();
      },
      removeAccount: (id) => session.signOut(id),
    }),
    [account, accounts, loaded],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** For screens that only render while signed in. */
export function useAccount(): MinecraftAccount {
  const { account } = useAuth();
  if (!account) throw new Error('No signed-in account');
  return account;
}
