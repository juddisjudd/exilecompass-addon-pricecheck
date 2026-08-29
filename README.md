# ExileCompass Price Check

Price check Path of Exile 2 items against the official trade API, from inside
the ExileCompass overlay. Paste a copied item, pick the modifiers that matter,
and see what comparable items are actually listed for.

Requires **ExileCompass 1.5.0** or newer (pluginApi 1.1) — the trade API's
search endpoint only accepts POST, and its rate-limit headers have to be read
off the response, neither of which older hosts can do.

## What it does

- Parses copied item text, including the affix names, tiers, tags, and roll
  ranges the game adds when *Advanced Item Descriptions* is held during the
  copy.
- Matches each modifier to its trade stat id using the stat list the trade API
  serves itself — no bundled mod database, nothing to re-release per patch.
- Builds a search from the filters you tick, runs it, and lists matching items
  newest first with their prices, sellers, and how long each has been listed.
  The Price and Listed headers re-order on the server; **Show 10 more** pages
  through the rest of what the search returned without spending another
  search.
- Shows prices with the currency's own icon, and restates each one in your core
  currency — exalted or chaos — alongside the seller's asking price. Anything
  worth a divine or more is quoted in divines automatically. Rates come from
  poe.ninja; without them prices simply stay as listed.
- Every listing shows the item itself — mods badged by affix tier (P7, S3) with
  their roll ranges — alongside its price, seller and age.
- Softcore or hardcore, always the current challenge league — resolved from
  the API, never hardcoded.
- Obeys GGG's published rate limits. Breaking them bans your IP from trade for
  up to an hour, so the add-on waits rather than risk it.

## Using it

1. Open the **Price Check** tab in ExileCompass.
2. In game, hover an item and press `Ctrl+C` — hold `Alt` (the Advanced Item
   Descriptions key) as well, to get mod tiers and roll ranges.
3. Click the paste strip in the panel and press `Ctrl+V`. Tick the modifiers you
   care about — the min/max boxes appear for each one you tick, prefilled a
   little under what your item rolled; right-click a box to clear it — then
   press **Search**.
4. Each listing is one line: name, item level, how long it has been up, and
   the price. Click a line to see the full item under it, or **Expand all** in
   the results header to open every listing.

Hotkey-driven checks over the game, without the paste step, arrive with the
next host release.

## Permissions

| Permission | Why |
|---|---|
| `storage.read` / `storage.write` | Remembers your league and status choice |
| `network.request:pathofexile.com` | Searching the trade API (POST + rate-limit headers) |
| `network.fetch:web.poecdn.com` | Item icons in the results list |
| `network.fetch:poe.ninja` | Exchange rates, for restating prices in your core currency |
| `shell.open:pathofexile.com` | "Open on the trade site" |
| `ui.panel` | Renders the panel |

## Development

```bash
bun install
bun run check    # tsc --noEmit
bun run test     # parser, stat matching, rate limiter, and the panel itself
bun run build    # bundles src/panel.ts -> dist/panel.js
```

`test/panel.test.ts` mounts the real panel in a DOM (happy-dom) behind the same
fake host bridge ExileCompass provides, then drives it — paste, search, sort.
Its trade responses come from `test/fixtures/`, so it runs offline and spends
no rate-limit budget.

`test/live-search.mjs` is the counterpart: a manual check that runs a real
search against the trade API. It is not part of `bun run test` because it does
spend your IP's budget.

Releases are tag-driven: push `vX.Y.Z` with matching versions in
`package.json` and `plugin.manifest.json`, and the workflow publishes
`exilecompass-addon.zip`.

`PLAN.md` is the design document — read it before changing the trade layer.

## Credits

Parser and filter behaviour follow
[Exiled Exchange 2](https://github.com/Kvan7/Exiled-Exchange-2) (MIT), with
[Sidekick](https://github.com/Sidekick-Poe/Sidekick) as a behavioural
reference. Item and stat data come from the official trade API.
