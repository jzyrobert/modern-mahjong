import type { Action, Claim, Tile as MTile, Seat } from '@mahjong/game-logic';
import { chiOptions, isWinning, legalClaimsFor, scoreHand } from '@mahjong/game-logic';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useGame } from '../state/game';
import { Tile } from './Tile';

interface ClaimBarProps {
  onAction: (a: Action) => void;
  seat: Seat;
}

type CallKind = 'chi' | 'peng' | 'gang' | 'hu' | 'pass';
type Tone = 'jade' | 'blue' | 'plum' | 'gold' | 'cream';

const LABELS: Record<CallKind, { en: string; zh: string; tone: Tone }> = {
  chi: { en: 'Chi', zh: '吃', tone: 'jade' },
  peng: { en: 'Peng', zh: '碰', tone: 'blue' },
  gang: { en: 'Gang', zh: '槓', tone: 'plum' },
  hu: { en: 'Win', zh: '糊', tone: 'gold' },
  pass: { en: 'Pass', zh: '過', tone: 'cream' },
};

// Per-action colours — closer to the legacy CallButton's per-kind
// gradient-by-hue palette. RN can't render the original 135° linear
// gradients without an extra package, so we approximate with a flat
// hex + a darker pressed state + an inner shadow on press.
const TONE: Record<Tone, { bg: string; pressed: string; fg: string }> = {
  jade: { bg: '#58c280', pressed: '#4ba668', fg: 'white' },
  blue: { bg: '#5b9ad9', pressed: '#467fbf', fg: 'white' },
  plum: { bg: '#9d6dc7', pressed: '#7e54a8', fg: 'white' },
  gold: { bg: '#dc9f4f', pressed: '#c98a37', fg: '#3a3328' },
  cream: { bg: '#ece4d3', pressed: '#d8cdb4', fg: '#3a3328' },
};

const ORDER: readonly CallKind[] = ['chi', 'peng', 'gang', 'hu', 'pass'];

/**
 * Claim flow buttons.
 *
 * Renders one button per legal claim kind for this seat against the
 * current discard. `pass` is always offered (legalClaimsFor already
 * includes it during awaitingClaims). `hu` is offered only when the
 * seat actually has a winning hand against the discarded tile AND
 * the resulting score meets the configured `faanMin` floor —
 * `legalClaimsFor` deliberately omits `hu` because it depends on
 * shanten + scoring, so we run `isWinning` here against the
 * `hand + discard` projection and then `scoreHand` against the same
 * projection. Without the faan-min check, a low-scoring shape would
 * surface a Win button that the engine then silently demotes to a
 * pass (`resolveAndApply` pre-filters faan-below-min hu submissions
 * — see `canFinalizeHu` in `actions.ts`), which from the user's
 * perspective looked like "the Win button doesn't do anything."
 *
 * `chi` shows when there's at least one legal completion. With a
 * single option, clicking commits the chi directly; with multiple,
 * it reveals an inline tile-thumbnail picker so the user picks the
 * specific run.
 */
export function ClaimBar({ onAction, seat }: ClaimBarProps) {
  const state = useGame((s) => s.state);
  const [chiPickerOpen, setChiPickerOpen] = useState(false);
  const legal = new Set<CallKind>(state ? legalClaimsFor(state, seat) : []);
  // Score the projected win when the live discard would complete the
  // user's hand. Kept around even after the `legal.has('hu')` gate so
  // the Win button can surface the faan count in its label — the user
  // shouldn't have to commit before knowing what they'd score.
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
  const visible = ORDER.filter((k) => legal.has(k));
  const discard = state?.lastDiscard?.tile ?? null;
  const chiOpts = state && discard ? chiOptions(state.hands[seat], discard) : [];

  const handleClick = (kind: CallKind) => {
    if (kind === 'chi') {
      if (chiOpts.length === 1) {
        onAction({ t: 'declareClaim', seat, claim: { kind: 'chi', with: chiOpts[0]! } });
      } else if (chiOpts.length > 1) {
        setChiPickerOpen((open) => !open);
      }
      return;
    }
    onAction({ t: 'declareClaim', seat, claim: claimFor(kind) });
  };

  return (
    <View
      style={{
        gap: 10,
        padding: 12,
        backgroundColor: '#fbf8f0',
        borderColor: '#cdc1ad',
        borderWidth: 1,
        borderRadius: 12,
        boxShadow: '0px 4px 12px rgba(0,0,0,0.08)',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ fontSize: 11, fontWeight: '800', color: '#918275', letterSpacing: 0.5 }}>
          CLAIM?
        </Text>
        {/* `flex: 1, minWidth: 0` so the inner buttons container takes
            the row's leftover width and `flexWrap: 'wrap'` actually
            kicks in. Without it the View sized to its content and a
            crowded bar (CHI + WIN (N FAAN) + PASS at 360 px portrait)
            overflowed the right edge — the trailing button got clipped
            under the screen instead of dropping to a second row. */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, flex: 1, minWidth: 0 }}>
          {visible.map((kind) => (
            <CallButton
              key={kind}
              kind={kind}
              faan={kind === 'hu' ? huFaan : null}
              onPress={() => handleClick(kind)}
            />
          ))}
        </View>
      </View>
      {chiPickerOpen && discard ? (
        <ChiOptionPicker
          discard={discard}
          options={chiOpts}
          onPick={(opt) => {
            setChiPickerOpen(false);
            onAction({ t: 'declareClaim', seat, claim: { kind: 'chi', with: opt } });
          }}
        />
      ) : null}
    </View>
  );
}

interface ChiOptionPickerProps {
  discard: MTile;
  options: readonly (readonly [MTile, MTile])[];
  onPick: (option: [MTile, MTile]) => void;
}

function ChiOptionPicker({ discard, options, onPick }: ChiOptionPickerProps) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((opt, i) => {
        // Sort the three tiles by rank so the preview reads as a run.
        const run = sortRun(discard, opt[0], opt[1]);
        return (
          <Pressable
            // biome-ignore lint/suspicious/noArrayIndexKey: position-stable per discard
            key={i}
            onPress={() => onPick([opt[0], opt[1]])}
            testID="chi-option"
            style={({ pressed }) => ({
              flexDirection: 'row',
              gap: 2,
              padding: 6,
              borderRadius: 10,
              backgroundColor: pressed ? '#e3dac3' : '#f4ecdb',
              borderWidth: 1,
              borderColor: '#cdc1ad',
            })}
          >
            {run.map((t, j) => (
              <Tile
                // biome-ignore lint/suspicious/noArrayIndexKey: ordered run is positional
                key={j}
                tile={t}
                width={24}
                height={34}
              />
            ))}
          </Pressable>
        );
      })}
    </View>
  );
}

function sortRun(a: MTile, b: MTile, c: MTile): MTile[] {
  // chi is always within a single suit; rank ordering is enough.
  return [a, b, c].sort((x, y) => {
    const xr = x.kind === 'suit' ? x.rank : 0;
    const yr = y.kind === 'suit' ? y.rank : 0;
    return xr - yr;
  });
}

function CallButton({
  kind,
  faan,
  onPress,
}: {
  kind: CallKind;
  /** Surfaces "(N faan)" next to the EN label on the win button so the
   *  user sees what they'd score before committing. Null on every other
   *  kind (chi/peng/gang/pass don't score). */
  faan: number | null;
  onPress: () => void;
}) {
  const meta = LABELS[kind];
  const tone = TONE[meta.tone];
  const isCream = meta.tone === 'cream';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? tone.pressed : tone.bg,
        paddingVertical: 10,
        paddingHorizontal: 18,
        borderRadius: 14,
        borderWidth: isCream ? 1.5 : 0,
        borderColor: isCream ? '#cdc1ad' : 'transparent',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        boxShadow: isCream ? 'none' : '0px 4px 6px rgba(0,0,0,0.18)',
      })}
    >
      <Text
        style={{ fontFamily: 'Noto Serif TC', fontSize: 18, fontWeight: '700', color: tone.fg }}
      >
        {meta.zh}
      </Text>
      <Text
        style={{
          fontSize: 12,
          fontWeight: '900',
          color: tone.fg,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
        }}
      >
        {faan !== null ? `${meta.en} (${faan} faan)` : meta.en}
      </Text>
    </Pressable>
  );
}

function claimFor(kind: Exclude<CallKind, 'chi'>): Claim {
  // chi has its own path via `ChiOptionPicker` — it needs the two
  // completing tiles bundled into the action. Other kinds are bare tags.
  return { kind } as Claim;
}
