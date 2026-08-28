import type { Listing, ListingLine, ListingMod } from '../trade/search';
import { el } from './dom';

/**
 * Mod text arrives with PoE's own markup: `[Resistances]` is a plain link and
 * `[ElementalDamage|Elemental]` is a link whose second half is what the game
 * actually prints. Left in, an item reads like a wiki source page.
 */
export function cleanDescription(text: string): string {
  return text.replace(/\[([^\]|]+)(?:\|([^\]]+))?\]/g, (_all, first: string, second?: string) =>
    second ?? first,
  );
}

function lineText(line: ListingLine): string {
  const values = (line.values ?? []).map(([text]) => text).filter(Boolean);
  return values.length ? `${line.name}: ${values.join(', ')}` : line.name;
}

/** `39–51`, the range this roll came out of. */
function rangeLabel(mod: ListingMod): string | null {
  const magnitudes = mod.mods?.[0]?.magnitudes ?? [];
  const ranges = magnitudes
    .filter((m) => m.min !== undefined && m.max !== undefined)
    .map((m) => (m.min === m.max ? `${m.min}` : `${m.min}–${m.max}`));
  return ranges.length ? ranges.join(', ') : null;
}

/**
 * Sidekick puts the affix tier in the margin beside its mod — `P1` for a
 * prefix, `S2` for a suffix, coloured apart
 * (`Trade/Items/ItemStatLineComponent.razor`). It reads far faster than a name
 * and a tier trailing off the end of the line, and it lines the tiers up into
 * a column you can scan.
 */
function tierBadge(mod: ListingMod): HTMLElement {
  const detail = mod.mods?.[0];
  const tier = detail?.tier;
  if (!tier) return el('span', 'pc-affix empty');

  const prefix = tier.toUpperCase().startsWith('P');
  const badge = el('span', `pc-affix ${prefix ? 'prefix' : 'suffix'}`, tier);
  badge.title = detail?.name
    ? `${prefix ? 'Prefix' : 'Suffix'} — ${detail.name}`
    : prefix
      ? 'Prefix'
      : 'Suffix';
  return badge;
}

function modRow(mod: ListingMod, kind: string): HTMLElement {
  const row = el('div', `pc-mod ${kind}`);
  row.append(tierBadge(mod), el('span', 'pc-mod-text', cleanDescription(mod.description ?? '')));
  const range = rangeLabel(mod);
  if (range) row.append(el('span', 'pc-mod-range', range));
  return row;
}

const RARITY_CLASS: Record<string, string> = {
  Rare: 'rare',
  Unique: 'unique',
  Magic: 'magic',
};

/**
 * The whole item, the way the game shows it: name and base, then properties,
 * requirements, and every mod with its affix, tier and roll range. Sidekick
 * renders the same thing per listing (`Trade/Items/ItemComponent.razor`), and
 * so does the card here: what you are comparing prices against is the item,
 * so it should not be hidden behind a control.
 */
export function renderListingItem(container: HTMLElement, listing: Listing): void {
  const item = listing.item;
  container.replaceChildren();

  const head = el('div', 'pc-detail-head');
  const rarity = RARITY_CLASS[item.rarity ?? ''] ?? '';
  head.append(el('span', `pc-item-name ${rarity}`.trim(), item.name || item.typeLine || 'Item'));
  if (item.name && item.typeLine && item.typeLine !== item.name) {
    head.append(el('span', 'pc-item-base', item.typeLine));
  }
  if (item.ilvl) head.append(el('span', 'pc-item-class', `ilvl ${item.ilvl}`));
  if (item.identified === false) head.append(el('span', 'pc-flag', 'unidentified'));
  if (item.corrupted) head.append(el('span', 'pc-flag', 'corrupted'));
  container.append(head);

  const facts = [...(item.properties ?? []), ...(item.requirements ?? [])]
    .map(lineText)
    .filter(Boolean);
  if (facts.length) container.append(el('div', 'pc-detail-facts', facts.join('  •  ')));

  const groups: Array<[string, ListingMod[] | undefined]> = [
    ['enchant', item.enchantMods],
    ['implicit', item.implicitMods],
    ['rune', item.runeMods],
    ['explicit', item.explicitMods],
  ];
  for (const [kind, mods] of groups) {
    if (!mods?.length) continue;
    const block = el('div', 'pc-mods');
    for (const mod of mods) block.append(modRow(mod, kind));
    container.append(block);
  }

}

