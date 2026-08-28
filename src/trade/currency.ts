import type { AddonHost } from '../types';
import type { TradeClient } from './client';

export const POE_CDN = 'https://web.poecdn.com';

/**
 * `/data/static` names and illustrates every currency the trade site knows,
 * keyed by exactly the id a listing's `price.currency` carries. So there is no
 * need to bundle icons or map names by hand — the site publishes both.
 */
export interface CurrencyMeta {
  id: string;
  name: string;
  icon?: string;
}

interface StaticPayload {
  result: Array<{ id: string; entries?: Array<{ id: string; text: string; image?: string }> }>;
}

export class CurrencyIndex {
  private byId = new Map<string, CurrencyMeta>();

  constructor(payload: StaticPayload) {
    for (const group of payload.result ?? []) {
      for (const entry of group.entries ?? []) {
        if (this.byId.has(entry.id)) continue;
        this.byId.set(entry.id, {
          id: entry.id,
          name: entry.text,
          icon: entry.image ? `${POE_CDN}${entry.image}` : undefined,
        });
      }
    }
  }

  get(id: string): CurrencyMeta {
    return this.byId.get(id) ?? { id, name: id };
  }
}

export async function loadCurrencies(client: TradeClient): Promise<CurrencyIndex> {
  return new CurrencyIndex(await client.fetchData<StaticPayload>('/data/static'));
}

// ── exchange rates ──────────────────────────────────────────────────────────

const NINJA = 'https://poe.ninja/poe2/api/economy/exchange/current/overview';
const RATES_TTL_SECONDS = 60 * 60;

interface NinjaOverview {
  core?: { primary?: string; secondary?: string; rates?: Record<string, number> };
  lines?: Array<{ id: string; primaryValue?: number }>;
}

/**
 * How many divines one of each currency is worth, from poe.ninja — the same
 * source Exiled Exchange 2 normalizes against. GGG's own API does not publish
 * rates, and the trade endpoints that could imply them are rate limited, so
 * converting prices means asking someone who already aggregates the economy.
 */
export class Rates {
  /** currency id -> value in `base` units. */
  private perUnit = new Map<string, number>();

  constructor(
    overview: NinjaOverview,
    /** The currency `primaryValue` is denominated in. */
    readonly base: string,
  ) {
    for (const line of overview.lines ?? []) {
      if (typeof line.primaryValue === 'number' && line.primaryValue > 0) {
        this.perUnit.set(line.id, line.primaryValue);
      }
    }
    this.perUnit.set(base, 1);
  }

  get known(): boolean {
    return this.perUnit.size > 1;
  }

  /** Currencies worth offering as a display unit, most valuable first. */
  targets(): string[] {
    const wanted = [this.base, 'divine', 'exalted', 'chaos'];
    return [...new Set(wanted)].filter((id) => this.perUnit.has(id));
  }

  /** null when either side has no published rate — never a guessed number. */
  convert(amount: number, from: string, to: string): number | null {
    if (from === to) return amount;
    const source = this.perUnit.get(from);
    const target = this.perUnit.get(to);
    if (!source || !target) return null;
    return (amount * source) / target;
  }
}

export async function loadRates(host: AddonHost, league: string): Promise<Rates | null> {
  const net = host.net;
  if (!net) return null;
  const url = `${NINJA}?league=${encodeURIComponent(league)}&type=Currency`;
  try {
    const res = net.fetchCached ? await net.fetchCached(url, RATES_TTL_SECONDS) : await net.fetch(url);
    if (res.status !== 200) return null;
    const overview = JSON.parse(res.body) as NinjaOverview;
    const rates = new Rates(overview, overview.core?.primary ?? 'divine');
    return rates.known ? rates : null;
  } catch {
    // Conversion is a convenience; prices still show as listed without it.
    return null;
  }
}
