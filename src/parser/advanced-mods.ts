import type { ModKind, ParsedMod, ParsedModLine } from './types';
import { parseModLine } from './values';

/**
 * Advanced Item Descriptions block headers (PLAN.md §2.6):
 *
 *   { Prefix Modifier "Vaporous" (Tier: 3) — Defences }
 *   { Suffix Modifier "of Warmth" (Tier: 3) — Mana }
 *   { Implicit Modifier — Elemental, Fire, Cold, Lightning, Resistance }
 *   { Rune Modifier }
 *
 * They give the affix slot, tier, tags, and — the part that matters most for
 * matching — which stat group the lines below belong to.
 */
const HEADER = /^\{\s*(.+?)\s*\}$/;

const KIND_BY_WORD: Record<string, ModKind> = {
  prefix: 'explicit',
  suffix: 'explicit',
  explicit: 'explicit',
  implicit: 'implicit',
  enchant: 'enchant',
  rune: 'rune',
  desecrated: 'desecrated',
  fractured: 'fractured',
  crafted: 'crafted',
  sanctum: 'sanctum',
  skill: 'skill',
};

export function isModHeader(line: string): boolean {
  return HEADER.test(line.trim());
}

interface Header {
  kind: ModKind;
  affix?: 'prefix' | 'suffix';
  name?: string;
  tier?: number;
  tags: string[];
}

export function parseHeader(line: string): Header | null {
  const match = HEADER.exec(line.trim());
  if (!match) return null;
  let inner = match[1];

  // Tags follow an em dash; the game uses `—`, not `-`.
  let tags: string[] = [];
  const dash = inner.indexOf('—');
  if (dash >= 0) {
    tags = inner
      .slice(dash + 1)
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    inner = inner.slice(0, dash).trim();
  }

  const name = /"([^"]+)"/.exec(inner)?.[1];
  // `(Tier: 3)`, and `(Rank: 2)` on runes.
  const tier = Number(/\((?:Tier|Rank):\s*(\d+)\)/.exec(inner)?.[1]);

  const first = inner.split(/\s+/)[0]?.toLowerCase() ?? '';
  const kind = KIND_BY_WORD[first] ?? 'unknown';
  const affix = first === 'prefix' ? 'prefix' : first === 'suffix' ? 'suffix' : undefined;

  return {
    kind,
    affix,
    name,
    tier: Number.isFinite(tier) ? tier : undefined,
    tags,
  };
}

export function toModLine(text: string): ParsedModLine {
  const { normalized, values } = parseModLine(text);
  return { text, normalized, values };
}

/**
 * Turn one section into mods. With advanced descriptions each `{ ... }` header
 * opens a block; without them every line is its own mod of unknown group.
 */
export function parseModSection(lines: string[], fallbackKind: ModKind): ParsedMod[] {
  const mods: ParsedMod[] = [];
  let current: ParsedMod | null = null;

  for (const line of lines) {
    const header = parseHeader(line);
    if (header) {
      current = { ...header, lines: [] };
      mods.push(current);
      continue;
    }
    if (current) {
      current.lines.push(toModLine(line));
    } else {
      mods.push({ kind: fallbackKind, tags: [], lines: [toModLine(line)] });
    }
  }

  return mods.filter((mod) => mod.lines.length > 0);
}
