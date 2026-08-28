import { TRADE_BASE, TradeClient, TradeError, TRADE_SITE } from './client';
import type { TradeRequest } from './query';

export const SEARCH_POLICY = 'trade-search-request-limit';
export const FETCH_POLICY = 'trade-fetch-request-limit';

/** How many listings one price check pulls. Fetch takes at most 10 ids. */
export const RESULT_LIMIT = 10;

/**
 * What the API will order by. `price` and `indexed` are the only keys it
 * accepts — anything else is a hard 400 ("Unknown sort key"), verified live.
 *
 * Price ordering has to happen server-side: listings are priced in different
 * currencies, and only GGG knows today's rates between them. Sorting a fetched
 * page by raw amount would put 1 divine below 5 exalted.
 */
export type SortKey = 'price-asc' | 'price-desc' | 'recent';

export const SORTS: Array<{ key: SortKey; label: string; sort: Record<string, string> }> = [
  { key: 'price-asc', label: 'Cheapest first', sort: { price: 'asc' } },
  { key: 'price-desc', label: 'Most expensive', sort: { price: 'desc' } },
  { key: 'recent', label: 'Recently listed', sort: { indexed: 'desc' } },
];

export function sortFor(key: SortKey): Record<string, string> {
  return (SORTS.find((s) => s.key === key) ?? SORTS[0]).sort;
}

export interface SearchResponse {
  id: string;
  complexity: number;
  total: number;
  result: string[];
}

/**
 * Absent when the seller is offline; present with `status: 'afk'` when they
 * are logged in but away. It is an object, not a boolean — treating it as one
 * marks every offline seller as online.
 */
export interface AccountOnline {
  league?: string;
  status?: string;
}

export type SellerStatus = 'online' | 'afk' | 'offline';

/** One rolled magnitude on a mod: the range the roll came from. */
export interface ModMagnitude {
  min?: string;
  max?: string;
}

export interface ModDetail {
  /** Affix name, e.g. `Acrobat's`. */
  name?: string;
  /** `P7` / `S5` — prefix or suffix, and its tier. */
  tier?: string;
  level?: number;
  magnitudes?: ModMagnitude[];
}

/**
 * A mod as the fetch endpoint returns it — an object, not a string. The
 * description carries PoE's own markup (`[ElementalDamage|Elemental]`), and
 * `mods[]` holds the affix name, tier and roll ranges the trade site shows.
 */
export interface ListingMod {
  description?: string;
  domain?: string;
  hash?: string;
  mods?: ModDetail[];
}

/** `{name, values: [[text, type]]}` — properties and requirements share it. */
export interface ListingLine {
  name: string;
  values?: Array<[string, number]>;
}

export interface Listing {
  id: string;
  price: { type: string; amount: number; currency: string } | null;
  account: { name: string; online?: AccountOnline; lastCharacterName?: string };
  stash?: { name: string; x: number; y: number };
  whisper: string;
  /** ISO timestamp of when the listing was indexed. */
  indexed?: string;
  item: {
    name?: string;
    typeLine?: string;
    baseType?: string;
    icon?: string;
    ilvl?: number;
    stackSize?: number;
    corrupted?: boolean;
    identified?: boolean;
    rarity?: string;
    properties?: ListingLine[];
    requirements?: ListingLine[];
    implicitMods?: ListingMod[];
    explicitMods?: ListingMod[];
    runeMods?: ListingMod[];
    enchantMods?: ListingMod[];
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

export function sellerStatus(listing: Listing): SellerStatus {
  const online = listing.account.online;
  if (!online) return 'offline';
  return online.status === 'afk' ? 'afk' : 'online';
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
