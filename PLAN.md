# ExileCompass Price Check Add-on — Plan

Status: **M1 + M2 built** (host bridge + paste-driven price check); M3 next — see §9
Written: 2026-08-27
Scope: **Path of Exile 2 only, current challenge league only** — both its
softcore and hardcore variants (§2.1)

Goal: reach practical parity with [Sidekick](https://github.com/Sidekick-Poe/Sidekick)
and [Exiled Exchange 2](https://github.com/Kvan7/Exiled-Exchange-2) for item price
checking, shipped as an ExileCompass add-on rather than core app code, so that the
feature can be maintained by others if it gets adopted.

---

## 1. Executive summary

A price checker cannot be built as a pure add-on against the ExileCompass add-on
bridge as it exists in 1.4.2. The bridge offers HTTPS **GET** only, returns no
response headers, and has no clipboard, no hotkey, and no window of its own.
Price checking needs all four.

The host (`exilecompass`) therefore needs an add-on API bump — **pluginApi 1.1** —
before the add-on can do anything useful. That host work is the critical path.

Two findings make the rest much cheaper than expected:

- **No game-data pipeline is needed.** EE2 ships a ~2.6 MB GGPK-derived database
  built by a Python `dataParser`. We do not need it: GGG serves the same
  stat-id/item mapping over plain GET from the trade API itself.
- **Mod tiers and roll ranges come free** from the item text, if the player has
  the game's *Advanced Item Descriptions* key held during the copy. No mod-tier
  database, no per-patch data release.

**No Cloudflare Worker should be built for this.** See §4.

---

## 2. Verified facts

Everything in this section was tested live against the PoE2 trade API on
2026-08-27 with plain `curl` from a residential IP — no login, no cookies, no
Cloudflare challenge.

### 2.1 League discovery is solved — and it gives hardcore for free

```
GET https://www.pathofexile.com/api/trade2/data/leagues        -> 200
{"result":[
  {"id":"Runes of Aldur",   "realm":"poe2","text":"Runes of Aldur"},
  {"id":"HC Runes of Aldur","realm":"poe2","text":"HC Runes of Aldur"},
  {"id":"Standard",         "realm":"poe2","text":"Standard"},
  {"id":"Hardcore",         "realm":"poe2","text":"Hardcore"}]}
```

The endpoint returns every tradeable PoE2 league, in a stable order: current
softcore challenge, current hardcore challenge, `Standard`, `Hardcore`. The
hardcore challenge league is always the softcore id prefixed with `HC ` — that
naming has held since PoE2 launch, and is what both reference tools rely on
(EE2: `renderer/src/web/background/Leagues.ts`, which notes it uses
`/api/trade2/data/leagues` because `/api/leagues?realm=poe2` is not available).

**Decision:** use exactly the two **current challenge** leagues — softcore and
hardcore. Softcore and hardcore are different markets, so quoting a hardcore
player softcore prices is a wrong answer, not a rough one, and `result[0]` alone
is not acceptable. `Standard` and `Hardcore` are dead-league dumping grounds
(where characters land when a league ends), not markets anyone price-checks
against, so they are **filtered out**, not offered.

Classification, without hardcoding any league name:

| Slot | Rule |
|---|---|
| softcore (default) | `result[0]`, after filtering to `realm === "poe2"` |
| hardcore | the entry whose `id` equals `` `HC ${softcore.id}` ``; fall back to the first `id` starting with `HC ` that is not `Hardcore` |
| excluded | `id === "Standard"` and `id === "Hardcore"` — never selectable |

Rules:

- Cache the resolved pair for 1 h; refresh in the background.
- Persist the **mode** (`"sc" | "hc"`) in `settings.v1`, not the league id — the
  id changes every league, the mode does not, so the choice survives a rollover
  with no migration and no stale-id fallback path.
- Resolve mode -> league id at request time, from the cached list.
- If the hardcore entry is missing from a response (never seen, but the `HC `
  convention is a convention), fall back to softcore and say so once in the
  panel rather than searching a league that does not exist.

**UI:** a two-state SC / HC toggle in the panel header, labelled with each
league's `text`. Two current leagues is the whole selectable set, so this is a
toggle, not a dropdown, and it is the only league UI the add-on needs.

**Everything league-scoped must carry the selection, not `result[0]`:**

- `POST /api/trade2/search/<league>` — ids contain spaces, so URL-encode at every
  use: `HC Runes of Aldur` -> `HC%20Runes%20of%20Aldur`.
- The trade-site deep link (§5.6) must point at the same league as the search
  that produced it.
- The search/result cache must be keyed by league **and** query — otherwise
  toggling SC/HC re-serves the other market's prices from cache.
- Rate limits are per-IP (§2.3), *not* per-league. One shared limiter covers
  both; toggling does not hand back budget.

`/data/{stats,items,static,filters}` are league-independent and cache once
across both.

### 2.2 Search must be POST

```
POST /api/trade2/search/Runes%20of%20Aldur   -> 200 {"id":"lg5q4GpkuV","complexity":5,"result":[...]}
GET  /api/trade2/search/Runes%20of%20Aldur?q={...}  -> 401 {"error":{"code":8,"message":"Unauthorized"}}
```

The GET-with-`?q=` form is rejected. **POST is mandatory**, which the current
GET-only `net.fetch` bridge cannot do. This is the single hard blocker.

### 2.3 Rate limits are per-IP and must be honoured

Response headers on search:

```
X-Rate-Limit-Policy:   trade-search-request-limit
X-Rate-Limit-Rules:    Ip
X-Rate-Limit-Ip:       5:10:60,15:60:300,30:300:1800,600:21600:3600
X-Rate-Limit-Ip-State: 1:10:0,1:60:0,1:300:0,1:21600:0
```

on fetch:

```
X-Rate-Limit-Policy: trade-fetch-request-limit
X-Rate-Limit-Ip:     12:4:10,16:12:300,50:300:300,1000:21600:1800
```

Format is `hits:period_seconds:ban_seconds`. So search is capped at 5 requests
per 10 seconds with a 60 second ban, and 600 per 6 hours with a 1 hour ban.

Consequences:

- The add-on **must** be able to read response headers. The current bridge
  returns `{status, body}` only.
- Getting this wrong locks the user out of trade for up to an hour. Treat the
  limiter as a correctness requirement, not a nicety.
- `Access-Control-Expose-Headers` lists these, so they are readable.

### 2.4 Fetch returns everything needed to display a result

```
GET /api/trade2/fetch/<id>,<id>?query=<queryId>   -> 200
```

Each result carries `listing.price {type, amount, currency}`,
`listing.account {name, online, lastCharacterName}`, `listing.stash {name,x,y}`,
a ready-made `listing.whisper` string, and `item` with an absolute
`https://web.poecdn.com/gen/image/...` icon URL. Icons are already servable
through the existing `net.fetchImage` bridge method.

### 2.5 The trade API serves its own item/stat database

| Endpoint | Size | Contents |
|---|---|---|
| `/api/trade2/data/stats` | 849 KB | 10 groups: `pseudo`(36) `explicit`(3097) `implicit`(182) `fractured`(1242) `crafted`(1081) `enchant`(1001) `rune`(569) `desecrated`(755) `sanctum`(164) `skill`(131) |
| `/api/trade2/data/items` | 186 KB | Item bases grouped by category (`accessory`, …) |
| `/api/trade2/data/static` | 176 KB | Currency ids, labels, icons |
| `/api/trade2/data/filters` | 9 KB | Filter definitions and their option values |

Stat entries look like:

```json
{"id":"explicit.stat_3299347043","text":"# to maximum Life","type":"explicit"}
{"id":"explicit.stat_4220027924","text":"#% to Cold Resistance","type":"explicit"}
```

An item mod line matches a stat entry by replacing its numbers with `#` and
looking the text up, scoped by the mod's type (explicit / implicit / rune /
enchant / desecrated). This is the whole stat-matching problem for v1.

All four are plain GET and **already reachable through today's `net.fetch`**, so
the data layer needs no new host capability at all — only caching in add-on
storage.

### 2.6 Item text gives mod tiers for free

PoE2 copies the item under the cursor on `Ctrl + C`. If the *Advanced Item
Descriptions* key is **held during the copy**, the text also contains the affix
name, tier, tags, and roll range:

```
Item Class: Rings
Rarity: Rare
Rune Loop
Prismatic Ring
--------
Requires: Level 45
--------
Item Level: 79
--------
{ Implicit Modifier — Elemental, Fire, Cold, Lightning, Resistance }
+8(7-10)% to all Elemental Resistances
--------
{ Prefix Modifier "Vaporous" (Tier: 3) — Defences }
+143(124-151) to Evasion Rating
{ Suffix Modifier "of the Wrestler" (Tier: 7) — Attribute }
+12(9-12) to Strength
{ Suffix Modifier "of Warmth" (Tier: 3) — Mana }
8(8-12)% increased Mana Regeneration Rate
5% increased Light Radius
{ Suffix Modifier "of the Penguin" (Tier: 7) — Elemental, Cold, Resistance }
+15(11-15)% to Cold Resistance
```

(from `Exiled-Exchange-2/renderer/specs/Parser/items.ts`, `RareWithImplicit`)

That block gives us prefix/suffix classification, tier, tags, and the min-max
roll range with no mod database. It also disambiguates which stat group to match
against — the ambiguity that would otherwise be the hardest part of §2.5.

The key is read from the game's own config:

```
%USERPROFILE%\Documents\My Games\Path of Exile 2\poe2_production_Config.ini
  [ACTION_KEYS]
  show_advanced_item_descriptions = <key>
```

Default is `Alt`. So the synthesised keystroke is `Ctrl + <that key> + C`, not
plain `Ctrl + C`. EE2 does exactly this
(`main/src/host-files/GameConfig.ts`, `main/src/shortcuts/Shortcuts.ts`
`pressKeysToCopyItemText`). Sections are separated by lines of exactly eight
hyphens.

### 2.7 Reference tool licensing

Exiled Exchange 2 is **MIT** (Copyright (c) 2020 Alexander Drozdov — the
Awakened PoE Trade lineage). Its parser and filter logic are therefore
legitimately portable, matching the vendoring pattern ExileCompass already uses
for poe.re and exile-leveling. Port logic in our own style and record the
upstream commit, as `CLAUDE.md` requires for the other vendored subsystems.

Sidekick is C#/.NET; useful as a behavioural reference only.

---

## 3. Why this cannot be a pure add-on

Bridge as of ExileCompass 1.4.2 (`src/lib/components/addons/AddonsPanel.svelte`,
contract published in `tools/addon-scaffold/create-addon.mjs`):

| Provided | Notes |
|---|---|
| `storage.get/set` | string values, namespaced per add-on |
| `builds.getActive` / `builds.changed` | |
| `game.get` / `game.changed` | mirrors the PoE1/PoE2 switch |
| `net.fetch(url)` | HTTPS **GET** only, no redirects, returns `{status, body}` |
| `net.fetchImage(url)` | disk-cached, returns a `data:` URL |
| `ui.panel` | renders as a tab inside the main overlay window |

Gaps against the requirement:

| Need | Gap |
|---|---|
| POST `/api/trade2/search` | `net.fetch` is GET-only (§2.2) |
| Read `X-Rate-Limit-*` | response returns no headers (§2.3) |
| Read the copied item text | ExileCompass has no clipboard code at all |
| Trigger while the game has focus | `HOTKEY_ACTIONS` in `src/lib/hotkeys.ts` is a closed enum |
| Show results over the game | add-ons render as a tab; widget windows can't host an add-on |
| Open the search on the trade site | no `shell.open` bridge method |

Partly already solved in the host, which lowers the cost of the hotkey work
considerably: `overlay-core` already installs a **low-level keyboard hook** that
fires only while the game window is foreground, with a runtime-replaceable chord
set and without consuming the keystroke
(`src-tauri/overlay-core/src/platform/windows.rs:246` `start_keyboard_hook`,
`set_trigger_chords`, `set_hook_foreground_target`; wired in
`src-tauri/src/lib.rs` around the `set_overlay_triggers` command and the
`overlay-trigger` event). It currently reports only "some trigger fired" with no
chord identity, which is the piece that needs adding.

Similarly, secondary always-on-top widget windows already exist
(`create_widget_window`, `src/lib/widgets.ts`, `src/routes/widget/+page.svelte`,
`WidgetShell.svelte`) — they just cannot host an add-on panel yet.

---

## 4. Cloudflare Worker decision: do not build one

Considered and rejected for both plausible uses.

**Proxying trade requests — actively harmful.** `X-Rate-Limit-Rules: Ip` means
GGG's limits apply per source IP. Routing every user's search through one Worker
would give the entire user base a shared budget of 5 requests per 10 seconds and
600 per 6 hours, then a ban on the shared IP. It would also hide the real client
from GGG. Trade requests must originate from the user's own machine. This is not
a tuning problem; it is a hard architectural constraint.

**Hosting the item/stat database — unnecessary.** GGG serves it (§2.5), fresh,
free, and already reachable through the existing GET bridge. Baking a data
snapshot into the add-on and re-releasing per patch would be strictly worse.

`exilecompass-cf-workers` stays untouched for this project. Revisit only if we
later want *aggregate* data we cannot get from GGG — for example our own price
history or listing-volume statistics, in the style of poe2scout — which would
need storage and a scheduled ingest, and would be a separate project with its
own justification.

---

## 5. Host work — ExileCompass pluginApi 1.1

Target: ExileCompass **1.5.0**, `compatibility.pluginApi: "^1.1.0"`.

All additions are permission-gated in `AddonsPanel.svelte` the same way the
existing methods are, declared in `plugin.manifest.json`, surfaced in
`AddonsPermissions.svelte`, and mirrored into the published contract in
`tools/addon-scaffold/create-addon.mjs` (`types.ts` template). Keep that template
in step — it is the contract other add-on authors read.

### 5.1 `net.request` — POST with response headers

```ts
net.request(opts: {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}): Promise<{
  status: number;
  headers: Record<string, string>;
  body: string;
}>;
```

Permission: `network.request:<host>`. Implies `network.fetch:<host>`; host
matching reuses the existing `fetchAllowed` rule (exact host or subdomain).

Rust `addons_request`, modelled on `addons_fetch_text`
(`src-tauri/src/lib.rs:1387`):

- `https://` only, `redirect::Policy::none()`, 20 s timeout — as today.
- Method allowlist: `GET`, `POST`. Nothing else.
- **Request header allowlist**: `Accept` and `Content-Type` only. Reject
  anything else — including `X-Powered-By`, which the host sets itself — rather
  than dropping it silently, so an add-on never believes it sent a header it
  did not. The add-on must not be able to attach credentials or spoof the
  client identity.
- Host always sets the ExileCompass `User-Agent` (as today) and
  `X-Powered-By: ExileCompass`, so GGG can attribute traffic — Sidekick does the
  same (`TradeApiHandler.SendAsync`).
- **Response header allowlist**: return only `x-rate-limit-*`, `retry-after`,
  and `content-type`. Never surface `Set-Cookie` to add-on code.
- Caps: request body 64 KB, response body 4 MB.

This one method is what makes a price checker possible at all.

### 5.2 `clipboard.readItem` — the copy dance

```ts
clipboard.readItem(): Promise<string | null>;
```

Permission: `clipboard.readItem`.

Rust `addons_read_item_text`:

1. Require an attached, alive, foreground game window; otherwise return `null`.
2. Read the current clipboard and keep it. If it already looks like PoE item
   text, treat the saved value as empty — EE2 does this so a stale item can't be
   mistaken for a fresh read (`main/src/shortcuts/HostClipboard.ts`).
3. Clear the clipboard.
4. `SendInput` the chord `Ctrl + <advanced-descriptions key> + C` to the game.
   New `overlay-core` function; key resolved per §5.3.
5. Poll the clipboard every ~48 ms for up to ~500 ms for text whose first line
   starts with `Item Class: `.
6. Restore the saved clipboard. EE2 restores after ~120 ms and documents why the
   window matters: restoring too early can make the game read the *restored*
   contents, which may be a password. Mirror that timing and that comment.
7. Return the item text, or `null` on timeout.

**Security boundary — do not weaken this.** The method returns item text or
nothing. It must never hand arbitrary clipboard contents to an add-on. Gate on
the `Item Class: ` prefix inside the Rust command, not in the add-on.

Needs a clipboard crate (`arboard`, or `tauri-plugin-clipboard-manager`) and a
`send_key_chord(hwnd, chord)` in `overlay-core/src/platform/windows.rs` with a
no-op in `stub.rs`, consistent with how that module is already split.

Also add `clipboard.writeText(text)` under permission `clipboard.write` so the
add-on can copy a listing's `whisper` string. Lower risk than reading; note the
race with the save/restore dance above and serialise them in the host.

### 5.3 Advanced Descriptions key detection

Read `[ACTION_KEYS] show_advanced_item_descriptions` from
`Documents\My Games\Path of Exile 2\poe2_production_Config.ini` (§2.6), falling
back to `Alt`. Expose the resolved key in ExileCompass settings so the user can
override it when detection fails.

This belongs next to the existing `detect_log_file` machinery in
`src-tauri/src/lib.rs`, which already knows how to find game-adjacent paths, and
should follow the same "cheapest, most precise tier first, never brute-force"
discipline documented in `CLAUDE.md`.

### 5.4 `hotkey.register` — add-on hotkeys over the game

```ts
hotkey.register(combo: string, cb: () => void): Promise<() => void>;
```

Permission: `hotkey.register`.

- Give `KeyChord` an `id: u32`; pass it to the hook callback; emit
  `overlay-trigger` with `{ id }`. Existing auto-hide triggers keep `id: 0`, so
  the current behaviour is unchanged.
- The Svelte host allocates ids for add-on-registered combos, keeps an
  id -> add-on map, and forwards fires to the owning panel over the existing
  postMessage channel.
- Keep the hook **non-consuming**, as it is today. That means a combo the game
  also uses will do both things; surface the conflict in settings rather than
  swallowing keys. (EE2 does consume; deviating here is deliberate and cheaper.)
- Because the hook only fires while the game window is foreground, this is
  exactly the right trigger semantics for a price check and needs no extra
  gating.
- Default combo: `Ctrl+D`, matching Sidekick and EE2 — user-rebindable.

### 5.5 Add-on panels in a widget window

The highest-risk item. Results must appear over the game without the user first
opening the overlay and switching to a tab, or the feature is a downgrade on
both reference tools.

- Extend `openWidget` / `create_widget_window` to accept `addon:<id>` and add an
  `addon:` branch to `src/routes/widget/+page.svelte` that renders
  `AddonsPanel.svelte` inside `WidgetShell.svelte`.
- Add cursor-relative positioning (`atCursor: true`) and an opt-in
  close-on-mouse-leave behaviour to `WidgetShell`.
- **Known integration risk:** a widget window is a separate process with no
  shared JS memory (`CLAUDE.md`, "Secondary overlay widget windows"). The add-on
  manifest, permission set, and panel bundle all currently live in main-window
  state (`src/lib/plugins/host.svelte.ts`) and would have to be re-read from
  disk in the widget process, or pushed across via `persist.ts` plus events.
  Prototype this before committing to the milestone.
- Remember the two standing widget constraints: any command calling
  `WebviewWindowBuilder::build()` must be `async fn`, and the root element needs
  an `app-shell` class for the `app.html` bootstrap watchdog. `WidgetShell`
  already satisfies the second.
- Do **not** put per-instance controls in the widget header — that drag-region
  lesson is already recorded for the opacity slider.

### 5.6 `shell.openExternal`

```ts
shell.openExternal(url: string): Promise<void>;
```

Permission: `shell.open:<host>`. Uses `tauri-plugin-opener`, already a
dependency. For "open this search on the trade site".

### 5.7 `game.focus`

```ts
game.focus(): Promise<boolean>;
```

Permission: `game.focus`. Thin wrapper over the existing `focus_game` command,
so the panel can hand focus back after a whisper is copied.

### 5.8 `net.fetchCached` — disk-cached GET

```ts
net.fetchCached(url: string, maxAgeSeconds?: number): Promise<AddonFetchResponse>;
```

Permission: `network.fetch:<host>` — same grant as `net.fetch`, no new one.

Added during M1, not in the original plan. §6 assumed the `/data/*` payloads
could be cached for 24 h in add-on storage; they cannot. `storage.set` writes
into the app's single `settings.json` map (`store_set` in `src-tauri/src/lib.rs`
rewrites the whole file), so parking the 849 KB stat list there would make
every unrelated app setting write re-serialize a megabyte. The sandbox has no
usable `localStorage` either — its origin is opaque — and plain `net.fetch`
re-downloads on every call.

Rust `addons_fetch_cached`: `<app_data>/addons/cache/text/<hash>.txt`, one day
by default and 30 at most, only 200s cached, 8 MB cap, and a stale copy is
served if the network is down. Same shape and rules as `addons_fetch_image`,
which exists for exactly this reason on the icon side.

---

## 6. Add-on architecture

Repo: `S:\_projects_\_exilecompass_\exilecompass-addon-pricecheck`
Package: `@exilecompass/pricecheck-addon`
Add-on id: `dev.juddisjudd.pricecheck-addon`

Follow the `exilecompass-addon-economy` layout exactly — esbuild bundle to
`dist/panel.js` with a default-exported `mount(ctx)`, `tsc --noEmit` for
`check`, tag-driven `Release Addon` workflow producing `exilecompass-addon.zip`,
then bump `latestVersion` in `exilecompass-registry`'s `registry.v1.json`.

```
plugin.manifest.json
src/
  panel.ts            mount(ctx); state + render for paste / filters / results
  types.ts            host contract, mirroring the 1.1 scaffold template
  parser/
    sections.ts       split on lines of eight hyphens
    values.ts         rolled values, (min-max) ranges, and the # normalization
    nameplate.ts      Item Class, Rarity, name, base type
    properties.ts     ilvl, quality, sockets, armour/ev/es, phys/ele dmg, APS, crit
    advanced-mods.ts  { Prefix Modifier "X" (Tier: n) - Tags } blocks + roll ranges
    types.ts          ParsedItem / ParsedMod
    index.ts          parseClipboard(text) -> ParsedItem
  stats/
    match.ts          mod line -> trade stat id (numbers -> #, scoped by mod type)
    filters.ts        matched stats + item properties -> filter rows with defaults
  trade/
    client.ts         one rate-limited, serialised path to the API; /data GETs
    league.ts         /data/leagues -> current SC + HC pair; mode toggle; 1 h cache
    rate-limiter.ts   parse X-Rate-Limit-Ip / -Ip-State; per-policy windows; 429 backoff
    query.ts          ParsedItem + enabled filters -> TradeRequest JSON
    search.ts         POST /search then GET /fetch; sort keys
    currency.ts       /data/static names+icons; poe.ninja rates; conversion
  ui/
    dom.ts            el() helper, panel CSS, clipboard fallback
    format.ts         compact amounts: 0.003, 2.5, 371, 1.5k, 1.2m
    item.ts           compact item header + property chips (never the raw text)
    filters.ts        checkbox + min/max row per matched stat
    results.ts        listing cards: the item, its price, seller and age
    listing-item.ts   a listing's item: mods badged P#/S#, with roll ranges
test/
  parser.test.ts      fixtures for rare/plain/weapon/currency/negative rolls
  currency.test.ts    amount formatting, icon lookup, rate conversion
  panel.test.ts       mounts the panel in happy-dom and drives it (fixtures)
  match.test.ts       stat matching against the live /data/stats payload
  rate-limiter.test.ts  fake clock; bursts, bans, 429s, per-policy isolation
  live-search.mjs     manual end-to-end search (spends rate-limit budget)
```

Manifest permissions. The first block is what the add-on declares today; the
second is added with M3, when the host can serve it — an add-on asking for a
permission it cannot yet use only makes the install prompt scarier for no gain.

```
storage.read, storage.write,
network.request:pathofexile.com,
network.fetch:web.poecdn.com,
network.fetch:poe.ninja,
shell.open:pathofexile.com,
ui.panel
```

```
clipboard.readItem, clipboard.write,
hotkey.register
```

Storage keys (the host namespaces these as `EXILECOMPASS_ADDON_<id>__<key>`):

| Key | Contents | TTL |
|---|---|---|
| `league.v1` | resolved current SC + HC league ids + timestamp | 1 h |
| `settings.v1` | league mode (`sc`/`hc`), listing status filter | — |

`/data/{stats,items,static,filters}` are deliberately **not** here — they go
through the host's own disk cache (§5.8). Add-on storage is one shared
`settings.json`; a megabyte of game data does not belong in it.

The `TradeRequest` shape is confirmed against `/data/filters` (which publishes
the group and field ids) and Exiled-Exchange-2's
`renderer/src/web/price-check/trade/pathofexile-trade.ts:264` —
`query.status`, `query.name`, `query.type`, `query.stats[]`, and
`query.filters.{type_filters,equipment_filters,misc_filters}` (equipment
carries `ar`, `ev`, `es`, `pdps`, `edps`, `dps`, `aps`, `crit`, `spirit`,
`rune_sockets`, `block`, `reload_time`).

### 6.1 Flow

```
Ctrl+D over the game
  -> host keyboard hook (game is foreground)   [5.4]
  -> panel opens in a widget window at cursor  [5.5]
  -> clipboard.readItem()                      [5.2]
       clear -> SendInput Ctrl+Alt+C -> poll -> restore
  -> parseClipboard(text)
  -> match mods against cached /data/stats
  -> render filter rows, preselected with a slight range widening
  -> user adjusts -> POST /search/<selected league> -> GET /fetch  [5.1, rate-limited]
  -> price rows + expandable items + trade-site link
```

### 6.2 Results presentation

The listings are the answer, so they get the space. Everything above them
collapses once it has served its purpose: the paste box disappears the moment
an item parses (replaced by a one-line header plus property chips — never the
raw copied text), and the filters collapse to a `3 of 9 active` summary as soon
as a search returns something. Both reopen on click.

The listings themselves follow Exiled Exchange 2's table rather than Sidekick's
per-listing item cards (`Trade/Items/ItemComponent.razor`, which re-renders the
whole item and offers a compact-mode toggle to escape it). A price check is a
comparison across sellers, and a table compares; a stack of cards does not. As
in EE2's `TradeListing.vue`, columns are conditional on the item — stock only
for stackables, ilvl only when the listings carry one — and seller status is a
coloured dot (online / afk / offline) rather than a word.

**Sorting is split, deliberately.** `price` and `indexed` are the only sort keys
the API accepts (anything else is a hard 400, verified live), and price order
*must* be server-side: listings are priced in different currencies and only GGG
knows the rates, so ordering a fetched page by raw amount would rank 1 divine
below 5 exalted. So:

- the **Order** select (cheapest / most expensive / recently listed) is what the
  search asks the API for, and decides which listings come back at all;
- clicking **Price** flips that order and re-runs the search — one click, one
  search, through the limiter;
- clicking **Listed** or **ilvl** reorders the fetched
  page locally, with no API call.



**Two panes, not one column.** The item and its filters sit on the left, the
listings on the right — Sidekick's `LayoutTwoColumn` (`ItemOverlay.razor`).
Stacked in one column, as this was, the filters and the item pushed the prices
off the bottom of the panel, and collapsing them on a successful search only
traded one problem for another. They are read together, so they sit side by
side. Search anchors the bottom of the filter column, under everything it acts
on. Below 720px the panes stack, because at that width a 312px sidebar is most
of the screen.

**Each listing is a card, not a table row.** This went through a table first —
including a spell as two mismatched CSS grids, which is what made the columns
drift — and a table is the wrong shape for the content. Half of what matters
about a listing is its mods, and mods do not fit in a cell: they were truncated
to one ellipsised line, with the real item hidden behind an expander. Sidekick
renders each listing as the item itself with price, seller and age beside it
(`Trade/Items/ItemComponent.razor`), and that is what a price check compares.
So: the item on the left of the card, always visible, and what it costs on the
right.

Affix tiers are badged in the margin — `P7` red, `S3` blue — exactly as
`ItemStatLineComponent.razor` does it. The tier is the fastest read on a rare,
and in a fixed gutter the badges line up into a scannable column. (The badge
class is `pc-affix`, not `pc-tier`: the filter list already uses `pc-tier` for
the *player's own* item's mod tiers, and the two are different things.)

Sorting has no column headers to hang off any more, so it is three buttons
above the list: Price re-runs the search (the server owns currency order),
Listed and ilvl reorder the fetched page locally.

**There is no whisper button.** PoE2's in-game asynchronous trade offers are how
people buy now, so a copied whisper is a step almost nobody takes. Removing it
also removed the panel's only reason to touch the clipboard, and with it the
`document.execCommand` fallback the sandbox's opaque origin forced on us.

Two details of the fetch payload make the card possible and are easy to get
wrong. `explicitMods` and friends are **objects, not strings** — `{description,
mods: [{name, tier, magnitudes}]}` — which is where the affix and tier come
from. And `description` carries PoE's own link markup
(`[ElementalDamage|Elemental]`, `[Resistances]`), which reads as wiki source
until it is unwrapped: `[a|b]` takes the second half, `[a]` the first.


**Property and requirement names carry the link markup too.** Only mod
descriptions were being unwrapped for a while, so gear rendered as
`Boots • [Armour]: 134 • [EnergyShield|Energy Shield]: 37 • [Strength|Str]: 56`.
Everything the payload gives as display text goes through `cleanDescription`.
Requirements are then phrased the way the game phrases them —
`Requires Level 75, 56 Str, 56 Int` — rather than listed as name/value pairs.

**No online-status control.** It offered online / online-in-league / any, which
mattered when buying meant whispering someone. PoE2 sells through in-game
asynchronous offers, so whether the seller is logged in says nothing about
whether the item is purchasable. The query still asks for `online`, the trade
site's own default: widening it to `any` would let long-abandoned listings set
the price.

**The paste box is a one-line strip**, not a text area. Nobody types item text,
and a tall empty box was taking space both the filters and the listings wanted.
It stays visible after a paste (it costs one line) and empties itself once the
item is read, so the next paste needs no clearing. `Clear` on the item header
drops the item, its filters and its results together.

**Currency is shown as an icon, not a word.** `/data/static` publishes a name
and image for every currency, keyed by exactly the id a listing's
`price.currency` carries, so there is nothing to bundle or map by hand — Sidekick
renders `amount × [icon]` with the name in a tooltip (`PriceDisplay.razor`), and
EE2 bundles four PNGs picked by first letter (`CoreCurrencyImg.vue`). The API's
own table is better than either. Icons load through `net.fetchImage`, so they
are disk-cached like item icons.

Amounts are compacted (`formatAmount`): prices span from 0.002 divine for a rune
to hundreds of thousands of exalted for a mirror, so small values keep two
decimals and large ones become `1.5k` / `1.2m`.

**Converting between currencies needs a rate source, and GGG does not publish
one.** Sidekick does not convert at all. Exiled Exchange 2 does, and its model
is the one followed here (`Prices.ts`, `pathofexile-trade.ts`, `TradeItem.vue`):

- the player picks a **core currency**, and the choice is exactly two wide —
  `xchgRateCurrency` is typed `"chaos" | "exalted"`, rendered as radio buttons;
- **divine is not one of the choices.** It appears on its own once a price is
  worth about one (`autoCurrency`), because that is the unit anyone would quote
  at that value. Offering divine as a core as well would be a second way to say
  the same thing;
- the listing keeps **its own asking price**, and the restatement is appended in
  parentheses — `5 [ex icon] (0.14 c)`. That is the number the trade happens at, so
  substituting it would be actively unhelpful;
- nothing is appended when it would say nothing: a listing already in the core
  currency, or a divine price that would restate as divine.

Rates come from poe.ninja's PoE2 exchange overview, which gives every currency's
worth in divines under ids that match GGG's. That costs one extra permission
(`network.fetch:poe.ninja`), cached for an hour through `net.fetchCached`. When
poe.ninja cannot be reached the core toggle is simply not rendered and prices
stay exactly as listed. A missing rate yields `null`, never a guessed
conversion.

`account.online` is an **object** (`{league, status}`), absent when the seller is
offline and carrying `status: "afk"` when they are away — not a boolean. Reading
it as one marks every offline seller online.

---

## 7. Parity matrix

| Feature | Sidekick | EE2 | Plan |
|---|---|---|---|
| Hotkey price check over the game | yes | yes | **v1** (host 1.1) |
| Affix tier / roll range display | yes | yes | **v1** (free, §2.6) |
| Stat filter checkboxes + min/max | yes | yes | **v1** |
| Currency / unique / gem exact search | yes | yes | **v1** |
| Weapon DPS / pDPS / eDPS filters | yes | yes | **v1** |
| Armour / ES / evasion filters | yes | yes | **v1** |
| Rate-limit compliance | yes | yes | **v1, mandatory** |
| Trade-site link | yes | yes | **v1** |
| Whisper copy to clipboard | yes | yes | **v1** |
| Pseudo stats (total res, total life) | yes | yes | v2 |
| Bulk / currency exchange | yes | yes | v2 |
| Item info links (wiki / poedb) | yes | yes | v2 |
| Hardcore leagues | yes | yes | **v1** (§2.1) |
| League picker | yes | yes | **v1** (SC/HC toggle only) |
| Standard / permanent Hardcore | yes | yes | **out of scope** (dead leagues, §2.1) |
| Realms other than `poe2` (PoE1, Ruthless) | yes | yes | out of scope |
| Whisper sent into game chat | yes | yes | out of scope (chat input injection) |
| Map mod danger check | yes | yes | out of scope (belongs in core or its own add-on) |
| Stash regex search | yes | yes | already in the ExileCompass Regex tab |
| OCR heist gems | no | yes | out of scope |
| Non-English game clients | yes | yes | out of scope for v1 (§8.8) |

---

## 8. Risks and open questions

**8.1 Widget-hosted add-on panels (§5.5) — highest risk.** Separate process, no
shared memory, manifest and permission state currently main-window only.
Prototype this before scheduling M4. If it proves expensive, the fallback is a
pinned add-on tab in the main overlay, which works but is a real UX regression
against both reference tools.

**8.2 Rate limiting.** Getting it wrong bans the user's IP from trade for up to
an hour. Search and fetch have separate policies but share the IP budget. Build
the limiter first, from the `X-Rate-Limit-Ip` / `-Ip-State` pairs, back off hard
on 429, and test it before wiring any UI. Port the shape from
`renderer/src/web/price-check/trade/RateLimiter.ts` and `common.ts`.

**8.3 Synthesised input.** `SendInput` into the game is what Sidekick, EE2, and
Awakened PoE Trade all do openly and GGG tolerates. Keep the client honest and
identifiable (`User-Agent` + `X-Powered-By`, host-controlled, §5.1) rather than
disguising traffic.

**8.4 Advanced Descriptions key detection.** If the ini is missing or the key is
bound to something unsendable (a mouse button, per EE2's own troubleshooting
docs), mods will be absent from the copied text and the panel will show only
base properties. Detect that case explicitly and tell the user what to fix
instead of failing silently.

**8.5 Stat text ambiguity.** The same text can exist in several stat groups
(explicit vs rune vs implicit vs desecrated). The advanced-descriptions block
gives the mod's type, which resolves most of it. Log unmatched lines rather than
dropping them; EE2 keeps an `unknownModifiers` list for the same reason.

**8.6 Query complexity.** GGG rejects over-complex queries with
`"Query is too complex."` (Sidekick has a dedicated error path for it). Cap the
number of enabled stat filters and surface the cap in the UI.

**8.7 `net.request` widens the add-on attack surface.** An add-on gains POST to
a permitted host. The allowlists in §5.1 — methods, request headers, response
headers, size caps, no cookie forwarding — are the mitigation and should be
reviewed as a unit before release.

**8.8 Localization.** Stat matching is language-specific and the trade API has
per-language realms. v1 is English-only. The add-on should detect a non-English
client and say so rather than mis-parsing.

**8.9 Open question — can a sandboxed panel receive a paste?** Only relevant if
a paste-driven fallback is ever wanted. `navigator.clipboard.readText()` is
blocked by the opaque origin, but a native Ctrl+V into a focused input should
still work. Untested.

**8.10 Open question — PoE1.** Deliberately out of scope. The core app supports
both games, and someone will ask. The trade1 API is analogous, so the design
does not preclude it, but nothing here should be built for it.

---

## 9. Milestones

| # | Deliverable | Repo | Status |
|---|---|---|---|
| **M0** | This plan | `exilecompass-addon-pricecheck` | done |
| **M1** | `net.request` + `net.fetchCached` (§5.8) + `shell.openExternal`, pluginApi 1.1, scaffold `types.ts` updated | `exilecompass` | done, unreleased |
| **M2** | Parser, stat matcher, query builder, rate limiter, results UI — driven by pasted item text | `exilecompass-addon-pricecheck` | done |
| **M3** | `clipboard.readItem` + `clipboard.write` + advanced-descriptions key detection + `hotkey.register` | `exilecompass` | next |
| **M4** | Add-on panels in widget windows, cursor positioning, auto-close (**prototype first**, §8.1) | `exilecompass` | |
| **M5** | Hotkey-driven popup flow, settings, registry publish | `exilecompass-addon-pricecheck` + `exilecompass-registry` | |
| **M6** | v2: pseudo stats, bulk exchange, item info links | `exilecompass-addon-pricecheck` | |

M2 was the bulk of the code and all of the algorithmic risk, and depended only
on M1. Completing and validating it against real items before M3/M4 was
deliberate — a working engine behind a clumsy input beats a polished input
around an engine that mis-prices items.

What M2 proved, against the live API rather than fixtures: the `#`-substituted
mod text matches GGG's own stat entries exactly (`# to Evasion Rating`,
`#% increased Mana Regeneration Rate`, …); `(Local)` variants resolve correctly
from the item's own properties; the built query is accepted (complexity 11 on a
two-stat ring search) and returns priced listings with icons and whispers.

M1 ships with the next ExileCompass release. Until then the add-on's own
version-guard message is what a user on 1.4.2 sees.

---

## 10. Reference index

ExileCompass:

- `src/lib/components/addons/AddonsPanel.svelte` — the whole add-on bridge, sandbox bootstrap, permission gates
- `tools/addon-scaffold/create-addon.mjs` — published `types.ts` contract; keep in step with the bridge
- `src-tauri/src/lib.rs:1387` — `addons_fetch_text`, the model for `net.request`
- `src-tauri/src/lib.rs` — `create_widget_window`, `set_overlay_triggers`, `focus_game`, `detect_log_file`
- `src-tauri/overlay-core/src/platform/windows.rs:246` — `start_keyboard_hook`, `set_trigger_chords`, `set_hook_foreground_target`
- `src/lib/widgets.ts`, `src/routes/widget/+page.svelte`, `WidgetShell.svelte` — widget windows
- `src/lib/hotkeys.ts` — `HOTKEY_ACTIONS`, the enum to open up
- `src/lib/crafting-data.ts` — remote/cache/fallback layering pattern to copy

Exiled Exchange 2 (MIT):

- `renderer/src/parser/` — `Parser.ts`, `advanced-mod-desc.ts`, `modifiers.ts`, `stat-translations.ts`, `calc-base.ts`
- `renderer/src/web/price-check/trade/pathofexile-trade.ts:264` — `TradeRequest` shape
- `renderer/src/web/price-check/trade/RateLimiter.ts`, `common.ts` — limiter and `RATE_LIMIT_RULES`
- `renderer/src/web/price-check/filters/` — `create-stat-filters.ts`, `create-item-filters.ts`, `pseudo/`
- `renderer/src/web/background/Leagues.ts` — league resolution
- `main/src/shortcuts/HostClipboard.ts` — the copy/poll/restore dance and its security note
- `main/src/shortcuts/Shortcuts.ts` — `pressKeysToCopyItemText`
- `main/src/host-files/GameConfig.ts` — `show_advanced_item_descriptions`
- `renderer/specs/Parser/items.ts` — item text fixtures
- `main/src/proxy.ts` — note the `useSessionCookies: true` approach we are *not* copying

Sidekick (C#, behavioural reference):

- `src/Sidekick.Apis.Poe.Trade/Clients/TradeApiHandler.cs` — rate limit, 429, redirect, Cloudflare challenge handling
- `src/Sidekick.Apis.Poe.Trade/Clients/TradeApiClient.cs` — API-then-local-file data fallback
- `src/Sidekick.Game.Parser/` — parser
- `data/poe2/` — its bundled data, for comparison against the API-served approach in §2.5
