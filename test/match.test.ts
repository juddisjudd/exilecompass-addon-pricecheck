// Run with: bun test/match.test.ts
// Uses the real /data/stats payload if it has been downloaded next to this
// file; otherwise fetches it once and caches it.
import { parseClipboard } from '../src/parser';
import { StatIndex, matchItem, type StatsPayload } from '../src/stats/match';

const CACHE = new URL('./.stats-cache.json', import.meta.url).pathname.replace(/^\//, '');

async function loadStats(): Promise<StatsPayload> {
  const file = Bun.file(CACHE);
  if (await file.exists()) return JSON.parse(await file.text()) as StatsPayload;
  const res = await fetch('https://www.pathofexile.com/api/trade2/data/stats', {
    headers: { 'User-Agent': 'ExileCompass/dev (https://github.com/juddisjudd/exilecompass)' },
  });
  const body = await res.text();
  await Bun.write(CACHE, body);
  return JSON.parse(body) as StatsPayload;
}

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

const index = new StatIndex(await loadStats());

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
  const { matched, unmatched } = matchItem(item, index);
  console.log(matched.map((m) => `  ${m.entry.id}  ${m.entry.text}`).join('\n'));
  if (unmatched.length) console.log('  unmatched:', unmatched);

  check('every line matched', unmatched.length, 0);
  check('six lines matched', matched.length, 6);
  check('implicit resolves to the implicit group', matched[0].entry.id.startsWith('implicit.'), true);
  check('explicit mods resolve to explicit', matched[1].entry.id.startsWith('explicit.'), true);
  check('a ring takes the global evasion stat', /\(Local\)/.test(matched[1].entry.text), false);
}

// The same evasion text on a body armour must resolve to the local stat.
{
  const item = parseClipboard(`Item Class: Body Armours
Rarity: Rare
Dread Shell
Smuggler Coat
--------
Evasion Rating: 320 (augmented)
--------
Item Level: 80
--------
{ Prefix Modifier "Vaporous" (Tier: 3) — Defences }
+143(124-151) to Evasion Rating
`)!;
  const { matched } = matchItem(item, index);
  check('body armour takes the local evasion stat', /\(Local\)/.test(matched[0].entry.text), true);
}

// Without advanced descriptions the group has to be guessed.
{
  const item = parseClipboard(`Item Class: Rings
Rarity: Rare
Rune Loop
Prismatic Ring
--------
Item Level: 79
--------
+15% to Cold Resistance
+12 to Strength
`)!;
  const { matched, unmatched } = matchItem(item, index);
  check('plain copy still matches', matched.length, 2);
  check('plain copy has nothing unmatched', unmatched.length, 0);
  check('plain copy guesses explicit', matched[0].entry.id.startsWith('explicit.'), true);
}

console.log(failures === 0 ? '\nall passed' : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
