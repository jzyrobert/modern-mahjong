import type { FaanBreakdown, HandResult, Tile as MTile } from '@mahjong/game-logic';
import { sortHand } from '@mahjong/game-logic';
import { ScrollView, Text, View } from 'react-native';
import { Modal } from './Modal';
import { Tile } from './Tile';
import { COLORS } from './colors';
import { type SheetPalette, type SheetTheme, microLabel, sheetPalette } from './match/sheetTheme';

type WinResult = Extract<HandResult, { kind: 'win' }>;

interface ScoringBreakdownModalProps {
  open: boolean;
  onClose: () => void;
  result: WinResult;
  faanMin: number;
  /** `paper` (default) is the classic cream dialog; `glass` is the 3D
   *  HUD's dark panel the `ResultVeil` opens it from — serif pattern
   *  names, gold faan deltas, tiles on a felt-dark strip. */
  theme?: SheetTheme;
}

/**
 * Per-pattern faan breakdown shown when a hand resolves to `kind: 'win'`.
 * Each row
 * carries the pattern name (Chinese), english gloss, the tiles that
 * triggered it (rendered as small face-up `<Tile>`s), and the faan
 * delta. A total row at the bottom sums to `result.faan`.
 *
 * Opens via `ResultPanel` when the active result is a win.
 */
export function ScoringBreakdownModal({
  open,
  onClose,
  result,
  faanMin,
  theme = 'paper',
}: ScoringBreakdownModalProps) {
  const { winner, from, selfDraw, tile, faan, breakdown } = result;
  const glass = theme === 'glass';
  const P = sheetPalette(theme);
  return (
    <Modal
      open={open}
      title={`Seat ${winner} wins — ${faan} faan`}
      onClose={onClose}
      maxWidth={520}
      variant={theme}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 18,
          paddingTop: 14,
          paddingBottom: glass ? 12 : 8,
        }}
      >
        <Text
          style={
            glass
              ? { ...microLabel(P.text2), flex: 1, lineHeight: 15 }
              : { fontSize: 12, color: COLORS.ink2, fontWeight: '700', flex: 1 }
          }
        >
          {selfDraw ? 'Self-draw (tsumo)' : `Discarded by seat ${from}`}
          {' · '}Min faan: {faanMin}
        </Text>
        <View
          style={
            glass
              ? {
                  padding: 3,
                  borderRadius: 6,
                  backgroundColor: 'rgba(216,168,90,0.22)',
                  borderWidth: 1,
                  borderColor: P.gold,
                  boxShadow: '0 0 12px rgba(216,168,90,0.5)',
                }
              : undefined
          }
        >
          <Tile tile={tile} width={28} height={38} />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 18, gap: 8 }}>
        {breakdown.length === 0 ? (
          <Text
            style={{
              fontSize: 12,
              color: glass ? P.text2 : COLORS.ink3,
              fontWeight: glass ? '500' : '600',
              paddingVertical: 8,
            }}
          >
            No bonus patterns — base hand only.
          </Text>
        ) : (
          <>
            {breakdown.map((b, i) => (
              <BreakdownRow
                // Stable per-row key — `name` alone isn't unique because
                // the engine can emit duplicate-named entries.
                key={`${b.name}-${i}`}
                entry={b}
                P={P}
                glass={glass}
              />
            ))}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderTopWidth: glass ? 1 : 2,
                borderColor: glass ? P.goldBorder : COLORS.ink,
                paddingTop: 10,
                marginTop: 4,
              }}
            >
              <Text
                style={
                  glass
                    ? microLabel(P.text)
                    : { fontSize: 14, fontWeight: '900', color: COLORS.ink }
                }
              >
                Total
              </Text>
              <Text
                style={{
                  fontSize: glass ? 18 : 14,
                  fontWeight: glass ? '800' : '900',
                  color: glass ? P.gold : COLORS.success,
                  fontVariant: ['tabular-nums'],
                }}
              >
                +{faan}
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </Modal>
  );
}

function BreakdownRow({
  entry,
  P,
  glass,
}: { entry: FaanBreakdown; P: SheetPalette; glass: boolean }) {
  // Sort the per-entry tiles into canonical hand-display order
  // (man < pin < sou < honors; rank ascending within suit). The engine
  // emits tiles in iteration order — concealed-then-exposed for full-
  // hand patterns like 清一色 / 天糊, which surface unsorted runs that
  // are hard for the user to read as "1-2-3, 4-5-6". Sorting here is
  // purely cosmetic; the engine's data shape is unchanged.
  const tiles = sortHand(entry.tiles);
  return (
    <View
      style={{
        gap: glass ? 8 : 6,
        paddingVertical: glass ? 10 : 8,
        borderBottomWidth: 1,
        borderColor: glass ? P.hairline : COLORS.hairline,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <Text
          style={{
            fontFamily: glass ? P.serif : undefined,
            fontSize: glass ? 16 : 13,
            fontWeight: glass ? '700' : '800',
            color: P.text,
          }}
        >
          {entry.name}
        </Text>
        <Text
          style={{
            fontSize: glass ? 12 : 11,
            color: glass ? P.text2 : COLORS.ink3,
            fontWeight: glass ? '500' : '600',
            flex: 1,
          }}
        >
          {entry.english}
        </Text>
        <Text
          style={{
            fontSize: glass ? 14 : 13,
            fontWeight: glass ? '800' : '900',
            color: glass ? P.gold : COLORS.success,
            fontVariant: ['tabular-nums'],
          }}
        >
          +{entry.faan}
        </Text>
      </View>
      {tiles.length > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 3,
            ...(glass && {
              padding: 6,
              borderRadius: 8,
              backgroundColor: P.feltCard,
              borderWidth: 1,
              borderColor: P.feltCardBorder,
              alignSelf: 'flex-start',
            }),
          }}
        >
          {tiles.map((t: MTile, i: number) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: sorted tile order is positional; duplicates of the same face are intentional
            <Tile key={i} tile={t} width={20} height={28} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
