import type { AddonHost } from '../types';
import type { ParsedItem } from '../parser/types';
import { abbreviate, type CurrencyIndex, type Rates } from '../trade/currency';
import { sellerStatus, type Listing } from '../trade/search';
import { el } from './dom';
import { formatAmount } from './format';
import { renderListingItem } from './listing-item';

/**
 * How the fetched page is ordered. Price is not among them: listings are
 * priced in different currencies and only the API knows the rates, so price
 * order is asked of the server and arrives already sorted.
 */
export type LocalSort = 'listed' | 'ilvl' | 'none';

export interface SortState {
  column: LocalSort;
  descending: boolean;
}

export function ago(iso: string | undefined): string {
  if (!iso) return '';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.round(days / 30)}mo`;
}

function sellerLabel(listing: Listing): string {
  return listing.account.lastCharacterName ?? listing.account.name.split('#')[0];
}

function compare(a: Listing, b: Listing, column: LocalSort): number {
  switch (column) {
    case 'listed':
      return Date.parse(a.indexed ?? '') - Date.parse(b.indexed ?? '');
    case 'ilvl':
      return (a.item.ilvl ?? 0) - (b.item.ilvl ?? 0);
    default:
      return 0;
  }
}

export function sortListings(listings: Listing[], state: SortState): Listing[] {
  if (state.column === 'none') return listings;
  const sorted = [...listings].sort((a, b) => compare(a, b, state.column));
  return state.descending ? sorted.reverse() : sorted;
}

/**
 * Icons go through the host's image cache rather than a plain <img src>: the
 * sandbox's opaque origin makes Chromium skip its own HTTP cache, so every
 * reopen would re-download all of them.
 */
function loadIcon(host: AddonHost, url: string | undefined, into: HTMLImageElement): void {
  if (!url || !host.net?.fetchImage) return;
  void host.net.fetchImage(url).then(
    (src) => {
      if (src) into.src = src;
    },
    () => {
      /* an icon that will not load is not worth a message */
    },
  );
}

export interface ResultsOptions {
  host: AddonHost;
  item: ParsedItem | null;
  listings: Listing[];
  total: number;
  /** A search has run for this item, so an empty list means no matches. */
  searched: boolean;
  sort: SortState;
  /** Price order lives on the server; choosing it re-runs the search. */
  priceDescending: boolean;
  priceSorted: boolean;
  currencies: CurrencyIndex | null;
  rates: Rates | null;
  /** The player's core currency, which prices are restated in. */
  core: string;
  /** Every listing shown as its full item — Sidekick's non-compact view. */
  expandAll: boolean;
  /** Listings the user has toggled the other way from `expandAll`. */
  toggled: Set<string>;
  onSort: (column: LocalSort) => void;
  onPriceSort: () => void;
  onToggleAll: () => void;
  onToggle: (id: string) => void;
}

/**
 * `1 [exalted icon]`, with the same value restated in the player's core
 * currency beside it when that says something new. Exiled Exchange 2 appends
 * rather than replaces, and it is right to: the asking price is the number
 * the trade happens at.
 */
function renderPrice(container: HTMLElement, listing: Listing, options: ResultsOptions): void {
  const price = listing.price;
  if (!price) {
    container.append(el('span', 'pc-amount', '—'));
    return;
  }

  container.append(el('span', 'pc-amount', formatAmount(price.amount)));

  const meta = options.currencies?.get(price.currency);
  if (meta?.icon && options.host.net?.fetchImage) {
    const img = el('img', 'pc-cur');
    img.alt = meta.name;
    img.title = meta.name;
    loadIcon(options.host, meta.icon, img);
    container.append(img);
  } else {
    container.append(el('span', 'pc-cur-text', price.currency));
  }

  const normalized = options.rates?.normalize(price.amount, price.currency, options.core) ?? null;
  if (normalized) {
    container.append(
      el('span', 'pc-norm', `${formatAmount(normalized.amount)} ${abbreviate(normalized.currency)}`),
    );
  }
}

const RARITY_CLASS: Record<string, string> = {
  Rare: 'rare',
  Unique: 'unique',
  Magic: 'magic',
};

/**
 * One listing is one line — name, level, how long it has been up, and the
 * price — the way Sidekick's compact view (`ItemComponent.razor`, `IsCompact`)
 * and Exiled Exchange 2's table both read. A price check is answered by
 * scanning ten prices, and at the overlay's default size a full item card
 * showed one. The full item opens under the line on click, or for every
 * listing at once from the header.
 */
function renderRow(listing: Listing, open: boolean, options: ResultsOptions): HTMLElement {
  const row = el('button', 'pc-row');
  row.type = 'button';
  row.setAttribute('aria-expanded', open ? 'true' : 'false');
  row.title = open ? 'Hide the item' : 'Show the item';

  const item = listing.item;
  const name = el('span', 'pc-row-name');
  const rarity = RARITY_CLASS[item.rarity ?? ''] ?? '';
  name.append(el('span', `pc-item-name ${rarity}`.trim(), item.name || item.typeLine || 'Item'));
  if (item.name && item.typeLine && item.typeLine !== item.name) {
    name.append(el('span', 'pc-item-base', item.typeLine));
  }
  if (item.corrupted) name.append(el('span', 'pc-flag', 'corrupted'));
  row.append(name);

  row.append(el('span', 'pc-row-ilvl', item.ilvl ? `ilvl ${item.ilvl}` : ''));

  const status = sellerStatus(listing);
  const age = el('span', 'pc-row-age');
  const dot = el('span', `pc-dot ${status}`);
  age.append(dot, document.createTextNode(ago(listing.indexed)));
  age.title = `${sellerLabel(listing)} (${listing.account.name}) — ${status}${
    listing.indexed ? `, listed ${new Date(listing.indexed).toLocaleString()}` : ''
  }`;
  row.append(age);

  const price = el('span', 'pc-price');
  renderPrice(price, listing, options);
  row.append(price);

  row.addEventListener('click', () => options.onToggle(listing.id));
  return row;
}

/**
 * The item itself, as the game would show it, with who is selling it beside
 * it — Sidekick's full card (`Trade/Items/ItemComponent.razor`). The price
 * stays on the line above; this is what the price is for.
 */
function renderDetail(listing: Listing, options: ResultsOptions): HTMLElement {
  const body = el('div', 'pc-card-body');
  const left = el('div', 'pc-card-item');
  renderListingItem(left, listing, { head: false });

  const right = el('div', 'pc-card-side');
  const seller = el('div', 'pc-card-seller', sellerLabel(listing));
  seller.title = listing.account.name;
  right.append(seller);
  const account = el('div', 'pc-card-account', listing.account.name);
  right.append(account);
  if (listing.item.icon) {
    const img = el('img', 'pc-card-icon');
    img.alt = '';
    loadIcon(options.host, listing.item.icon, img);
    right.append(img);
  }

  body.append(left, right);
  return body;
}

function renderCard(listing: Listing, options: ResultsOptions): HTMLElement {
  const open = options.expandAll !== options.toggled.has(listing.id);
  const card = el('article', `pc-card${open ? ' open' : ''}`);
  card.append(renderRow(listing, open, options));
  if (open) card.append(renderDetail(listing, options));
  return card;
}

function sortButton(
  label: string,
  active: boolean,
  descending: boolean,
  onClick: () => void,
  title?: string,
): HTMLButtonElement {
  const button = el('button', `pc-sort${active ? ' on' : ''}`);
  button.type = 'button';
  button.textContent = active ? `${label} ${descending ? '↓' : '↑'}` : label;
  if (title) button.title = title;
  button.addEventListener('click', onClick);
  return button;
}

export function renderResults(container: HTMLElement, options: ResultsOptions): void {
  container.replaceChildren();

  if (!options.listings.length) {
    let text: string;
    if (!options.item) {
      text = 'Copy an item in game with Ctrl+C, then paste it into the box at the top to price check it.';
    } else if (options.searched) {
      text = 'No listings match. Untick a modifier or lower a minimum, then search again.';
    } else {
      text = 'Tick the modifiers that matter, then press Search.';
    }
    container.append(el('div', 'pc-empty', text));
    return;
  }

  const head = el('div', 'pc-results-head');
  head.append(el('span', 'pc-count', `Showing ${options.listings.length} of ${options.total}`));

  const sorts = el('div', 'pc-sorts');
  sorts.append(
    sortButton(
      'Price',
      options.priceSorted,
      options.priceDescending,
      options.onPriceSort,
      'Currencies only compare on the server — this re-runs the search.',
    ),
    sortButton('Listed', options.sort.column === 'listed', options.sort.descending, () =>
      options.onSort('listed'),
    ),
  );
  if (options.listings.some((l) => l.item.ilvl !== undefined)) {
    sorts.append(
      sortButton('ilvl', options.sort.column === 'ilvl', options.sort.descending, () =>
        options.onSort('ilvl'),
      ),
    );
  }
  head.append(sorts);

  // Sidekick's compact-view toggle (`ToggleCompactView.razor`), as words
  // rather than an icon: what it does is not obvious from a glyph.
  const expand = el('button', `pc-expand${options.expandAll ? ' on' : ''}`);
  expand.type = 'button';
  expand.textContent = options.expandAll ? 'Compact' : 'Expand all';
  expand.title = options.expandAll
    ? 'One line per listing'
    : 'Show every listing as its full item';
  expand.addEventListener('click', options.onToggleAll);
  head.append(expand);

  container.append(head);

  const list = el('div', 'pc-cards');
  for (const listing of options.listings) list.append(renderCard(listing, options));
  container.append(list);
}
