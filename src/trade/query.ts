import type { ParsedItem } from '../parser/types';
import type { AnyFilterRow } from '../stats/filters';

/**
 * The request body `/search/<league>` takes. Shape confirmed against
 * `/data/filters` (group and field ids) and Exiled-Exchange-2's
 * `renderer/src/web/price-check/trade/pathofexile-trade.ts`.
 */
export interface TradeRequest {
  query: {
    status: { option: string };
    name?: string;
    type?: string;
    stats: Array<{
      type: 'and';
      filters: Array<{ id: string; value?: { min?: number; max?: number }; disabled?: boolean }>;
    }>;
    filters: Record<string, { filters: Record<string, unknown> }>;
  };
  sort: Record<string, string>;
}

export interface QueryOptions {
  /** `online` (default), `onlineleague`, or `any`. */
  status?: string;
  /** What the API orders by. Only `price` and `indexed` are accepted keys. */
  sort?: Record<string, string>;
  /** Search by base type. Off for uniques, where the name is the identity. */
  useType?: boolean;
  /** Match the item's own rarity, so a rare search doesn't return uniques. */
  useRarity?: boolean;
  minItemLevel?: number;
}

const RARITY_OPTIONS: Record<string, string> = {
  Normal: 'normal',
  Magic: 'magic',
  Rare: 'rare',
  Unique: 'unique',
};

/**
 * Item Class as printed on the item -> the trade site's category option.
 * An unlisted class simply searches without a category filter: a wider search
 * is a worse search, not a wrong one.
 */
const CATEGORY_BY_CLASS: Record<string, string> = {
  Claws: 'weapon.claw',
  Daggers: 'weapon.dagger',
  Wands: 'weapon.wand',
  'One Hand Swords': 'weapon.onesword',
  'One Hand Axes': 'weapon.oneaxe',
  'One Hand Maces': 'weapon.onemace',
  Spears: 'weapon.spear',
  Flails: 'weapon.flail',
  'Two Hand Swords': 'weapon.twosword',
  'Two Hand Axes': 'weapon.twoaxe',
  'Two Hand Maces': 'weapon.twomace',
  Quarterstaves: 'weapon.warstaff',
  Bows: 'weapon.bow',
  Crossbows: 'weapon.crossbow',
  Sceptres: 'weapon.sceptre',
  Staves: 'weapon.staff',
  'Fishing Rods': 'weapon.rod',
  Helmets: 'armour.helmet',
  'Body Armours': 'armour.chest',
  Gloves: 'armour.gloves',
  Boots: 'armour.boots',
  Quivers: 'armour.quiver',
  Shields: 'armour.shield',
  Foci: 'armour.focus',
  Bucklers: 'armour.buckler',
  Amulets: 'accessory.amulet',
  Belts: 'accessory.belt',
  Rings: 'accessory.ring',
  Jewels: 'jewel',
  'Life Flasks': 'flask.life',
  'Mana Flasks': 'flask.mana',
  Charms: 'flask.charm',
  Waystones: 'map.waystone',
  Relics: 'sanctum.relic',
  Tablet: 'map.tablet',
  'Stackable Currency': 'currency',
  Runes: 'currency.rune',
  'Soul Cores': 'currency.soulcore',
  Omen: 'currency.omen',
  Idols: 'currency.idol',
  'Skill Gems': 'gem.activegem',
  'Support Gems': 'gem.supportgem',
  'Meta Gems': 'gem.metagem',
};

function bounds(row: AnyFilterRow): { min?: number; max?: number } | undefined {
  const value: { min?: number; max?: number } = {};
  if (row.min !== null && Number.isFinite(row.min)) value.min = row.min;
  if (row.max !== null && Number.isFinite(row.max)) value.max = row.max;
  return Object.keys(value).length ? value : undefined;
}

export function buildQuery(
  item: ParsedItem,
  rows: AnyFilterRow[],
  options: QueryOptions = {},
): TradeRequest {
  const enabled = rows.filter((row) => row.enabled);

  const stats = enabled
    .filter((row): row is Extract<AnyFilterRow, { kind: 'stat' }> => row.kind === 'stat')
    .map((row) => ({ id: row.statId, value: bounds(row) }));

  const equipment: Record<string, unknown> = {};
  for (const row of enabled) {
    if (row.kind !== 'equipment') continue;
    const value = bounds(row);
    if (value) equipment[row.field] = value;
  }

  const typeFilters: Record<string, unknown> = {};
  const category = CATEGORY_BY_CLASS[item.itemClass];
  if (category) typeFilters.category = { option: category };
  if (options.useRarity !== false) {
    const rarity = RARITY_OPTIONS[item.rarity];
    if (rarity) typeFilters.rarity = { option: rarity };
  }
  if (options.minItemLevel) typeFilters.ilvl = { min: options.minItemLevel };

  const miscFilters: Record<string, unknown> = {};
  if (item.corrupted) miscFilters.corrupted = { option: 'true' };

  const filters: TradeRequest['query']['filters'] = {};
  if (Object.keys(typeFilters).length) filters.type_filters = { filters: typeFilters };
  if (Object.keys(equipment).length) filters.equipment_filters = { filters: equipment };
  if (Object.keys(miscFilters).length) filters.misc_filters = { filters: miscFilters };

  const query: TradeRequest['query'] = {
    status: { option: options.status ?? 'online' },
    stats: [{ type: 'and', filters: stats }],
    filters,
  };

  // A unique is identified by its name; everything else by its base type. A
  // magic item has neither — its name line carries its affixes — so it is
  // searched on stats alone.
  if (item.rarity === 'Unique') {
    query.name = item.name;
    if (item.baseType) query.type = item.baseType;
  } else if (options.useType !== false && item.baseType) {
    query.type = item.baseType;
  }

  return { query, sort: options.sort ?? { price: 'asc' } };
}
