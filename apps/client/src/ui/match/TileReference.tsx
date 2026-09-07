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
import { COLORS } from '../colors';
import { type SheetTheme, microLabel, sheetPalette } from './sheetTheme';

interface TileGroup {
  title: string;
  /** Chinese suit / family name, set in Noto Serif TC on glass. */
  han: string;
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

const SUIT_LABEL: Record<Suit, { title: string; han: string; info: string }> = {
  man: { title: 'Characters (Man)', han: '萬子', info: '36 tiles · 9 unique × 4' },
  pin: { title: 'Dots (Pin)', han: '筒子', info: '36 tiles · 9 unique × 4' },
  sou: { title: 'Bamboo (Sou)', han: '索子', info: '36 tiles · 9 unique × 4' },
};

/** The paper heading keeps its original "Characters · 萬子 (Man)" form. */
function paperTitle(g: TileGroup): string {
  const m = g.title.match(/^(.*?)(?: \((.*)\))?$/);
  const english = m?.[1] ?? g.title;
  const paren = m?.[2];
  return paren ? `${english} · ${g.han} (${paren})` : `${english} · ${g.han}`;
}

/**
 * 136-tile reference grouped by suit + honor family. Each group lists the
 * unique faces (one tile per face) at a 32×44 footprint, with a
 * ×4 multiplicity hint underneath. Used inside the bottom-sheet
 * reference modal opened from the match `TopBar`.
 *
 * On glass the groups sit on felt-dark cards under a glass header —
 * ivory `Tile` faces on dark felt, the way they read on the 3D table.
 */
export function TileReference({ theme = 'paper' }: { theme?: SheetTheme }) {
  const glass = theme === 'glass';
  const P = sheetPalette(theme);
  const groups: TileGroup[] = [
    ...SUITS.map((s) => ({
      ...SUIT_LABEL[s],
      tiles: ALL_FACES.filter((t) => t.kind === 'suit' && t.suit === s),
    })),
    {
      title: 'Winds',
      han: '風牌',
      info: '16 tiles · 4 winds × 4',
      tiles: ALL_FACES.filter((t) => t.kind === 'honor' && 'ESWN'.includes(t.honor)),
    },
    {
      title: 'Dragons',
      han: '三元牌',
      info: '12 tiles · 3 dragons × 4',
      tiles: ALL_FACES.filter((t) => t.kind === 'honor' && 'ZFB'.includes(t.honor)),
    },
  ];

  return (
    <View style={{ gap: glass ? 14 : 18 }}>
      {groups.map((g) => (
        <View
          key={g.title}
          style={
            glass
              ? {
                  borderRadius: 14,
                  overflow: 'hidden',
                  borderWidth: 1,
                  borderColor: P.border,
                  backgroundColor: P.surface,
                }
              : { gap: 8 }
          }
        >
          {glass ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 12,
                paddingVertical: 9,
                borderBottomWidth: 1,
                borderBottomColor: P.hairline,
              }}
            >
              <Text style={{ fontFamily: P.serif, fontSize: 15, lineHeight: 18, color: P.gold }}>
                {g.han}
              </Text>
              <Text style={{ ...microLabel(P.text), flexShrink: 1 }} numberOfLines={1}>
                {g.title}
              </Text>
              <Text
                style={{
                  fontSize: 11,
                  lineHeight: 13,
                  fontWeight: '600',
                  color: P.text3,
                  marginLeft: 'auto',
                }}
              >
                {g.info}
              </Text>
            </View>
          ) : (
            <View
              style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}
            >
              <Text style={{ fontWeight: '900', fontSize: 13, color: COLORS.ink2 }}>
                {paperTitle(g)}
              </Text>
              <Text style={{ fontSize: 10, fontWeight: '600', color: COLORS.ink3 }}>{g.info}</Text>
            </View>
          )}
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: glass ? 10 : 8,
              padding: 12,
              backgroundColor: P.feltCard,
              borderRadius: glass ? 0 : 12,
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
                <Tile tile={t} width={32} height={44} elevation={glass ? 'discard' : 'flat'} />
                <Text
                  style={{
                    fontSize: glass ? 10 : 9,
                    fontWeight: '700',
                    color: glass ? P.text2 : COLORS.ink3,
                  }}
                >
                  ×4
                </Text>
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
