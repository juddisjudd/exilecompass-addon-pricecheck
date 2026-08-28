// Recorded trade API responses, trimmed to what the panel reads and with
// seller identities replaced — these are real players' listings otherwise.
// The shapes are verbatim from live responses (2026-08-28), including the
// details that are easy to get wrong: `account.online` is an object that is
// absent when the seller is offline and carries `status: "afk"` when they are
// away, and `price.type` is `~price`, not `exact`.

export const SEARCH_RESPONSE = {
  id: 'aBcDeFgHiJ',
  complexity: 11,
  total: 78,
  result: ['listing-1', 'listing-2', 'listing-3', 'listing-4'],
};

const ICON = 'https://web.poecdn.com/gen/image/example/ring.png';

export const FETCH_RESPONSE = {
  result: [
    {
      id: 'listing-1',
      listing: {
        method: 'psapi',
        indexed: '2026-08-27T10:06:20Z',
        stash: { name: '~price 1 exalted', x: 0, y: 11 },
        price: { type: '~price', amount: 1, currency: 'exalted' },
        account: {
          name: 'SellerOne#1111',
          online: { league: 'Runes of Aldur', status: 'afk' },
          lastCharacterName: 'AfkAlchemist',
          realm: 'poe2',
        },
        whisper: '@AfkAlchemist Hi, I would like to buy your Dusk Turn Prismatic Ring',
      },
      item: {
        icon: ICON,
        name: 'Dusk Turn',
        typeLine: 'Prismatic Ring',
        baseType: 'Prismatic Ring',
        ilvl: 47,
        rarity: 'Rare',
        identified: true,
        requirements: [{ name: 'Level', values: [['39', 0] as [string, number]] }],
        // Mods are objects, not strings: each carries the affix name, its tier
        // and the range the roll came from. The text uses PoE's own link
        // markup, which has to be unwrapped before it is readable.
        implicitMods: [
          {
            description: '+10% to all [ElementalDamage|Elemental] [Resistances]',
            mods: [{ level: 44, magnitudes: [{ min: '7', max: '10' }] }],
          },
        ],
        explicitMods: [
          {
            description: '+43 to [Evasion] Rating',
            mods: [{ name: "Acrobat's", tier: 'P7', magnitudes: [{ min: '39', max: '51' }] }],
          },
          {
            description: '+82 to maximum Life',
            mods: [{ name: 'Robust', tier: 'P3', magnitudes: [{ min: '70', max: '84' }] }],
          },
        ],
      },
    },
    {
      id: 'listing-2',
      listing: {
        method: 'psapi',
        indexed: '2026-08-28T02:15:00Z',
        stash: { name: '~price 2 exalted', x: 3, y: 4 },
        price: { type: '~price', amount: 2, currency: 'exalted' },
        account: {
          name: 'SellerTwo#2222',
          online: { league: 'Runes of Aldur' },
          lastCharacterName: 'OnlineOccultist',
          realm: 'poe2',
        },
        whisper: '@OnlineOccultist Hi, I would like to buy your Blood Band Prismatic Ring',
      },
      item: {
        icon: ICON,
        name: 'Blood Band',
        typeLine: 'Prismatic Ring',
        baseType: 'Prismatic Ring',
        ilvl: 81,
        rarity: 'Rare',
        // Property and requirement *names* carry the same link markup the mod
        // descriptions do — which is easy to miss, because for a while only the
        // mods were being unwrapped and gear rendered as
        // "[EnergyShield|Energy Shield]: 37 • [Strength|Str]: 56".
        properties: [
          { name: 'Boots', values: [] as Array<[string, number]> },
          { name: '[Armour]', values: [['134', 0] as [string, number]] },
          { name: '[EnergyShield|Energy Shield]', values: [['37', 0] as [string, number]] },
        ],
        requirements: [
          { name: 'Level', values: [['75', 0] as [string, number]] },
          { name: '[Strength|Str]', values: [['56', 0] as [string, number]] },
          { name: '[Intelligence|Int]', values: [['56', 0] as [string, number]] },
        ],
      },
    },
    {
      id: 'listing-3',
      listing: {
        method: 'psapi',
        indexed: '2026-08-20T18:40:00Z',
        stash: { name: '~price 5 exalted', x: 1, y: 1 },
        price: { type: '~price', amount: 5, currency: 'exalted' },
        // No `online` key at all: this seller is offline.
        account: {
          name: 'SellerThree#3333',
          lastCharacterName: 'GoneFishing',
          realm: 'poe2',
        },
        whisper: '@GoneFishing Hi, I would like to buy your Rift Gyre Prismatic Ring',
      },
      item: {
        icon: ICON,
        name: 'Rift Gyre',
        typeLine: 'Prismatic Ring',
        baseType: 'Prismatic Ring',
        ilvl: 65,
        rarity: 'Rare',
      },
    },
    // The API returns null for a listing that vanished between search and fetch.
    null,
  ],
};

export const LEAGUES_RESPONSE = {
  result: [
    { id: 'Runes of Aldur', realm: 'poe2', text: 'Runes of Aldur' },
    { id: 'HC Runes of Aldur', realm: 'poe2', text: 'HC Runes of Aldur' },
    { id: 'Standard', realm: 'poe2', text: 'Standard' },
    { id: 'Hardcore', realm: 'poe2', text: 'Hardcore' },
  ],
};

/** Headers a search response carries, so the limiter has something to read. */
export const RATE_HEADERS: Record<string, string> = {
  'x-rate-limit-policy': 'trade-search-request-limit',
  'x-rate-limit-rules': 'Ip',
  'x-rate-limit-ip': '5:10:60,15:60:300,30:300:1800,600:21600:3600',
  'x-rate-limit-ip-state': '1:10:0,1:60:0,1:300:0,1:21600:0',
};

/** Two currency entries, enough for icon rendering and conversion. */
export const STATIC_RESPONSE = {
  result: [
    {
      id: 'Currency',
      entries: [
        { id: 'exalted', text: 'Exalted Orb', image: '/gen/image/exalted.png' },
        { id: 'divine', text: 'Divine Orb', image: '/gen/image/divine.png' },
        { id: 'chaos', text: 'Chaos Orb', image: '/gen/image/chaos.png' },
      ],
    },
  ],
};

/** poe.ninja's PoE2 currency overview, trimmed. Values are in divines. */
export const NINJA_RESPONSE = {
  core: { primary: 'divine', secondary: 'chaos', rates: { exalted: 371, chaos: 10.69 } },
  lines: [
    { id: 'exalted', primaryValue: 0.002695 },
    { id: 'chaos', primaryValue: 0.09357 },
  ],
};
