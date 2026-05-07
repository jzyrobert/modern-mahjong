/**
 * Catalog of every scoring pattern the engine knows how to detect, in
 * a form a UI can read directly. Each entry pairs the canonical 中文
 * + English name with the fan value, a one-line description of when
 * it fires, and a worked example: a hand the engine would actually
 * score the pattern on.
 *
 * The catalog is the source of truth for the in-app "Scoring rules"
 * sheet. Pattern names + fan values must match `scoring.ts` exactly —
 * a mismatch here is a UI bug masquerading as engine drift.
 */

import type { MeldKind } from './hand.js';
import type { Tile } from './tiles.js';

export type ScoringRuleCategory =
  | 'win-condition' // self-draw, concealed, kong-replacement, last-tile, robbing-the-kong
  | 'composition' // flush variants + nine gates + all-honors + terminals
  | 'honors' // dragons / winds / yakuhai
  | 'shape' // 七對子, 十三幺, 對對和, 平和, 四暗刻, 四槓子
  | 'blessing'; // 天/地/人糊

export interface ExampleMeld {
  kind: MeldKind;
  tiles: Tile[];
}

export interface ScoringRuleExample {
  /** Concealed tiles (not including the winning tile). */
  concealed: Tile[];
  /** Exposed melds, if any. Empty array for fully-concealed examples. */
  melds: ExampleMeld[];
  /** The tile that completed the hand. */
  winningTile: Tile;
  /** Optional context note rendered alongside the hand. */
  note?: string;
}

export interface ScoringRule {
  /** Traditional Chinese name (e.g. 自摸). */
  name: string;
  /** Short English gloss (e.g. "self-draw"). */
  english: string;
  /** Fan contributed when this pattern fires. */
  faan: number;
  /** Category for grouping in the UI. */
  category: ScoringRuleCategory;
  /** One-line plain-English explanation of the trigger condition. */
  description: string;
  /** A representative hand the engine would score this pattern on. */
  example: ScoringRuleExample;
}

// Local helpers — the catalog uses these to keep example hands
// readable. Copy index is fixed at 0 for display purposes; the
// engine's `sameFace` is what scoring uses, so the copy doesn't
// affect any pattern detection.
function s(suit: 'man' | 'pin' | 'sou', rank: number): Tile {
  return { kind: 'suit', suit, rank: rank as 1, copy: 0 };
}
function h(honor: 'E' | 'S' | 'W' | 'N' | 'Z' | 'F' | 'B'): Tile {
  return { kind: 'honor', honor, copy: 0 };
}
function chi(suit: 'man' | 'pin' | 'sou', start: number): ExampleMeld {
  return { kind: 'chi', tiles: [s(suit, start), s(suit, start + 1), s(suit, start + 2)] };
}
function peng(t: Tile): ExampleMeld {
  return { kind: 'peng', tiles: [t, t, t] };
}
function gangExposed(t: Tile): ExampleMeld {
  return { kind: 'gang-exposed', tiles: [t, t, t, t] };
}
function gangConcealed(t: Tile): ExampleMeld {
  return { kind: 'gang-concealed', tiles: [t, t, t, t] };
}

// Three concealed sequences across the suits — the most common
// "boring filler" that lets the *interesting* part of an example
// hand stand out. 1m-2m-3m, 4p-5p-6p, 7s-8s-9s.
const CROSS_SUIT_STRAIGHTS: Tile[] = [
  s('man', 1),
  s('man', 2),
  s('man', 3),
  s('pin', 4),
  s('pin', 5),
  s('pin', 6),
  s('sou', 7),
  s('sou', 8),
  s('sou', 9),
];

// Vanilla 13-tile concealed used as the worked example for any
// pattern that doesn't constrain the rest of the hand: the three
// cross-suit straights + a 5m pair + a 2p pair, winning on 2p.
const VANILLA_CONCEALED: Tile[] = [
  ...CROSS_SUIT_STRAIGHTS,
  s('man', 5),
  s('man', 5),
  s('pin', 2),
  s('pin', 2),
];

// 13-tile concealed used by patterns that pin one specific honor
// triplet (三元牌, 圈風, 門風): cross-suit straights + the triplet
// + the 2p winning pair.
function straightsWithHonorTriplet(honor: 'E' | 'S' | 'W' | 'N' | 'Z' | 'F' | 'B'): Tile[] {
  return [...CROSS_SUIT_STRAIGHTS, h(honor), h(honor), h(honor), s('pin', 2)];
}

export const SCORING_RULES: ScoringRule[] = [
  // — Win conditions ——————————————————————————————————————————————
  {
    name: '自摸',
    english: 'Self-draw',
    faan: 1,
    category: 'win-condition',
    description: 'Win on a tile you drew yourself rather than on an opponent’s discard.',
    example: {
      concealed: VANILLA_CONCEALED,
      melds: [],
      winningTile: s('pin', 2),
      note: 'Drawn from the wall.',
    },
  },
  {
    name: '門前清',
    english: 'Concealed hand',
    faan: 1,
    category: 'win-condition',
    description:
      'No claimed melds — the entire hand stayed in your concealed tiles, regardless of self-draw or ron.',
    example: {
      concealed: VANILLA_CONCEALED,
      melds: [],
      winningTile: s('pin', 2),
    },
  },
  {
    name: '槓上開花',
    english: 'Kong replacement',
    faan: 2,
    category: 'win-condition',
    description: 'Self-draw the replacement tile right after declaring a gang.',
    example: {
      concealed: [
        s('man', 1),
        s('man', 2),
        s('man', 3),
        s('pin', 4),
        s('pin', 5),
        s('pin', 6),
        s('sou', 7),
        s('sou', 8),
        s('sou', 9),
        s('pin', 2),
        s('pin', 2),
      ],
      melds: [gangConcealed(s('man', 5))],
      winningTile: s('pin', 2),
      note: 'Drawn from the dead wall after the gang.',
    },
  },
  {
    name: '槓上槓',
    english: 'Double kong replacement',
    faan: 9,
    category: 'win-condition',
    description:
      'Self-draw the replacement of a second gang declared back-to-back, without an intervening discard.',
    example: {
      concealed: [
        s('man', 1),
        s('man', 2),
        s('man', 3),
        s('pin', 4),
        s('pin', 5),
        s('pin', 6),
        s('pin', 2),
        s('pin', 2),
      ],
      melds: [gangConcealed(s('man', 5)), gangConcealed(s('sou', 7))],
      winningTile: s('pin', 2),
      note: 'Two gangs, then the second replacement completes the hand.',
    },
  },
  {
    name: '海底撈月',
    english: 'Last tile',
    faan: 1,
    category: 'win-condition',
    description:
      'Win on the very last live-wall draw or discard before the hand would have run out of tiles.',
    example: {
      concealed: VANILLA_CONCEALED,
      melds: [],
      winningTile: s('pin', 2),
      note: 'Wall is empty after this tile is taken.',
    },
  },
  {
    name: '搶槓',
    english: 'Robbing the kong',
    faan: 1,
    category: 'win-condition',
    description:
      'Ron an opponent’s 4th tile before it lands in their promoted gang. Only promoted-from-peng gangs are robbable.',
    example: {
      concealed: [
        s('man', 1),
        s('man', 2),
        s('man', 3),
        s('pin', 4),
        s('pin', 6),
        s('sou', 7),
        s('sou', 8),
        s('sou', 9),
        s('man', 5),
        s('man', 5),
        s('pin', 2),
        s('pin', 2),
        h('S'),
      ],
      melds: [],
      winningTile: s('pin', 5),
      note: 'Robs the 5p mid-promotion to complete 4p-5p-6p.',
    },
  },
  {
    name: '平和',
    english: 'All sequences',
    faan: 1,
    category: 'win-condition',
    description:
      'Four sequences plus a pair that isn’t a yakuhai (no dragons, prevailing wind, or seat wind).',
    example: {
      concealed: [
        s('man', 1),
        s('man', 2),
        s('man', 3),
        s('man', 4),
        s('man', 5),
        s('man', 6),
        s('pin', 1),
        s('pin', 2),
        s('pin', 3),
        s('pin', 9),
      ],
      melds: [chi('sou', 4)],
      winningTile: s('pin', 9),
    },
  },

  // — Tile composition ——————————————————————————————————————————
  {
    name: '混一色',
    english: 'Half flush',
    faan: 3,
    category: 'composition',
    description: 'One suit plus honors only — no tiles from the other two suits.',
    example: {
      concealed: [
        s('man', 1),
        s('man', 2),
        s('man', 3),
        s('man', 4),
        s('man', 5),
        s('man', 6),
        s('man', 7),
        s('man', 8),
        s('man', 9),
        h('E'),
        h('E'),
        h('E'),
        h('S'),
      ],
      melds: [],
      winningTile: h('S'),
    },
  },
  {
    name: '清一色',
    english: 'Full flush',
    faan: 7,
    category: 'composition',
    description: 'Every tile from a single suit — no honors, no other suits.',
    example: {
      concealed: [
        s('man', 1),
        s('man', 2),
        s('man', 3),
        s('man', 4),
        s('man', 5),
        s('man', 6),
        s('man', 7),
        s('man', 8),
        s('man', 9),
        s('man', 2),
        s('man', 3),
        s('man', 4),
        s('man', 5),
      ],
      melds: [],
      winningTile: s('man', 5),
    },
  },
  {
    name: '九蓮寶燈',
    english: 'Nine gates',
    faan: 13,
    category: 'composition',
    description:
      'A fully-concealed 1112345678999 of one suit, plus any one extra of the same suit. The 9-tile wait makes this one of the rarest hands in the game.',
    example: {
      concealed: [
        s('pin', 1),
        s('pin', 1),
        s('pin', 1),
        s('pin', 2),
        s('pin', 3),
        s('pin', 4),
        s('pin', 5),
        s('pin', 6),
        s('pin', 7),
        s('pin', 8),
        s('pin', 9),
        s('pin', 9),
        s('pin', 9),
      ],
      melds: [],
      winningTile: s('pin', 5),
    },
  },
  {
    name: '混么九',
    english: 'Mixed terminals & honors',
    faan: 4,
    category: 'composition',
    description: 'Every tile is a 1, a 9, or an honor. Mixing terminals with at least one honor.',
    example: {
      concealed: [
        s('man', 1),
        s('man', 1),
        s('man', 1),
        s('pin', 9),
        s('pin', 9),
        s('pin', 9),
        s('sou', 1),
        s('sou', 1),
        s('sou', 1),
        h('E'),
        h('E'),
        h('E'),
        h('Z'),
      ],
      melds: [],
      winningTile: h('Z'),
    },
  },
  {
    name: '清么九',
    english: 'All terminals',
    faan: 13,
    category: 'composition',
    description: 'Only 1s and 9s — no honors, no middle tiles.',
    example: {
      concealed: [
        s('man', 1),
        s('man', 1),
        s('man', 1),
        s('man', 9),
        s('man', 9),
        s('man', 9),
        s('pin', 1),
        s('pin', 1),
        s('pin', 1),
        s('sou', 9),
        s('sou', 9),
        s('sou', 9),
        s('pin', 9),
      ],
      melds: [],
      winningTile: s('pin', 9),
    },
  },
  {
    name: '字一色',
    english: 'All honors',
    faan: 10,
    category: 'composition',
    description: 'Every tile is a wind or dragon — no suit tiles at all.',
    example: {
      concealed: [
        h('E'),
        h('E'),
        h('E'),
        h('S'),
        h('S'),
        h('S'),
        h('W'),
        h('W'),
        h('W'),
        h('Z'),
        h('Z'),
        h('Z'),
        h('F'),
      ],
      melds: [],
      winningTile: h('F'),
    },
  },

  // — Honors patterns ———————————————————————————————————————————
  {
    name: '三元牌',
    english: 'Dragon triplet',
    faan: 1,
    category: 'honors',
    description:
      'A triplet (or gang) of any dragon — 中, 發, or 白. Stacks per dragon and on top of 大三元 / 小三元.',
    example: {
      concealed: straightsWithHonorTriplet('Z'),
      melds: [],
      winningTile: s('pin', 2),
    },
  },
  {
    name: '小三元',
    english: 'Small three dragons',
    faan: 5,
    category: 'honors',
    description:
      'Two dragon triplets plus a pair of the third dragon. Each dragon triplet still adds its own +1.',
    example: {
      concealed: [
        h('Z'),
        h('Z'),
        h('Z'),
        h('F'),
        h('F'),
        h('F'),
        h('B'),
        h('B'),
        s('man', 1),
        s('man', 2),
        s('man', 3),
        s('pin', 5),
        s('pin', 5),
      ],
      melds: [],
      winningTile: s('pin', 5),
    },
  },
  {
    name: '大三元',
    english: 'Big three dragons',
    faan: 8,
    category: 'honors',
    description:
      'Triplets of all three dragons. Each dragon triplet still adds its own +1, so the total yield is +11.',
    example: {
      concealed: [
        h('Z'),
        h('Z'),
        h('Z'),
        h('F'),
        h('F'),
        h('F'),
        h('B'),
        h('B'),
        h('B'),
        s('man', 1),
        s('man', 2),
        s('pin', 5),
        s('pin', 5),
      ],
      melds: [],
      winningTile: s('man', 3),
    },
  },
  {
    name: '圈風',
    english: 'Prevailing-wind triplet',
    faan: 1,
    category: 'honors',
    description:
      'A triplet of the prevailing (round) wind. Stacks with 門風 when seat wind is also the prevailing wind.',
    example: {
      concealed: straightsWithHonorTriplet('E'),
      melds: [],
      winningTile: s('pin', 2),
      note: 'Prevailing wind is East.',
    },
  },
  {
    name: '門風',
    english: 'Seat-wind triplet',
    faan: 1,
    category: 'honors',
    description:
      'A triplet of your own seat wind. When seat wind matches the prevailing wind, both fire (+2 total).',
    example: {
      concealed: straightsWithHonorTriplet('S'),
      melds: [],
      winningTile: s('pin', 2),
      note: 'Winning seat is South.',
    },
  },
  {
    name: '小四喜',
    english: 'Small four winds',
    faan: 6,
    category: 'honors',
    description: 'Three wind triplets plus a pair of the fourth wind.',
    example: {
      concealed: [
        h('E'),
        h('E'),
        h('E'),
        h('S'),
        h('S'),
        h('S'),
        h('W'),
        h('W'),
        h('W'),
        h('N'),
        h('N'),
        s('man', 5),
        s('man', 5),
      ],
      melds: [],
      winningTile: s('man', 5),
    },
  },
  {
    name: '大四喜',
    english: 'Big four winds',
    faan: 13,
    category: 'honors',
    description: 'Triplets of all four winds plus any pair.',
    example: {
      concealed: [
        h('E'),
        h('E'),
        h('E'),
        h('S'),
        h('S'),
        h('S'),
        h('W'),
        h('W'),
        h('W'),
        h('N'),
        h('N'),
        h('N'),
        s('man', 5),
      ],
      melds: [],
      winningTile: s('man', 5),
    },
  },

  // — Special shapes ——————————————————————————————————————————
  {
    name: '對對和',
    english: 'All triplets',
    faan: 3,
    category: 'shape',
    description:
      'Four triplets (or gangs) plus a pair — no sequences. Suppressed when stronger triplet patterns like 字一色 fire.',
    example: {
      concealed: [
        s('man', 1),
        s('man', 1),
        s('man', 1),
        s('pin', 4),
        s('pin', 4),
        s('pin', 4),
        h('E'),
        h('E'),
        h('E'),
        s('pin', 9),
      ],
      melds: [peng(s('sou', 7))],
      winningTile: s('pin', 9),
    },
  },
  {
    name: '七對子',
    english: 'Seven pairs',
    faan: 4,
    category: 'shape',
    description:
      'Seven distinct pairs in a fully-concealed hand. Replaces the standard 4-sets-and-a-pair shape.',
    example: {
      concealed: [
        s('man', 1),
        s('man', 1),
        s('man', 5),
        s('man', 5),
        s('pin', 3),
        s('pin', 3),
        s('pin', 7),
        s('pin', 7),
        s('sou', 2),
        s('sou', 2),
        s('sou', 8),
        s('sou', 8),
        h('Z'),
      ],
      melds: [],
      winningTile: h('Z'),
    },
  },
  {
    name: '十三幺',
    english: 'Thirteen orphans',
    faan: 13,
    category: 'shape',
    description:
      'One of each terminal (1m, 9m, 1p, 9p, 1s, 9s) and each honor (E, S, W, N, 中, 發, 白), with one of them paired up.',
    example: {
      concealed: [
        s('man', 1),
        s('man', 9),
        s('pin', 1),
        s('pin', 9),
        s('sou', 1),
        s('sou', 9),
        h('E'),
        h('S'),
        h('W'),
        h('N'),
        h('Z'),
        h('F'),
        h('B'),
      ],
      melds: [],
      winningTile: s('man', 1),
      note: 'Win on any of the 13 faces — that face becomes the pair.',
    },
  },
  {
    name: '四暗刻',
    english: 'All concealed triplets',
    faan: 8,
    category: 'shape',
    description:
      'Four concealed triplets plus a pair. No exposed melds, and on a ron win the discard must complete the pair (otherwise only 三暗刻).',
    example: {
      concealed: [
        s('man', 1),
        s('man', 1),
        s('man', 1),
        s('pin', 4),
        s('pin', 4),
        s('pin', 4),
        s('sou', 7),
        s('sou', 7),
        s('sou', 7),
        h('E'),
        h('E'),
        h('E'),
        s('pin', 9),
      ],
      melds: [],
      winningTile: s('pin', 9),
      note: 'Self-drawn so all four triplets stay concealed.',
    },
  },
  {
    name: '四槓子',
    english: 'All gangs',
    faan: 13,
    category: 'shape',
    description: 'Four gangs (any mix of concealed / exposed / promoted) plus a pair.',
    example: {
      concealed: [s('pin', 9), s('pin', 9)],
      melds: [
        gangConcealed(s('man', 1)),
        gangExposed(s('pin', 4)),
        gangConcealed(s('sou', 7)),
        gangExposed(h('E')),
      ],
      winningTile: s('pin', 9),
    },
  },

  // — Blessing limit hands ———————————————————————————————————————
  {
    name: '天糊',
    english: 'Blessing of heaven',
    faan: 13,
    category: 'blessing',
    description: 'Dealer wins on the opening 14-tile self-draw — before anyone has discarded.',
    example: {
      concealed: VANILLA_CONCEALED,
      melds: [],
      winningTile: s('pin', 2),
    },
  },
  {
    name: '地糊',
    english: 'Blessing of earth',
    faan: 13,
    category: 'blessing',
    description:
      'Non-dealer wins on the dealer’s very first discard — before any other tile has been pitched.',
    example: {
      concealed: VANILLA_CONCEALED,
      melds: [],
      winningTile: s('pin', 2),
    },
  },
  {
    name: '人糊',
    english: 'Blessing of man',
    faan: 13,
    category: 'blessing',
    description:
      'Non-dealer wins on their own first self-draw — before they’ve discarded anything.',
    example: {
      concealed: VANILLA_CONCEALED,
      melds: [],
      winningTile: s('pin', 2),
    },
  },
];
