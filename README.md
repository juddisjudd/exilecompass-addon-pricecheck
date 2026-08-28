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
- Builds a search from the filters you tick, runs it, and lists the cheapest
  matching items with their prices, sellers, and ready-made whispers.
- Softcore or hardcore, always the current challenge league — resolved from
  the API, never hardcoded.
- Obeys GGG's published rate limits. Breaking them bans your IP from trade for
  up to an hour, so the add-on waits rather than risk it.

## Using it

1. Open the **Price Check** tab in ExileCompass.
2. In game, hover an item and press `Ctrl+C` — hold `Alt` (the Advanced Item
   Descriptions key) as well, to get mod tiers and roll ranges.
3. Paste into the panel. Tick the modifiers you care about and adjust the
   min/max values, then press **Price check**.

Hotkey-driven checks over the game, without the paste step, arrive with the
next host release.

## Permissions

| Permission | Why |
|---|---|
| `storage.read` / `storage.write` | Remembers your league and status choice |
| `network.request:pathofexile.com` | Searching the trade API (POST + rate-limit headers) |
| `network.fetch:web.poecdn.com` | Item icons in the results list |
| `shell.open:pathofexile.com` | "Open on the trade site" |
| `ui.panel` | Renders the panel |

## Development

```bash
bun install
bun run check    # tsc --noEmit
bun run test     # parser, stat matching, and rate limiter
bun run build    # bundles src/panel.ts -> dist/panel.js
```

`test/live-search.mjs` is a manual check that runs a real search against the
trade API. It is not part of `bun run test` because it spends your IP's
rate-limit budget.

Releases are tag-driven: push `vX.Y.Z` with matching versions in
`package.json` and `plugin.manifest.json`, and the workflow publishes
`exilecompass-addon.zip`.

`PLAN.md` is the design document — read it before changing the trade layer.

## Credits

Parser and filter behaviour follow
[Exiled Exchange 2](https://github.com/Kvan7/Exiled-Exchange-2) (MIT), with
[Sidekick](https://github.com/Sidekick-Poe/Sidekick) as a behavioural
reference. Item and stat data come from the official trade API.
