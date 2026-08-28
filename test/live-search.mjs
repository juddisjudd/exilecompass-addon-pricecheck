// Manual, network-touching check of the query shape against the live trade
// API. Not part of `bun run test` — it spends the user's IP rate-limit budget.
//   bun test/live-search.mjs
import { parseClipboard } from '../src/parser/index.ts';
import { StatIndex, matchItem } from '../src/stats/match.ts';
import { buildStatFilters, buildEquipmentFilters } from '../src/stats/filters.ts';
import { buildQuery } from '../src/trade/query.ts';

const UA = 'ExileCompass/dev (https://github.com/juddisjudd/exilecompass)';
const BASE = 'https://www.pathofexile.com/api/trade2';

const leagues = await (await fetch(`${BASE}/data/leagues`, { headers: { 'User-Agent': UA } })).json();
const league = leagues.result[0].id;
console.log('league:', league);

const statsFile = Bun.file(new URL('./.stats-cache.json', import.meta.url));
const stats = JSON.parse(await statsFile.text());
const index = new StatIndex(stats);

const item = parseClipboard(`Item Class: Rings
Rarity: Rare
Rune Loop
Prismatic Ring
--------
Item Level: 79
--------
{ Suffix Modifier "of the Penguin" (Tier: 7) — Elemental, Cold, Resistance }
+15(11-15)% to Cold Resistance
{ Suffix Modifier "of the Wrestler" (Tier: 7) — Attribute }
+12(9-12) to Strength
`);

const match = matchItem(item, index);
const rows = [...buildStatFilters(match), ...buildEquipmentFilters(item)];
for (const row of rows) row.enabled = true;
const request = buildQuery(item, rows);
console.log('request:', JSON.stringify(request));

const res = await fetch(`${BASE}/search/${encodeURIComponent(league)}`, {
  method: 'POST',
  headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify(request),
});
const text = await res.text();
console.log('search status:', res.status);
for (const [k, v] of res.headers) if (k.startsWith('x-rate-limit') || k === 'retry-after') console.log(' ', k, '=', v);
const body = JSON.parse(text);
if (res.status !== 200) {
  console.log('body:', text.slice(0, 400));
  process.exit(1);
}
console.log('query id:', body.id, 'complexity:', body.complexity, 'total:', body.total);

const ids = (body.result ?? []).slice(0, 5);
if (!ids.length) {
  console.log('no listings matched — query is valid but nothing is for sale');
  process.exit(0);
}
const fetched = await fetch(`${BASE}/fetch/${ids.join(',')}?query=${body.id}`, {
  headers: { 'User-Agent': UA, Accept: 'application/json' },
});
console.log('fetch status:', fetched.status);
const page = await fetched.json();
for (const entry of page.result ?? []) {
  if (!entry) continue;
  const p = entry.listing.price;
  console.log(
    ` ${p ? `${p.amount} ${p.currency}` : 'no price'}  ${entry.item.typeLine ?? entry.item.baseType}  by ${entry.listing.account.name}`,
  );
  console.log(`    icon: ${(entry.item.icon ?? '').slice(0, 60)}…`);
  console.log(`    whisper: ${entry.listing.whisper.slice(0, 70)}…`);
}
