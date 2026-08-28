import type { ParsedItem, ParsedMod, ModKind } from '../parser/types';
import { normalizeStatText } from '../parser/values';

export interface StatEntry {
  id: string;
  text: string;
  type: string;
}

export interface StatGroup {
  id: string;
  label: string;
  entries: StatEntry[];
}

export interface StatsPayload {
  result: StatGroup[];
}

/** `# to Evasion Rating (Local)` -> `# to Evasion Rating`, plus a local flag. */
function splitQualifier(text: string): { key: string; local: boolean } {
  const match = /^(.*?)\s*\((Local|Global)\)$/.exec(text);
  if (!match) return { key: normalizeStatText(text), local: false };
  return { key: normalizeStatText(match[1]), local: match[2] === 'Local' };
}

/**
 * Item mod line -> trade stat id. The trade API serves its own stat list
 * (PLAN.md §2.5), so there is no bundled mod database to keep in step with
 * patches; the whole matching problem is reducing both sides to the same
 * `#`-substituted text and looking it up in the right group.
 */
export class StatIndex {
  /** group id -> normalized text -> entries, in the order the API listed them. */
  private byGroup = new Map<string, Map<string, StatEntry[]>>();

  constructor(payload: StatsPayload) {
    for (const group of payload.result ?? []) {
      const map = new Map<string, StatEntry[]>();
      for (const entry of group.entries ?? []) {
        const { key } = splitQualifier(entry.text);
        const list = map.get(key);
        if (list) list.push(entry);
        else map.set(key, [entry]);
      }
      this.byGroup.set(group.id, map);
    }
  }

  get groups(): string[] {
    return [...this.byGroup.keys()];
  }

  candidates(group: string, normalized: string): StatEntry[] {
    return this.byGroup.get(group)?.get(normalized) ?? [];
  }
}

/**
 * Groups to try for a mod, best first. An advanced-description header names
 * the group outright; without one the group is a guess, and explicit mods are
 * the overwhelming majority of what anyone prices (PLAN.md §8.5).
 */
export function groupsFor(kind: ModKind): string[] {
  if (kind !== 'unknown') return [kind, 'explicit', 'implicit'];
  return ['explicit', 'implicit', 'rune', 'enchant', 'desecrated', 'fractured', 'crafted', 'sanctum', 'skill'];
}

/**
 * `(Local)` variants exist for mods that modify the item's own defences or
 * damage — the same text means different stats on a body armour and on a
 * ring. The item itself settles it: a local mod's property is printed on the
 * item, a global one's is not.
 */
function prefersLocal(item: ParsedItem, text: string): boolean {
  if (/Evasion Rating/i.test(text)) return item.evasion !== undefined;
  if (/Armour/i.test(text)) return item.armour !== undefined;
  if (/Energy Shield/i.test(text)) return item.energyShield !== undefined;
  if (/Physical Damage/i.test(text)) return item.physicalDamage !== undefined;
  if (/Attack Speed/i.test(text)) return item.attacksPerSecond !== undefined;
  if (/Critical (Hit|Strike) Chance/i.test(text)) return item.criticalChance !== undefined;
  return false;
}

export interface MatchedLine {
  mod: ParsedMod;
  lineIndex: number;
  entry: StatEntry;
  /** Other entries with the same text, for a future manual override. */
  alternatives: StatEntry[];
}

export interface MatchResult {
  matched: MatchedLine[];
  /** Lines with no entry in any candidate group — reported, never dropped. */
  unmatched: string[];
}

export function matchItem(item: ParsedItem, index: StatIndex): MatchResult {
  const matched: MatchedLine[] = [];
  const unmatched: string[] = [];

  for (const mod of item.mods) {
    mod.lines.forEach((line, lineIndex) => {
      const entries = groupsFor(mod.kind)
        .map((group) => index.candidates(group, line.normalized))
        .find((list) => list.length > 0);

      if (!entries) {
        unmatched.push(line.text);
        return;
      }

      const wantLocal = prefersLocal(item, line.normalized);
      const entry =
        entries.find((e) => /\(Local\)$/.test(e.text) === wantLocal) ?? entries[0];
      matched.push({
        mod,
        lineIndex,
        entry,
        alternatives: entries.filter((e) => e !== entry),
      });
    });
  }

  return { matched, unmatched };
}
