import { COMPARISONS, type AnyFilterRow, type Comparison } from '../stats/filters';
import { el } from './dom';

/** Cap borrowed from GGG's own limit on query complexity (PLAN.md §8.6). */
export const MAX_ENABLED_FILTERS = 8;

export interface FilterListOptions {
  rows: AnyFilterRow[];
  onChange: () => void;
}

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
  return input;
}

function filterRow(row: AnyFilterRow, options: FilterListOptions): HTMLElement {
  const wrap = el('div', 'pc-filter');

  const check = el('input');
  check.type = 'checkbox';
  check.checked = row.enabled;
  check.addEventListener('change', () => {
    row.enabled = check.checked;
    options.onChange();
  });

  const label = el('div', 'pc-label');
  label.append(document.createTextNode(row.label));
  if (row.tier !== undefined) label.append(el('span', 'pc-tier', `T${row.tier}`));
  label.title = row.rolled === null ? row.label : `${row.label}  (rolled ${row.rolled})`;

  const compare = el('select', 'pc-compare');
  compare.title = 'How to read the numbers';
  for (const option of COMPARISONS) {
    const node = el('option');
    node.value = option.key;
    node.textContent = option.symbol;
    node.title = option.label;
    compare.append(node);
  }
  compare.value = row.comparison;

  const minInput = numberInput(row.min, 'min', (value) => {
    row.min = value;
    options.onChange();
  });
  const maxInput = numberInput(row.max, 'max', (value) => {
    row.max = value;
    options.onChange();
  });

  // "At most" reads from the max box, everything else from the min box, and
  // only Between uses both. Hiding the unused one is what makes the symbol
  // mean something.
  function applyComparison(): void {
    const mode = row.comparison;
    minInput.style.display = mode === 'max' ? 'none' : '';
    maxInput.style.display = mode === 'range' || mode === 'max' ? '' : 'none';
    minInput.placeholder = mode === 'exact' ? 'value' : 'min';
  }

  compare.addEventListener('change', () => {
    row.comparison = compare.value as Comparison;
    applyComparison();
    options.onChange();
  });
  applyComparison();

  wrap.append(check, label, compare, minInput, maxInput);
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
