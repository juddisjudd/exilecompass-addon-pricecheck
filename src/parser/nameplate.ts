import type { ItemRarity } from './types';
import { keyValue } from './sections';

const RARITIES: ItemRarity[] = ['Normal', 'Magic', 'Rare', 'Unique', 'Currency', 'Gem', 'Quest'];

export interface Nameplate {
  itemClass: string;
  rarity: ItemRarity;
  name: string;
  baseType: string;
}

/**
 * The first section:
 *
 *   Item Class: Rings
 *   Rarity: Rare
 *   Rune Loop          <- name (rare and unique only)
 *   Prismatic Ring     <- base type
 *
 * A magic item has one name line with its affixes baked in ("Vaporous
 * Prismatic Ring of Warmth"), so there is no base type to take from it —
 * those are searched on their stats, not their name.
 */
export function parseNameplate(lines: string[]): Nameplate {
  let itemClass = '';
  let rarity: ItemRarity = 'Unknown';
  const rest: string[] = [];

  for (const line of lines) {
    const kv = keyValue(line);
    if (kv && kv[0] === 'Item Class') {
      itemClass = kv[1];
      continue;
    }
    if (kv && kv[0] === 'Rarity') {
      rarity = RARITIES.find((r) => r === kv[1]) ?? 'Unknown';
      continue;
    }
    rest.push(line.trim());
  }

  const named = rarity === 'Rare' || rarity === 'Unique';
  const name = rest[0] ?? '';
  const baseType = named ? (rest[1] ?? '') : rarity === 'Magic' ? '' : name;

  return { itemClass, rarity, name, baseType };
}
