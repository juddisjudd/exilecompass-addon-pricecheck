import type { AddonHost, AddonRequestResponse } from '../types';
import { RateLimiter } from './rate-limiter';

export const TRADE_BASE = 'https://www.pathofexile.com/api/trade2';
export const TRADE_SITE = 'https://www.pathofexile.com/trade2/search/poe2';

/** Thrown for anything the panel should show the user verbatim. */
export class TradeError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'TradeError';
  }
}

export interface ClientOptions {
  /** Called whenever the limiter makes us wait, so the UI can say why. */
  onWait?: (seconds: number, policy: string) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Every call to the trade API goes through here: one rate limiter, one place
 * that knows the endpoints, one place that turns GGG's error bodies into
 * something readable.
 */
export class TradeClient {
  readonly limiter = new RateLimiter();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private host: AddonHost,
    private opts: ClientOptions = {},
  ) {}

  /**
   * Large, slow-moving payloads (`/data/*`, 849 KB for stats alone) go through
   * the host's disk cache. These are not rate limited — GGG serves them as
   * static data — but they are also not free to re-download every mount.
   */
  async fetchData<T>(path: string, maxAgeSeconds = 24 * 60 * 60): Promise<T> {
    const net = this.host.net;
    if (!net) throw new TradeError('This ExileCompass build has no network bridge.');
    const url = `${TRADE_BASE}${path}`;
    const res = net.fetchCached
      ? await net.fetchCached(url, maxAgeSeconds)
      : await net.fetch(url);
    if (res.status !== 200) throw new TradeError(`${path} returned HTTP ${res.status}`, res.status);
    return JSON.parse(res.body) as T;
  }

  /**
   * A rate-limited trade call. Requests are serialised — the limiter's view of
   * "how many are in flight" is only honest if they go out one at a time, and
   * a price check is two calls (search then fetch), not a fan-out.
   */
  request(policy: string, opts: { url: string; method?: 'GET' | 'POST'; body?: unknown }): Promise<AddonRequestResponse> {
    const run = this.queue.then(() => this.send(policy, opts));
    // Keep the chain alive even when a call fails.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async send(
    policy: string,
    opts: { url: string; method?: 'GET' | 'POST'; body?: unknown },
  ): Promise<AddonRequestResponse> {
    const request = this.host.net?.request;
    if (!request)
      throw new TradeError(
        'This ExileCompass build cannot POST to the trade API. Update to 1.5.0 or newer.',
      );

    const wait = this.limiter.delayFor(policy);
    if (wait > 0) {
      this.opts.onWait?.(Math.ceil(wait / 1000), policy);
      await sleep(wait);
    }

    const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    this.limiter.spend(policy);
    const res = await request({
      url: opts.url,
      method: opts.method ?? 'GET',
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body,
    });
    this.limiter.sync(res.headers);

    if (res.status === 429) {
      this.limiter.penalise(policy, res.headers['retry-after']);
      throw new TradeError(
        `Rate limited by the trade API. Try again in ${this.limiter.secondsUntilReady(policy)}s.`,
        429,
      );
    }
    if (res.status < 200 || res.status >= 300) throw new TradeError(errorMessage(res), res.status);
    return res;
  }
}

/** GGG returns `{"error":{"code":n,"message":"..."}}` for most failures. */
function errorMessage(res: AddonRequestResponse): string {
  try {
    const parsed = JSON.parse(res.body) as { error?: { message?: string } };
    if (parsed.error?.message) return `${parsed.error.message} (HTTP ${res.status})`;
  } catch {
    /* not JSON — fall through */
  }
  return `Trade API returned HTTP ${res.status}`;
}
