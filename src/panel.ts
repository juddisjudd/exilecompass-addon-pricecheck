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
import { buildQuery } from './trade/query';
import { search, searchUrl, type Listing } from './trade/search';
import { CSS, el } from './ui/dom';
import { MAX_ENABLED_FILTERS, renderFilters } from './ui/filters';
import { renderResults } from './ui/results';
import type { MountFn } from './types';

const SETTINGS_KEY = 'settings.v1';

interface Settings {
  /**
   * Which of the two current leagues to search. The mode is stored, not a
   * league id: ids change every league, the choice does not (PLAN.md §2.1).
   */
  mode: LeagueMode;
  status: string;
}

const DEFAULT_SETTINGS: Settings = { mode: 'sc', status: 'online' };

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
  };

  const client = new TradeClient(host, {
    onWait: (seconds) => {
      state.status = `Waiting ${seconds}s for the trade API rate limit…`;
      renderBar();
    },
  });

  let statIndex: StatIndex | null = null;

  // ── shell ────────────────────────────────────────────────────────────────
  const shell = el('div', 'pc');
  const bar = el('div', 'pc-bar');
  const notice = el('div');
  const paste = el('textarea', 'pc-paste');
  paste.placeholder = 'Copy an item in game with Ctrl+C (hold Alt for mod tiers) and paste it here.';
  paste.spellcheck = false;
  const head = el('div', 'pc-head');
  const filterList = el('div', 'pc-scroll');
  const resultList = el('div', 'pc-scroll');
  const foot = el('div', 'pc-foot');
  shell.append(bar, notice, paste, head, filterList, resultList, foot);
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

  function currentLeague(): string | null {
    return state.leagues ? leagueFor(state.leagues, state.settings.mode).id : null;
  }

  // ── actions ──────────────────────────────────────────────────────────────
  async function parseInput(text: string): Promise<void> {
    state.listings = [];
    state.total = 0;
    state.queryId = '';
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
      const request = buildQuery(state.item, state.rows, { status: state.settings.status });
      const outcome = await search(client, league, request);
      state.listings = outcome.listings;
      state.total = outcome.total;
      state.queryId = outcome.queryId;
      state.status = outcome.total === 0 ? 'No matches.' : `${outcome.total} listings.`;
    } catch (err) {
      state.error = err instanceof TradeError ? err.message : `Search failed: ${(err as Error).message}`;
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
      button.textContent = mode === 'sc' ? 'Softcore' : 'Hardcore';
      button.title = league ? leagueLabel(league) : 'Loading leagues…';
      button.disabled = !league;
      button.addEventListener('click', () => {
        state.settings.mode = mode;
        state.listings = [];
        state.queryId = '';
        void saveSettings();
        render();
      });
      toggle.append(button);
    });

    const status = el('select');
    for (const [value, label] of [
      ['online', 'Online only'],
      ['onlineleague', 'Online in league'],
      ['any', 'Any listing'],
    ]) {
      const option = el('option');
      option.value = value;
      option.textContent = label;
      status.append(option);
    }
    status.value = state.settings.status;
    status.addEventListener('change', () => {
      state.settings.status = status.value;
      void saveSettings();
    });

    const go = el('button', 'pc-primary', state.busy ? 'Searching…' : 'Price check');
    go.type = 'button';
    go.disabled = state.busy || !state.item || !state.leagues;
    go.addEventListener('click', () => void runSearch());

    bar.append(toggle, status, go, el('div', 'pc-status', state.status));
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

  function renderHead(): void {
    head.replaceChildren();
    if (!state.item) return;
    const item = state.item;
    head.append(el('span', 'pc-name', item.name || item.baseType || 'Item'));
    const details = [item.baseType && item.baseType !== item.name ? item.baseType : '', item.itemClass]
      .filter(Boolean)
      .join(' • ');
    if (details) head.append(el('span', 'pc-sub', details));
    if (item.itemLevel) head.append(el('span', 'pc-sub', `ilvl ${item.itemLevel}`));
  }

  function renderFoot(): void {
    foot.replaceChildren();
    const league = state.leagues ? leagueFor(state.leagues, state.settings.mode) : null;
    foot.append(el('span', undefined, league ? leagueLabel(league) : 'Resolving league…'));

    if (state.queryId && league && host.shell) {
      const open = el('button', 'pc-link', 'Open on the trade site');
      open.type = 'button';
      open.addEventListener('click', () => {
        void host.shell?.openExternal(searchUrl(league.id, state.queryId));
      });
      foot.append(open);
    }
  }

  function render(): void {
    renderBar();
    renderNotice();
    renderHead();
    renderFilters(filterList, {
      rows: state.rows,
      onChange: () => {
        /* rows carry their own state; nothing to recompute until a search */
      },
    });
    renderResults(resultList, {
      host,
      listings: state.listings,
      total: state.total,
      onStatus: (message) => {
        state.status = message;
        renderBar();
      },
    });
    renderFoot();
  }

  paste.addEventListener('input', () => void parseInput(paste.value));

  await loadSettings();
  render();
  await loadLeagues();
  render();
};

export default mount;
