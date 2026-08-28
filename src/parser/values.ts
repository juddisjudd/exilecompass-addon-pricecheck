/**
 * Numbers inside item text, and the `(min-max)` roll ranges the game adds when
 * Advanced Item Descriptions is held during the copy (PLAN.md §2.6).
 *
 *   `+143(124-151) to Evasion Rating`  -> value 143, range [124, 151]
 *   `8(8-12)% increased Mana Regen`    -> value 8,   range [8, 12]
 *   `-25(-30--20)% to Fire Resistance` -> value -25, range [-30, -20]
 */

export interface ModValue {
  value: number;
  range: [number, number] | null;
}

const RANGE = /\(([^()]*)\)/g;
const NUMBER = /[+-]?\d+(?:\.\d+)?/g;

/** Split `-30--20` on the hyphen that separates the two numbers, not the signs. */
function splitRange(inner: string): [number, number] | null {
  const parts = inner.split(/(?<=\d)-/);
  if (parts.length !== 2) return null;
  const min = Number(parts[0]);
  const max = Number(parts[1]);
  return Number.isFinite(min) && Number.isFinite(max) ? [min, max] : null;
}

/**
 * Pull the rolled values and their ranges out of a mod line, and produce the
 * `#`-substituted text the trade API's stat list is keyed by.
 */
export function parseModLine(text: string): { normalized: string; values: ModValue[] } {
  const ranges: Array<[number, number] | null> = [];
  // Ranges are removed first so their numbers can't be mistaken for rolls.
  const withoutRanges = text.replace(RANGE, (_match, inner: string) => {
    ranges.push(splitRange(inner));
    return '';
  });

  const numbers = withoutRanges.match(NUMBER) ?? [];
  const values: ModValue[] = numbers.map((n, i) => ({
    value: Number(n),
    range: ranges[i] ?? null,
  }));

  const normalized = normalizeStatText(withoutRanges);
  return { normalized, values };
}

/**
 * The form both an item line and a trade stat entry reduce to. The API's PoE2
 * texts drop the leading sign (`# to maximum Life`, not `+# to maximum Life`),
 * so it comes off both sides rather than being guessed at on one.
 */
export function normalizeStatText(text: string): string {
  return text
    .replace(NUMBER, '#')
    .replace(/([+-])#/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}
