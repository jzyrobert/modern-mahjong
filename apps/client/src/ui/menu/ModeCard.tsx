import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { COLORS as SHARED_COLORS } from '../colors';

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
  ...SHARED_COLORS,
  // Border for the salmon-accented "RECOMMENDED" card. Slightly
  // hotter than `accentSalmonEdge` (used for the swatch outline) so
  // the card edge reads from across the page; kept local because no
  // other surface uses this specific tone.
  accentBorder: '#ec9275',
  // Neutral icon-swatch background for non-accent cards.
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
            backgroundColor: accent ? COLORS.accentSalmonSwatch : COLORS.neutralSwatch,
            borderColor: accent ? COLORS.accentSalmonEdge : COLORS.hairline,
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
            {/* RECOMMENDED pill paused — restore by switching to:
                {accent ? <RecommendedBadge /> : null} */}
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

// RecommendedBadge — paused. To re-enable: re-add the function below
// and switch the render slot back to `{accent ? <RecommendedBadge /> : null}`.
// function RecommendedBadge() { ... }
