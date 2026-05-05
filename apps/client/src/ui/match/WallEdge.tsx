import { type Tile as MTile, type Seat, tileId } from '@mahjong/game-logic';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { Tile } from '../Tile';
import type { WallSlot } from './wallLayout';

/**
 * Visual wall edge for one seat. Renders the seat's still-undrawn stacks
 * as 2-tile-tall pillboxes (1-tile if the stack is half-drawn). Real
 * Hong Kong mahjong builds the wall as 17 stacks × 2 per side; as the
 * dealer + dice break feed plays, drawn stacks vanish and the visible
 * wall shrinks to match.
 *
 *   - Full stack (`tiles: 2`)  → two stacked face-down tile-backs.
 *   - Half stack (`tiles: 1`)  → one face-down tile-back.
 *   - Next-to-draw (`isNextDraw`) — top tile renders as the engine's
 *     real next `Tile` (face-down) so future Phase 6 FLIPs have a real
 *     tile object to track. Pulse halo signals "your draw."
 *
 * The dead wall is not rendered separately — it's part of the
 * engine's state but never visible at a real table.
 */

interface WallEdgeProps {
  /** Visible stacks for this seat — already filtered to undrawn ones. */
  slots: readonly WallSlot[];
  /** Engine `Tile` for the next-to-draw stack, used as the FLIP source. */
  nextDrawTile?: MTile | null | undefined;
  /** Click handler when the next-to-draw slot is on this seat's wall. */
  onDrawNext?: (() => void) | undefined;
  /** Render order: when true, slot 0 stays visually rightmost. Used for
   *  the right-side wall so the break math reads consistently across
   *  seats once the column is rotated. */
  reverse?: boolean | undefined;
  /** Stack orientation — horizontal row (top/bottom seats) or vertical
   *  column (left/right seats). The pillbox direction flips to match. */
  orient: 'row' | 'column';
  /** Tile width. Defaults to 14 — matches OppHandStrip face-down tiles. */
  tileW?: number;
  /** Tile height. Defaults to 20. */
  tileH?: number;
  /** Live tiles still in the wall. Renders a small badge on the user's
   *  wall when set; opponent walls pass undefined to hide it. */
  liveCount?: number | undefined;
  /** Test harness signal for the click target. Proxies to the existing
   *  `wall-draw-next` testID so the existing solo-match e2e keeps
   *  working. */
  enableDrawTestId?: boolean | undefined;
  seatKey: Seat;
}

const COLORS = {
  back1: '#7fa9c1',
  back2: '#5a8cb0',
  backEdge: 'rgba(50,80,100,0.6)',
  drawHalo: '#dc9f4f',
  countBg: 'rgba(0,0,0,0.35)',
  countFg: 'rgba(255,255,255,0.85)',
};

export function WallEdge({
  slots,
  nextDrawTile,
  onDrawNext,
  reverse = false,
  orient,
  tileW = 14,
  tileH = 20,
  liveCount,
  enableDrawTestId,
  seatKey,
}: WallEdgeProps) {
  const ordered = reverse ? [...slots].reverse() : slots;
  const stackDir = orient === 'row' ? 'column' : 'row';
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <View style={{ flexDirection: orient, gap: 1 }}>
        {ordered.map((slot, i) => (
          <SlotCell
            // biome-ignore lint/suspicious/noArrayIndexKey: order-stable per seat
            key={`${seatKey}-${i}`}
            slot={slot}
            stackDir={stackDir}
            tileW={tileW}
            tileH={tileH}
            nextDrawTile={slot.isNextDraw ? (nextDrawTile ?? null) : null}
            onPress={slot.isNextDraw ? onDrawNext : undefined}
            enableDrawTestId={enableDrawTestId === true && slot.isNextDraw}
          />
        ))}
      </View>
      {liveCount !== undefined ? (
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 8,
            backgroundColor: COLORS.countBg,
          }}
        >
          <Text style={{ color: COLORS.countFg, fontSize: 10, fontWeight: '700' }}>
            {liveCount} left
          </Text>
        </View>
      ) : null}
    </View>
  );
}

interface SlotCellProps {
  slot: WallSlot;
  /** Layout direction for the inner pillbox. 'row' = stacked horizontally
   *  (used when the wall row is vertical); 'column' = stacked vertically
   *  (used when the wall row is horizontal). */
  stackDir: 'row' | 'column';
  tileW: number;
  tileH: number;
  nextDrawTile: MTile | null;
  onPress?: (() => void) | undefined;
  enableDrawTestId: boolean;
}

function SlotCell({
  slot,
  stackDir,
  tileW,
  tileH,
  nextDrawTile,
  onPress,
  enableDrawTestId,
}: SlotCellProps) {
  // Half-drawn stack as the next-to-draw target — single face-down
  // engine tile with the pulse halo.
  if (slot.isNextDraw && nextDrawTile && slot.tiles === 1) {
    return (
      <Pressable
        onPress={onPress}
        testID={enableDrawTestId ? 'wall-draw-next' : undefined}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      >
        <PulseHalo width={tileW} height={tileH}>
          <Tile
            tile={nextDrawTile}
            flipId={`tile-${tileId(nextDrawTile)}`}
            faceDown
            width={tileW}
            height={tileH}
          />
        </PulseHalo>
      </Pressable>
    );
  }

  // Full next-to-draw stack — engine tile on top + a placeholder back below.
  if (slot.isNextDraw && nextDrawTile && slot.tiles === 2) {
    return (
      <View style={{ flexDirection: stackDir, gap: 1 }}>
        <Pressable
          onPress={onPress}
          testID={enableDrawTestId ? 'wall-draw-next' : undefined}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        >
          <PulseHalo width={tileW} height={tileH}>
            <Tile
              tile={nextDrawTile}
              flipId={`tile-${tileId(nextDrawTile)}`}
              faceDown
              width={tileW}
              height={tileH}
            />
          </PulseHalo>
        </Pressable>
        <PlaceholderBack width={tileW} height={tileH} />
      </View>
    );
  }

  // Plain stack — 1 or 2 face-down placeholder backs.
  if (slot.tiles === 1) {
    return <PlaceholderBack width={tileW} height={tileH} />;
  }
  return (
    <View style={{ flexDirection: stackDir, gap: 1 }}>
      <PlaceholderBack width={tileW} height={tileH} />
      <PlaceholderBack width={tileW} height={tileH} />
    </View>
  );
}

/**
 * Pulse halo wrapper for the next-draw stack — gold border + scale +
 * opacity loop using RN core `Animated`. Replaces the framer-motion
 * `motion.span animate={PULSE_HALO_ANIMATE}` from the legacy build.
 * Compositor-only properties (transform + opacity), `useNativeDriver`
 * so the JS thread stays free during animation.
 */
function PulseHalo({
  width,
  height,
  children,
}: { width: number; height: number; children: React.ReactNode }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(t, {
          toValue: 0,
          duration: 700,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });
  return (
    <View
      style={{
        borderRadius: 4,
        borderWidth: 1.5,
        borderColor: COLORS.drawHalo,
      }}
    >
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width,
          height,
          borderRadius: 4,
          backgroundColor: COLORS.drawHalo,
          opacity,
          transform: [{ scale }],
          pointerEvents: 'none',
        }}
      />
      {children}
    </View>
  );
}

function PlaceholderBack({ width, height }: { width: number; height: number }) {
  return (
    <View
      style={{
        width,
        height,
        borderRadius: 3,
        backgroundColor: COLORS.back1,
        borderColor: COLORS.backEdge,
        borderWidth: 0.5,
      }}
    />
  );
}
