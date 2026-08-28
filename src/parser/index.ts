import { isModHeader, parseModSection } from './advanced-mods';
import { parseNameplate } from './nameplate';
import { applyFlag, applyProperty } from './properties';
import { keyValue, splitSections } from './sections';
import type { ParsedItem } from './types';

export * from './types';
export { splitSections } from './sections';

/** Section-level noise that is neither a property nor a mod. */
const IGNORED_PREFIXES = ['Note: ', 'Requirements:', 'Item sells for', 'Price: '];

function emptyItem(): ParsedItem {
  return {
    itemClass: '',
    rarity: 'Unknown',
    name: '',
    baseType: '',
    corrupted: false,
    unidentified: false,
    mirrored: false,
    sockets: 0,
    mods: [],
    unparsed: [],
    hasAdvancedDescriptions: false,
  };
}

export function looksLikeItemText(text: string): boolean {
  return /^\s*Item Class:\s/.test(text);
}

/**
 * Flavour text on uniques sits in its own trailing section and is prose, not
 * stats — no numbers, no leading sign. Left out rather than reported as an
 * unrecognised mod.
 */
function looksLikeFlavour(lines: string[]): boolean {
  return lines.every((line) => !/\d/.test(line) && !/^[+-]/.test(line));
}

export function parseClipboard(text: string): ParsedItem | null {
  if (!looksLikeItemText(text)) return null;

  const sections = splitSections(text);
  if (!sections.length) return null;

  const item = emptyItem();
  Object.assign(item, parseNameplate(sections[0]));
  item.hasAdvancedDescriptions = sections.some((section) => section.some(isModHeader));

  sections.slice(1).forEach((section, index) => {
    const isLast = index === sections.length - 2;

    if (section.some(isModHeader)) {
      item.mods.push(...parseModSection(section, 'unknown'));
      return;
    }

    const leftovers: string[] = [];
    for (const line of section) {
      if (applyProperty(item, line) || applyFlag(item, line)) continue;
      if (IGNORED_PREFIXES.some((prefix) => line.startsWith(prefix))) continue;
      leftovers.push(line);
    }
    if (!leftovers.length) return;

    // A section of keyed lines we didn't recognise is a property block, not
    // mods; anything else is mod text of a group we can't name.
    if (leftovers.every((line) => keyValue(line) !== null)) {
      item.unparsed.push(...leftovers);
      return;
    }
    if (item.rarity === 'Unique' && isLast && looksLikeFlavour(leftovers)) return;

    item.mods.push(...parseModSection(leftovers, 'unknown'));
  });

  return item;
}
