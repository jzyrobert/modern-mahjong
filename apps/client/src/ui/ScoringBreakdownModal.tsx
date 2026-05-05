import type { FaanBreakdown, HandResult, Tile as MTile } from '@mahjong/game-logic';
import { ScrollView, Text, View } from 'react-native';
import { Modal } from './Modal';
import { Tile } from './Tile';

type WinResult = Extract<HandResult, { kind: 'win' }>;

interface ScoringBreakdownModalProps {
  open: boolean;
  onClose: () => void;
  result: WinResult;
  faanMin: number;
}

const COLORS = {
  ink: '#3a3328',
  ink2: '#65594c',
  ink3: '#918275',
  hairline: '#cdc1ad',
  cream: '#f1eadc',
  red: '#b14d3a',
  green: '#58c280',
};

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
}: ScoringBreakdownModalProps) {
  const { winner, from, selfDraw, tile, faan, breakdown } = result;
  return (
    <Modal
      open={open}
      title={`Seat ${winner} wins — ${faan} faan`}
      onClose={onClose}
      maxWidth={520}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 18,
          paddingTop: 14,
          paddingBottom: 8,
        }}
      >
        <Text style={{ fontSize: 12, color: COLORS.ink2, fontWeight: '700', flex: 1 }}>
          {selfDraw ? 'Self-draw (tsumo)' : `Discarded by seat ${from}`}
          {' · '}Min faan: {faanMin}
        </Text>
        <Tile tile={tile} width={28} height={38} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 18, gap: 8 }}>
        {breakdown.length === 0 ? (
          <Text style={{ fontSize: 12, color: COLORS.ink3, fontWeight: '600', paddingVertical: 8 }}>
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
              />
            ))}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderTopWidth: 2,
                borderColor: COLORS.ink,
                paddingTop: 10,
                marginTop: 4,
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '900', color: COLORS.ink }}>Total</Text>
              <Text style={{ fontSize: 14, fontWeight: '900', color: COLORS.green }}>+{faan}</Text>
            </View>
          </>
        )}
      </ScrollView>
    </Modal>
  );
}

function BreakdownRow({ entry }: { entry: FaanBreakdown }) {
  return (
    <View
      style={{
        gap: 6,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderColor: COLORS.hairline,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 13, fontWeight: '800', color: COLORS.ink }}>{entry.name}</Text>
        <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '600', flex: 1 }}>
          {entry.english}
        </Text>
        <Text style={{ fontSize: 13, fontWeight: '900', color: COLORS.green }}>+{entry.faan}</Text>
      </View>
      {entry.tiles.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
          {entry.tiles.map((t: MTile, i: number) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: tile composition order is engine-defined; duplicates are intentional
            <Tile key={i} tile={t} width={20} height={28} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
