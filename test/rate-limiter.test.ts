// Run with: bun test/rate-limiter.test.ts
// A fake clock, because the thing under test is entirely about time.

import { RateLimiter } from '../src/trade/rate-limiter';

let clock = 1_000_000;
const now = () => clock;
const advance = (ms: number) => {
  clock += ms;
};

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` — got ${actual}, want ${expected}`}`);
}

// Real headers from a search response (PLAN.md §2.3).
const SEARCH_HEADERS = {
  'x-rate-limit-policy': 'trade-search-request-limit',
  'x-rate-limit-rules': 'Ip',
  'x-rate-limit-ip': '5:10:60,15:60:300,30:300:1800,600:21600:3600',
  'x-rate-limit-ip-state': '1:10:0,1:60:0,1:300:0,1:21600:0',
};
const POLICY = 'trade-search-request-limit';

// A limiter that has never seen a response lets the first request through —
// otherwise nothing could ever learn the limits.
{
  const rl = new RateLimiter(now);
  check('unseen policy is free', rl.delayFor(POLICY), 0);
}

// 5 hits per 10s, minus the reserve, means 4 back-to-back then a wait.
{
  const rl = new RateLimiter(now);
  rl.sync(SEARCH_HEADERS);
  // sync() adopted "1 used" from the server, so 3 more fit under the cap of 4.
  for (let i = 0; i < 3; i += 1) {
    check(`burst ${i + 1} is free`, rl.delayFor(POLICY), 0);
    rl.spend(POLICY);
  }
  const wait = rl.delayFor(POLICY);
  check('burst is capped', wait > 0, true);
  check('waits out the 10s window', wait <= 10_000, true);

  advance(wait);
  check('free again after the wait', rl.delayFor(POLICY), 0);
}

// A ban reported in the state triple blocks the whole policy.
{
  const rl = new RateLimiter(now);
  rl.sync({ ...SEARCH_HEADERS, 'x-rate-limit-ip-state': '5:10:37,1:60:0,1:300:0,1:21600:0' });
  check('active ban blocks', rl.secondsUntilReady(POLICY), 37);
  advance(37_000);
  check('ban expires', rl.delayFor(POLICY), 0);
}

// 429 with Retry-After.
{
  const rl = new RateLimiter(now);
  rl.sync(SEARCH_HEADERS);
  rl.penalise(POLICY, '60');
  check('429 honours Retry-After', rl.secondsUntilReady(POLICY), 60);
  advance(59_000);
  check('still blocked at 59s', rl.secondsUntilReady(POLICY), 1);
  advance(1_000);
  check('clear at 60s', rl.delayFor(POLICY), 0);
}

// 429 without Retry-After falls back to the longest published ban.
{
  const rl = new RateLimiter(now);
  rl.sync(SEARCH_HEADERS);
  rl.penalise(POLICY);
  check('429 without header uses longest ban', rl.secondsUntilReady(POLICY), 3600);
}

// Search and fetch have separate policies and must not share a budget.
{
  const rl = new RateLimiter(now);
  rl.sync(SEARCH_HEADERS);
  rl.sync({
    'x-rate-limit-policy': 'trade-fetch-request-limit',
    'x-rate-limit-rules': 'Ip',
    'x-rate-limit-ip': '12:4:10,16:12:300,50:300:300,1000:21600:1800',
    'x-rate-limit-ip-state': '0:4:0,0:12:0,0:300:0,0:21600:0',
  });
  rl.penalise(POLICY, '60');
  check('fetch unaffected by a search ban', rl.delayFor('trade-fetch-request-limit'), 0);
}

// The narrowest window wins when several apply.
{
  const rl = new RateLimiter(now);
  rl.sync({
    'x-rate-limit-policy': POLICY,
    'x-rate-limit-rules': 'Ip',
    'x-rate-limit-ip': '5:10:60,6:3600:300',
    'x-rate-limit-ip-state': '0:10:0,4:3600:0',
  });
  // 4 of 6 used in the hour window; the cap of 5 leaves one request.
  check('hour window still has room', rl.delayFor(POLICY), 0);
  rl.spend(POLICY);
  const wait = rl.delayFor(POLICY);
  check('hour window then blocks', wait > 10_000, true);
  check('and blocks for up to an hour', wait <= 3_600_000, true);
}

console.log(failures === 0 ? '\nall passed' : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
