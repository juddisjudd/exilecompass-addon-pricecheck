import type { DamageRange, ParsedItem } from './types';
import { keyValue } from './sections';

/** `43-79 (augmented)` -> {min:43, max:79}; `320` -> {min:320,max:320}. */
function damage(value: string): DamageRange | null {
  const cleaned = value.replace(/\(.*?\)/g, '').trim();
  const match = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/.exec(cleaned);
  if (match) return { min: Number(match[1]), max: Number(match[2]) };
  const single = Number(cleaned);
  return Number.isFinite(single) ? { min: single, max: single } : null;
}

function num(value: string): number | undefined {
  const parsed = Number(value.replace(/\(.*?\)/g, '').replace(/[+%,]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Property lines, wherever they appear. Item text puts them in a few sections
 * whose order varies by item class, so the keys are matched rather than the
 * positions. Unknown keys are left alone for the caller to report.
 */
export function applyProperty(item: ParsedItem, line: string): boolean {
  const kv = keyValue(line);
  if (!kv) return false;
  const [key, value] = kv;

  switch (key) {
    case 'Item Level':
      item.itemLevel = num(value);
      return true;
    case 'Quality':
      item.quality = num(value);
      return true;
    case 'Stack Size':
      item.stackSize = num(value.split('/')[0]);
      return true;
    case 'Armour':
      item.armour = num(value);
      return true;
    case 'Evasion Rating':
      item.evasion = num(value);
      return true;
    case 'Energy Shield':
      item.energyShield = num(value);
      return true;
    case 'Spirit':
      item.spirit = num(value);
      return true;
    case 'Block chance':
    case 'Block Chance':
      item.block = num(value);
      return true;
    case 'Physical Damage':
      item.physicalDamage = damage(value) ?? undefined;
      return true;
    case 'Fire Damage':
      item.fireDamage = damage(value) ?? undefined;
      return true;
    case 'Cold Damage':
      item.coldDamage = damage(value) ?? undefined;
      return true;
    case 'Lightning Damage':
      item.lightningDamage = damage(value) ?? undefined;
      return true;
    case 'Chaos Damage':
      item.chaosDamage = damage(value) ?? undefined;
      return true;
    case 'Critical Hit Chance':
    case 'Critical Strike Chance':
      item.criticalChance = num(value);
      return true;
    case 'Attacks per Second':
      item.attacksPerSecond = num(value);
      return true;
    case 'Reload Time':
      item.reloadTime = num(value);
      return true;
    case 'Sockets':
      // `S S` is two empty rune sockets; a socketed rune prints its own line.
      item.sockets = (value.match(/S/g) ?? []).length;
      return true;
    case 'Requires':
    case 'Requirements': {
      const level = /Level\s+(\d+)/.exec(value)?.[1];
      if (level) item.requiresLevel = Number(level);
      return true;
    }
    case 'Level':
      item.requiresLevel = num(value);
      return true;
    default:
      return false;
  }
}

const FLAGS: Record<string, keyof ParsedItem> = {
  Corrupted: 'corrupted',
  Unidentified: 'unidentified',
  Mirrored: 'mirrored',
};

export function applyFlag(item: ParsedItem, line: string): boolean {
  const flag = FLAGS[line.trim()];
  if (!flag) return false;
  (item as unknown as Record<string, boolean>)[flag] = true;
  return true;
}
