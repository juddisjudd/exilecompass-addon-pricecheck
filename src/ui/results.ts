import type { AddonHost } from '../types';
import type { ParsedItem } from '../parser/types';
import { sellerStatus, type Listing } from '../trade/search';
import type { CurrencyIndex, Rates } from '../trade/currency';
import { copyText, el } from './dom';
import { formatAmount } from './format';

/**
 * Columns the page can be reordered by locally. Price is deliberately absent:
 * listings are priced in different currencies and only the API knows the
 * rates between them, so price order is asked of the server instead.
 */
export type LocalSort = 'listed' | 'ilvl' | 'stock' | 'seller' | 'none';

export interface SortState {
  column: LocalSort;
  descending: boolean;
}

function ago(iso: string | undefined): string {
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

/**
 * `5 × [divine icon]`, the way both reference tools show it — the icon is what
 * a player recognises, and the word "divine" costs a third of the column.
 * The full name and, when converted, the seller's original asking price live
 * in the tooltip.
 */
function renderPrice(cell: HTMLElement, listing: Listing, options: ResultsOptions): void {
  const price = listing.price;
  if (!price) {
    cell.textContent = '—';
    return;
  }

  let amount = price.amount;
  let currency = price.currency;
  let converted = false;

  const target = options.display;
  if (target && target !== 'listed' && options.rates) {
    const value = options.rates.convert(price.amount, price.currency, target);
    if (value !== null) {
      amount = value;
      currency = target;
      converted = true;
    }
  }

  const meta = options.currencies?.get(currency);
  cell.append(el('span', 'pc-amount', formatAmount(amount)));

  if (meta?.icon && options.host.net?.fetchImage) {
    const img = el('img', 'pc-cur');
    img.alt = meta.name;
    void options.host.net
      .fetchImage(meta.icon)
      .then((src) => {
        if (src) img.src = src;
      })
      .catch(() => {
        // No icon, no problem — the name still reads in the tooltip.
      });
    cell.append(img);
  } else {
    cell.append(el('span', 'pc-cur-text', currency));
  }

  const parts = [meta?.name ?? currency];
  if (converted) parts.push(`listed as ${formatAmount(price.amount)} ${price.currency}`);
  if (price.type && price.type !== 'exact') parts.push(price.type);
  cell.title = parts.join(' — ');
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
    case 'stock':
      return (a.item.stackSize ?? 0) - (b.item.stackSize ?? 0);
    case 'seller':
      return sellerLabel(a).localeCompare(sellerLabel(b));
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
async function iconFor(host: AddonHost, url: string | undefined): Promise<string | null> {
  if (!url || !host.net?.fetchImage) return null;
  try {
    return await host.net.fetchImage(url);
  } catch {
    return null;
  }
}

export interface ResultsOptions {
  host: AddonHost;
  item: ParsedItem | null;
  listings: Listing[];
  total: number;
  sort: SortState;
  /** Price order lives on the server; clicking it re-runs the search. */
  priceDescending: boolean;
  onSort: (column: LocalSort) => void;
  onPriceSort: () => void;
  onStatus: (message: string) => void;
  onWhisper: (listing: Listing) => void;
  /** Currency names and icons from /data/static. */
  currencies: CurrencyIndex | null;
  /** Exchange rates, when poe.ninja could be reached. */
  rates: Rates | null;
  /** `listed` keeps each seller's own currency; anything else converts. */
  display: string;
}

interface Column {
  key: LocalSort | 'price' | 'icon' | 'action';
  label: string;
  show: boolean;
  sortable: boolean;
  align?: 'right';
}

function columnsFor(options: ResultsOptions): Column[] {
  const listings = options.listings;
  return [
    { key: 'icon', label: '', show: true, sortable: false },
    { key: 'price', label: 'Price', show: true, sortable: true },
    {
      key: 'stock',
      label: 'Stock',
      show: listings.some((l) => l.item.stackSize !== undefined),
      sortable: true,
      align: 'right',
    },
    {
      key: 'ilvl',
      label: 'ilvl',
      show: listings.some((l) => l.item.ilvl !== undefined),
      sortable: true,
      align: 'right',
    },
    { key: 'listed', label: 'Listed', show: true, sortable: true },
    { key: 'seller', label: 'Seller', show: true, sortable: true },
    { key: 'action', label: '', show: true, sortable: false },
  ].filter((c) => c.show) as Column[];
}

function caret(active: boolean, descending: boolean): string {
  if (!active) return '';
  return descending ? ' ↓' : ' ↑';
}

export function renderResults(container: HTMLElement, options: ResultsOptions): void {
  container.replaceChildren();

  if (!options.listings.length) {
    container.append(
      el(
        'div',
        'pc-empty',
        options.item
          ? 'No listings yet. Pick your filters and run a price check.'
          : 'Paste an item to price check it.',
      ),
    );
    return;
  }

  const columns = columnsFor(options);
  const table = el('div', 'pc-table');
  // Header and rows are separate grid containers, so they need the same
  // explicit track list to line up.
  const TRACKS: Record<string, string> = {
    icon: '26px',
    price: 'minmax(72px, auto)',
    stock: '46px',
    ilvl: '38px',
    listed: 'minmax(56px, auto)',
    seller: 'minmax(0, 1fr)',
    action: 'auto',
  };
  const tracks = columns.map((c) => TRACKS[c.key] ?? 'auto').join(' ');
  table.style.setProperty('--tracks', tracks);

  const head = el('div', 'pc-thead');
  for (const column of columns) {
    if (!column.sortable) {
      head.append(el('span', `pc-th ${column.align ?? ''}`.trim(), column.label));
      continue;
    }
    const button = el('button', `pc-th sortable ${column.align ?? ''}`.trim());
    button.type = 'button';
    if (column.key === 'price') {
      button.textContent = `Price${caret(true, options.priceDescending)}`;
      button.title = 'Currencies only compare on the server — this re-runs the search.';
      button.addEventListener('click', options.onPriceSort);
    } else {
      const active = options.sort.column === column.key;
      button.textContent = `${column.label}${caret(active, options.sort.descending)}`;
      button.classList.toggle('on', active);
      button.addEventListener('click', () => options.onSort(column.key as LocalSort));
    }
    head.append(button);
  }
  table.append(head);

  for (const listing of options.listings) {
    const row = el('div', 'pc-tr');

    for (const column of columns) {
      if (column.key === 'icon') {
        const img = el('img', 'pc-icon');
        img.alt = '';
        void iconFor(options.host, listing.item.icon).then((src) => {
          if (src) img.src = src;
        });
        img.title = [listing.item.name, listing.item.typeLine ?? listing.item.baseType]
          .filter(Boolean)
          .join(' ');
        row.append(img);
        continue;
      }
      if (column.key === 'price') {
        const cell = el('span', 'pc-td price');
        renderPrice(cell, listing, options);
        row.append(cell);
        continue;
      }
      if (column.key === 'stock') {
        row.append(el('span', 'pc-td right', String(listing.item.stackSize ?? '')));
        continue;
      }
      if (column.key === 'ilvl') {
        row.append(el('span', 'pc-td right', String(listing.item.ilvl ?? '')));
        continue;
      }
      if (column.key === 'listed') {
        const cell = el('span', 'pc-td listed');
        const status = sellerStatus(listing);
        const dot = el('span', `pc-dot ${status}`);
        dot.title = status;
        cell.append(dot, document.createTextNode(ago(listing.indexed)));
        if (listing.indexed) cell.title = new Date(listing.indexed).toLocaleString();
        row.append(cell);
        continue;
      }
      if (column.key === 'seller') {
        const cell = el('span', 'pc-td seller', sellerLabel(listing));
        cell.title = listing.account.name;
        row.append(cell);
        continue;
      }

      const copy = el('button', 'pc-copy', 'Whisper');
      copy.type = 'button';
      copy.title = listing.whisper;
      copy.addEventListener('click', () => {
        const ok = copyText(listing.whisper);
        options.onStatus(ok ? 'Whisper copied.' : 'Could not copy — select the text instead.');
        if (ok) options.onWhisper(listing);
      });
      row.append(copy);
    }

    table.append(row);
  }

  container.append(table);
}
