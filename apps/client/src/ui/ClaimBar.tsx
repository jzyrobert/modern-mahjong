import type { Action, Tile as MTile, Seat } from '@mahjong/game-logic';
import { chiOptions, isWinning, legalClaimsFor, scoreHand } from '@mahjong/game-logic';
import { type ReactNode, useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useGame } from '../state/game';
import { Tile } from './Tile';
import { COLORS } from './colors';

interface ClaimBarProps {
  onAction: (a: Action) => void;
  seat: Seat;
  /** Layout switch. Portrait lays the bar as a single horizontal row;
   *  landscape and desktop stack the option groups in a narrow vertical
   *  column. Desktop also bumps tile + button sizes for the larger
   *  viewport. Defaults to 'portrait'. */
  orientation?: 'portrait' | 'landscape' | 'desktop';
}

type CallKind = 'chi' | 'peng' | 'gang' | 'hu' | 'pass';

// Per-action colours. Per-kind hues keep the visual hierarchy: Win is
// gold (amplified — the most valuable action), Peng/Chi/Gang carry
// their own claim-kind hues, and Pass is intentionally treated as a
// ghost outline to de-emphasise the safe-default.
const KIND = {
  chi: { glyph: '吃', en: 'Chi', bg: '#58c280', pressed: '#48b270', fg: 'white' },
  peng: { glyph: '碰', en: 'Peng', bg: '#5b9ad9', pressed: '#4a8bc9', fg: 'white' },
  gang: { glyph: '槓', en: 'Gang', bg: '#9d6dc7', pressed: '#7e54a8', fg: 'white' },
  hu: { glyph: '糊', en: 'Win', bg: '#dc9f4f', pressed: '#c88e3e', fg: '#3a2c0d' },
  pass: { glyph: '過', en: 'Pass', bg: 'transparent', pressed: COLORS.creamLow, fg: COLORS.ink3 },
} as const;

const CHI_CHIP = {
  bg: 'rgba(88,194,128,0.1)',
  bgPressed: 'rgba(88,194,128,0.2)',
  border: 'rgba(88,194,128,0.35)',
  fg: '#2d7a52',
} as const;

/**
 * Claim flow buttons, V2.
 *
 * Renders one option per legal claim against the current discard, with
 * a few V2-specific affordances over the original bar:
 *
 *   - **Live discarded tile** is mounted left-of-actions (portrait) or
 *     top-of-actions (landscape / desktop) with a gold halo ring so the
 *     player can see what they're claiming without parsing the
 *     individual previews.
 *   - **Meld previews** under Peng / Chi / Gang buttons show the
 *     exact 3- or 4-tile shape that would form if the player commits.
 *     Multi-chi degrades to a row of meld-chip buttons in place of the
 *     ambiguous "Chi" → picker flow the original bar used.
 *   - **Win is amplified** with a gold-glow box-shadow; **Pass is
 *     de-emphasised** with a hairline ghost outline — the visual
 *     weight matches the actual stakes of each action.
 *   - **Countdown bar** at the top of the card animates the remaining
 *     claim window via `pendingClaims.deadlineMs` (soft floor) or
 *     `hardDeadlineMs` (hard fallback) when present; absent in solo
 *     (no deadline) → bar hidden.
 *
 * `legalClaimsFor` doesn't include `hu` (depends on shanten + scoring),
 * so we project the win in-place and only add it when the projected
 * score meets `rules.faanMin` — without the gate, a low-faan shape
 * would surface a Win button the engine then silently demotes.
 *
 * Picking a lesser claim (chi/peng/gang) on a tile we could hu on
 * leaves the seat unable to declare the win on the resulting forced-
 * discard turn (`applyClaim` clears `lastDiscard` and zeros
 * `drewThisTurn`). In HK rules you'd always declare hu when you can,
 * so we collapse the visible options to WIN + PASS in that case.
 */
export function ClaimBar({ onAction, seat, orientation = 'portrait' }: ClaimBarProps) {
  const state = useGame((s) => s.state);
  const legal = new Set<CallKind>(state ? legalClaimsFor(state, seat) : []);
  let huFaan: number | null = null;
  if (state?.lastDiscard && state.lastDiscard.from !== seat) {
    const allowSpecial = state.rules.allowSevenPairs || state.rules.allowThirteenOrphans;
    const winnable = isWinning({
      hand: [...state.hands[seat], state.lastDiscard.tile],
      exposedMelds: state.melds[seat].length,
      allowSpecial,
    });
    if (winnable) {
      const score = scoreHand({
        state,
        winner: seat,
        winningTile: state.lastDiscard.tile,
        selfDraw: false,
      });
      if (score.faan >= state.rules.faanMin) {
        legal.add('hu');
        huFaan = score.faan;
      }
    }
  }
  const collapseToWin = legal.has('hu');
  const discard = state?.lastDiscard?.tile ?? state?.pendingClaims?.discard.tile ?? null;
  const chiOpts = state && discard && !collapseToWin ? chiOptions(state.hands[seat], discard) : [];

  const showChi = legal.has('chi') && chiOpts.length > 0 && !collapseToWin;
  const showPeng = legal.has('peng') && !collapseToWin;
  const showGang = legal.has('gang') && !collapseToWin;
  const showHu = legal.has('hu');
  const showPass = legal.has('pass');

  const isVertical = orientation === 'landscape' || orientation === 'desktop';
  const tileW = orientation === 'desktop' ? 32 : isVertical ? 28 : 32;
  const tileH = orientation === 'desktop' ? 44 : isVertical ? 38 : 44;
  const cardShadow =
    orientation === 'desktop' ? '0px 8px 24px rgba(0,0,0,0.14)' : '0px 4px 12px rgba(0,0,0,0.08)';

  // Header tile + CLAIM? sublabel. Same content in every orientation;
  // the surrounding layout decides whether to stack with the actions
  // (portrait) or sit above them (landscape / desktop).
  const tileHeader = discard ? (
    <View style={{ alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <View
        style={{
          borderRadius: 6,
          boxShadow: `0 0 0 2px ${COLORS.gold}, 0 0 10px ${COLORS.gold}80`,
        }}
      >
        <Tile tile={discard} width={tileW} height={tileH} />
      </View>
      <Text style={{ fontSize: 8, fontWeight: '800', color: COLORS.ink3, letterSpacing: 0.4 }}>
        CLAIM?
      </Text>
    </View>
  ) : (
    <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.ink3, letterSpacing: 0.5 }}>
      CLAIM?
    </Text>
  );

  const buttons: ReactNode[] = [];
  if (showPeng && discard) {
    buttons.push(
      <ClaimAction
        key="peng"
        kind="peng"
        meldTiles={[discard, discard, discard]}
        fullWidth={isVertical}
        onPress={() => onAction({ t: 'declareClaim', seat, claim: { kind: 'peng' } })}
      />,
    );
  }
  if (showChi && discard) {
    if (chiOpts.length === 1) {
      const opt = chiOpts[0]!;
      const run = sortRun(discard, opt[0], opt[1]);
      buttons.push(
        <ClaimAction
          key="chi"
          kind="chi"
          meldTiles={run}
          fullWidth={isVertical}
          onPress={() => onAction({ t: 'declareClaim', seat, claim: { kind: 'chi', with: opt } })}
        />,
      );
    } else {
      buttons.push(
        <ChiChipGroup
          key="chi"
          discard={discard}
          options={chiOpts}
          fullWidth={isVertical}
          onPick={(opt) => onAction({ t: 'declareClaim', seat, claim: { kind: 'chi', with: opt } })}
        />,
      );
    }
  }
  if (showGang && discard) {
    buttons.push(
      <ClaimAction
        key="gang"
        kind="gang"
        meldTiles={[discard, discard, discard, discard]}
        fullWidth={isVertical}
        onPress={() => onAction({ t: 'declareClaim', seat, claim: { kind: 'gang' } })}
      />,
    );
  }
  if (showHu) {
    buttons.push(
      <ClaimAction
        key="hu"
        kind="hu"
        meldTiles={null}
        faan={huFaan}
        amplified
        fullWidth={isVertical}
        onPress={() => onAction({ t: 'declareClaim', seat, claim: { kind: 'hu' } })}
      />,
    );
  }
  if (showPass) {
    buttons.push(
      <ClaimAction
        key="pass"
        kind="pass"
        meldTiles={null}
        ghost
        fullWidth={isVertical}
        onPress={() => onAction({ t: 'declareClaim', seat, claim: { kind: 'pass' } })}
      />,
    );
  }

  return (
    <View
      testID="claim-bar"
      style={{
        borderRadius: 12,
        backgroundColor: COLORS.paperHi,
        borderWidth: 1,
        borderColor: COLORS.hairline,
        boxShadow: cardShadow,
        overflow: 'hidden',
      }}
    >
      <CountdownBar deadlineMs={state?.pendingClaims?.deadlineMs ?? null} />
      {isVertical ? (
        <View style={{ paddingVertical: 8, paddingHorizontal: 10, gap: 6, alignItems: 'center' }}>
          {tileHeader}
          <View style={{ width: '100%', gap: 6 }}>{buttons}</View>
        </View>
      ) : (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingVertical: 10,
            paddingHorizontal: 12,
          }}
        >
          {tileHeader}
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'flex-start',
              gap: 8,
              flex: 1,
              minWidth: 0,
            }}
          >
            {buttons}
          </View>
        </View>
      )}
    </View>
  );
}

interface ClaimActionProps {
  kind: CallKind;
  /** Inline tile previews rendered below the button. `null` skips
   *  rendering — used for Win (no meld) and Pass (no shape). */
  meldTiles: readonly MTile[] | null;
  faan?: number | null;
  amplified?: boolean;
  ghost?: boolean;
  fullWidth?: boolean;
  onPress: () => void;
}

function ClaimAction({
  kind,
  meldTiles,
  faan = null,
  amplified = false,
  ghost = false,
  fullWidth = false,
  onPress,
}: ClaimActionProps) {
  const meta = KIND[kind];
  return (
    <View style={{ alignItems: 'center', gap: 3, width: fullWidth ? '100%' : undefined }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={meta.en}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
          paddingVertical: 7,
          paddingHorizontal: ghost ? 10 : amplified ? 12 : 10,
          borderRadius: 9,
          width: fullWidth ? '100%' : undefined,
          backgroundColor: pressed ? meta.pressed : meta.bg,
          borderWidth: ghost ? 1.5 : 0,
          borderColor: ghost ? COLORS.hairline : 'transparent',
          boxShadow: amplified
            ? '0px 2px 8px rgba(220,159,79,0.55)'
            : ghost
              ? 'none'
              : `0px 2px 4px ${shadowFor(kind)}`,
        })}
      >
        <Text
          style={{
            fontFamily: 'Noto Serif TC',
            fontSize: 14,
            fontWeight: '700',
            color: meta.fg,
          }}
        >
          {meta.glyph}
        </Text>
        <Text
          style={{
            fontSize: 10,
            fontWeight: '900',
            color: meta.fg,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
          }}
        >
          {faan != null ? `${meta.en} · ${faan} faan` : meta.en}
        </Text>
      </Pressable>
      {meldTiles && meldTiles.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: 2 }}>
          {meldTiles.map((t, i) => (
            <Tile
              // biome-ignore lint/suspicious/noArrayIndexKey: positional preview
              key={i}
              tile={t}
              width={11}
              height={16}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Colored drop-shadow tint matching the button hue — keeps the press
 *  feel even when RN can't render a true filter-blur. Ghost/amplified
 *  paths short-circuit before this is read. */
function shadowFor(kind: CallKind): string {
  if (kind === 'peng') return 'rgba(91,154,217,0.4)';
  if (kind === 'chi') return 'rgba(88,194,128,0.4)';
  if (kind === 'gang') return 'rgba(157,109,199,0.4)';
  return 'rgba(0,0,0,0.18)';
}

interface ChiChipGroupProps {
  discard: MTile;
  options: [MTile, MTile][];
  fullWidth: boolean;
  onPick: (option: [MTile, MTile]) => void;
}

/** Multi-chi affordance — surfaces one chip per available chi sequence
 *  instead of a "Chi" button that hides a picker behind a tap. The
 *  chip shows the three-tile sequence inline + a "3·4·5"-style numeric
 *  label so the player can pick from the visible options without
 *  uncovering anything. Portrait flexes into a wrap row; landscape /
 *  desktop stack full-width chips inside the vertical column. */
function ChiChipGroup({ discard, options, fullWidth, onPick }: ChiChipGroupProps) {
  return (
    <View
      style={{
        flexDirection: fullWidth ? 'column' : 'row',
        flexWrap: 'wrap',
        gap: 4,
        width: fullWidth ? '100%' : undefined,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          width: fullWidth ? '100%' : undefined,
        }}
      >
        <View style={{ flex: 1, height: 1, backgroundColor: COLORS.hairline, opacity: 0.6 }} />
        <Text
          style={{
            fontFamily: 'Noto Serif TC',
            fontSize: 11,
            fontWeight: '700',
            color: CHI_CHIP.fg,
          }}
        >
          吃
        </Text>
        <Text
          style={{
            fontSize: 9,
            fontWeight: '800',
            color: CHI_CHIP.fg,
            letterSpacing: 0.5,
          }}
        >
          CHI
        </Text>
        <View style={{ flex: 1, height: 1, backgroundColor: COLORS.hairline, opacity: 0.6 }} />
      </View>
      {options.map((opt, i) => {
        const run = sortRun(discard, opt[0], opt[1]);
        return (
          <Pressable
            // biome-ignore lint/suspicious/noArrayIndexKey: position-stable per discard
            key={i}
            testID="chi-option"
            onPress={() => onPick([opt[0], opt[1]])}
            style={({ pressed }) => ({
              flexDirection: fullWidth ? 'row' : 'column',
              alignItems: 'center',
              justifyContent: fullWidth ? 'space-between' : 'center',
              gap: fullWidth ? 8 : 3,
              paddingVertical: 5,
              paddingHorizontal: 8,
              borderRadius: 8,
              backgroundColor: pressed ? CHI_CHIP.bgPressed : CHI_CHIP.bg,
              borderWidth: 1,
              borderColor: CHI_CHIP.border,
              width: fullWidth ? '100%' : undefined,
            })}
          >
            <View style={{ flexDirection: 'row', gap: 1 }}>
              {run.map((t, j) => (
                <Tile
                  // biome-ignore lint/suspicious/noArrayIndexKey: ordered run is positional
                  key={j}
                  tile={t}
                  width={12}
                  height={17}
                />
              ))}
            </View>
            <Text
              style={{
                fontSize: 8,
                fontWeight: '800',
                color: CHI_CHIP.fg,
                letterSpacing: 0.3,
              }}
            >
              {sequenceLabel(run)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function sequenceLabel(run: readonly MTile[]): string {
  return run
    .map((t) => (t.kind === 'suit' ? String(t.rank) : ''))
    .filter(Boolean)
    .join('·');
}

function sortRun(a: MTile, b: MTile, c: MTile): MTile[] {
  return [a, b, c].sort((x, y) => {
    const xr = x.kind === 'suit' ? x.rank : 0;
    const yr = y.kind === 'suit' ? y.rank : 0;
    return xr - yr;
  });
}

interface CountdownBarProps {
  deadlineMs: number | null;
}

/** Thin 3-px progress strip at the top of the claim card. Animated
 *  100→0 across the time remaining at mount. Absent when no deadline
 *  is set (solo / claimWindowMs=0) — the bar simply doesn't render so
 *  the card collapses to its actions only. */
function CountdownBar({ deadlineMs }: CountdownBarProps) {
  const width = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (deadlineMs === null) return;
    const now = Date.now();
    const remaining = deadlineMs - now;
    if (remaining <= 0) {
      width.setValue(0);
      return;
    }
    // The bar shows "remaining vs full window," but we don't know the
    // full window length here — `claimWindowMs` lives on the rule
    // config. As a pragmatic stand-in we treat the elapsed-so-far +
    // remaining as the window, capped at a sensible upper bound.
    const ASSUMED_WINDOW_MS = Math.max(remaining, 5_000);
    const start = remaining / ASSUMED_WINDOW_MS;
    width.setValue(start);
    const anim = Animated.timing(width, {
      toValue: 0,
      duration: remaining,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [deadlineMs, width]);
  if (deadlineMs === null) return null;
  return (
    <View style={{ height: 3, backgroundColor: 'rgba(0,0,0,0.06)', width: '100%' }}>
      <Animated.View
        style={{
          height: '100%',
          width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          backgroundColor: COLORS.redHot,
          opacity: 0.85,
        }}
      />
    </View>
  );
}
