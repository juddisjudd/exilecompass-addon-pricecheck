// GGG's trade API publishes its own limits on every response and bans the
// caller's IP for minutes-to-an-hour when they are broken (§2.3 of PLAN.md).
// So this is a correctness component, not a politeness one: it refuses to
// issue a request it believes would breach a window, rather than firing and
// apologising afterwards.
//
// Header format, one rule per policy, comma-separated windows:
//   X-Rate-Limit-Ip:       5:10:60,15:60:300      hits : period_s : ban_s
//   X-Rate-Limit-Ip-State: 1:10:0,1:60:0          used : period_s : active_ban_s
// Rule names come from X-Rate-Limit-Rules ("Ip", sometimes "Account").

export interface RateWindow {
  /** Requests permitted per period. */
  limit: number;
  periodMs: number;
  banMs: number;
  /** Our own requests since the last sync, newest last. */
  hits: number[];
  /** Server-reported usage as of `reportedAt`. */
  reported: number;
  reportedAt: number;
}

export interface PolicyState {
  windows: RateWindow[];
  /** Epoch ms until which the whole policy is refused (429 / active ban). */
  blockedUntil: number;
}

/** Headroom kept free in every window, so a retry or a stray call has room. */
const RESERVE = 1;

function parseTriples(value: string): Array<[number, number, number]> {
  return value
    .split(',')
    .map((part) => part.trim().split(':').map(Number))
    .filter((n) => n.length === 3 && n.every((v) => Number.isFinite(v)))
    .map((n) => [n[0], n[1], n[2]] as [number, number, number]);
}

export class RateLimiter {
  private policies = new Map<string, PolicyState>();

  constructor(private now: () => number = Date.now) {}

  private policy(name: string): PolicyState {
    let state = this.policies.get(name);
    if (!state) {
      state = { windows: [], blockedUntil: 0 };
      this.policies.set(name, state);
    }
    return state;
  }

  /**
   * When each request counted against `window` stops counting. The server's
   * reported hits are pessimistically all treated as landing at sync time —
   * we only know the count, not when they happened.
   */
  private expiries(window: RateWindow, now: number): number[] {
    const out: number[] = [];
    const reportedExpiry = window.reportedAt + window.periodMs;
    if (reportedExpiry > now) for (let i = 0; i < window.reported; i += 1) out.push(reportedExpiry);
    for (const t of window.hits) if (t + window.periodMs > now) out.push(t + window.periodMs);
    return out.sort((a, b) => a - b);
  }

  /** ms to wait before a request on `policy` may be sent. 0 = go now. */
  delayFor(policy: string): number {
    const state = this.policy(policy);
    const now = this.now();
    let wait = Math.max(0, state.blockedUntil - now);
    for (const w of state.windows) {
      const expiries = this.expiries(w, now);
      const cap = Math.max(1, w.limit - RESERVE);
      if (expiries.length < cap) continue;
      // Wait until enough of them have aged out to leave one slot free.
      const needed = expiries.length - cap + 1;
      wait = Math.max(wait, expiries[needed - 1] - now);
    }
    return wait;
  }

  /** Record that a request is going out now. Call immediately before sending. */
  spend(policy: string): void {
    const state = this.policy(policy);
    const now = this.now();
    for (const w of state.windows) {
      w.hits.push(now);
      w.hits = w.hits.filter((t) => t + w.periodMs > now);
    }
  }

  /**
   * Adopt the server's own view from a response. The policy name is whatever
   * the response says it is, so one limiter tracks search and fetch
   * separately without being told which is which.
   *
   * Local hits are cleared: the response being synced is itself one of them,
   * and the server's count already includes every request that reached it.
   * That holds because trade calls are issued one at a time.
   */
  sync(headers: Record<string, string>): void {
    const get = (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? '';
    const policyName = get('x-rate-limit-policy');
    if (!policyName) return;
    const state = this.policy(policyName);
    const now = this.now();
    const rules = get('x-rate-limit-rules')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);

    for (const rule of rules) {
      const limits = parseTriples(get(`x-rate-limit-${rule.toLowerCase()}`));
      const used = parseTriples(get(`x-rate-limit-${rule.toLowerCase()}-state`));
      if (!limits.length) continue;

      limits.forEach(([limit, period, ban], i) => {
        const periodMs = period * 1000;
        let window = state.windows.find((w) => w.periodMs === periodMs);
        if (!window) {
          window = { limit, periodMs, banMs: ban * 1000, hits: [], reported: 0, reportedAt: 0 };
          state.windows.push(window);
        }
        window.limit = limit;
        window.banMs = ban * 1000;
        window.reported = used[i]?.[0] ?? 0;
        window.reportedAt = now;
        window.hits = [];
        if (used[i]?.[2]) {
          // The server says we are already banned on this window.
          state.blockedUntil = Math.max(state.blockedUntil, now + used[i][2] * 1000);
        }
      });
    }
  }

  /** Called on a 429. `retryAfter` is the header value, in seconds. */
  penalise(policy: string, retryAfter?: string): void {
    const state = this.policy(policy);
    const seconds = Number(retryAfter);
    const longestBan = state.windows.reduce((max, w) => Math.max(max, w.banMs), 60_000);
    const waitMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : longestBan;
    state.blockedUntil = Math.max(state.blockedUntil, this.now() + waitMs);
  }


  /**
   * The tightest window's usage, for the readout Sidekick keeps in its status
   * bar ("1/5 in 10 s"). Seeing the budget is the point: this limiter exists
   * because overrunning it bans the player's IP from trade.
   */
  describe(policy: string): { used: number; limit: number; period: number } | null {
    const state = this.policies.get(policy);
    if (!state?.windows.length) return null;
    const now = this.now();
    const tightest = state.windows.reduce((a, b) => (a.periodMs <= b.periodMs ? a : b));
    return {
      used: this.expiries(tightest, now).length,
      limit: tightest.limit,
      period: Math.round(tightest.periodMs / 1000),
    };
  }

  /** Whole seconds left before `policy` is usable, for the UI. */
  secondsUntilReady(policy: string): number {
    return Math.ceil(this.delayFor(policy) / 1000);
  }
}
