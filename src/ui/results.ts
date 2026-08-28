import type { AddonHost } from '../types';
import type { Listing } from '../trade/search';
import { copyText, el } from './dom';

function priceLabel(listing: Listing): string {
  const price = listing.price;
  if (!price) return 'no price';
  return `${price.amount} ${price.currency}`;
}

function itemLabel(listing: Listing): string {
  const item = listing.item;
  return [item.name, item.typeLine ?? item.baseType].filter(Boolean).join(' ') || 'Unknown item';
}

/**
 * Icons come from web.poecdn.com. They go through the host's image cache
 * rather than a plain <img src>: the sandbox's opaque origin makes Chromium
 * skip its own HTTP cache, so every reopen would re-download all of them.
 */
async function iconFor(host: AddonHost, url: string | undefined): Promise<string | null> {
  if (!url || !host.net?.fetchImage) return null;
  try {
    return await host.net.fetchImage(url);
  } catch {
    return null;
  }
}

export interface ResultsOptions {
  host: AddonHost;
  listings: Listing[];
  total: number;
  onStatus: (message: string) => void;
}

export function renderResults(container: HTMLElement, options: ResultsOptions): void {
  container.replaceChildren();
  if (!options.listings.length) {
    container.append(el('div', 'pc-empty', 'No listings matched. Loosen a filter and search again.'));
    return;
  }

  if (options.total > options.listings.length) {
    container.append(
      el(
        'div',
        'pc-section',
        `Cheapest ${options.listings.length} of ${options.total} listings`,
      ),
    );
  }

  for (const listing of options.listings) {
    const row = el('div', 'pc-result');

    const img = el('img');
    img.alt = '';
    void iconFor(options.host, listing.item.icon).then((src) => {
      if (src) img.src = src;
    });

    const middle = el('div');
    middle.append(el('div', 'pc-label', itemLabel(listing)));
    const seller = listing.account.lastCharacterName ?? listing.account.name;
    middle.append(el('div', 'pc-seller', `${seller}${listing.account.online ? '' : ' (offline)'}`));

    const copy = el('button', 'pc-copy', 'Whisper');
    copy.type = 'button';
    copy.title = listing.whisper;
    copy.addEventListener('click', () => {
      options.onStatus(
        copyText(listing.whisper) ? 'Whisper copied.' : 'Could not copy — select the text instead.',
      );
    });

    row.append(img, middle, el('div', 'pc-price', priceLabel(listing)), copy);
    container.append(row);
  }
}
