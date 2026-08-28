import type { ParsedItem } from '../parser/types';
import { el } from './dom';

export interface Chip {
  label: string;
  value: string;
}

function average(range: { min: number; max: number } | undefined): number {
  return range ? (range.min + range.max) / 2 : 0;
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * What the item is, as a handful of values — not the copied text it came
 * from. The raw block is the input, not the answer; once it parses, the
 * numbers a price depends on are all anyone needs to see.
 */
export function itemChips(item: ParsedItem): Chip[] {
  const chips: Chip[] = [];
  const add = (label: string, value: number | undefined, suffix = '') => {
    if (value === undefined || !Number.isFinite(value) || value <= 0) return;
    chips.push({ label, value: `${round(value)}${suffix}` });
  };

  add('ilvl', item.itemLevel);
  add('qual', item.quality, '%');

  const aps = item.attacksPerSecond;
  if (aps) {
    const pdps = average(item.physicalDamage) * aps;
    const edps =
      (average(item.fireDamage) + average(item.coldDamage) + average(item.lightningDamage)) * aps;
    const chaos = average(item.chaosDamage) * aps;
    add('dps', pdps + edps + chaos);
    add('pdps', pdps);
    add('edps', edps);
    add('aps', aps);
    add('crit', item.criticalChance, '%');
  }

  add('ar', item.armour);
  add('ev', item.evasion);
  add('es', item.energyShield);
  add('block', item.block, '%');
  add('spirit', item.spirit);
  add('sockets', item.sockets);
  add('stack', item.stackSize);

  return chips;
}

export interface ItemHeaderOptions {
  item: ParsedItem;
  /** Drops the item, its filters and its results. */
  onClear: () => void;
}

const RARITY_CLASS: Record<string, string> = {
  Rare: 'rare',
  Unique: 'unique',
  Magic: 'magic',
  Currency: 'currency',
  Gem: 'gem',
};

export function renderItemHeader(container: HTMLElement, options: ItemHeaderOptions): void {
  const { item } = options;
  container.replaceChildren();

  const top = el('div', 'pc-item-top');
  const name = el('span', `pc-item-name ${RARITY_CLASS[item.rarity] ?? ''}`.trim());
  name.textContent = item.name || item.baseType || 'Item';
  top.append(name);

  if (item.baseType && item.baseType !== item.name) {
    top.append(el('span', 'pc-item-base', item.baseType));
  }
  if (item.itemClass) top.append(el('span', 'pc-item-class', item.itemClass));
  if (item.corrupted) top.append(el('span', 'pc-flag', 'corrupted'));
  if (item.unidentified) top.append(el('span', 'pc-flag', 'unidentified'));
  if (item.mirrored) top.append(el('span', 'pc-flag', 'mirrored'));

  const change = el('button', 'pc-link', 'Clear');
  change.type = 'button';
  change.title = 'Clear this item and its results';
  change.addEventListener('click', options.onClear);
  top.append(change);

  container.append(top);

  const chips = itemChips(item);
  if (chips.length) {
    const row = el('div', 'pc-chips');
    for (const chip of chips) {
      const node = el('span', 'pc-chip');
      node.append(el('span', 'pc-chip-label', chip.label), document.createTextNode(chip.value));
      row.append(node);
    }
    container.append(row);
  }
}
