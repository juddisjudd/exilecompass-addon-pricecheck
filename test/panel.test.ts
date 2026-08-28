// Run with: bun test/panel.test.ts
//
// Mounts the real panel behind a fake host bridge, exactly as ExileCompass
// does, and drives it: paste an item, search, sort. The trade responses come
// from recorded fixtures rather than the network — this is UI wiring, and it
// should be runnable offline and without spending the IP's rate-limit budget.
// `test/live-search.mjs` is the counterpart that does hit the real API.

import { Window } from 'happy-dom';
import {
  FETCH_RESPONSE,
  LEAGUES_RESPONSE,
  NINJA_RESPONSE,
  RATE_HEADERS,
  SEARCH_RESPONSE,
  STATIC_RESPONSE,
} from './fixtures/trade';

const win = new Window({ url: 'https://opaque.invalid' });
const globals = globalThis as unknown as Record<string, unknown>;
globals.window = win;
globals.document = win.document;
globals.HTMLElement = win.HTMLElement;
globals.navigator = win.navigator;

const statsPath = new URL('./.stats-cache.json', import.meta.url).pathname.replace(/^\//, '');

async function loadStats(): Promise<string> {
  const file = Bun.file(statsPath);
  if (await file.exists()) return file.text();
  // Not rate limited, and only fetched the first time the suite runs.
  const res = await fetch('https://www.pathofexile.com/api/trade2/data/stats', {
    headers: { 'User-Agent': 'ExileCompass/dev (https://github.com/juddisjudd/exilecompass)' },
  });
  const body = await res.text();
  await Bun.write(statsPath, body);
  return body;
}

const stats = await loadStats();
const store = new Map<string, string>();

let searchCount = 0;
const iconRequests: string[] = [];
let lastSort = '';

const host = {
  storage: {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => void store.set(key, value),
  },
  net: {
    fetch: async (url: string) => serve(url),
    fetchCached: async (url: string) => serve(url),
    fetchImage: async (url: string) => {
      iconRequests.push(url);
      return 'data:image/png;base64,AAAA';
    },
    request: async (opts: { url: string; method?: string; body?: string }) => {
      if (opts.method === 'POST') {
        searchCount += 1;
        lastSort = JSON.stringify(JSON.parse(opts.body ?? '{}').sort);
        return { status: 200, headers: RATE_HEADERS, body: JSON.stringify(SEARCH_RESPONSE) };
      }
      return { status: 200, headers: {}, body: JSON.stringify(FETCH_RESPONSE) };
    },
  },
  shell: { openExternal: async () => {} },
};

function serve(url: string): { status: number; body: string } {
  if (url.endsWith('/data/stats')) return { status: 200, body: stats };
  if (url.endsWith('/data/leagues')) return { status: 200, body: JSON.stringify(LEAGUES_RESPONSE) };
  if (url.endsWith('/data/static')) return { status: 200, body: JSON.stringify(STATIC_RESPONSE) };
  if (url.startsWith('https://poe.ninja/')) return { status: 200, body: JSON.stringify(NINJA_RESPONSE) };
  throw new Error(`unexpected GET: ${url}`);
}

const mount = (await import('../src/panel')).default;
const root = win.document.createElement('div');
win.document.body.append(root);
await mount({ root: root as unknown as HTMLElement, host: host as never });

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
const text = () => String(root.textContent).replace(/\s+/g, ' ').trim();
const $ = (sel: string) => root.querySelector(sel) as unknown as HTMLElement | null;
const $$ = (sel: string) => [...root.querySelectorAll(sel)] as unknown as HTMLElement[];
const shown = (sel: string) => {
  const node = $(sel);
  return !!node && node.style.display !== 'none';
};
const click = (node: HTMLElement | undefined) =>
  node?.dispatchEvent(new win.Event('click', { bubbles: true }));
const headings = () => $$('.pc-th').map((n) => String(n.textContent).trim());

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` — ${detail}`}`);
}

const ITEM = `Item Class: Rings
Rarity: Rare
Rune Loop
Prismatic Ring
--------
Item Level: 79
--------
{ Suffix Modifier "of the Penguin" (Tier: 7) — Elemental, Cold, Resistance }
+15(11-15)% to Cold Resistance
`;

await settle(120);
check('league resolves into the footer', /Runes of Aldur/.test(text()), text().slice(0, 120));
check('starts on the paste box', shown('.pc-paste-wrap'));
check('no item header yet', !shown('.pc-item'));

const paste = $('.pc-paste') as HTMLTextAreaElement;
paste.value = ITEM;
paste.dispatchEvent(new win.Event('input', { bubbles: true }));
await settle(150);

check('paste box collapses once parsed', !shown('.pc-paste-wrap'));
check('item header takes its place', shown('.pc-item'));
check('names the item', /Rune Loop/.test(text()));
check('raw copy text is gone', !/Item Class:/.test(text()));
check('property chips rendered', $$('.pc-chip').length > 0, `${$$('.pc-chip').length}`);
check('ilvl chip present', /ilvl\s*79/.test(text()), text().slice(0, 200));

const box = $('.pc-filter input[type=checkbox]') as HTMLInputElement;
box.checked = true;
box.dispatchEvent(new win.Event('change', { bubbles: true }));

click($$('.pc-primary')[0]);
await settle(200);

check('one search ran', searchCount === 1, `count=${searchCount}`);
check('default order is cheapest first', lastSort === '{"price":"asc"}', lastSort);
check('null listings are dropped', $$('.pc-tr').length === 3, `${$$('.pc-tr').length} rows`);
check('filters collapse once there are prices', !shown('.pc-filter-list'));
check('total is reported', /78 listings/.test(text()), text().slice(-160));

check('price column', headings().some((h) => h.startsWith('Price')), headings().join('|'));
check('listed column', headings().includes('Listed'), headings().join('|'));
check('seller column', headings().includes('Seller'), headings().join('|'));
check('ilvl column shown for gear', headings().includes('ilvl'), headings().join('|'));
check('no stock column for a ring', !headings().includes('Stock'), headings().join('|'));

const dots = $$('.pc-dot').map((n) => n.className.replace('pc-dot ', ''));
check('afk seller shows as afk', dots[0] === 'afk', dots.join(','));
check('online seller shows as online', dots[1] === 'online', dots.join(','));
check('missing online key means offline', dots[2] === 'offline', dots.join(','));

// Local sort: ilvl ascending, then descending, with no API call either way.
const ilvls = () => $$('.pc-td.right').map((n) => String(n.textContent).trim());
click($$('.pc-th').find((n) => String(n.textContent).startsWith('ilvl')));
await settle();
check('ilvl sorts ascending', ilvls().join(',') === '47,65,81', ilvls().join(','));
click($$('.pc-th').find((n) => String(n.textContent).startsWith('ilvl')));
await settle();
check('clicking again reverses it', ilvls().join(',') === '81,65,47', ilvls().join(','));
check('caret marks the sorted column', /ilvl\s*↓/.test(text()));
check('local sorting costs no API call', searchCount === 1, `count=${searchCount}`);

// Price order belongs to the server, so it re-runs the search.
click($$('.pc-th').find((n) => String(n.textContent).startsWith('Price')));
await settle(200);
check('price sort re-runs the search', searchCount === 2, `count=${searchCount}`);
check('and flips to descending', lastSort === '{"price":"desc"}', lastSort);

// ── currency images and conversion ──────────────────────────────────────────



check('every price cell shows an icon, not a word', $$('.pc-cur').length === 3, `${$$('.pc-cur').length}`);
check(
  'no currency name in the cell text',
  !$$('.pc-td.price').some((n) => /exalted/i.test(String(n.textContent))),
  $$('.pc-td.price').map((n) => n.textContent).join('/'),
);
check('icons went through the host cache', iconRequests.some((u) => u.includes('exalted')), iconRequests.join(','));
check(
  'the currency name is in the tooltip',
  ($('.pc-td.price') as HTMLElement).title.includes('Exalted Orb'),
  ($('.pc-td.price') as HTMLElement).title,
);
const amounts = () => $$('.pc-amount').map((n) => String(n.textContent).trim());
check(
  'the asking price stays primary',
  amounts().includes('1') && amounts().includes('5'),
  amounts().join(','),
);

// The conversion is appended, not substituted — you whisper for the asking
// price, so that is the number that has to stay readable. And a listing
// already in your core currency has nothing to restate, which is why these
// fixtures (all priced in exalted, the default core) show no parenthetical.
const norms = () => $$('.pc-norm').map((n) => String(n.textContent).trim());
check('no redundant conversion for the core currency', norms().length === 0, norms().join(' '));

// Switching the core currency restates them all, with no further API call.
const cores = $$('.pc-toggle')[1];
check('a core toggle is offered', !!cores, 'no toggle rendered');
const coreButtons = [...cores.children] as HTMLElement[];
check('with exactly two options, as in EE2', coreButtons.length === 2, `${coreButtons.length}`);
check('labelled by abbreviation', coreButtons.map((b) => b.textContent).join(','), 'EX,C');

const searchesBefore = searchCount;
click(coreButtons[1]);
await settle(120);

check('switching core costs no API call', searchCount === searchesBefore, `count=${searchCount}`);
check('every listing now carries a conversion', norms().length === 3, norms().join(' '));
check('shown in parentheses', norms().every((t) => t.startsWith('(') && t.endsWith(')')), norms().join(' '));
check('restated in chaos', norms().every((t) => t.endsWith('c)')), norms().join(' '));
// 1 exalted is 0.0288 chaos here; it must not collapse to "0".
check('sub-unit conversions keep precision', norms().some((t) => /0\.0/.test(t)), norms().join(' '));
check('never a raw float', !norms().some((t) => /\.\d{3,}/.test(t)), norms().join(' '));
check('the choice persists', JSON.parse(store.get('settings.v1') ?? '{}').core === 'chaos');

// Switching league must not leave the other market's prices on screen.
click($$('.pc-toggle button')[1]);
await settle();
check('changing league clears stale listings', $$('.pc-tr').length === 0);
check('and the footer follows', /HC Runes of Aldur/.test(text()), text().slice(0, 160));


click($$('.pc-link').find((n) => String(n.textContent).includes('Change item')));
await settle();
check('“Change item” reopens the paste box', shown('.pc-paste-wrap'));

console.log(failures === 0 ? '\nall passed' : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
