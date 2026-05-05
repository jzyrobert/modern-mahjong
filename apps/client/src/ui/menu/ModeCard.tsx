import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

interface ModeCardProps {
  title: string;
  subtitle: string;
  icon: ReactNode;
  /** Highlights the card with an accent border + RECOMMENDED badge.
   *  Used for the Online card, which is the primary entry point. */
  accent?: boolean;
  children: ReactNode;
}

const COLORS = {
  ink: '#3a3328',
  ink3: '#918275',
  red: '#b14d3a',
  paperHi: '#fbf8f0',
  hairline: '#cdc1ad',
  accentBorder: '#ec9275',
  accentSwatch: '#fbe5d9',
  accentSwatchEdge: '#d8b09f',
  neutralSwatch: '#ede5d3',
};

/**
 * Lobby mode card — coloured icon swatch in a circle, title +
 * optional RECOMMENDED badge, subtitle, and free-form children
 * underneath (the per-mode controls). Used by the Online / Practice /
 * LAN entries in `<ModeGrid>`. Split out of `Lobby.tsx` so adding a
 * fourth mode card in future doesn't require touching the screen
 * orchestrator.
 */
export function ModeCard({ title, subtitle, icon, accent = false, children }: ModeCardProps) {
  return (
    <View
      style={{
        backgroundColor: COLORS.paperHi,
        borderColor: accent ? COLORS.accentBorder : COLORS.hairline,
        borderWidth: 1,
        borderRadius: 16,
        padding: 22,
        gap: 12,
        flexBasis: 0,
        flexGrow: 1,
        minWidth: 280,
        boxShadow: '0px 2px 6px rgba(0,0,0,0.04)',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            backgroundColor: accent ? COLORS.accentSwatch : COLORS.neutralSwatch,
            borderColor: accent ? COLORS.accentSwatchEdge : COLORS.hairline,
            borderWidth: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '900', color: COLORS.ink, lineHeight: 18 }}>
              {title}
            </Text>
            {accent ? <RecommendedBadge /> : null}
          </View>
          <Text
            style={{
              fontSize: 12,
              color: COLORS.ink3,
              marginTop: 2,
              fontWeight: '600',
            }}
          >
            {subtitle}
          </Text>
        </View>
      </View>
      {children}
    </View>
  );
}

/**
 * The grid wrapper around the mode cards. Equivalent of the legacy
 * `repeat(auto-fit, minmax(280px, 1fr))`: row + wrap with each child
 * `flex: 1 1 0; min-width: 280`. Children grow to fill available
 * width, wrapping to a new row whenever another 280-min card no
 * longer fits — so on portrait phones each card occupies its own
 * full-width row, and on desktop three fit side-by-side. The
 * earlier column-direction branch combined wrap with `flex-basis: 0`
 * on children and produced overlapping cards on narrow viewports —
 * see #86 for the bug repro.
 */
export function ModeGrid({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        maxWidth: 1080,
        width: '100%',
        alignSelf: 'center',
        paddingHorizontal: 28,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'stretch',
          gap: 14,
        }}
      >
        {children}
      </View>
    </View>
  );
}

function RecommendedBadge() {
  return (
    <View
      style={{
        backgroundColor: COLORS.accentSwatch,
        borderColor: COLORS.accentSwatchEdge,
        borderWidth: 1,
        borderRadius: 6,
        paddingHorizontal: 7,
        paddingVertical: 3,
      }}
    >
      <Text
        style={{
          color: COLORS.red,
          fontSize: 9,
          fontWeight: '900',
          letterSpacing: 0.7,
        }}
      >
        RECOMMENDED
      </Text>
    </View>
  );
}
