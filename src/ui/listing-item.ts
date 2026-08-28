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

/** `P7` is prefix tier 7, `S5` suffix tier 5 — the trade site's own shorthand. */
function affixLabel(mod: ListingMod): string | null {
  const detail = mod.mods?.[0];
  if (!detail) return null;
  const parts = [detail.name, detail.tier].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

/** `39–51`, the range this roll came out of. */
function rangeLabel(mod: ListingMod): string | null {
  const magnitudes = mod.mods?.[0]?.magnitudes ?? [];
  const ranges = magnitudes
    .filter((m) => m.min !== undefined && m.max !== undefined)
    .map((m) => (m.min === m.max ? `${m.min}` : `${m.min}–${m.max}`));
  return ranges.length ? ranges.join(', ') : null;
}

function modRow(mod: ListingMod, kind: string): HTMLElement {
  const row = el('div', `pc-mod ${kind}`);
  row.append(el('span', 'pc-mod-text', cleanDescription(mod.description ?? '')));

  const affix = affixLabel(mod);
  const range = rangeLabel(mod);
  if (affix || range) {
    const meta = el('span', 'pc-mod-meta');
    if (affix) meta.append(el('span', 'pc-mod-affix', affix));
    if (range) meta.append(el('span', 'pc-mod-range', range));
    row.append(meta);
  }
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
 * renders the same thing per listing (`Trade/Items/ItemComponent.razor`); here
 * it is behind the row's icon rather than always on, because a page of full
 * item cards stops being a price comparison.
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

  if (listing.stash?.name) {
    container.append(el('div', 'pc-detail-facts', `Stash: ${listing.stash.name}`));
  }
}

/**
 * One line standing in for the item in the results row. A rare's random name
 * says nothing, so its mods do the talking; everything else is known by name.
 */
export function listingSummary(listing: Listing): string {
  const item = listing.item;
  const mods = item.explicitMods ?? [];
  if (item.rarity === 'Rare' && mods.length) {
    return mods.map((mod) => cleanDescription(mod.description ?? '')).join(', ');
  }
  return item.name || item.typeLine || item.baseType || '';
}
