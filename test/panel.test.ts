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
const click = (node: HTMLElement | undefined | null) =>
  node?.dispatchEvent(new win.Event('click', { bubbles: true }));

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
{ Implicit Modifier — Elemental, Fire, Cold, Lightning, Resistance }
+8(7-10)% to all Elemental Resistances
--------
{ Suffix Modifier "of the Penguin" (Tier: 7) — Elemental, Cold, Resistance }
+15(11-15)% to Cold Resistance
`;

await settle(120);
check('league resolves into the footer', /Runes of Aldur/.test(text()), text().slice(0, 120));
check('starts on the paste box', shown('.pc-paste-wrap'));
check('no item header yet', !shown('.pc-item'));
check('the empty state does not point left', !/on the left/.test(text()), text());

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

// ── filter rows ─────────────────────────────────────────────────────────────
// A row is its text until it is ticked (Sidekick's `StatFilterComponent`):
// the numbers only exist for a filter that is on.
const rows = $$('.pc-filter');
check('one row per mod line', rows.length === 2, `${rows.length}`);
check('rows start unticked', rows.every((r) => !r.className.includes('on')));
check('every row still carries its numbers', $$('.pc-filter .pc-range').length === 2);
check('there is no comparison button', $$('.pc-compare').length === 0);
check('there is no order dropdown', $$('.pc-search-wrap select').length === 0);

// The player's own suffix wears the same badge the listings do.
const suffixBadge = rows[1].querySelector('.pc-affix');
check('the suffix is badged S7', suffixBadge?.textContent === 'S7', String(suffixBadge?.textContent));
check('as a suffix', !!suffixBadge?.className.includes('suffix'), String(suffixBadge?.className));
check('the implicit gets no affix badge', !rows[0].querySelector('.pc-affix'));
check('labels are real labels', rows[0].querySelector('label.pc-label') !== null);

const box = rows[1].querySelector('input[type=checkbox]') as HTMLInputElement;
box.checked = true;
box.dispatchEvent(new win.Event('change', { bubbles: true }));
check('ticking marks the row on', rows[1].className.includes('on'), rows[1].className);
check('the count follows', /1 of 2 active/.test(text()), text().slice(0, 300));

// Right-click clears a box, as it does in both reference tools.
const minBox = rows[1].querySelector('.pc-range input') as HTMLInputElement;
check('min is prefilled below the roll', minBox.value === '13', minBox.value);
minBox.dispatchEvent(new win.Event('contextmenu', { bubbles: true, cancelable: true }));
check('right-click clears it', minBox.value === '', minBox.value);
minBox.value = '13';
minBox.dispatchEvent(new win.Event('input', { bubbles: true }));

// ── search ──────────────────────────────────────────────────────────────────
check('the filters are open before a search', shown('.pc-filter-list'));
click($('.pc-search'));
await settle(200);

check('one search ran', searchCount === 1, `count=${searchCount}`);
check('default order is cheapest first', lastSort === '{"price":"asc"}', lastSort);
check('null listings are dropped', $$('.pc-card').length === 3, `${$$('.pc-card').length} cards`);
check('total is reported', /Showing 3 of 78/.test(text()), text().slice(0, 300));
check('no separate listing count in the bar', !/78 listings\./.test(text()), text().slice(0, 300));

// Once there are listings they get the height: the filters fold to their strip.
check('the filters fold after a search', !shown('.pc-filter-list'));
check('but their strip stays, with the count', /1 of 2 active/.test(text()), text().slice(0, 300));
click($('.pc-filters-title'));
check('and one click reopens them', shown('.pc-filter-list'));
click($('.pc-filters-title'));

// ── the layout is two panes ─────────────────────────────────────────────────
check('there are two panes', !!$('.pc-panes'), 'no pane container');
check('the item and filters are in the side pane', !!$('.pc-side .pc-item') && !!$('.pc-side .pc-filters'));
check('the listings are not', !$('.pc-side .pc-card'), 'listings ended up in the side pane');
check('search sits under the filters it acts on', !!$('.pc-side .pc-search'));

// ── each listing is one line until opened ───────────────────────────────────
// Sidekick's compact view: name, level, age and price on a line, the full
// item under it on click.
const firstCard = $('.pc-card') as HTMLElement;
const cardText = () => String(firstCard.textContent).replace(/\s+/g, ' ');
check('listings start compact', $$('.pc-card.open').length === 0, `${$$('.pc-card.open').length} open`);
check('the line names the item', /Dusk Turn/.test(cardText()) && /Prismatic Ring/.test(cardText()), cardText());
check('with its level', /ilvl 47/.test(cardText()), cardText());
check('the price is on the line', !!firstCard.querySelector('.pc-row .pc-price'), 'no price on the row');
check('mods are not', !/Evasion Rating/.test(cardText()), cardText());
// Ages are relative to now, so assert the shape rather than a value that goes
// stale the moment the fixture does.
check(
  'and how long it has been listed',
  /^[0-9]+(m|h|d|mo)$/.test(String($('.pc-row-age')?.textContent).trim()),
  String($('.pc-row-age')?.textContent),
);
const dots = $$('.pc-dot').map((n) => n.className.replace('pc-dot ', ''));
check('afk seller shows as afk', dots[0] === 'afk', dots.join(','));
check('online seller shows as online', dots[1] === 'online', dots.join(','));
check('missing online key means offline', dots[2] === 'offline', dots.join(','));
check('the seller is on the tooltip', /AfkAlchemist/.test(String($('.pc-row-age')?.title)), String($('.pc-row-age')?.title));

click(firstCard.querySelector('.pc-row') as HTMLElement);
const opened = $('.pc-card') as HTMLElement;
const openedText = () => String(opened.textContent).replace(/\s+/g, ' ');
check('clicking the line opens the item', opened.className.includes('open'), opened.className);
check('only that one', $$('.pc-card.open').length === 1, `${$$('.pc-card.open').length} open`);
check('with its requirements', /Requires Level 39/.test(openedText()), openedText());
check('the implicit', /\+10% to all Elemental Resistances/.test(openedText()), openedText());
check('and every explicit', /\+43 to Evasion Rating/.test(openedText()) && /\+82 to maximum Life/.test(openedText()), openedText());
check('no leftover link markup', !/[[\]|]/.test(openedText()), openedText());
check('and the seller', /AfkAlchemist/.test(openedText()), openedText());

// Sidekick puts the affix tier in the margin, prefixes and suffixes coloured
// apart. Ours reads the same P#/S# shorthand straight off the payload.
const tiers = [...opened.querySelectorAll('.pc-mod .pc-affix')].filter((n) => String(n.textContent).trim());
check('affix tiers are badged', tiers.map((n) => n.textContent).join(',') === 'P7,P3', tiers.map((n) => n.textContent).join(','));
check('prefixes are marked as prefixes', tiers.every((n) => n.className.includes('prefix')), tiers.map((n) => n.className).join('|'));
check('roll ranges are shown', /39–51/.test(openedText()) && /70–84/.test(openedText()), openedText());

click(opened.querySelector('.pc-row') as HTMLElement);
check('clicking again closes it', $$('.pc-card.open').length === 0, `${$$('.pc-card.open').length} open`);

// The header opens every listing at once, and remembers that.
click($('.pc-expand'));
check('Expand all opens every listing', $$('.pc-card.open').length === 3, `${$$('.pc-card.open').length} open`);
check('the choice persists', JSON.parse(store.get('settings.v1') ?? '{}').expandAll === true);
click($$('.pc-card .pc-row')[1]);
check('a single line can still be folded back', $$('.pc-card.open').length === 2, `${$$('.pc-card.open').length} open`);

// ── properties and requirements ─────────────────────────────────────────────
const boots = $$('.pc-card')[1] as HTMLElement;
click(boots.querySelector('.pc-row') as HTMLElement);
const bootsText = String($$('.pc-card')[1].textContent).replace(/\s+/g, ' ');
check('property names are unwrapped', /Energy Shield: 37/.test(bootsText), bootsText);
check('so are requirement names', /56 Str/.test(bootsText) && /56 Int/.test(bootsText), bootsText);
check('no link markup survives anywhere', !/[[\]|]/.test(bootsText), bootsText);
check('properties read as a list', /Boots · Armour: 134 · Energy Shield: 37/.test(bootsText), bootsText);
check('requirements read as the game phrases them', /Requires Level 75, 56 Str, 56 Int/.test(bootsText), bootsText);

// A desecrated mod arrives inside explicitMods with flags, not in an array of
// its own, so the array it came from is the wrong thing to colour it by.
const desecratedCard = $$('.pc-card')[2] as HTMLElement;
check('desecrated mods are recognised', !!desecratedCard.querySelector('.pc-mod.desecrated'), String(desecratedCard.querySelector('.pc-mod')?.className));
check('and labelled', /desecrated/.test(String(desecratedCard.textContent)), String(desecratedCard.textContent).slice(0, 200));
check(
  'plain explicits on the same item are not',
  desecratedCard.querySelectorAll('.pc-mod.explicit').length === 1,
  `${desecratedCard.querySelectorAll('.pc-mod.explicit').length}`,
);
// Rune mods keep their colour but get no label: the array they arrive in is a
// grab-bag, so "RUNE" would be wrong on the Shaman "Bonded" lines that share
// it — and says nothing on a line that already names itself.
check('rune mods are set apart by colour', !!desecratedCard.querySelector('.pc-mod.rune'));
check(
  'but not labelled',
  ![...desecratedCard.querySelectorAll('.pc-mod.rune')].some((n) => n.querySelector('.pc-mod-kind')),
  'a rune mod carries a kind label',
);
check('with the Bonded prefix unwrapped', /Bonded: \+20 to maximum Life/.test(String(desecratedCard.textContent)), String(desecratedCard.textContent).slice(0, 240));
check('and no RUNE tag beside it', !/RUNE/i.test(String(desecratedCard.textContent)), String(desecratedCard.textContent).slice(0, 240));

// Back to compact for the rest.
click($('.pc-expand'));
check('Compact folds them all', $$('.pc-card.open').length === 0, `${$$('.pc-card.open').length} open`);

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
// fixtures (all priced in exalted, the default core) show no conversion.
const norms = () => $$('.pc-norm').map((n) => String(n.textContent).trim());
check('no redundant conversion for the core currency', norms().length === 0, norms().join(' '));

// Switching the core currency restates them all, with no further API call.
// The core currency sits beside Search; the league switch with the league
// name in the footer.
const cores = $('.pc-search-wrap .pc-core');
check('a core toggle is offered', !!cores, 'no toggle rendered');
const coreButtons = [...(cores?.children ?? [])] as HTMLElement[];
check('with exactly two options, as in EE2', coreButtons.length === 2, `${coreButtons.length}`);
check('labelled by abbreviation', coreButtons.map((b) => b.textContent).join(',') === 'EX,C', coreButtons.map((b) => b.textContent).join(','));

const searchesBefore = searchCount;
click(coreButtons[1]);
await settle(120);

check('switching core costs no API call', searchCount === searchesBefore, `count=${searchCount}`);
check('every listing now carries a conversion', norms().length === 3, norms().join(' '));
check('beside the asking price', norms().every((t) => /^[0-9.]+ [a-z]+$/.test(t)), norms().join(' '));
check('restated in chaos', norms().every((t) => t.endsWith(' c')), norms().join(' '));
// 1 exalted is 0.0288 chaos here; it must not collapse to "0".
check('sub-unit conversions keep precision', norms().some((t) => /0\.0/.test(t)), norms().join(' '));
check('never a raw float', !norms().some((t) => /\.\d{3,}/.test(t)), norms().join(' '));
check('the choice persists', JSON.parse(store.get('settings.v1') ?? '{}').core === 'chaos');

// Switching league must not leave the other market's prices on screen.
click($$('.pc-foot-league .pc-toggle button')[1]);
await settle();
check('changing league clears stale listings', $$('.pc-card').length === 0, `${$$('.pc-card').length} cards left`);
check('and the footer follows', /HC Runes of Aldur/.test(text()), text().slice(0, 160));

// Links are links, not boxed buttons (the generic .pc button rule used to win).
const clear = $$('.pc-link').find((n) => String(n.textContent).includes('Clear'));
check('Clear is offered as a link', !!clear, 'no Clear link');

// Clear drops the item, its filters and its results in one go.
click(clear);
await settle();
check('Clear removes the item', !shown('.pc-item'));
check('and its filters', $$('.pc-filter').length === 0, `${$$('.pc-filter').length} rows left`);
check('and its listings', $$('.pc-card').length === 0, `${$$('.pc-card').length} cards left`);
check('leaving the paste strip ready', shown('.pc-paste-wrap'));

console.log(failures === 0 ? '\nall passed' : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
