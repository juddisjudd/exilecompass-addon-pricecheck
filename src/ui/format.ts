/**
 * Prices span six orders of magnitude — a rune sells for 0.002 divine, a
 * mirror for hundreds of thousands of exalted — so a single decimal rule
 * cannot serve them. Small values keep their precision, large ones get
 * compacted, and nothing is ever shown as `1234.5678`.
 */
export function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const n = Math.abs(value);

  if (n === 0) return '0';
  if (n < 0.01) return sign + n.toPrecision(1);
  if (n < 1) return sign + trim(n.toFixed(2));
  if (n < 100) return sign + trim(n.toFixed(2));
  if (n < 1000) return sign + Math.round(n).toString();
  if (n < 1_000_000) return sign + compact(n / 1000, 'k');
  if (n < 1_000_000_000) return sign + compact(n / 1_000_000, 'm');
  return sign + compact(n / 1_000_000_000, 'b');
}

/** `1.0k` reads worse than `1k`; `1.5k` is worth the character. */
function compact(value: number, suffix: string): string {
  return trim(value.toFixed(value < 10 ? 1 : 0)) + suffix;
}

function trim(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}
