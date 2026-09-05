import { parseClipboard, type ParsedItem } from './parser';
import { buildEquipmentFilters, buildStatFilters, type AnyFilterRow } from './stats/filters';
import { StatIndex, matchItem, type StatsPayload } from './stats/match';
import { TradeClient, TradeError } from './trade/client';
import {
  familyFor,
  leagueFor,
  leagueLabel,
  resolveLeagues,
  type LeagueFamily,
  type LeagueMode,
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
import {
  fetchListings,
  PAGE_SIZE,
  search,
  searchUrl,
  SEARCH_POLICY,
  sortFor,
  type Listing,
  type SortKey,
} from './trade/search';
import { CSS, el } from './ui/dom';
import { MAX_ENABLED_FILTERS, renderFilters } from './ui/filters';
import { renderItemHeader } from './ui/item';
import { renderResults, sortListings, type LocalSort, type SortState } from './ui/results';
import type { MountFn } from './types';

/**
 * v2 dropped the stored order: v1 defaulted to cheapest-first and the default
 * is now newest-first, and a saved default would have pinned every existing
 * install to the old one. Everything else carries over.
 */
const SETTINGS_KEY = 'settings.v2';
const LEGACY_SETTINGS_KEY = 'settings.v1';

interface Settings {
  /**
   * Softcore or hardcore. The mode is stored, not a league id: ids change
   * every league, the choice does not (PLAN.md §2.1).
   */
  mode: LeagueMode;
  /**
   * Which challenge league, by its softcore id, for the weeks where the
   * previous one is still live. Null — and an id whose league has since
   * ended — both mean the newest, so a rollover needs no migration.
   */
  league: string | null;
  /**
   * Which listings the API returns. No longer a control: PoE2 sells through
   * in-game asynchronous offers, so whether the seller happens to be logged in
   * says nothing about whether you can buy it. Left at the trade site's own
   * default rather than widened to `any`, which would let long-abandoned
   * listings set the price.
   */
  status: string;
  /** Server-side order. The Price and Listed headers change it and re-run the search. */
  sort: SortKey;
  /** Which currency prices are restated in — exalted or chaos, per EE2. */
  core: string;
  /** Every listing opened to its full item, Sidekick's non-compact view. */
  expandAll: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  mode: 'sc',
  league: null,
  status: 'online',
  sort: 'recent',
  core: CORE_CURRENCIES[0],
  expandAll: false,
};

interface State {
  settings: Settings;
  leagues: LeagueFamily[] | null;
  item: ParsedItem | null;
  rows: AnyFilterRow[];
  unmatched: string[];
  listings: Listing[];
  total: number;
  queryId: string;
  /** Every id the search returned, and how many of them have been fetched. */
  ids: string[];
  fetched: number;
  loadingMore: boolean;
  status: string;
  error: string;
  busy: boolean;
  filtersOpen: boolean;
  localSort: SortState;
  /** Listings toggled the other way from `settings.expandAll`. */
  toggled: Set<string>;
  currencies: CurrencyIndex | null;
  rates: Rates | null;
  /** Which league `rates` were fetched for — they are per-market, not global. */
  ratesLeague: string | null;
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
    ids: [],
    fetched: 0,
    loadingMore: false,
    status: '',
    error: '',
    busy: false,
    filtersOpen: true,
    localSort: { column: 'none', descending: false },
    toggled: new Set(),
    currencies: null,
    rates: null,
    ratesLeague: null,
  };

  const client = new TradeClient(host, {
    onWait: (seconds) => {
      state.status = `Waiting ${seconds}s for the trade API rate limit…`;
      renderBar();
    },
  });

  let statIndex: StatIndex | null = null;

  // ── shell ────────────────────────────────────────────────────────────────
  // Two columns when there is room, as Sidekick lays it out
  // (`ItemOverlay.razor`'s LayoutTwoColumn): the item and its filters on the
  // left, the listings on the right. At the overlay's default size the panes
  // stack, and the filters fold to one line once a search has returned so the
  // listings get the height.
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
      if (raw) {
        state.settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Settings) };
        return;
      }
      const legacy = await host.storage.get(LEGACY_SETTINGS_KEY);
      if (legacy) {
        const { sort: _dropped, ...kept } = JSON.parse(legacy) as Partial<Settings>;
        state.settings = { ...DEFAULT_SETTINGS, ...kept };
        await saveSettings();
      }
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
      if (state.settings.mode === 'hc' && !currentFamily()?.hc) {
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
    if (league && state.ratesLeague !== league) {
      state.rates = await loadRates(host, league);
      state.ratesLeague = league;
    }
    // A core the economy has no rate for (or a value left by an older
    // version of this add-on) falls back to the first one it does.
    const cores = state.rates?.cores() ?? [];
    if (cores.length && !cores.includes(state.settings.core)) state.settings.core = cores[0];
  }

  function currentFamily(): LeagueFamily | null {
    return state.leagues ? familyFor(state.leagues, state.settings.league) : null;
  }

  function currentLeague(): string | null {
    const family = currentFamily();
    return family ? leagueFor(family, state.settings.mode).id : null;
  }

  // ── actions ──────────────────────────────────────────────────────────────
  function resetResults(): void {
    state.listings = [];
    state.total = 0;
    state.queryId = '';
    state.ids = [];
    state.fetched = 0;
    state.loadingMore = false;
    state.status = '';
    state.localSort = { column: 'none', descending: false };
    state.toggled = new Set();
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
    state.filtersOpen = true;
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
      state.ids = outcome.ids;
      state.fetched = Math.min(PAGE_SIZE, outcome.ids.length);
      state.localSort = { column: 'none', descending: false };
      state.toggled = new Set();
      state.status = '';
      // The listings are the answer, so once there are some they get the
      // height; with none, the filters stay up because that is what needs
      // changing. The strip reopens them with one click either way.
      if (outcome.listings.length) state.filtersOpen = false;
    } catch (err) {
      state.error =
        err instanceof TradeError ? err.message : `Search failed: ${(err as Error).message}`;
      state.listings = [];
      state.status = '';
    } finally {
      state.busy = false;
      render();
    }
  }

  /** The next ten of the ids the search already returned — no new search. */
  async function loadMore(): Promise<void> {
    if (state.busy || state.loadingMore || !state.queryId) return;
    const next = state.ids.slice(state.fetched, state.fetched + PAGE_SIZE);
    if (!next.length) return;

    state.loadingMore = true;
    state.error = '';
    renderList();
    try {
      const page = await fetchListings(client, state.queryId, next);
      state.listings = [...state.listings, ...page];
      state.fetched += next.length;
    } catch (err) {
      state.error =
        err instanceof TradeError ? err.message : `Loading more failed: ${(err as Error).message}`;
    } finally {
      state.loadingMore = false;
      renderNotice();
      renderList();
    }
  }

  // ── render ───────────────────────────────────────────────────────────────
  /** Only what is happening right now — searching, waiting on the limiter. */
  function renderBar(): void {
    bar.style.display = state.status ? '' : 'none';
    bar.replaceChildren(el('div', 'pc-status', state.status));
  }

  function renderLeagueToggle(): HTMLElement {
    const family = currentFamily();
    const toggle = el('div', 'pc-toggle');
    (['sc', 'hc'] as LeagueMode[]).forEach((mode) => {
      const league = family ? (mode === 'hc' ? family.hc : family.sc) : null;
      const button = el('button', state.settings.mode === mode ? 'on' : undefined);
      button.type = 'button';
      button.textContent = mode === 'sc' ? 'SC' : 'HC';
      button.title = league ? leagueLabel(league) : 'Loading leagues…';
      button.disabled = !league;
      button.addEventListener('click', () => {
        state.settings.mode = mode;
        onLeagueChanged();
      });
      toggle.append(button);
    });
    return toggle;
  }

  /**
   * A picker only while a previous league is still live — for most of a league
   * there is one market and a one-entry dropdown is a control that does nothing.
   * Either way it names the league actually being searched, hardcore included,
   * so the footer still answers "which market is this price from".
   */
  function renderLeaguePick(): HTMLElement {
    const family = currentFamily();
    const name = (f: LeagueFamily) => leagueLabel(leagueFor(f, state.settings.mode));
    if (!state.leagues || state.leagues.length < 2) {
      return el('span', undefined, family ? name(family) : 'Resolving league…');
    }
    const select = el('select', 'pc-league-pick');
    for (const option of state.leagues) {
      const opt = el('option', undefined, name(option));
      opt.value = option.sc.id;
      opt.selected = option.sc.id === family?.sc.id;
      select.append(opt);
    }
    select.addEventListener('change', () => {
      state.settings.league = select.value;
      onLeagueChanged();
    });
    return select;
  }

  /** Results and rates both belong to the league that produced them. */
  function onLeagueChanged(): void {
    resetResults();
    void saveSettings();
    void loadCurrencyData().then(render);
    render();
  }

  // Search sits directly under the filters it acts on, with the core currency
  // beside it. Order is not a control here: the Price header owns it.
  function renderSearch(): void {
    searchWrap.replaceChildren();
    if (!state.item) return;

    const go = el('button', 'pc-primary pc-search', state.busy ? 'Searching…' : 'Search');
    go.type = 'button';
    go.disabled = state.busy || !state.leagues;
    go.addEventListener('click', () => void runSearch());
    searchWrap.append(go);

    // Exiled Exchange 2 offers exactly two core currencies as radio buttons;
    // divine is not among them because `normalize` promotes to divines on its
    // own once a price is worth one. Hidden entirely without rates — a
    // converter with nothing to convert by is a control that does nothing.
    const cores = state.rates?.cores() ?? [];
    if (cores.length > 1) {
      const core = el('div', 'pc-toggle pc-core');
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
      searchWrap.append(core);
    }
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
    const family = currentFamily();
    const league = family ? leagueFor(family, state.settings.mode) : null;

    // The switch belongs beside the league it switches, and the footer is
    // already where the panel says which league it is searching.
    const where = el('div', 'pc-foot-league');
    where.append(renderLeagueToggle(), renderLeaguePick());
    foot.append(where);

    const limit = client.limiter.describe(SEARCH_POLICY);
    if (limit) {
      const usage = el('span', 'pc-limit', `${limit.used}/${limit.limit} searches per ${limit.period}s`);
      usage.title = 'GGG rate limit. Going over it bans your IP from trade for a while.';
      foot.append(usage);
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
      searched: !!state.queryId,
      remaining: state.ids.length - state.fetched,
      loadingMore: state.loadingMore,
      sort: state.localSort,
      serverSort: state.settings.sort,
      currencies: state.currencies,
      rates: state.rates,
      core: state.settings.core,
      expandAll: state.settings.expandAll,
      toggled: state.toggled,
      onSort: (column: LocalSort) => {
        state.localSort =
          state.localSort.column === column
            ? { column, descending: !state.localSort.descending }
            : { column, descending: false };
        renderList();
      },
      onServerSort: (target) => {
        // Price and Listed are the server's orders. Clicking the one already
        // in force flips its direction; clicking the other switches to it.
        // Either way it is one search — except when a local ilvl sort is the
        // only thing on top of the order asked for, which just comes off.
        const current = state.settings.sort;
        const isPrice = current === 'price-asc' || current === 'price-desc';
        const sameGroup = target === 'price' ? isPrice : !isPrice;
        if (state.localSort.column !== 'none') {
          state.localSort = { column: 'none', descending: false };
          if (sameGroup) {
            renderList();
            return;
          }
        } else if (sameGroup) {
          state.settings.sort =
            target === 'price'
              ? current === 'price-asc'
                ? 'price-desc'
                : 'price-asc'
              : current === 'recent'
                ? 'oldest'
                : 'recent';
        }
        if (!sameGroup) state.settings.sort = target === 'price' ? 'price-asc' : 'recent';
        void saveSettings();
        void runSearch();
      },
      onLoadMore: () => void loadMore(),
      onToggleAll: () => {
        state.settings.expandAll = !state.settings.expandAll;
        state.toggled = new Set();
        void saveSettings();
        renderList();
      },
      onToggle: (id: string) => {
        if (state.toggled.has(id)) state.toggled.delete(id);
        else state.toggled.add(id);
        renderList();
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
