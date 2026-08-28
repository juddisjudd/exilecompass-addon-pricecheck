// Run with: bun test/parser.test.ts
import { parseClipboard } from '../src/parser';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

// PLAN.md §2.6, from Exiled-Exchange-2's `RareWithImplicit` fixture.
const RARE_RING = `Item Class: Rings
Rarity: Rare
Rune Loop
Prismatic Ring
--------
Requires: Level 45
--------
Item Level: 79
--------
{ Implicit Modifier — Elemental, Fire, Cold, Lightning, Resistance }
+8(7-10)% to all Elemental Resistances
--------
{ Prefix Modifier "Vaporous" (Tier: 3) — Defences }
+143(124-151) to Evasion Rating
{ Suffix Modifier "of the Wrestler" (Tier: 7) — Attribute }
+12(9-12) to Strength
{ Suffix Modifier "of Warmth" (Tier: 3) — Mana }
8(8-12)% increased Mana Regeneration Rate
5% increased Light Radius
{ Suffix Modifier "of the Penguin" (Tier: 7) — Elemental, Cold, Resistance }
+15(11-15)% to Cold Resistance
`;

{
  const item = parseClipboard(RARE_RING)!;
  check('parses', !!item, true);
  check('item class', item.itemClass, 'Rings');
  check('rarity', item.rarity, 'Rare');
  check('name', item.name, 'Rune Loop');
  check('base type', item.baseType, 'Prismatic Ring');
  check('item level', item.itemLevel, 79);
  check('requires level', item.requiresLevel, 45);
  check('advanced descriptions detected', item.hasAdvancedDescriptions, true);
  check('mod count', item.mods.length, 5);

  const implicit = item.mods[0];
  check('implicit kind', implicit.kind, 'implicit');
  check('implicit tags', implicit.tags.join('|'), 'Elemental|Fire|Cold|Lightning|Resistance');
  check('implicit normalized', implicit.lines[0].normalized, '#% to all Elemental Resistances');
  check('implicit value', implicit.lines[0].values[0].value, 8);
  check('implicit range min', implicit.lines[0].values[0].range?.[0], 7);
  check('implicit range max', implicit.lines[0].values[0].range?.[1], 10);

  const prefix = item.mods[1];
  check('prefix affix', prefix.affix, 'prefix');
  check('prefix name', prefix.name, 'Vaporous');
  check('prefix tier', prefix.tier, 3);
  check('prefix kind is explicit', prefix.kind, 'explicit');
  check('prefix normalized', prefix.lines[0].normalized, '# to Evasion Rating');
  check('prefix value', prefix.lines[0].values[0].value, 143);

  const mana = item.mods[3];
  check('two-line mod keeps both lines', mana.lines.length, 2);
  check('second line normalized', mana.lines[1].normalized, '#% increased Light Radius');
}

// Same item copied WITHOUT the advanced-descriptions key held.
const PLAIN_RING = `Item Class: Rings
Rarity: Rare
Rune Loop
Prismatic Ring
--------
Requires: Level 45
--------
Item Level: 79
--------
+8% to all Elemental Resistances
--------
+143 to Evasion Rating
+12 to Strength
8% increased Mana Regeneration Rate
+15% to Cold Resistance
--------
Corrupted
`;

{
  const item = parseClipboard(PLAIN_RING)!;
  check('plain copy parses', item.rarity, 'Rare');
  check('plain copy has no advanced descriptions', item.hasAdvancedDescriptions, false);
  check('plain copy mod count', item.mods.length, 5);
  check('plain copy mod kind is unknown', item.mods[0].kind, 'unknown');
  check('corrupted flag', item.corrupted, true);
}

// A weapon, for the DPS/attack-speed properties.
const WEAPON = `Item Class: Crossbows
Rarity: Rare
Havoc Core
Bombard Crossbow
--------
Physical Damage: 43-79 (augmented)
Fire Damage: 12-24 (augmented)
Critical Hit Chance: 5.00%
Attacks per Second: 1.60
Reload Time: 0.75
--------
Requires: Level 62, 108 Str, 108 Dex
--------
Sockets: S S
--------
Item Level: 78
--------
{ Prefix Modifier "Flaring" (Tier: 4) — Damage, Physical }
36(30-39)% increased Physical Damage
--------
Corrupted
`;

{
  const item = parseClipboard(WEAPON)!;
  check('weapon phys min', item.physicalDamage?.min, 43);
  check('weapon phys max', item.physicalDamage?.max, 79);
  check('weapon fire min', item.fireDamage?.min, 12);
  check('weapon crit', item.criticalChance, 5);
  check('weapon aps', item.attacksPerSecond, 1.6);
  check('weapon reload', item.reloadTime, 0.75);
  check('weapon sockets', item.sockets, 2);
  check('weapon requires level', item.requiresLevel, 62);
  check('weapon item level', item.itemLevel, 78);
}

// Currency: nameplate only, plus a stack size.
const CURRENCY = `Item Class: Stackable Currency
Rarity: Currency
Exalted Orb
--------
Stack Size: 12/20
--------
Enchants an item with a new modifier.
`;

{
  const item = parseClipboard(CURRENCY)!;
  check('currency rarity', item.rarity, 'Currency');
  check('currency name is its base', item.baseType, 'Exalted Orb');
  check('currency stack size', item.stackSize, 12);
}

// Negative rolls, where the range separator and the sign share a character.
{
  const item = parseClipboard(`Item Class: Amulets
Rarity: Rare
Doom Clasp
Gold Amulet
--------
Item Level: 80
--------
{ Suffix Modifier "of the Worthy" (Tier: 1) — Resistance }
-25(-30--20)% to Fire Resistance
`)!;
  const value = item.mods[0].lines[0].values[0];
  check('negative roll value', value.value, -25);
  check('negative range min', value.range?.[0], -30);
  check('negative range max', value.range?.[1], -20);
  check('negative normalized', item.mods[0].lines[0].normalized, '#% to Fire Resistance');
}

// Not an item at all.
check('rejects non-item text', parseClipboard('hello world'), null);

console.log(failures === 0 ? '\nall passed' : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
