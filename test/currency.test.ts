// Run with: bun test/currency.test.ts
import { CurrencyIndex, POE_CDN, Rates } from '../src/trade/currency';
import { formatAmount } from '../src/ui/format';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`,
  );
}

// ── number formatting ───────────────────────────────────────────────────────
check('zero', formatAmount(0), '0');
check('whole small number', formatAmount(5), '5');
check('drops trailing zeros', formatAmount(2.5), '2.5');
check('two decimals at most', formatAmount(2.456), '2.46');
check('sub-unit price keeps precision', formatAmount(0.09357), '0.09');
check('tiny price does not round to zero', formatAmount(0.002695), '0.003');
check('hundreds are whole', formatAmount(371.4), '371');
check('rounds at the thousand boundary', formatAmount(999.6), '1000');
check('thousands compact', formatAmount(1000), '1k');
check('and keep one decimal', formatAmount(1500), '1.5k');
check('but not a pointless one', formatAmount(2000), '2k');
check('ten thousand drops the decimal', formatAmount(15_400), '15k');
check('millions', formatAmount(1_200_000), '1.2m');
check('billions', formatAmount(3_000_000_000), '3b');
check('negatives keep their sign', formatAmount(-1500), '-1.5k');
check('nonsense is not rendered as a number', formatAmount(NaN), '—');

// ── currency metadata ───────────────────────────────────────────────────────
const index = new CurrencyIndex({
  result: [
    {
      id: 'Currency',
      entries: [
        { id: 'exalted', text: 'Exalted Orb', image: '/gen/image/exalted.png' },
        { id: 'divine', text: 'Divine Orb', image: '/gen/image/divine.png' },
        { id: 'nameless', text: 'Nameless Thing' },
      ],
    },
    // A later group must not shadow an id an earlier one already defined.
    { id: 'Runes', entries: [{ id: 'exalted', text: 'Not This One' }] },
  ],
});

check('resolves a currency name', index.get('exalted').name, 'Exalted Orb');
check('absolute icon url', index.get('divine').icon, `${POE_CDN}/gen/image/divine.png`);
check('first definition wins', index.get('exalted').icon, `${POE_CDN}/gen/image/exalted.png`);
check('missing image is undefined, not a broken url', index.get('nameless').icon, undefined);
check('unknown id falls back to itself', index.get('mystery').name, 'mystery');

// ── conversion ──────────────────────────────────────────────────────────────
// Real poe.ninja values (Aug 2026): primaryValue is the worth in divines.
const rates = new Rates(
  {
    core: { primary: 'divine', secondary: 'chaos', rates: { exalted: 371, chaos: 10.69 } },
    lines: [
      { id: 'exalted', primaryValue: 0.002695 },
      { id: 'chaos', primaryValue: 0.09357 },
      { id: 'annul', primaryValue: 0.3841 },
      { id: 'broken', primaryValue: 0 },
    ],
  },
  'divine',
);

check('rates loaded', rates.known, true);
check('base converts to itself', rates.convert(3, 'divine', 'divine'), 3);
check('same currency is a no-op', rates.convert(7, 'exalted', 'exalted'), 7);
check('exalted to divine', Math.round(rates.convert(371, 'exalted', 'divine')! * 100) / 100, 1);
check('divine to exalted', Math.round(rates.convert(1, 'divine', 'exalted')!), 371);
check(
  'exalted to chaos',
  Math.round(rates.convert(100, 'exalted', 'chaos')! * 100) / 100,
  Math.round(((100 * 0.002695) / 0.09357) * 100) / 100,
);
check('unknown source is null, never a guess', rates.convert(5, 'mystery', 'divine'), null);
check('unknown target is null', rates.convert(5, 'divine', 'mystery'), null);
check('a zero rate is not usable', rates.convert(5, 'broken', 'divine'), null);

const targets = rates.targets();
check('offers the base first', targets[0], 'divine');
check('offers exalted', targets.includes('exalted'), true);
check('offers chaos', targets.includes('chaos'), true);
// The shortlist is the currencies people actually price in, not everything
// with a published rate.
check('does not offer every currency it knows', targets.includes('annul'), false);
check('no duplicate targets', targets.length, new Set(targets).size);

const empty = new Rates({ lines: [] }, 'divine');
check('an empty overview is not usable', empty.known, false);

console.log(failures === 0 ? '\nall passed' : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
