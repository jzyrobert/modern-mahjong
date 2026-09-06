import type { Action, Tile as MTile, Seat } from '@mahjong/game-logic';
import { chiOptions, isWinning, legalClaimsFor, scoreHand } from '@mahjong/game-logic';
import { type ReactNode, useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useGame } from '../state/game';
import { TILE_CORNER_RADIUS_RATIO, Tile } from './Tile';
import { COLORS } from './colors';

interface ClaimBarProps {
  onAction: (a: Action) => void;
  seat: Seat;
  /** Layout switch. Portrait lays the bar as a single horizontal row;
   *  landscape and desktop stack the option groups in a narrow vertical
   *  column. Desktop also bumps tile + button sizes for the larger
   *  viewport. Defaults to 'portrait'. */
  orientation?: 'portrait' | 'landscape' | 'desktop';
  /** Surface palette. `paper` (default) is the classic cream card;
   *  `glass` is the dark translucent panel the Three.js HUD uses.
   *  Only chrome colours change — the per-kind action buttons, tile
   *  previews and layout are identical. */
  theme?: ClaimBarTheme;
  /** Portrait orientation only: a single ~56 px strip — no CLAIM?
   *  sublabel under the live tile, meld previews inline beside each
   *  button instead of below it, tighter padding. The 3D landscape HUD
   *  floats it in the free-felt band between the rivers and the near
   *  wall, which is only ~45–65 px tall. */
  dense?: boolean;
  /**
   * Glass-strip scale (portrait orientation only). `footer` is the
   * phone-landscape footer variant: a 37 px strip that replaces the
   * sort control in the row under the hand, so a claim never lies on
   * the near wall's tile backs. `large` is the desktop footer strip:
   * 44 px buttons, 22 px meld previews, 18 px glyphs, for a primary CTA
   * that reads at 1440 px instead of the phone's compact sizing.
   */
  size?: 'default' | 'footer' | 'large';
}

export type ClaimBarTheme = 'paper' | 'glass';

interface ClaimPalette {
  panelBg: string;
  panelBorder: string;
  label: string;
  divider: string;
  ghostBorder: string;
  ghostFg: string;
  track: string;
  chiFg: string;
  /** Chi-option chips (multi-chi). */
  chipBg: string;
  chipBgPressed: string;
  chipBorder: string;
  /**
   * Glass only: every non-pass button is a glass secondary (gold-tinted
   * hairline) except the single *primary* option, which takes the gold
   * fill — so the claim card reads with the same hierarchy as the rest
   * of the glass HUD instead of the per-kind hues.
   */
  glassButtons: boolean;
}

const PALETTES: Record<ClaimBarTheme, ClaimPalette> = {
  paper: {
    panelBg: COLORS.paperHi,
    panelBorder: COLORS.hairline,
    label: COLORS.ink3,
    divider: COLORS.hairline,
    ghostBorder: COLORS.hairline,
    ghostFg: COLORS.ink3,
    track: 'rgba(0,0,0,0.06)',
    chiFg: '#2d7a52',
    chipBg: 'rgba(88,194,128,0.1)',
    chipBgPressed: 'rgba(88,194,128,0.2)',
    chipBorder: 'rgba(88,194,128,0.35)',
    glassButtons: false,
  },
  glass: {
    panelBg: 'rgba(14,20,17,0.88)',
    panelBorder: 'rgba(216,168,90,0.65)',
    label: 'rgba(255,255,255,0.62)',
    divider: 'rgba(255,255,255,0.14)',
    ghostBorder: 'rgba(255,255,255,0.2)',
    ghostFg: 'rgba(255,255,255,0.78)',
    track: 'rgba(255,255,255,0.08)',
    chiFg: '#d8a85a',
    chipBg: 'rgba(255,255,255,0.06)',
    chipBgPressed: 'rgba(216,168,90,0.22)',
    chipBorder: 'rgba(216,168,90,0.45)',
    glassButtons: true,
  },
};

/** Glass-theme button surfaces (see `ClaimPalette.glassButtons`). */
const GLASS_BTN = {
  primary: { bg: '#d8a85a', pressed: '#c99a4c', fg: '#2a2418', border: 'rgba(255,235,190,0.55)' },
  secondary: {
    bg: 'rgba(255,255,255,0.06)',
    pressed: 'rgba(216,168,90,0.22)',
    fg: 'rgba(255,255,255,0.92)',
    border: 'rgba(216,168,90,0.5)',
  },
} as const;

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
export function ClaimBar({
  onAction,
  seat,
  orientation = 'portrait',
  theme = 'paper',
  dense = false,
  size = 'default',
}: ClaimBarProps) {
  const pal = PALETTES[theme];
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
      // Promoted-gang rob windows boost the score by +1 faan (搶槓);
      // `state.pendingPromotedGang` being set is the engine signal
      // that we're in a robWindow. Without this, the user's hu CTA
      // hides on rob-only-viable hands (the regular ron score falls
      // below `faanMin` but the rob clears the floor) — see
      // `apps/client/src/ui/tutorial/lessons/robbing-kong.ts` for the
      // case that surfaced this gap. Mirrors `canScoredHu` in
      // `packages/game-logic/src/claims.ts` so the engine's pre-pass
      // gate (`hasMeaningfulClaim`) and the UI's CTA gate use the
      // same score.
      const robbingKong = state.pendingPromotedGang !== undefined;
      const score = scoreHand({
        state,
        winner: seat,
        winningTile: state.lastDiscard.tile,
        selfDraw: false,
        robbingKong,
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
  // Glass theme: the one option that takes the gold fill.
  const primaryKind: CallKind | null = showHu
    ? 'hu'
    : showGang
      ? 'gang'
      : showPeng
        ? 'peng'
        : showChi && chiOpts.length === 1
          ? 'chi'
          : null;

  const isVertical = orientation === 'landscape' || orientation === 'desktop';
  const isDesktop = orientation === 'desktop';
  // Desktop's claim panel floats over the felt with more pixel budget
  // than a phone shell. The visual weight tilts toward the meld
  // previews — the tiles are what the user is parsing ("am I peng-ing
  // 5m or 5p?"), so previews read large while the button chrome stays
  // near mobile-compact sizing rather than dominating the card.
  //
  // Landscape rail (Match Alt D): live tile 32×44 with gold halo, meld
  // previews 13×18 — matches the V2 handoff so the rail's claim card
  // reads with the same hierarchy as the portrait bar's tile preview
  // rather than shrinking the live tile to a thumbnail.
  const large = size === 'large';
  const footer = size === 'footer';
  // `large` (the 1440 px desktop footer strip): a 48 × 66 live tile, 24 ×
  // 33 meld previews, 20 px glyphs on 48 px gold buttons — the user's
  // call is the primary CTA on the screen and reads as one from across
  // the room, not at the phone strip's compact sizing. The strip stays
  // ≤ 84 px tall (`Table3DShell.CLAIM_STRIP_LARGE_H`) so it fits the
  // void band under the desktop hand row instead of climbing onto the
  // tiles' bottom edge.
  const tileW = large ? 48 : isDesktop ? 44 : footer ? 26 : 32;
  const tileH = large ? 66 : isDesktop ? 60 : footer ? 35 : 44;
  const previewW = large ? 24 : isDesktop ? 22 : footer ? 12 : 13;
  const previewH = large ? 33 : isDesktop ? 30 : footer ? 16 : 18;
  const buttonPadV = large ? 12 : footer ? 4 : dense ? 6 : 7;
  const buttonPadH = large ? 18 : isDesktop ? 11 : 10;
  const glyphSize = large ? 20 : isDesktop ? 15 : footer ? 13 : 14;
  const labelSize = large ? 13 : 10;
  /** Vertical padding of the dense strip: 37 px footer (incl. border), ~83 px large. */
  const stripPadV = footer ? 1 : large ? 6 : dense ? 6 : 10;
  // Glass: the HUD's 0 12px 40px shadow so the strip floats above the
  // felt (and, on landscape, the near wall's backs) instead of reading
  // as painted on them.
  const cardShadow =
    theme === 'glass'
      ? '0px 0px 0px 1px rgba(216,168,90,0.18), 0px 0px 28px rgba(216,168,90,0.22), 0px 12px 40px rgba(0,0,0,0.35)'
      : isDesktop
        ? '0px 8px 24px rgba(0,0,0,0.14)'
        : '0px 4px 12px rgba(0,0,0,0.08)';

  // Header tile + CLAIM? sublabel. Same content in every orientation;
  // the surrounding layout decides whether to stack with the actions
  // (portrait) or sit above them (landscape / desktop).
  // Match the live-tile halo's corner curve to the Tile face's actual
  // rounded silhouette (Tile uses `width * TILE_CORNER_RADIUS_RATIO`).
  // Without this, the hard-coded 6 px halo radius traced a tighter
  // corner than the desktop's 44×60 tile (which rounds at ~8 px) and
  // the gold ring stuck out at each corner.
  const haloRadius = tileW * TILE_CORNER_RADIUS_RATIO;
  const tileHeader = discard ? (
    <View style={{ alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <View
        style={{
          width: tileW,
          height: tileH,
          borderRadius: haloRadius,
          boxShadow: `0 0 0 2px ${COLORS.gold}, 0 0 10px ${COLORS.gold}80`,
        }}
      >
        <Tile tile={discard} width={tileW} height={tileH} />
      </View>
      {dense ? null : (
        <Text style={{ fontSize: 9, fontWeight: '800', color: pal.label, letterSpacing: 0.4 }}>
          CLAIM?
        </Text>
      )}
    </View>
  ) : (
    <Text style={{ fontSize: 11, fontWeight: '800', color: pal.label, letterSpacing: 0.5 }}>
      CLAIM?
    </Text>
  );

  const actionSizing = {
    padV: buttonPadV,
    padH: buttonPadH,
    glyphSize,
    labelSize,
    previewW,
    previewH,
    inline: dense && !isVertical,
  } as const;
  const buttons: ReactNode[] = [];
  if (showPeng && discard) {
    buttons.push(
      <ClaimAction
        key="peng"
        kind="peng"
        primary={primaryKind === 'peng'}
        meldTiles={[discard, discard, discard]}
        fullWidth={isVertical}
        sizing={actionSizing}
        pal={pal}
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
          primary={primaryKind === 'chi'}
          meldTiles={run}
          fullWidth={isVertical}
          sizing={actionSizing}
          pal={pal}
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
          sizing={actionSizing}
          pal={pal}
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
        primary={primaryKind === 'gang'}
        meldTiles={[discard, discard, discard, discard]}
        fullWidth={isVertical}
        sizing={actionSizing}
        pal={pal}
        onPress={() => onAction({ t: 'declareClaim', seat, claim: { kind: 'gang' } })}
      />,
    );
  }
  if (showHu) {
    buttons.push(
      <ClaimAction
        key="hu"
        kind="hu"
        primary={primaryKind === 'hu'}
        meldTiles={null}
        faan={huFaan}
        amplified
        fullWidth={isVertical}
        sizing={actionSizing}
        pal={pal}
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
        sizing={actionSizing}
        pal={pal}
        onPress={() => onAction({ t: 'declareClaim', seat, claim: { kind: 'pass' } })}
      />,
    );
  }

  // Landscape: the rail hosts the bar as the only thing in the
  // remaining vertical slot, so the card grows to flex: 1 and centers
  // its contents (large empty space above + below the actions reads
  // as "claim takeover" without padding the content out artificially).
  const landscapeFill = orientation === 'landscape';
  return (
    <View
      testID="claim-bar"
      style={{
        borderRadius: 12,
        backgroundColor: pal.panelBg,
        borderWidth: 1,
        borderColor: pal.panelBorder,
        boxShadow: cardShadow,
        overflow: 'hidden',
        ...(landscapeFill ? { flex: 1, minHeight: 0 } : {}),
      }}
    >
      <CountdownBar
        hardDeadlineMs={state?.pendingClaims?.hardDeadlineMs ?? null}
        totalWindowMs={state?.rules.claimHardWindowMs ?? null}
        track={pal.track}
      />
      {isVertical ? (
        <View
          style={{
            paddingVertical: 8,
            paddingHorizontal: 10,
            gap: 6,
            alignItems: 'center',
            ...(landscapeFill ? { flex: 1, justifyContent: 'center' } : {}),
          }}
        >
          {tileHeader}
          <View style={{ width: '100%', gap: 6 }}>{buttons}</View>
        </View>
      ) : (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: large ? 16 : 10,
            paddingVertical: stripPadV,
            paddingHorizontal: footer ? 10 : large ? 16 : 12,
          }}
        >
          {tileHeader}
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: dense ? 'center' : 'flex-start',
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

interface ClaimActionSizing {
  padV: number;
  padH: number;
  glyphSize: number;
  labelSize: number;
  previewW: number;
  previewH: number;
  /** Meld previews sit beside the button (dense strip) instead of below it. */
  inline?: boolean;
}

interface ClaimActionProps {
  kind: CallKind;
  /** Glass theme: this option takes the gold fill. */
  primary?: boolean;
  /** Inline tile previews rendered below the button. `null` skips
   *  rendering — used for Win (no meld) and Pass (no shape). */
  meldTiles: readonly MTile[] | null;
  faan?: number | null;
  amplified?: boolean;
  ghost?: boolean;
  fullWidth?: boolean;
  sizing: ClaimActionSizing;
  pal: ClaimPalette;
  onPress: () => void;
}

function ClaimAction({
  kind,
  primary = false,
  meldTiles,
  faan = null,
  amplified = false,
  ghost = false,
  fullWidth = false,
  sizing,
  pal,
  onPress,
}: ClaimActionProps) {
  const meta = KIND[kind];
  const glassKind = pal.glassButtons && !ghost ? (primary ? 'primary' : 'secondary') : null;
  const surface = glassKind ? GLASS_BTN[glassKind] : null;
  const fg = ghost ? pal.ghostFg : surface ? surface.fg : meta.fg;
  return (
    <View
      style={{
        flexDirection: sizing.inline ? 'row' : 'column',
        alignItems: 'center',
        gap: sizing.inline ? 6 : 3,
        width: fullWidth ? '100%' : undefined,
      }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={meta.en}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
          paddingVertical: sizing.padV,
          paddingHorizontal: sizing.padH,
          borderRadius: 9,
          width: fullWidth ? '100%' : undefined,
          backgroundColor: surface
            ? pressed
              ? surface.pressed
              : surface.bg
            : pressed
              ? meta.pressed
              : meta.bg,
          borderWidth: ghost ? 1.5 : surface ? 1 : 0,
          borderColor: ghost ? pal.ghostBorder : surface ? surface.border : 'transparent',
          boxShadow: surface
            ? glassKind === 'primary'
              ? '0px 8px 24px rgba(216,168,90,0.28)'
              : 'none'
            : amplified
              ? '0px 2px 8px rgba(220,159,79,0.55)'
              : ghost
                ? 'none'
                : `0px 2px 4px ${shadowFor(kind)}`,
        })}
      >
        <Text
          style={{
            fontFamily: 'Noto Serif TC',
            fontSize: sizing.glyphSize,
            fontWeight: '700',
            color: fg,
          }}
        >
          {meta.glyph}
        </Text>
        <Text
          style={{
            fontSize: sizing.labelSize,
            fontWeight: '900',
            color: fg,
            letterSpacing: sizing.labelSize >= 14 ? 1.2 : 0.4,
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
              width={sizing.previewW}
              height={sizing.previewH}
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
  sizing: ClaimActionSizing;
  pal: ClaimPalette;
  onPick: (option: [MTile, MTile]) => void;
}

/** Multi-chi affordance — surfaces one chip per available chi sequence
 *  instead of a "Chi" button that hides a picker behind a tap. The
 *  chip shows the three-tile sequence inline + a "3·4·5"-style numeric
 *  label so the player can pick from the visible options without
 *  uncovering anything. Portrait flexes into a wrap row; landscape /
 *  desktop stack full-width chips inside the vertical column. */
function ChiChipGroup({ discard, options, fullWidth, sizing, pal, onPick }: ChiChipGroupProps) {
  // Chi chip tiles ride a hair smaller than the main meld preview so
  // the chip itself stays compact even at desktop sizing — the chip
  // is already showing 3 tiles + a numeric label inside a Pressable.
  const chipTileW = Math.max(12, sizing.previewW - 2);
  const chipTileH = Math.max(17, sizing.previewH - 1);
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
        <View style={{ flex: 1, height: 1, backgroundColor: pal.divider, opacity: 0.6 }} />
        <Text
          style={{
            fontFamily: 'Noto Serif TC',
            fontSize: 11,
            fontWeight: '700',
            color: pal.chiFg,
          }}
        >
          吃
        </Text>
        <Text
          style={{
            fontSize: 9,
            fontWeight: '800',
            color: pal.chiFg,
            letterSpacing: 0.5,
          }}
        >
          CHI
        </Text>
        <View style={{ flex: 1, height: 1, backgroundColor: pal.divider, opacity: 0.6 }} />
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
              backgroundColor: pressed ? pal.chipBgPressed : pal.chipBg,
              borderWidth: 1,
              borderColor: pal.chipBorder,
              width: fullWidth ? '100%' : undefined,
            })}
          >
            <View style={{ flexDirection: 'row', gap: 1 }}>
              {run.map((t, j) => (
                <Tile
                  // biome-ignore lint/suspicious/noArrayIndexKey: ordered run is positional
                  key={j}
                  tile={t}
                  width={chipTileW}
                  height={chipTileH}
                />
              ))}
            </View>
            <Text
              style={{
                fontSize: 8,
                fontWeight: '800',
                color: pal.chiFg,
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
  /** Server-clock timestamp at which the engine auto-passes any seat
   *  that hasn't submitted. Null in solo (the rule strips the hard
   *  cap via `soloRulesFrom`), in which case the bar doesn't render. */
  hardDeadlineMs: number | null;
  /** Length of the hard-deadline window in ms (`rules.claimHardWindowMs`).
   *  Used to compute the elapsed-vs-total fraction at mount, so the
   *  bar starts at the correct fill if the user mounts mid-claim
   *  (e.g. tab refresh, late-attached spectator). Null in solo. */
  totalWindowMs: number | null;
  /** Empty-track colour behind the shrinking bar. */
  track: string;
}

/** Thin 3-px progress strip at the top of the claim card. Animated
 *  current-fraction → 0 across the time remaining at mount. Hidden
 *  when no hard deadline is set — solo strips `claimHardWindowMs` via
 *  `soloRulesFrom`, so there's no real countdown to surface; the card
 *  collapses to its actions only.
 *
 *  Driven by the engine's *hard* deadline (the auto-pass cap) rather
 *  than the soft floor (`deadlineMs`, the earliest the engine will
 *  resolve). The hard cap is what the user actually races against —
 *  the soft floor is for fairness to slow clickers and never extends
 *  the window. */
function initialFraction(hardDeadlineMs: number | null, totalWindowMs: number | null): number {
  if (hardDeadlineMs === null || totalWindowMs === null) return 0;
  const remaining = hardDeadlineMs - Date.now();
  if (remaining <= 0) return 0;
  return Math.min(1, Math.max(0, remaining / totalWindowMs));
}

function CountdownBar({ hardDeadlineMs, totalWindowMs, track }: CountdownBarProps) {
  // Seed the Animated.Value at the correct starting fraction so the
  // very first paint already shows the right fill — without the lazy
  // initialiser, the ref captured `0`, the useEffect ran after commit,
  // and the bar visibly popped from empty → start-fraction on mount.
  const fraction = useRef(
    new Animated.Value(initialFraction(hardDeadlineMs, totalWindowMs)),
  ).current;
  useEffect(() => {
    if (hardDeadlineMs === null || totalWindowMs === null) {
      // Reset to 0 so a subsequent claim window that opens while this
      // bar stays mounted doesn't flash at the stale fill for a frame
      // before its own start-fraction is set.
      fraction.setValue(0);
      return;
    }
    const now = Date.now();
    const remaining = hardDeadlineMs - now;
    if (remaining <= 0) {
      fraction.setValue(0);
      return;
    }
    const start = Math.min(1, Math.max(0, remaining / totalWindowMs));
    fraction.setValue(start);
    const anim = Animated.timing(fraction, {
      toValue: 0,
      duration: remaining,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [hardDeadlineMs, totalWindowMs, fraction]);
  if (hardDeadlineMs === null || totalWindowMs === null) return null;
  return (
    <View style={{ height: 3, backgroundColor: track, width: '100%' }}>
      <Animated.View
        style={{
          height: '100%',
          width: fraction.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          backgroundColor: COLORS.redHot,
          opacity: 0.85,
        }}
      />
    </View>
  );
}
