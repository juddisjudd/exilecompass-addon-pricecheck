import type { AddonHost } from '../types';
import { TradeClient, TradeError } from './client';

export type LeagueMode = 'sc' | 'hc';

export interface TradeLeague {
  id: string;
  realm?: string;
  text?: string;
}

/** One challenge league and its hardcore twin — the two halves of one market. */
export interface LeagueFamily {
  sc: TradeLeague;
  hc: TradeLeague | null;
}

const CACHE_KEY = 'league.v2';
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * `/data/leagues` lists each challenge league's softcore entry followed by its
 * hardcore twin (`HC ` + the same id), newest first, then Standard and
 * Hardcore. Those last two are where characters land when a league ends, not
 * markets anyone price-checks against, so they are filtered out rather than
 * offered. See PLAN.md §2.1.
 *
 * Every challenge league is kept, not only the newest: for the first weeks of
 * a new league the previous one is still live, and someone with characters
 * there is asking about a real market.
 */
export function classify(leagues: TradeLeague[]): LeagueFamily[] {
  const poe2 = leagues.filter((l) => !l.realm || l.realm === 'poe2');
  const challenge = poe2.filter((l) => l.id !== 'Standard' && l.id !== 'Hardcore');
  const families = challenge
    .filter((l) => !l.id.startsWith('HC '))
    .map((sc) => ({ sc, hc: challenge.find((l) => l.id === `HC ${sc.id}`) ?? null }));
  if (families.length === 0) throw new TradeError('No current league found in the trade API response.');
  return families;
}

/** The stored league id's family, or the newest league when it has ended. */
export function familyFor(families: LeagueFamily[], id: string | null): LeagueFamily {
  return families.find((f) => f.sc.id === id) ?? families[0];
}

export function leagueFor(family: LeagueFamily, mode: LeagueMode): TradeLeague {
  return mode === 'hc' ? (family.hc ?? family.sc) : family.sc;
}

export function leagueLabel(league: TradeLeague): string {
  return league.text ?? league.id;
}

interface CachedFamilies {
  families: LeagueFamily[];
  at: number;
}

/**
 * The resolved families, from memory, then the host store, then the API. Small
 * enough to keep in addon storage, unlike the `/data/*` payloads.
 */
export async function resolveLeagues(
  client: TradeClient,
  host: AddonHost,
  force = false,
): Promise<LeagueFamily[]> {
  if (!force) {
    const cached = await readCache(host);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.families;
  }
  try {
    const data = await client.fetchData<{ result: TradeLeague[] }>('/data/leagues', 60 * 60);
    const families = classify(data.result ?? []);
    await host.storage.set(CACHE_KEY, JSON.stringify({ families, at: Date.now() } satisfies CachedFamilies));
    return families;
  } catch (err) {
    // A stale league id still points at a real market; no leagues at all does not.
    const cached = await readCache(host);
    if (cached) return cached.families;
    throw err;
  }
}

async function readCache(host: AddonHost): Promise<CachedFamilies | null> {
  try {
    const raw = await host.storage.get(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedFamilies;
    return parsed?.families?.[0]?.sc?.id ? parsed : null;
  } catch {
    return null;
  }
}
