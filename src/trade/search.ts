import { TRADE_BASE, TradeClient, TradeError, TRADE_SITE } from './client';
import type { TradeRequest } from './query';

export const SEARCH_POLICY = 'trade-search-request-limit';
export const FETCH_POLICY = 'trade-fetch-request-limit';

/** How many listings one price check pulls. Fetch takes at most 10 ids. */
export const RESULT_LIMIT = 10;

export interface SearchResponse {
  id: string;
  complexity: number;
  total: number;
  result: string[];
}

export interface Listing {
  id: string;
  price: { type: string; amount: number; currency: string } | null;
  account: { name: string; online: boolean; lastCharacterName?: string };
  stash?: { name: string; x: number; y: number };
  whisper: string;
  indexed?: string;
  item: {
    name?: string;
    typeLine?: string;
    baseType?: string;
    icon?: string;
    ilvl?: number;
    corrupted?: boolean;
    properties?: Array<{ name: string; values: Array<[string, number]> }>;
    explicitMods?: string[];
    implicitMods?: string[];
  };
}

interface FetchResponse {
  result: Array<{
    id: string;
    listing: {
      price: Listing['price'];
      account: Listing['account'];
      stash?: Listing['stash'];
      whisper: string;
      indexed?: string;
    };
    item: Listing['item'];
  } | null>;
}

export interface SearchOutcome {
  queryId: string;
  total: number;
  listings: Listing[];
}

/** The trade site URL for a completed search, so the user can open it. */
export function searchUrl(league: string, queryId: string): string {
  return `${TRADE_SITE}/${encodeURIComponent(league)}/${encodeURIComponent(queryId)}`;
}

export async function search(
  client: TradeClient,
  league: string,
  request: TradeRequest,
  limit = RESULT_LIMIT,
): Promise<SearchOutcome> {
  const res = await client.request(SEARCH_POLICY, {
    url: `${TRADE_BASE}/search/${encodeURIComponent(league)}`,
    method: 'POST',
    body: request,
  });

  const found = JSON.parse(res.body) as SearchResponse;
  const ids = (found.result ?? []).slice(0, limit);
  if (!ids.length) return { queryId: found.id, total: found.total ?? 0, listings: [] };

  const fetched = await client.request(FETCH_POLICY, {
    url: `${TRADE_BASE}/fetch/${ids.join(',')}?query=${encodeURIComponent(found.id)}`,
  });

  const payload = JSON.parse(fetched.body) as FetchResponse;
  const listings: Listing[] = (payload.result ?? [])
    .filter((entry): entry is NonNullable<FetchResponse['result'][number]> => entry !== null)
    .map((entry) => ({
      id: entry.id,
      price: entry.listing.price ?? null,
      account: entry.listing.account,
      stash: entry.listing.stash,
      whisper: entry.listing.whisper,
      indexed: entry.listing.indexed,
      item: entry.item,
    }));

  return { queryId: found.id, total: found.total ?? listings.length, listings };
}

/** GGG's own words for a query the engine refuses (PLAN.md §8.6). */
export function isComplexityError(err: unknown): boolean {
  return err instanceof TradeError && /too complex/i.test(err.message);
}
