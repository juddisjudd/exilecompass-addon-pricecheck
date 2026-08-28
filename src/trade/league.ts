import type { AddonHost } from '../types';
import { TradeClient, TradeError } from './client';

export type LeagueMode = 'sc' | 'hc';

export interface TradeLeague {
  id: string;
  realm?: string;
  text?: string;
}

export interface LeaguePair {
  sc: TradeLeague;
  hc: TradeLeague | null;
}

const CACHE_KEY = 'league.v1';
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * `/data/leagues` lists the current softcore challenge league first, then its
 * hardcore twin (`HC ` + the same id), then Standard and Hardcore. Only the
 * two current ones are markets anyone price-checks against — Standard and
 * Hardcore are where characters land when a league ends — so they are
 * filtered out here rather than offered. See PLAN.md §2.1.
 */
export function classify(leagues: TradeLeague[]): LeaguePair {
  const poe2 = leagues.filter((l) => !l.realm || l.realm === 'poe2');
  const challenge = poe2.filter((l) => l.id !== 'Standard' && l.id !== 'Hardcore');
  const sc = challenge.find((l) => !l.id.startsWith('HC '));
  if (!sc) throw new TradeError('No current league found in the trade API response.');
  const hc =
    challenge.find((l) => l.id === `HC ${sc.id}`) ??
    challenge.find((l) => l.id.startsWith('HC ')) ??
    null;
  return { sc, hc };
}

export function leagueFor(pair: LeaguePair, mode: LeagueMode): TradeLeague {
  return mode === 'hc' ? (pair.hc ?? pair.sc) : pair.sc;
}

export function leagueLabel(league: TradeLeague): string {
  return league.text ?? league.id;
}

interface CachedPair {
  pair: LeaguePair;
  at: number;
}

/**
 * The resolved pair, from memory, then the host store, then the API. Small
 * enough to keep in addon storage, unlike the `/data/*` payloads.
 */
export async function resolveLeagues(
  client: TradeClient,
  host: AddonHost,
  force = false,
): Promise<LeaguePair> {
  if (!force) {
    const cached = await readCache(host);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.pair;
  }
  try {
    const data = await client.fetchData<{ result: TradeLeague[] }>('/data/leagues', 60 * 60);
    const pair = classify(data.result ?? []);
    await host.storage.set(CACHE_KEY, JSON.stringify({ pair, at: Date.now() } satisfies CachedPair));
    return pair;
  } catch (err) {
    // A stale league id still points at a real market; no leagues at all does not.
    const cached = await readCache(host);
    if (cached) return cached.pair;
    throw err;
  }
}

async function readCache(host: AddonHost): Promise<CachedPair | null> {
  try {
    const raw = await host.storage.get(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPair;
    return parsed?.pair?.sc?.id ? parsed : null;
  } catch {
    return null;
  }
}
