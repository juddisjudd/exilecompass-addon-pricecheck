import type { ParsedItem } from '../parser/types';
import type { MatchResult } from './match';

/** A row in the filter list: one checkbox plus a min/max pair. */
export interface FilterRow {
  key: string;
  label: string;
  /** The rolled value, for the "as rolled" hint. */
  rolled: number | null;
  min: number | null;
  max: number | null;
  enabled: boolean;
  tier?: number;
  affix?: 'prefix' | 'suffix';
}

export interface StatFilterRow extends FilterRow {
  kind: 'stat';
  statId: string;
}

export interface EquipmentFilterRow extends FilterRow {
  kind: 'equipment';
  /** Field name under `query.filters.equipment_filters.filters`. */
  field: string;
}

export type AnyFilterRow = StatFilterRow | EquipmentFilterRow;

/**
 * A search on the exact roll finds nothing but the item itself, so every row
 * opens slightly below what the item has. 10% is what both reference tools
 * settled on; the user can tighten it before searching.
 */
function defaultMin(value: number): number {
  if (!Number.isFinite(value)) return value;
  if (value < 0) return Math.floor(value);
  const widened = value * 0.9;
  // Whole numbers stay whole — a socket count of 1.8 helps nobody.
  return Number.isInteger(value) ? Math.floor(widened) : Math.floor(widened * 10) / 10;
}

/** `Adds # to # Fire Damage` is filtered on the average of its two rolls. */
function filterValue(values: number[]): number | null {
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

export function buildStatFilters(match: MatchResult): StatFilterRow[] {
  return match.matched.map((m, i) => {
    const line = m.mod.lines[m.lineIndex];
    const rolled = filterValue(line.values.map((v) => v.value));
    return {
      kind: 'stat',
      key: `stat-${i}-${m.entry.id}`,
      statId: m.entry.id,
      label: line.text,
      rolled,
      min: rolled === null ? null : defaultMin(rolled),
      max: null,
      enabled: false,
      tier: m.mod.tier,
      affix: m.mod.affix,
    };
  });
}

function average(range: { min: number; max: number } | undefined): number {
  return range ? (range.min + range.max) / 2 : 0;
}

/**
 * Weapon and defence numbers the trade site filters on directly. DPS is not
 * printed on the item — it is the damage rolls times attack speed, the same
 * arithmetic the trade site does server-side.
 */
export function buildEquipmentFilters(item: ParsedItem): EquipmentFilterRow[] {
  const rows: EquipmentFilterRow[] = [];
  const add = (field: string, label: string, value: number | undefined) => {
    if (value === undefined || !Number.isFinite(value) || value <= 0) return;
    const rounded = Math.round(value * 100) / 100;
    rows.push({
      kind: 'equipment',
      key: `eq-${field}`,
      field,
      label,
      rolled: rounded,
      min: defaultMin(rounded),
      max: null,
      enabled: false,
    });
  };

  const aps = item.attacksPerSecond;
  if (aps) {
    const pdps = average(item.physicalDamage) * aps;
    const edps =
      (average(item.fireDamage) + average(item.coldDamage) + average(item.lightningDamage)) * aps;
    const chaos = average(item.chaosDamage) * aps;
    add('pdps', 'Physical DPS', pdps);
    add('edps', 'Elemental DPS', edps);
    add('dps', 'Total DPS', pdps + edps + chaos);
    add('aps', 'Attacks per Second', aps);
  }
  add('crit', 'Critical Chance', item.criticalChance);
  add('reload_time', 'Reload Time', item.reloadTime);
  add('ar', 'Armour', item.armour);
  add('ev', 'Evasion', item.evasion);
  add('es', 'Energy Shield', item.energyShield);
  add('block', 'Block', item.block);
  add('spirit', 'Spirit', item.spirit);
  add('rune_sockets', 'Rune Sockets', item.sockets || undefined);
  return rows;
}
