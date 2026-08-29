import type { AnyFilterRow } from '../stats/filters';
import { el } from './dom';

/** Cap borrowed from GGG's own limit on query complexity (PLAN.md §8.6). */
export const MAX_ENABLED_FILTERS = 8;

export interface FilterListOptions {
  rows: AnyFilterRow[];
  onChange: () => void;
}

let seq = 0;

function numberInput(
  value: number | null,
  placeholder: string,
  onInput: (value: number | null) => void,
): HTMLInputElement {
  const input = el('input');
  input.type = 'number';
  input.placeholder = placeholder;
  input.value = value === null ? '' : String(value);
  input.addEventListener('input', () => {
    const parsed = input.value.trim() === '' ? null : Number(input.value);
    onInput(parsed === null || Number.isFinite(parsed) ? parsed : null);
  });
  // Right-click clears, as it does in both reference tools.
  input.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    input.value = '';
    onInput(null);
  });
  return input;
}

/**
 * The same `P3` / `S7` badge the listings wear, so the player's own mods and
 * the sellers' line up as one column. Implicits carry no affix, and get none.
 */
function tierBadge(row: AnyFilterRow): HTMLElement | null {
  if (row.tier === undefined) return null;
  if (!row.affix) return el('span', 'pc-tier', `T${row.tier}`);
  const prefix = row.affix === 'prefix';
  const badge = el('span', `pc-affix ${prefix ? 'prefix' : 'suffix'}`, `${prefix ? 'P' : 'S'}${row.tier}`);
  badge.title = `${prefix ? 'Prefix' : 'Suffix'}, tier ${row.tier}`;
  return badge;
}

/**
 * A row is its text until it is ticked; the min/max boxes only appear for a
 * filter that is on, as in Sidekick's `StatFilterComponent`. Unticked rows
 * read as a list of what the item has, and the text gets the whole width.
 */
function filterRow(row: AnyFilterRow, options: FilterListOptions): HTMLElement {
  const wrap = el('div', `pc-filter${row.enabled ? ' on' : ''}`);

  const check = el('input');
  check.type = 'checkbox';
  check.id = `pc-filter-${(seq += 1)}`;
  check.checked = row.enabled;
  check.addEventListener('change', () => {
    row.enabled = check.checked;
    wrap.classList.toggle('on', row.enabled);
    options.onChange();
  });

  const label = el('label', 'pc-label');
  label.htmlFor = check.id;
  label.append(document.createTextNode(row.label));
  // A mod's text carries its roll; a property's does not, so the value goes
  // after the name the way the game prints it (`Physical DPS: 87.8`).
  if (row.kind === 'equipment' && row.rolled !== null) {
    label.append(el('span', 'pc-value', `${row.rolled}`));
  }
  const badge = tierBadge(row);
  if (badge) label.append(badge);
  label.title = row.rolled === null ? row.label : `${row.label}  (rolled ${row.rolled})`;

  const minInput = numberInput(row.min, 'min', (value) => {
    row.min = value;
    options.onChange();
  });
  const maxInput = numberInput(row.max, 'max', (value) => {
    row.max = value;
    options.onChange();
  });

  const range = el('div', 'pc-range');
  range.append(minInput, maxInput);

  wrap.append(check, label, range);
  return wrap;
}

export function renderFilters(container: HTMLElement, options: FilterListOptions): void {
  container.replaceChildren();
  const stats = options.rows.filter((row) => row.kind === 'stat');
  const equipment = options.rows.filter((row) => row.kind === 'equipment');

  if (!stats.length && !equipment.length) {
    container.append(el('div', 'pc-empty', 'Nothing to filter on — paste an item above.'));
    return;
  }

  if (stats.length) {
    container.append(el('div', 'pc-section', 'Modifiers'));
    for (const row of stats) container.append(filterRow(row, options));
  }
  if (equipment.length) {
    container.append(el('div', 'pc-section', 'Properties'));
    for (const row of equipment) container.append(filterRow(row, options));
  }
}
