import {
  HONORS,
  type Honor,
  type Tile as MTile,
  RANKS,
  SUITS,
  type Suit,
  type SuitRank,
} from '@mahjong/game-logic';
import { Text, View } from 'react-native';
import { Tile } from '../Tile';

interface TileGroup {
  title: string;
  info: string;
  tiles: MTile[];
}

const ALL_FACES: MTile[] = (() => {
  const out: MTile[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      out.push({ kind: 'suit', suit, rank: rank as SuitRank, copy: 0 });
    }
  }
  for (const honor of HONORS) {
    out.push({ kind: 'honor', honor: honor as Honor, copy: 0 });
  }
  return out;
})();

const SUIT_LABEL: Record<Suit, { title: string; info: string }> = {
  man: { title: 'Characters · 萬子 (Man)', info: '36 tiles · 9 unique × 4' },
  pin: { title: 'Dots · 筒子 (Pin)', info: '36 tiles · 9 unique × 4' },
  sou: { title: 'Bamboo · 索子 (Sou)', info: '36 tiles · 9 unique × 4' },
};

const COLORS = {
  ink2: '#65594c',
  ink3: '#918275',
  paper: '#f1eadc',
};

/**
 * 136-tile reference grouped by suit + honor family. Each group lists the
 * unique faces (one tile per face) at a 32×44 footprint, with a
 * ×4 multiplicity hint underneath. Used inside the bottom-sheet
 * reference modal opened from the match `TopBar`.
 */
export function TileReference() {
  const groups: TileGroup[] = [
    ...SUITS.map((s) => ({
      ...SUIT_LABEL[s],
      tiles: ALL_FACES.filter((t) => t.kind === 'suit' && t.suit === s),
    })),
    {
      title: 'Winds · 風牌',
      info: '16 tiles · 4 winds × 4',
      tiles: ALL_FACES.filter((t) => t.kind === 'honor' && 'ESWN'.includes(t.honor)),
    },
    {
      title: 'Dragons · 三元牌',
      info: '12 tiles · 3 dragons × 4',
      tiles: ALL_FACES.filter((t) => t.kind === 'honor' && 'ZFB'.includes(t.honor)),
    },
  ];

  return (
    <View style={{ gap: 18 }}>
      {groups.map((g) => (
        <View key={g.title} style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{ fontWeight: '900', fontSize: 13, color: COLORS.ink2 }}>{g.title}</Text>
            <Text style={{ fontSize: 10, fontWeight: '600', color: COLORS.ink3 }}>{g.info}</Text>
          </View>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 8,
              padding: 12,
              backgroundColor: COLORS.paper,
              borderRadius: 12,
            }}
          >
            {g.tiles.map((t) => (
              <View
                key={tileKey(t)}
                style={{
                  alignItems: 'center',
                  gap: 4,
                  width: 36,
                }}
              >
                <Tile tile={t} width={32} height={44} />
                <Text style={{ fontSize: 9, fontWeight: '700', color: COLORS.ink3 }}>×4</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function tileKey(t: MTile): string {
  if (t.kind === 'suit') return `${t.suit}-${t.rank}`;
  return `honor-${t.honor}`;
}
