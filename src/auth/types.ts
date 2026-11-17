export interface MinecraftAccount {
  /** Profile UUID in dashed form (the PolyPlus API uses dashed UUIDs). */
  id: string;
  username: string;
  /** Minecraft services access token (~24h). */
  accessToken: string;
  /** Microsoft refresh token, used to mint a new Minecraft token silently. */
  refreshToken: string;
  /** Epoch ms when `accessToken` expires. */
  expiresAt: number;
}

/** What the account switcher shows; no tokens. */
export interface AccountSummary {
  id: string;
  username: string;
}

export interface PolyToken {
  token: string;
  issuedAt: number;
  accountId: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    /** True when the stored credentials can no longer be used and the user must sign in again. */
    public readonly requiresSignIn = false,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export function dashUuid(id: string): string {
  const hex = id.replace(/-/g, '').toLowerCase();
  if (hex.length !== 32) return id;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const undashUuid = (id: string) => id.replace(/-/g, '').toLowerCase();
