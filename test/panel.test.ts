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
const headings = () => $$('th').map((n) => String(n.textContent).trim());

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

// The paste strip stays put: it is one line now, so it costs nothing to leave
// available for the next item.
check('the paste strip stays available', shown('.pc-paste-wrap'));
check('and empties itself once read', ($('.pc-paste') as HTMLTextAreaElement).value === '');
check('item header takes its place', shown('.pc-item'));
check('names the item', /Rune Loop/.test(text()));
check('raw copy text is gone', !/Item Class:/.test(text()));
check('property chips rendered', $$('.pc-chip').length > 0, `${$$('.pc-chip').length}`);
check('ilvl chip present', /ilvl\s*79/.test(text()), text().slice(0, 200));

const box = $('.pc-filter input[type=checkbox]') as HTMLInputElement;
box.checked = true;
box.dispatchEvent(new win.Event('change', { bubbles: true }));

click($('.pc-search') as HTMLElement);
await settle(200);

check('one search ran', searchCount === 1, `count=${searchCount}`);
check('default order is cheapest first', lastSort === '{"price":"asc"}', lastSort);
check('null listings are dropped', $$('.pc-card').length === 3, `${$$('.pc-card').length} cards`);
check('total is reported', /Showing 3 of 78/.test(text()), text().slice(0, 300));

// ── the layout is two panes ─────────────────────────────────────────────────
// Stacked, the filters pushed the listings off the bottom. Item and filters
// live on the left now, listings on the right, as Sidekick lays it out.
check('there are two panes', !!$('.pc-panes'), 'no pane container');
check('the item and filters are in the side pane', !!$('.pc-side .pc-item') && !!$('.pc-side .pc-filters'));
check('the listings are not', !$('.pc-side .pc-card'), 'listings ended up in the side pane');
check('search sits under the filters it acts on', !!$('.pc-side .pc-search'));
check('the filters stay open alongside results', shown('.pc-filter-list'));

// ── each listing is a card showing the item ─────────────────────────────────
const firstCard = $('.pc-card') as HTMLElement;
const cardText = () => String(firstCard.textContent).replace(/\s+/g, ' ');
check('the item is named', /Dusk Turn/.test(cardText()), cardText());
check('with its base and level', /Prismatic Ring/.test(cardText()) && /Requires Level 39/.test(cardText()), cardText());
check('the implicit is shown', /\+10% to all Elemental Resistances/.test(cardText()), cardText());
check('and every explicit', /\+43 to Evasion Rating/.test(cardText()) && /\+82 to maximum Life/.test(cardText()), cardText());
check('no leftover link markup', !/[[\]|]/.test(cardText()), cardText());
check('no expansion needed to see it', $$('.pc-item-btn').length === 0, 'still behind a control');

// Sidekick puts the affix tier in the margin, prefixes and suffixes coloured
// apart. Ours reads the same P#/S# shorthand straight off the payload.
const tiers = $$('.pc-card .pc-affix').filter((n) => String(n.textContent).trim());
check('affix tiers are badged', tiers.map((n) => n.textContent).join(',') === 'P7,P3', tiers.map((n) => n.textContent).join(','));
check('prefixes are marked as prefixes', tiers.every((n) => n.className.includes('prefix')), tiers.map((n) => n.className).join('|'));
check('roll ranges are shown', /39–51/.test(cardText()) && /70–84/.test(cardText()), cardText());


// ── properties and requirements ─────────────────────────────────────────────
const boots = $$('.pc-card')[1] as HTMLElement;
const bootsText = String(boots.textContent).replace(/\s+/g, ' ');
check('property names are unwrapped', /Energy Shield: 37/.test(bootsText), bootsText);
check('so are requirement names', /56 Str/.test(bootsText) && /56 Int/.test(bootsText), bootsText);
check('no link markup survives anywhere', !/[[\]|]/.test(bootsText), bootsText);
check('properties read as a list', /Boots · Armour: 134 · Energy Shield: 37/.test(bootsText), bootsText);
check('requirements read as the game phrases them', /Requires Level 75, 56 Str, 56 Int/.test(bootsText), bootsText);

// Price, seller and age sit together on the card's right.
check('the price is on the card', !!$('.pc-card .pc-price'), 'no price');
check('so is the seller', /AfkAlchemist/.test(cardText()), cardText());
// Ages are relative to now, so assert the shape rather than a value that goes
// stale the moment the fixture does.
check(
  'and how long it has been listed',
  /^[0-9]+(m|h|d|mo)$/.test(String($('.pc-card-age')?.textContent).trim()),
  String($('.pc-card-age')?.textContent),
);
const dots = $$('.pc-dot').map((n) => n.className.replace('pc-dot ', ''));
check('afk seller shows as afk', dots[0] === 'afk', dots.join(','));
check('online seller shows as online', dots[1] === 'online', dots.join(','));
check('missing online key means offline', dots[2] === 'offline', dots.join(','));

// ── sorting, without columns to click ───────────────────────────────────────
const cardNames = () => $$('.pc-card .pc-item-name').map((n) => String(n.textContent).trim());
check('starts in the order the server returned', cardNames().join(',') === 'Dusk Turn,Blood Band,Rift Gyre', cardNames().join(','));

const searchesBeforeSort = searchCount;
click($$('.pc-sort').find((n) => String(n.textContent).startsWith('ilvl')));
await settle();
check('ilvl sorts ascending', cardNames().join(',') === 'Dusk Turn,Rift Gyre,Blood Band', cardNames().join(','));
click($$('.pc-sort').find((n) => String(n.textContent).startsWith('ilvl')));
await settle();
check('clicking again reverses it', cardNames().join(',') === 'Blood Band,Rift Gyre,Dusk Turn', cardNames().join(','));
check('the active sort is marked', /ilvl\s*↓/.test(text()));
check('local sorting costs no API call', searchCount === searchesBeforeSort, `count=${searchCount}`);

// Price order belongs to the server, so choosing it re-runs the search.
click($$('.pc-sort').find((n) => String(n.textContent).startsWith('Price')));
await settle(200);
check('price sort re-runs the search', searchCount === 2, `count=${searchCount}`);
check('and returns to the server order', cardNames().join(',') === 'Dusk Turn,Blood Band,Rift Gyre', cardNames().join(','));

// ── currency images and conversion ──────────────────────────────────────────
check('every price shows an icon, not a word', $$('.pc-cur').length === 3, `${$$('.pc-cur').length}`);
check(
  'no currency name in the price text',
  !$$('.pc-price').some((n) => /exalted/i.test(String(n.textContent))),
  $$('.pc-price').map((n) => n.textContent).join('/'),
);
check('icons went through the host cache', iconRequests.some((u) => u.includes('exalted')), iconRequests.join(','));
check(
  'the currency name is on the icon',
  ($('.pc-cur') as HTMLImageElement).title.includes('Exalted Orb'),
  ($('.pc-cur') as HTMLImageElement).title,
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
// On its own line under the price now, so it needs no parentheses to be
// told apart from the asking price.
check('shown under the asking price', norms().every((t) => /^[0-9.]+ [a-z]+$/.test(t)), norms().join(' '));
check('restated in chaos', norms().every((t) => t.endsWith(' c')), norms().join(' '));
// 1 exalted is 0.0288 chaos here; it must not collapse to "0".
check('sub-unit conversions keep precision', norms().some((t) => /0\.0/.test(t)), norms().join(' '));
check('never a raw float', !norms().some((t) => /\.\d{3,}/.test(t)), norms().join(' '));
check('the choice persists', JSON.parse(store.get('settings.v1') ?? '{}').core === 'chaos');

// Switching league must not leave the other market's prices on screen.
click($$('.pc-toggle button')[1]);
await settle();
check('changing league clears stale listings', $$('.pc-tr').length === 0);
check('and the footer follows', /HC Runes of Aldur/.test(text()), text().slice(0, 160));


// Clear drops the item, its filters and its results in one go.
click($$('.pc-link').find((n) => String(n.textContent).includes('Clear')));
await settle();
check('Clear removes the item', !shown('.pc-item'));
check('and its filters', $$('.pc-filter').length === 0, `${$$('.pc-filter').length} rows left`);
check('and its listings', $$('.pc-card').length === 0, `${$$('.pc-card').length} cards left`);
check('leaving the paste strip ready', shown('.pc-paste-wrap'));

console.log(failures === 0 ? '\nall passed' : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
