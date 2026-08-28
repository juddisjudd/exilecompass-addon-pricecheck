import { parseClipboard, type ParsedItem } from './parser';
import { buildEquipmentFilters, buildStatFilters, type AnyFilterRow } from './stats/filters';
import { StatIndex, matchItem, type StatsPayload } from './stats/match';
import { TradeClient, TradeError } from './trade/client';
import {
  leagueFor,
  leagueLabel,
  resolveLeagues,
  type LeagueMode,
  type LeaguePair,
} from './trade/league';
import {
  abbreviate,
  CORE_CURRENCIES,
  CurrencyIndex,
  loadCurrencies,
  loadRates,
  type Rates,
} from './trade/currency';
import { buildQuery } from './trade/query';
import { search, searchUrl, sortFor, SORTS, type Listing, type SortKey } from './trade/search';
import { CSS, el } from './ui/dom';
import { MAX_ENABLED_FILTERS, renderFilters } from './ui/filters';
import { renderItemHeader } from './ui/item';
import { renderResults, sortListings, type LocalSort, type SortState } from './ui/results';
import type { MountFn } from './types';

const SETTINGS_KEY = 'settings.v1';

interface Settings {
  /**
   * Which of the two current leagues to search. The mode is stored, not a
   * league id: ids change every league, the choice does not (PLAN.md §2.1).
   */
  mode: LeagueMode;
  /**
   * Which listings the API returns. No longer a control: PoE2 sells through
   * in-game asynchronous offers, so whether the seller happens to be logged in
   * says nothing about whether you can buy it. Left at the trade site's own
   * default rather than widened to `any`, which would let long-abandoned
   * listings set the price.
   */
  status: string;
  sort: SortKey;
  /** Which currency prices are restated in — exalted or chaos, per EE2. */
  core: string;
}

const DEFAULT_SETTINGS: Settings = {
  mode: 'sc',
  status: 'online',
  sort: 'price-asc',
  core: CORE_CURRENCIES[0],
};

interface State {
  settings: Settings;
  leagues: LeaguePair | null;
  item: ParsedItem | null;
  rows: AnyFilterRow[];
  unmatched: string[];
  listings: Listing[];
  total: number;
  queryId: string;
  status: string;
  error: string;
  busy: boolean;
  filtersOpen: boolean;
  localSort: SortState;
  currencies: CurrencyIndex | null;
  rates: Rates | null;
}

const mount: MountFn = async ({ root, host }) => {
  root.innerHTML = '';
  const style = el('style');
  style.textContent = CSS;
  root.append(style);

  if (!host.net?.request) {
    root.append(
      el(
        'p',
        'pc-error',
        'This add-on needs ExileCompass 1.5.0 or newer — the trade API requires POST, which older hosts cannot do.',
      ),
    );
    return;
  }

  const state: State = {
    settings: { ...DEFAULT_SETTINGS },
    leagues: null,
    item: null,
    rows: [],
    unmatched: [],
    listings: [],
    total: 0,
    queryId: '',
    status: '',
    error: '',
    busy: false,
    filtersOpen: true,
    localSort: { column: 'none', descending: false },
    currencies: null,
    rates: null,
  };

  const client = new TradeClient(host, {
    onWait: (seconds) => {
      state.status = `Waiting ${seconds}s for the trade API rate limit…`;
      renderBar();
    },
  });

  let statIndex: StatIndex | null = null;

  // ── shell ────────────────────────────────────────────────────────────────
  // Two columns, as Sidekick lays it out (`ItemOverlay.razor`'s
  // LayoutTwoColumn): the item and its filters on the left, the listings on
  // the right. Stacked, the filters pushed the prices off the bottom of the
  // panel — the two are read together, not one after the other.
  const shell = el('div', 'pc');
  const bar = el('div', 'pc-bar');
  const notice = el('div');

  const panes = el('div', 'pc-panes');
  const side = el('div', 'pc-side');
  // A one-line drop target rather than a text box: nobody types item text, they
  // paste it, and a tall empty box was taking space the filters and listings
  // both wanted. Still a real textarea, so Ctrl+V works without the clipboard
  // permission the sandbox does not have.
  const pasteWrap = el('div', 'pc-paste-wrap');
  const paste = el('textarea', 'pc-paste');
  paste.placeholder = 'Click here, then Ctrl+V to paste a copied item';
  paste.spellcheck = false;
  paste.rows = 1;
  pasteWrap.append(paste);
  const itemHead = el('div', 'pc-item');
  const filters = el('div', 'pc-filters');
  const filtersHead = el('div', 'pc-filters-head');
  const filterList = el('div', 'pc-filter-list');
  filters.append(filtersHead, filterList);
  const searchWrap = el('div', 'pc-search-wrap');
  side.append(pasteWrap, itemHead, filters, searchWrap);

  const resultList = el('div', 'pc-results');
  panes.append(side, resultList);

  const foot = el('div', 'pc-foot');
  shell.append(bar, notice, panes, foot);
  root.append(shell);

  // ── settings ─────────────────────────────────────────────────────────────
  async function loadSettings(): Promise<void> {
    try {
      const raw = await host.storage.get(SETTINGS_KEY);
      if (raw) state.settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Settings) };
    } catch {
      /* defaults are fine */
    }
  }
  const saveSettings = () => host.storage.set(SETTINGS_KEY, JSON.stringify(state.settings));

  // ── data ─────────────────────────────────────────────────────────────────
  async function ensureStats(): Promise<StatIndex> {
    if (statIndex) return statIndex;
    const payload = await client.fetchData<StatsPayload>('/data/stats');
    statIndex = new StatIndex(payload);
    return statIndex;
  }

  async function loadLeagues(): Promise<void> {
    try {
      state.leagues = await resolveLeagues(client, host);
      if (state.settings.mode === 'hc' && !state.leagues.hc) {
        state.settings.mode = 'sc';
        state.error = 'No hardcore league in the trade API right now — searching softcore.';
      }
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
  }

  /**
   * Currency names and icons ship with the trade API itself, so this is free
   * beyond the one cached GET. Rates do not: they come from poe.ninja, and the
   * panel works without them — prices just stay in whatever the seller asked.
   */
  async function loadCurrencyData(): Promise<void> {
    if (!state.currencies) {
      try {
        state.currencies = await loadCurrencies(client);
      } catch {
        /* icons are a nicety; the currency id still reads as text */
      }
    }
    const league = currentLeague();
    if (league && !state.rates) state.rates = await loadRates(host, league);
    // A core the economy has no rate for (or a value left by an older
    // version of this add-on) falls back to the first one it does.
    const cores = state.rates?.cores() ?? [];
    if (cores.length && !cores.includes(state.settings.core)) state.settings.core = cores[0];
  }

  function currentLeague(): string | null {
    return state.leagues ? leagueFor(state.leagues, state.settings.mode).id : null;
  }

  // ── actions ──────────────────────────────────────────────────────────────
  function resetResults(): void {
    state.listings = [];
    state.total = 0;
    state.queryId = '';
    state.localSort = { column: 'none', descending: false };
  }

  async function parseInput(text: string): Promise<void> {
    resetResults();
    state.error = '';

    const item = parseClipboard(text);
    if (!item) {
      state.item = null;
      state.rows = [];
      state.unmatched = [];
      if (text.trim()) state.error = 'That does not look like copied item text.';
      render();
      return;
    }

    state.item = item;
    state.status = 'Loading the trade stat list…';
    render();

    try {
      const index = await ensureStats();
      const match = matchItem(item, index);
      state.rows = [...buildStatFilters(match), ...buildEquipmentFilters(item)];
      state.unmatched = match.unmatched;
      state.status = '';
      // The text has done its job; hand the space to the filters and prices.
      paste.value = '';
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
      state.rows = [];
      state.unmatched = [];
    }
    render();
  }

  async function runSearch(): Promise<void> {
    const league = currentLeague();
    if (!state.item || !league || state.busy) return;

    const enabled = state.rows.filter((row) => row.enabled).length;
    if (enabled > MAX_ENABLED_FILTERS) {
      state.error = `Too many filters (${enabled}). The trade API rejects complex queries — keep it to ${MAX_ENABLED_FILTERS}.`;
      render();
      return;
    }

    state.busy = true;
    state.error = '';
    state.status = 'Searching…';
    render();

    try {
      const request = buildQuery(state.item, state.rows, {
        status: state.settings.status,
        sort: sortFor(state.settings.sort),
      });
      const outcome = await search(client, league, request);
      state.listings = outcome.listings;
      state.total = outcome.total;
      state.queryId = outcome.queryId;
      state.localSort = { column: 'none', descending: false };
      state.status = outcome.total === 0 ? 'No matches.' : `${outcome.total} listings.`;
    } catch (err) {
      state.error =
        err instanceof TradeError ? err.message : `Search failed: ${(err as Error).message}`;
      state.listings = [];
    } finally {
      state.busy = false;
      render();
    }
  }

  // ── render ───────────────────────────────────────────────────────────────
  function renderBar(): void {
    bar.replaceChildren();

    const toggle = el('div', 'pc-toggle');
    (['sc', 'hc'] as LeagueMode[]).forEach((mode) => {
      const league = state.leagues ? (mode === 'hc' ? state.leagues.hc : state.leagues.sc) : null;
      const button = el('button', state.settings.mode === mode ? 'on' : undefined);
      button.type = 'button';
      button.textContent = mode === 'sc' ? 'SC' : 'HC';
      button.title = league ? leagueLabel(league) : 'Loading leagues…';
      button.disabled = !league;
      button.addEventListener('click', () => {
        state.settings.mode = mode;
        resetResults();
        void saveSettings();
        render();
      });
      toggle.append(button);
    });

    const sort = el('select');
    sort.title = 'What the search asks the API for';
    for (const entry of SORTS) {
      const option = el('option');
      option.value = entry.key;
      option.textContent = entry.label;
      sort.append(option);
    }
    sort.value = state.settings.sort;
    sort.addEventListener('change', () => {
      state.settings.sort = sort.value as SortKey;
      void saveSettings();
      if (state.listings.length) void runSearch();
    });

    // Exiled Exchange 2 offers exactly two core currencies as radio buttons;
    // divine is not among them because `normalize` promotes to divines on its
    // own once a price is worth one. Hidden entirely without rates — a
    // converter with nothing to convert by is a control that does nothing.
    const cores = state.rates?.cores() ?? [];
    const core = el('div', 'pc-toggle');
    for (const id of cores) {
      const button = el('button', state.settings.core === id ? 'on' : undefined);
      button.type = 'button';
      button.textContent = abbreviate(id).toUpperCase();
      button.title = `Show prices in ${state.currencies?.get(id).name ?? id}`;
      button.addEventListener('click', () => {
        state.settings.core = id;
        void saveSettings();
        render();
      });
      core.append(button);
    }

    bar.append(toggle, sort, el('div', 'pc-status', state.status));
    if (cores.length > 1) bar.append(core);
  }

  // Sidekick anchors Search at the bottom of the filter column, under
  // everything it acts on. Same here.
  function renderSearch(): void {
    searchWrap.replaceChildren();
    if (!state.item) return;
    const go = el('button', 'pc-primary pc-search', state.busy ? 'Searching…' : 'Search');
    go.type = 'button';
    go.disabled = state.busy || !state.leagues;
    go.addEventListener('click', () => void runSearch());
    searchWrap.append(go);
  }

  function renderNotice(): void {
    notice.replaceChildren();
    if (state.error) notice.append(el('div', 'pc-error', state.error));
    if (state.item && !state.item.hasAdvancedDescriptions) {
      notice.append(
        el(
          'div',
          'pc-warn',
          'No mod tiers in this copy — hold the Advanced Item Descriptions key (Alt by default) while pressing Ctrl+C.',
        ),
      );
    }
    if (state.unmatched.length) {
      notice.append(
        el(
          'div',
          'pc-warn',
          `${state.unmatched.length} line(s) not recognised: ${state.unmatched.join(' • ')}`,
        ),
      );
    }
  }
  function renderItem(): void {
    itemHead.style.display = state.item ? '' : 'none';
    if (!state.item) return;
    renderItemHeader(itemHead, {
      item: state.item,
      onClear: () => {
        state.item = null;
        state.rows = [];
        state.unmatched = [];
        state.error = '';
        resetResults();
        render();
        paste.focus();
      },
    });
  }

  function renderFilterBlock(): void {
    filters.style.display = state.rows.length ? '' : 'none';
    filtersHead.replaceChildren();
    if (!state.rows.length) {
      // Hiding the container is not enough — the old rows stay in the DOM and
      // would flash back the next time it is shown.
      filterList.replaceChildren();
      return;
    }

    const enabled = state.rows.filter((row) => row.enabled).length;
    // The whole strip is the control, with a caret that turns — a bare "▸
    // Filters" label did not read as something you could press.
    const title = el('button', `pc-filters-title${state.filtersOpen ? ' open' : ''}`);
    title.type = 'button';
    title.setAttribute('aria-expanded', state.filtersOpen ? 'true' : 'false');
    title.title = state.filtersOpen ? 'Hide the filters' : 'Show the filters';
    title.append(
      el('span', 'pc-caret', '▸'),
      el('span', undefined, 'Filters'),
      el('span', 'pc-filters-count', `${enabled} of ${state.rows.length} active`),
    );
    title.addEventListener('click', () => {
      state.filtersOpen = !state.filtersOpen;
      render();
    });
    filtersHead.append(title);

    filterList.style.display = state.filtersOpen ? '' : 'none';
    if (!state.filtersOpen) return;
    renderFilters(filterList, {
      rows: state.rows,
      onChange: () => {
        // Only the count depends on this; redrawing the list would steal focus
        // from the number input being typed into.
        const active = state.rows.filter((row) => row.enabled).length;
        const count = title.querySelector('.pc-filters-count');
        if (count) count.textContent = `${active} of ${state.rows.length} active`;
      },
    });
  }

  function renderFoot(): void {
    foot.replaceChildren();
    const league = state.leagues ? leagueFor(state.leagues, state.settings.mode) : null;
    foot.append(el('span', undefined, league ? leagueLabel(league) : 'Resolving league…'));

    if (state.listings.length) {
      foot.append(
        el('span', undefined, `Showing ${state.listings.length} of ${state.total} listings`),
      );
    }

    if (state.queryId && league && host.shell) {
      const open = el('button', 'pc-link', 'Open on the trade site');
      open.type = 'button';
      open.addEventListener('click', () => {
        void host.shell?.openExternal(searchUrl(league.id, state.queryId));
      });
      foot.append(open);
    }
  }

  function renderList(): void {
    renderResults(resultList, {
      host,
      item: state.item,
      listings: sortListings(state.listings, state.localSort),
      total: state.total,
      sort: state.localSort,
      priceSorted: state.localSort.column === 'none',
      priceDescending: state.settings.sort === 'price-desc',
      currencies: state.currencies,
      rates: state.rates,
      core: state.settings.core,
      onSort: (column: LocalSort) => {
        state.localSort =
          state.localSort.column === column
            ? { column, descending: !state.localSort.descending }
            : { column, descending: false };
        renderList();
      },
      onPriceSort: () => {
        // Back to the server's order, flipping direction if it was already on.
        if (state.localSort.column === 'none') {
          state.settings.sort = state.settings.sort === 'price-asc' ? 'price-desc' : 'price-asc';
        }
        state.localSort = { column: 'none', descending: false };
        void saveSettings();
        void runSearch();
      },
    });
  }

  function render(): void {
    renderBar();
    renderNotice();
    renderItem();
    renderFilterBlock();
    renderSearch();
    renderList();
    renderFoot();
  }

  paste.addEventListener('input', () => void parseInput(paste.value));

  await loadSettings();
  render();
  await loadLeagues();
  render();
  await loadCurrencyData();
  render();
};

export default mount;
