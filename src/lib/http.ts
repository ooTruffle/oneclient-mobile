export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(describe(status, body, retryAfterSeconds));
    this.name = 'HttpError';
  }

  get isNotFound() {
    return this.status === 404;
  }
}

function describe(status: number, body: string, retryAfter?: number): string {
  // Prefer the server's own wording: a 429 can mean a 3-day Special Chat
  // cooldown as easily as "slow down for a few seconds".
  try {
    const parsed = JSON.parse(body);
    const message =
      parsed?.message ?? parsed?.error_description ?? parsed?.errorMessage ?? parsed?.error;
    if (typeof message === 'string' && message.length > 0) return message;
  } catch {
    // not JSON
  }
  if (status === 429) {
    return `You're doing that too often. Try again in ${retryAfter ?? 5}s.`;
  }
  if (body && body.length < 200) return `${body} (HTTP ${status})`;
  return `Request failed (HTTP ${status})`;
}

/** A request got no response in time (dead or very slow connection). */
export class TimeoutError extends Error {
  constructor() {
    super('The server took too long to respond. Check your connection and try again.');
    this.name = 'TimeoutError';
  }
}

export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * `fetch` that gives up after `timeoutMs`. Mobile connections can stall
 * without ever erroring, which would otherwise leave a spinner up forever.
 * A caller's own `signal` still cancels the request as before.
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const outer = init.signal;
  if (outer?.aborted) throw new AbortError();
  const onOuterAbort = () => controller.abort();
  outer?.addEventListener('abort', onOuterAbort);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new TimeoutError();
    if (outer?.aborted) throw new AbortError();
    throw err;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}

/** Reads a response as JSON, throwing HttpError on non-2xx. Empty bodies resolve to undefined. */
export async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    const retry = Number(res.headers.get('Retry-After'));
    throw new HttpError(res.status, text, Number.isFinite(retry) && retry > 0 ? retry : undefined);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

/** URLSearchParams is only partially implemented in React Native, so encode by hand. */
export function encodeForm(params: Record<string, string | number | undefined | null>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

export function withQuery(url: string, params: Record<string, string | number | undefined | null>) {
  const query = encodeForm(params);
  return query ? `${url}${url.includes('?') ? '&' : '?'}${query}` : url;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortError());
    };
    signal?.addEventListener('abort', onAbort);
  });
}

export class AbortError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'AbortError';
  }
}

/** A request finished after the user switched accounts; its result is thrown away. */
export class AccountChangedError extends AbortError {
  constructor() {
    super();
    this.name = 'AccountChangedError';
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
