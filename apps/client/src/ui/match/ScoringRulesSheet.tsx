import {
  type ExampleMeld,
  type Tile as MTile,
  SCORING_RULES,
  type ScoringRule,
  type ScoringRuleCategory,
  tileId,
} from '@mahjong/game-logic';
import { ScrollView, Text, View } from 'react-native';
import { Modal } from '../Modal';
import { Tile } from '../Tile';
import { COLORS } from '../colors';

interface ScoringRulesSheetProps {
  open: boolean;
  onClose: () => void;
}

/** Display order for the category headings — matches the rule sheet's
 *  natural progression: how you win → what your hand looks like →
 *  honors-driven bonuses → exotic shapes → limit hands. */
const CATEGORY_ORDER: ScoringRuleCategory[] = [
  'win-condition',
  'composition',
  'honors',
  'shape',
  'blessing',
];

const CATEGORY_LABEL: Record<ScoringRuleCategory, { title: string; subtitle: string }> = {
  'win-condition': {
    title: 'How you won',
    subtitle: 'Bonuses tied to the moment of winning rather than tile composition.',
  },
  composition: {
    title: 'Suits & terminals',
    subtitle: 'Bonuses for restricting which tiles can appear in the hand.',
  },
  honors: {
    title: 'Dragons & winds',
    subtitle: 'Bonuses driven by triplets of honor tiles.',
  },
  shape: {
    title: 'Shape & structure',
    subtitle: 'Bonuses for non-standard or fully-concealed groupings.',
  },
  blessing: {
    title: 'Blessing hands',
    subtitle: 'Limit hands that fire only in the very first round of play.',
  },
};

/**
 * Bottom-sheet wrapper around the full scoring catalog. Opens from the
 * ☰ menu's "Scoring rules" row. Each entry pairs the 中文 name +
 * English gloss + fan value with a one-line trigger description and a
 * worked example — the concealed tiles, any exposed melds, and the
 * highlighted winning tile.
 *
 * The catalog itself lives in `@mahjong/game-logic/scoring-catalog`
 * so the names + fan values stay in lockstep with `scoring.ts`. This
 * component is purely presentational.
 */
export function ScoringRulesSheet({ open, onClose }: ScoringRulesSheetProps) {
  return (
    <Modal open={open} title="Scoring rules" onClose={onClose} placement="bottom" maxWidth={620}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 28, gap: 22 }}>
        <Text style={{ fontSize: 12, color: COLORS.ink3, fontWeight: '600', lineHeight: 18 }}>
          Hong Kong mahjong scores in fan (番): each pattern below contributes its fan value to the
          winning hand's total, and patterns can stack (e.g. 自摸 + 門前清 + 平和 = 3 fan). The
          lobby's faan-min setting is the floor a winning hand must clear.
        </Text>
        {CATEGORY_ORDER.map((cat) => {
          const rules = SCORING_RULES.filter((r) => r.category === cat).sort(
            (a, b) => a.faan - b.faan,
          );
          if (rules.length === 0) return null;
          const meta = CATEGORY_LABEL[cat];
          return (
            <View key={cat} style={{ gap: 10 }}>
              <View style={{ gap: 2 }}>
                <Text style={{ fontWeight: '900', fontSize: 14, color: COLORS.ink2 }}>
                  {meta.title}
                </Text>
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: '600',
                    color: COLORS.ink3,
                    lineHeight: 15,
                  }}
                >
                  {meta.subtitle}
                </Text>
              </View>
              <View style={{ gap: 12 }}>
                {rules.map((r) => (
                  <RuleCard key={`${r.name}-${r.english}`} rule={r} />
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>
      <View style={{ height: 8 }} />
    </Modal>
  );
}

function RuleCard({ rule }: { rule: ScoringRule }) {
  return (
    <View
      style={{
        gap: 8,
        padding: 12,
        backgroundColor: COLORS.cream,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 12,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <Text style={{ fontWeight: '900', fontSize: 16, color: COLORS.ink }}>{rule.name}</Text>
        <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.ink3 }}>{rule.english}</Text>
        <View style={{ flex: 1 }} />
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 999,
            backgroundColor: '#ede5d3',
            borderColor: COLORS.hairline,
            borderWidth: 1,
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: '900', color: COLORS.ink2 }}>
            +{rule.faan} fan
          </Text>
        </View>
      </View>
      <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.ink2, lineHeight: 17 }}>
        {rule.description}
      </Text>
      <ExampleHand
        concealed={rule.example.concealed}
        melds={rule.example.melds}
        winningTile={rule.example.winningTile}
        note={rule.example.note}
      />
    </View>
  );
}

interface ExampleHandProps {
  concealed: MTile[];
  melds: ExampleMeld[];
  winningTile: MTile;
  note?: string | undefined;
}

/**
 * Renders an example hand as: a row of concealed-tile faces, the
 * highlighted winning tile separated by a small gap, and any exposed
 * melds laid out underneath. No interactivity — this is pure
 * documentation. The tiles use small 24×34 dimensions so a 14-tile
 * hand fits across a 320 px iPhone SE viewport without wrapping.
 */
function ExampleHand({ concealed, melds, winningTile, note }: ExampleHandProps) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
        {concealed.map((t, i) => (
          <Tile key={`c-${i}-${tileId(t)}`} tile={t} width={24} height={34} />
        ))}
        <View style={{ width: 6 }} />
        <View
          style={{
            padding: 2,
            borderRadius: 4,
            backgroundColor: '#fff5d6',
            borderColor: '#d4a73a',
            borderWidth: 1,
          }}
        >
          <Tile tile={winningTile} width={24} height={34} />
        </View>
      </View>
      {melds.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {melds.map((m, i) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: melds are append-only per example
              key={`m-${i}`}
              style={{
                flexDirection: 'row',
                gap: 1,
                backgroundColor: COLORS.creamLow,
                borderColor: COLORS.hairline,
                borderWidth: 1,
                borderRadius: 4,
                padding: 2,
              }}
            >
              {m.tiles.map((t, j) => (
                <Tile key={`m-${i}-${j}-${tileId(t)}`} tile={t} width={20} height={28} />
              ))}
              <Text
                style={{
                  fontSize: 8,
                  fontWeight: '700',
                  color: '#918275',
                  alignSelf: 'flex-end',
                  paddingLeft: 4,
                }}
              >
                {m.kind.toUpperCase()}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {note ? (
        <Text style={{ fontSize: 10, fontWeight: '600', color: COLORS.ink3, fontStyle: 'italic' }}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}
