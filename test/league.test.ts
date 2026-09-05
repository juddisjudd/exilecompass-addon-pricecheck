// Run with: bun test/league.test.ts
// League classification, over the two shapes /data/leagues takes: one live
// challenge league for most of a league's life, and two for the weeks after a
// new one starts while the previous is still tradeable.

import { classify, familyFor, leagueFor } from '../src/trade/league';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` — got ${actual}, want ${expected}`}`);
}

const league = (id: string) => ({ id, realm: 'poe2', text: id });

// Mid-league: one challenge league, plus the two parking leagues.
{
  const families = classify([
    league('Runes of Aldur'),
    league('HC Runes of Aldur'),
    league('Standard'),
    league('Hardcore'),
  ]);
  check('one family mid-league', families.length, 1);
  check('softcore is the challenge league', families[0].sc.id, 'Runes of Aldur');
  check('hardcore is its twin', families[0].hc?.id, 'HC Runes of Aldur');
  check('Standard is never offered', families.some((f) => f.sc.id === 'Standard'), false);
  check('Hardcore is never offered', families.some((f) => f.sc.id === 'Hardcore'), false);
}

// Launch day: the new league first, the previous one still live behind it.
// This is the response that shipped on 2026-09-05.
{
  const families = classify([
    league('Forbidden Rites'),
    league('HC Forbidden Rites'),
    league('Runes of Aldur'),
    league('HC Runes of Aldur'),
    league('Standard'),
    league('Hardcore'),
  ]);
  check('both families are offered', families.length, 2);
  check('newest first', families[0].sc.id, 'Forbidden Rites');
  check('previous league kept', families[1].sc.id, 'Runes of Aldur');
  check('each keeps its own twin', families[1].hc?.id, 'HC Runes of Aldur');

  // No stored choice means the newest league, so a rollover needs no migration.
  check('no stored id picks the newest', familyFor(families, null).sc.id, 'Forbidden Rites');
  check('a stored id is honoured', familyFor(families, 'Runes of Aldur').sc.id, 'Runes of Aldur');
  // The league someone last searched has since ended and left the list.
  check('an ended league falls back', familyFor(families, 'Fate of the Vaal').sc.id, 'Forbidden Rites');

  const previous = familyFor(families, 'Runes of Aldur');
  check('mode applies within the family', leagueFor(previous, 'hc').id, 'HC Runes of Aldur');
  check('and softcore stays softcore', leagueFor(previous, 'sc').id, 'Runes of Aldur');
}

// A league with no hardcore twin still resolves, rather than searching another
// league's market.
{
  const families = classify([league('Forbidden Rites'), league('Standard')]);
  check('a lone softcore league is a family', families[0].hc, null);
  check('hardcore mode falls back to it', leagueFor(families[0], 'hc').id, 'Forbidden Rites');
}

// Nothing tradeable at all is an error, not an empty picker.
{
  let threw = false;
  try {
    classify([league('Standard'), league('Hardcore')]);
  } catch {
    threw = true;
  }
  check('no challenge league throws', threw, true);
}

console.log(failures === 0 ? '\nall passed' : `\n${failures} failed`);
if (failures > 0) process.exit(1);
