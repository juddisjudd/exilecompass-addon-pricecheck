import type { ModValue } from './values';

export type ItemRarity = 'Normal' | 'Magic' | 'Rare' | 'Unique' | 'Currency' | 'Gem' | 'Quest' | 'Unknown';

/**
 * Which trade stat group a mod's lines should be looked up in. The
 * advanced-description header names it outright; without one we have to guess
 * (PLAN.md §8.5).
 */
export type ModKind =
  | 'explicit'
  | 'implicit'
  | 'enchant'
  | 'rune'
  | 'desecrated'
  | 'fractured'
  | 'crafted'
  | 'sanctum'
  | 'skill'
  | 'unknown';

export interface ParsedModLine {
  /** As printed, ranges and all. */
  text: string;
  /** `#`-substituted, ready to look up. */
  normalized: string;
  values: ModValue[];
}

export interface ParsedMod {
  kind: ModKind;
  affix?: 'prefix' | 'suffix';
  /** The affix name from an advanced description, e.g. `Vaporous`. */
  name?: string;
  tier?: number;
  tags: string[];
  lines: ParsedModLine[];
}

export interface DamageRange {
  min: number;
  max: number;
}

export interface ParsedItem {
  itemClass: string;
  rarity: ItemRarity;
  /** Rare/unique name, or the base type for everything else. */
  name: string;
  baseType: string;
  itemLevel?: number;
  quality?: number;
  stackSize?: number;
  corrupted: boolean;
  unidentified: boolean;
  mirrored: boolean;
  /** Rune sockets, counted from the `Sockets:` line. */
  sockets: number;
  armour?: number;
  evasion?: number;
  energyShield?: number;
  spirit?: number;
  block?: number;
  physicalDamage?: DamageRange;
  fireDamage?: DamageRange;
  coldDamage?: DamageRange;
  lightningDamage?: DamageRange;
  chaosDamage?: DamageRange;
  attacksPerSecond?: number;
  criticalChance?: number;
  reloadTime?: number;
  requiresLevel?: number;
  mods: ParsedMod[];
  /** Lines we could not place, kept for the "unrecognised" notice. */
  unparsed: string[];
  /** True when the copy carried `{ ... Modifier ... }` headers (§2.6). */
  hasAdvancedDescriptions: boolean;
}
