import type { AddonHost } from '../types';
import type { ParsedItem } from '../parser/types';
import { abbreviate, type CurrencyIndex, type Rates } from '../trade/currency';
import { sellerStatus, type Listing } from '../trade/search';
import { el } from './dom';
import { formatAmount } from './format';
import { listingSummary, renderListingItem } from './listing-item';

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
 * `(0.14 c) 5 [exalted icon]` — the seller's own asking price with the
 * currency's icon, preceded by the same value restated in the player's core
 * currency when that says something new. Exiled Exchange 2 appends rather than
 * replaces (`TradeItem.vue`), and it is right to: the asking price is the
 * number the trade itself happens at. The conversion leads here only because
 * the column is right-aligned, which puts the asking price against the edge.
 */
function renderPrice(cell: HTMLElement, listing: Listing, options: ResultsOptions): void {
  const price = listing.price;
  if (!price) {
    cell.textContent = '—';
    return;
  }

  const normalized = options.rates?.normalize(price.amount, price.currency, options.core) ?? null;
  if (normalized) {
    cell.append(
      el(
        'span',
        'pc-norm',
        `(${formatAmount(normalized.amount)} ${abbreviate(normalized.currency)})`,
      ),
    );
  }

  const meta = options.currencies?.get(price.currency);
  cell.append(el('span', 'pc-amount', formatAmount(price.amount)));

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
    cell.append(el('span', 'pc-cur-text', price.currency));
  }

  const parts = [meta?.name ?? price.currency];
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
  /** Ids of the listings whose full item is open. */
  expanded: Set<string>;
  /** Currency names and icons from /data/static. */
  currencies: CurrencyIndex | null;
  /** Exchange rates, when poe.ninja could be reached. */
  rates: Rates | null;
  /** The player's core currency, which prices are restated in. */
  core: string;
  onSort: (column: LocalSort) => void;
  onPriceSort: () => void;
  onToggleItem: (id: string) => void;
}

type ColumnKey = LocalSort | 'price' | 'icon' | 'summary';

interface Column {
  key: ColumnKey;
  label: string;
  show: boolean;
  sortable: boolean;
  align?: 'right';
}

/**
 * Fixed widths, applied through a <colgroup> on a `table-layout: fixed`
 * table. Header and body are one layout here, so a long mod line cannot push
 * the price column around — which is what happened while the header and rows
 * were two independent CSS grids, each sizing its `auto` tracks to its own
 * content.
 */
const WIDTHS: Record<ColumnKey, string> = {
  icon: '30px',
  summary: 'auto',
  seller: '96px',
  stock: '48px',
  ilvl: '40px',
  listed: '58px',
  price: '104px',
  none: 'auto',
};

function columnsFor(options: ResultsOptions): Column[] {
  const listings = options.listings;
  return (
    [
      { key: 'icon', label: '', show: true, sortable: false },
      { key: 'summary', label: 'Item', show: true, sortable: false },
      { key: 'seller', label: 'Seller', show: true, sortable: true },
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
      { key: 'listed', label: 'Listed', show: true, sortable: true, align: 'right' },
      { key: 'price', label: 'Price', show: true, sortable: true, align: 'right' },
    ] as Column[]
  ).filter((c) => c.show);
}

function caret(active: boolean, descending: boolean): string {
  return active ? (descending ? ' ↓' : ' ↑') : '';
}

function renderHead(columns: Column[], options: ResultsOptions): HTMLTableSectionElement {
  const thead = el('thead');
  const row = el('tr');

  for (const column of columns) {
    const cell = el('th', column.align === 'right' ? 'right' : undefined);
    cell.scope = 'col';

    if (!column.sortable) {
      cell.textContent = column.label;
      row.append(cell);
      continue;
    }

    const isPrice = column.key === 'price';
    const active = isPrice || options.sort.column === column.key;
    const descending = isPrice ? options.priceDescending : options.sort.descending;
    // aria-sort belongs on the header cell, so a screen reader announces the
    // column's state rather than the button's.
    cell.setAttribute('aria-sort', active ? (descending ? 'descending' : 'ascending') : 'none');

    const button = el('button', `pc-sort${active ? ' on' : ''}`);
    button.type = 'button';
    button.textContent = `${column.label}${caret(active, descending)}`;
    button.title = isPrice
      ? 'Currencies only compare on the server — this re-runs the search.'
      : `Sort by ${column.label.toLowerCase()}`;
    button.addEventListener(
      'click',
      isPrice ? options.onPriceSort : () => options.onSort(column.key as LocalSort),
    );

    cell.append(button);
    row.append(cell);
  }

  thead.append(row);
  return thead;
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
  const table = el('table', 'pc-table');

  const colgroup = el('colgroup');
  for (const column of columns) {
    const col = el('col');
    col.style.width = WIDTHS[column.key];
    colgroup.append(col);
  }
  table.append(colgroup, renderHead(columns, options));

  const body = el('tbody');
  for (const listing of options.listings) {
    const row = el('tr', 'pc-tr');
    const open = options.expanded.has(listing.id);

    for (const column of columns) {
      const cell = el('td', column.align === 'right' ? 'right' : undefined);

      if (column.key === 'icon') {
        // The icon is the control: press it to see the whole item.
        const button = el('button', `pc-item-btn${open ? ' on' : ''}`);
        button.type = 'button';
        button.title = open ? 'Hide the full item' : 'Show the full item';
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
        const img = el('img', 'pc-icon');
        img.alt = '';
        void iconFor(options.host, listing.item.icon).then((src) => {
          if (src) img.src = src;
        });
        button.append(img);
        button.addEventListener('click', () => options.onToggleItem(listing.id));
        cell.append(button);
      } else if (column.key === 'summary') {
        const summary = listingSummary(listing);
        cell.className = 'summary';
        cell.textContent = summary;
        cell.title = summary;
      } else if (column.key === 'seller') {
        cell.className = 'seller';
        cell.textContent = sellerLabel(listing);
        cell.title = listing.account.name;
      } else if (column.key === 'stock') {
        cell.textContent = String(listing.item.stackSize ?? '');
      } else if (column.key === 'ilvl') {
        cell.textContent = String(listing.item.ilvl ?? '');
      } else if (column.key === 'listed') {
        cell.className = 'right listed';
        const status = sellerStatus(listing);
        const dot = el('span', `pc-dot ${status}`);
        dot.title = status;
        cell.append(dot, document.createTextNode(ago(listing.indexed)));
        if (listing.indexed) cell.title = new Date(listing.indexed).toLocaleString();
      } else {
        cell.className = 'right price';
        renderPrice(cell, listing, options);
      }

      row.append(cell);
    }

    body.append(row);

    if (open) {
      const detailRow = el('tr', 'pc-detail-row');
      const cell = el('td');
      cell.colSpan = columns.length;
      renderListingItem(cell, listing);
      detailRow.append(cell);
      body.append(detailRow);
    }
  }

  table.append(body);
  container.append(table);
}
