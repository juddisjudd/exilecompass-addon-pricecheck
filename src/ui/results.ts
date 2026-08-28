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
  sort: SortState;
  /** Price order lives on the server; choosing it re-runs the search. */
  priceDescending: boolean;
  priceSorted: boolean;
  currencies: CurrencyIndex | null;
  rates: Rates | null;
  /** The player's core currency, which prices are restated in. */
  core: string;
  onSort: (column: LocalSort) => void;
  onPriceSort: () => void;
}

/**
 * `1 [exalted icon]`, with the same value restated in the player's core
 * currency underneath when that says something new. Exiled Exchange 2 appends
 * rather than replaces, and it is right to: the asking price is the number the
 * trade happens at.
 */
function renderPrice(container: HTMLElement, listing: Listing, options: ResultsOptions): void {
  const price = listing.price;
  if (!price) {
    container.append(el('div', 'pc-price', '—'));
    return;
  }

  const line = el('div', 'pc-price');
  line.append(el('span', 'pc-amount', formatAmount(price.amount)));

  const meta = options.currencies?.get(price.currency);
  if (meta?.icon && options.host.net?.fetchImage) {
    const img = el('img', 'pc-cur');
    img.alt = meta.name;
    img.title = meta.name;
    loadIcon(options.host, meta.icon, img);
    line.append(img);
  } else {
    line.append(el('span', 'pc-cur-text', price.currency));
  }
  container.append(line);

  const normalized = options.rates?.normalize(price.amount, price.currency, options.core) ?? null;
  if (normalized) {
    container.append(
      el(
        'div',
        'pc-norm',
        `${formatAmount(normalized.amount)} ${abbreviate(normalized.currency)}`,
      ),
    );
  }
}

/**
 * One listing, laid out the way Sidekick lays one out
 * (`Trade/Items/ItemComponent.razor`): the item on the left as the game would
 * show it, and what it costs and who has it on the right. A price check is a
 * comparison of items, not of rows of numbers, so the item is always visible
 * rather than hidden behind a control.
 */
function renderCard(listing: Listing, options: ResultsOptions): HTMLElement {
  const card = el('article', 'pc-card');

  const body = el('div', 'pc-card-body');
  const left = el('div', 'pc-card-item');
  renderListingItem(left, listing);

  const right = el('div', 'pc-card-side');
  renderPrice(right, listing, options);

  const seller = el('div', 'pc-card-seller', sellerLabel(listing));
  seller.title = listing.account.name;
  const status = sellerStatus(listing);
  const dot = el('span', `pc-dot ${status}`);
  dot.title = status;
  seller.prepend(dot);
  right.append(seller);

  const age = el('div', 'pc-card-age', ago(listing.indexed));
  if (listing.indexed) age.title = new Date(listing.indexed).toLocaleString();
  right.append(age);

  if (listing.item.icon) {
    const img = el('img', 'pc-card-icon');
    img.alt = '';
    loadIcon(options.host, listing.item.icon, img);
    right.append(img);
  }

  body.append(left, right);
  card.append(body);
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
    container.append(
      el(
        'div',
        'pc-empty',
        options.item
          ? 'No listings yet. Pick the modifiers that matter and run a price check.'
          : 'Copy an item in game and paste it on the left to price check it.',
      ),
    );
    return;
  }

  const head = el('div', 'pc-results-head');
  head.append(
    el('span', 'pc-count', `Showing ${options.listings.length} of ${options.total}`),
  );

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
  container.append(head);

  const list = el('div', 'pc-cards');
  for (const listing of options.listings) list.append(renderCard(listing, options));
  container.append(list);
}
