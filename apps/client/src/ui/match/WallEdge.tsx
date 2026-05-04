import type { Tile as MTile, Seat } from '@mahjong/game-logic';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { Tile } from '../Tile';

/**
 * Visual wall edge for one seat. Renders the seat's physical wall as 17
 * stacks (real Hong Kong mahjong has 4 walls × 17 stacks × 2 tiles = 136
 * tiles total). Each stack is drawn as a 2-tile-tall pillbox; status
 * comes from the dice break and the engine's draw progress:
 *
 *   - `live`     — face-down, drawable (full 2-tile stack)
 *   - `dead`     — face-down, dimmed (kong replacements; never drawn
 *                  except on a kong declaration)
 *   - `drawn`    — empty (both tiles already left this stack)
 *   - `nextDraw` — the next-to-draw stack; renders the engine's actual
 *                  next `Tile` on top so future Phase 6 FLIP animations
 *                  have a real tile object to track. Pulse halo deferred.
 *
 * Native port of `_legacy/src/ui/match/WallEdge.tsx`. The framer-motion
 * pulse halo is intentionally omitted — animations belong to Phase 6
 * (Reanimated worklets / Animated API). For now the next-draw slot is
 * highlighted with a static gold border so it's still a visible cue.
 */

export type SlotStatus = 'live' | 'dead' | 'drawn' | 'nextDraw';

interface WallEdgeProps {
  /** 17-element status map for this seat's wall, slot 0 = leftmost. */
  slots: readonly SlotStatus[];
  /** Engine `Tile` for the next-to-draw slot, used as the FLIP source. */
  nextDrawTile?: MTile | null | undefined;
  /** Click handler when the next-to-draw slot is on this seat's wall. */
  onDrawNext?: (() => void) | undefined;
  /** Render order: when true, slot 0 stays visually rightmost. Used for
   *  the right-side wall so the break math reads consistently across
   *  seats once the column is rotated. */
  reverse?: boolean | undefined;
  /** Stack orientation — horizontal row (top/bottom seats) or vertical
   *  column (left/right seats). The 2-tile pillbox direction flips to
   *  match. */
  orient: 'row' | 'column';
  /** Tile width. Defaults to 14 — matches the existing OppHandStrip
   *  face-down strip so opp-hand and wall sizes look consistent. */
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
        {ordered.map((status, i) => (
          <SlotCell
            // biome-ignore lint/suspicious/noArrayIndexKey: 17 fixed stack positions per seat — index IS the canonical identity
            key={`${seatKey}-${i}`}
            status={status}
            stackDir={stackDir}
            tileW={tileW}
            tileH={tileH}
            nextDrawTile={status === 'nextDraw' ? (nextDrawTile ?? null) : null}
            onPress={status === 'nextDraw' ? onDrawNext : undefined}
            enableDrawTestId={enableDrawTestId === true && status === 'nextDraw'}
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
  status: SlotStatus;
  /** Layout direction for the inner 2-tile stack. 'row' = stacked
   *  horizontally (used when the wall row is vertical); 'column' =
   *  stacked vertically (used when the wall row is horizontal). */
  stackDir: 'row' | 'column';
  tileW: number;
  tileH: number;
  nextDrawTile: MTile | null;
  onPress?: (() => void) | undefined;
  enableDrawTestId: boolean;
}

function SlotCell({
  status,
  stackDir,
  tileW,
  tileH,
  nextDrawTile,
  onPress,
  enableDrawTestId,
}: SlotCellProps) {
  if (status === 'drawn') {
    // Empty span keeps the row geometry stable so live stacks don't
    // reflow as more are drawn.
    const w = stackDir === 'column' ? tileW : tileW * 2 + 1;
    const h = stackDir === 'column' ? tileH * 2 + 1 : tileH;
    return <View style={{ width: w, height: h }} />;
  }

  if (status === 'nextDraw' && nextDrawTile) {
    return (
      <View style={{ flexDirection: stackDir, gap: 1 }}>
        <Pressable
          onPress={onPress}
          testID={enableDrawTestId ? 'wall-draw-next' : undefined}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        >
          <PulseHalo width={tileW} height={tileH}>
            <Tile tile={nextDrawTile} faceDown width={tileW} height={tileH} />
          </PulseHalo>
        </Pressable>
        <PlaceholderBack width={tileW} height={tileH} dim={false} />
      </View>
    );
  }

  // live or dead — render as a 2-tile-tall placeholder stack. Dead wall
  // uses dim opacity so the player can read the boundary.
  const dim = status === 'dead';
  return (
    <View style={{ flexDirection: stackDir, gap: 1 }}>
      <PlaceholderBack width={tileW} height={tileH} dim={dim} />
      <PlaceholderBack width={tileW} height={tileH} dim={dim} />
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
        pointerEvents="none"
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
        }}
      />
      {children}
    </View>
  );
}

function PlaceholderBack({ width, height, dim }: { width: number; height: number; dim: boolean }) {
  return (
    <View
      style={{
        width,
        height,
        borderRadius: 3,
        backgroundColor: COLORS.back1,
        borderColor: COLORS.backEdge,
        borderWidth: 0.5,
        opacity: dim ? 0.45 : 1,
      }}
    />
  );
}
