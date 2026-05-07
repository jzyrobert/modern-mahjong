import { Text, View, useWindowDimensions } from 'react-native';

const COLORS = {
  // Mahjong red dragon ink at ~6% — sits between paper #f1eadc and the
  // brand red #b14d3a so the chop reads as ink soaked into the page,
  // not as a separate decoration.
  chop: 'rgba(177, 77, 58, 0.06)',
};

/**
 * Quiet 中 (red-dragon tile) chop watermark behind the lobby — like a
 * calligrapher's seal pressed into the paper. Rotated slightly off
 * axis, anchored to the bottom-right with generous bleed so the
 * silhouette reads even when the glyph itself is muted. Suppressed on
 * narrow phone widths where the character would crowd the mode cards
 * and the visual debt outweighs the atmospheric gain.
 *
 * The corner anchor (vs centred) is deliberate: a centred mark
 * fights the WindEmblem hero, but tucked into the lower right it
 * reinforces the "this is mahjong paper" frame without competing.
 */
export function LobbyWatermark() {
  const { width, height } = useWindowDimensions();
  if (width < 560) return null;
  // 70% of the shorter axis — large enough to dominate the dead space
  // below the mode cards on tall viewports without spilling past the
  // ScrollView edges.
  const size = Math.min(width, height) * 0.7;
  return (
    <View
      style={{
        position: 'absolute',
        right: -size * 0.18,
        bottom: -size * 0.22,
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        transform: [{ rotate: '-7deg' }],
      }}
    >
      <Text
        style={{
          fontFamily: 'Noto Serif TC',
          fontWeight: '700',
          fontSize: size,
          lineHeight: size,
          color: COLORS.chop,
        }}
      >
        中
      </Text>
    </View>
  );
}
