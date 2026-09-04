import type { Action, Tile as MTile, Seat } from '@mahjong/game-logic';
import { nextDealer, sameTile, sortHand, tileId } from '@mahjong/game-logic';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRecorder } from '../replay/recorder';
import { nameForSeat, useGame } from '../state/game';
import { randomSeed } from '../util';
import { RulePanel } from './RulePanel';
import { ScoringBreakdownModal } from './ScoringBreakdownModal';
import { Tile } from './Tile';
import { GhostButton, PrimaryButton } from './buttons';
import { COLORS } from './colors';
import { MeldStrip } from './match/MeldStrip';

interface ResultPanelProps {
  onAction: (a: Action) => void;
  mySeat: Seat;
  isHost: boolean;
  /** Surfaces a "Leave match" button next to "Start next hand". On the
   *  mobile shell the panel renders as a full-screen dim overlay that
   *  visually covers the ☰ menu pill (where Leave normally lives), so
   *  exposing it here is the only discoverable exit between hands. */
  onLeave: () => void;
  /** `paper` (default) is the classic cream card; `glass` is the dark
   *  translucent surface the Three.js HUD hosts it in (transparent
   *  body, gold primary CTA, uppercase labels, rules collapsed). */
  theme?: ResultPanelTheme;
  /** Glass only: tighter spacing + smaller winning-hand tiles. */
  compact?: boolean;
  /** Override the winning-hand tile width (height follows at 36/26);
   *  the 3D desktop veil bumps it to ~40 px inside its 700 px card. */
  handTileWidth?: number | undefined;
}

export type ResultPanelTheme = 'paper' | 'glass';

const GLASS = {
  text: 'rgba(255,255,255,0.92)',
  text2: 'rgba(255,255,255,0.62)',
  gold: '#d8a85a',
  goldInk: '#2a2418',
  border: 'rgba(255,255,255,0.12)',
  borderGold: 'rgba(216,168,90,0.55)',
  surface: 'rgba(255,255,255,0.06)',
} as const;

/**
 * End-of-hand result.
 * Wins show a one-line summary + a "View breakdown" button that opens
 * `ScoringBreakdownModal` with the per-pattern faan list.
 */
export function ResultPanel({
  onAction,
  mySeat,
  isHost,
  onLeave,
  theme = 'paper',
  compact = false,
  handTileWidth,
}: ResultPanelProps) {
  const state = useGame((s) => s.state);
  const lobby = useGame((s) => s.lobby);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  if (!state || !state.lastResult) return null;
  const r = state.lastResult;
  const dealerForNext = nextDealer(state);
  const glass = theme === 'glass';
  const startNext = () => onAction({ t: 'startHand', seed: randomSeed(), dealer: dealerForNext });

  if (glass) {
    const winnerName =
      r.kind === 'win' ? (r.winner === mySeat ? 'You' : nameForSeat(lobby, r.winner)) : '';
    const fromName =
      r.kind === 'win' && !r.selfDraw
        ? r.from === mySeat
          ? 'you'
          : nameForSeat(lobby, r.from)
        : null;
    return (
      <View style={{ padding: compact ? 10 : 14, gap: compact ? 10 : 12 }}>
        <SaveReplayButton theme="glass" />
        {r.kind === 'win' ? (
          <View style={{ gap: 6 }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: '800',
                letterSpacing: 2,
                textTransform: 'uppercase',
                color: GLASS.gold,
              }}
            >
              {r.faan} faan · {r.selfDraw ? 'self-draw 自摸' : `ron from ${fromName}`}
            </Text>
            <Text
              style={{
                fontSize: compact ? 24 : 28,
                fontWeight: '800',
                letterSpacing: -0.5,
                color: GLASS.text,
                paddingRight: 72,
              }}
            >
              {winnerName === 'You' ? 'You win!' : `${winnerName} wins!`}
            </Text>
            <WinningHand
              winner={r.winner}
              winningTile={r.tile}
              glass
              compact={compact}
              tileWidth={handTileWidth}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
              <GlassChip onPress={() => setBreakdownOpen(true)} label="View breakdown" />
            </View>
          </View>
        ) : (
          <View style={{ gap: 6 }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: '800',
                letterSpacing: 2,
                textTransform: 'uppercase',
                color: GLASS.text2,
              }}
            >
              Wall empty
            </Text>
            <Text
              style={{
                fontSize: compact ? 24 : 28,
                fontWeight: '800',
                letterSpacing: -0.5,
                color: GLASS.text,
              }}
            >
              Drawn game
            </Text>
          </View>
        )}

        <RulePanel
          rules={state.rules}
          isHost={isHost}
          onAction={onAction}
          theme="glass"
          collapsible
        />

        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <GlassCta disabled={!isHost} onPress={startNext} label="Start next hand" />
          <GlassChip onPress={onLeave} label="Leave match" />
          <Text
            style={{
              fontSize: 11,
              fontWeight: '800',
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              color: GLASS.text2,
              marginLeft: 'auto',
            }}
          >
            Next dealer · {dealerForNext === mySeat ? 'you' : nameForSeat(lobby, dealerForNext)}
          </Text>
        </View>

        {r.kind === 'win' ? (
          <ScoringBreakdownModal
            open={breakdownOpen}
            onClose={() => setBreakdownOpen(false)}
            result={r}
            faanMin={state.rules.faanMin}
            theme="glass"
          />
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={{
        marginTop: 16,
        padding: 14,
        backgroundColor: COLORS.paper,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 8,
        gap: 10,
      }}
    >
      <SaveReplayButton />
      {r.kind === 'win' ? (
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.ink }}>
            Seat {r.winner} wins!
          </Text>
          <Text style={{ fontSize: 13, color: COLORS.ink3 }}>
            {r.faan} faan ({r.selfDraw ? 'self-draw 自摸' : `from seat ${r.from}`})
          </Text>
          <WinningHand winner={r.winner} winningTile={r.tile} />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <GhostButton onPress={() => setBreakdownOpen(true)}>View breakdown</GhostButton>
          </View>
        </View>
      ) : (
        <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.ink }}>
          Drawn game (wall empty)
        </Text>
      )}

      <RulePanel rules={state.rules} isHost={isHost} onAction={onAction} />

      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <PrimaryButton disabled={!isHost} onPress={startNext}>
          Start next hand
        </PrimaryButton>
        <GhostButton onPress={onLeave}>Leave match</GhostButton>
        <Text style={{ fontSize: 12, color: COLORS.ink3 }}>
          (seat {mySeat}; next dealer: seat {dealerForNext})
        </Text>
      </View>

      {r.kind === 'win' ? (
        <ScoringBreakdownModal
          open={breakdownOpen}
          onClose={() => setBreakdownOpen(false)}
          result={r}
          faanMin={state.rules.faanMin}
        />
      ) : null}
    </View>
  );
}

/**
 * Winning hand display for the result panel: the winner's exposed
 * melds (in claim order — chi tiles already arrive sorted), followed
 * by the concealed strip in canonical hand-display order (man <
 * pin < sou < honors), with the winning tile highlighted by a
 * gold-tinted frame the way the catalog example hands do. Reads
 * directly from `state.hands[winner]` (which post-fix includes the
 * winning tile) so the source of truth is the engine's resolved
 * state rather than re-deriving from `lastResult`.
 */
function WinningHand({
  winner,
  winningTile,
  glass = false,
  compact = false,
  tileWidth,
}: {
  winner: Seat;
  winningTile: MTile;
  glass?: boolean;
  compact?: boolean;
  tileWidth?: number | undefined;
}) {
  const state = useGame((s) => s.state);
  if (!state) return null;
  const concealed = sortHand(state.hands[winner]);
  const melds = state.melds[winner];
  // Compact glass (phone): 14 tiles + 13 gaps + the winning tile's
  // frame must fit the 356 px card interior at 412 px, so 22 × 30.
  const tw = tileWidth ?? (glass && compact ? 22 : 26);
  const th =
    tileWidth !== undefined ? Math.round(tileWidth * (36 / 26)) : glass && compact ? 30 : 36;
  const gap = glass && compact ? 2 : 3;
  return (
    <View
      // `testID` so the scoring-intro / yaku-gallery regression
      // spec can assert the winning-hand row is on-screen and not
      // covered by the tutorial caption card.
      testID="winning-hand"
      style={{ gap: 6, marginTop: 4 }}
    >
      {melds.length > 0 ? <MeldStrip melds={melds} tileWidth={22} tileHeight={30} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap, alignItems: 'center' }}>
        {concealed.map((t) => {
          // `sameTile` matches by id (suit/rank + copy), so only the
          // exact physical winning tile gets the gold frame even when
          // the winner holds another copy of the same face.
          const isWin = sameTile(t, winningTile);
          if (isWin) {
            return (
              <View
                key={tileId(t)}
                style={{
                  padding: 2,
                  borderRadius: 4,
                  backgroundColor: glass ? 'rgba(216,168,90,0.22)' : '#fff5d6',
                  borderColor: glass ? GLASS.gold : '#d4a73a',
                  borderWidth: 1,
                  boxShadow: glass ? '0 0 12px rgba(216,168,90,0.55)' : undefined,
                }}
              >
                <Tile tile={t} width={tw} height={th} />
              </View>
            );
          }
          return <Tile key={tileId(t)} tile={t} width={tw} height={th} />;
        })}
      </View>
    </View>
  );
}

/**
 * Small "save replay" pill anchored in the top-right corner of the
 * ResultPanel. The save action used to live inside the ☰ menu sheet,
 * but the mobile shell renders the post-hand panel as a full-screen
 * dim overlay that covers the ☰ pill, so between hands the user had
 * no way to reach Save. Surfacing it on the panel itself fixes that
 * without re-exposing the entire menu.
 *
 * Hidden when:
 *   - There's no active draft (no match in progress; tutorials +
 *     spectator views never start one).
 *   - `settings.autoRecordReplays` is on. Manual save is redundant
 *     when finalize will auto-persist on teardown, and surfacing it
 *     implies the save is opt-in when it's actually automatic — users
 *     opt out via Settings → Auto-record to regain manual control.
 */
function SaveReplayButton({ theme = 'paper' }: { theme?: ResultPanelTheme }) {
  const glass = theme === 'glass';
  const draftActive = useRecorder((s) => s.draft !== null);
  const savedThisMatch = useRecorder((s) => s.savedThisMatch);
  const saveExplicit = useRecorder((s) => s.saveExplicit);
  const discardThisMatch = useRecorder((s) => s.discardThisMatch);
  const replayQuota = useGame((s) => s.settings.replayQuota);
  const autoRecord = useGame((s) => s.settings.autoRecordReplays);
  if (!draftActive || autoRecord) return null;
  const onPress = () => {
    if (savedThisMatch) discardThisMatch();
    else saveExplicit(replayQuota);
  };
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={savedThisMatch ? 'Replay saved — tap to discard' : 'Save replay'}
      style={({ pressed }) => ({
        position: 'absolute',
        top: 10,
        right: 10,
        // RN-Web styles every View `position: relative`, so later
        // siblings paint on top by document order and intercept taps
        // on this absolute button — lift it above them.
        zIndex: 2,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 14,
        backgroundColor: glass
          ? pressed
            ? 'rgba(216,168,90,0.22)'
            : GLASS.surface
          : pressed
            ? COLORS.cream
            : 'white',
        borderColor: glass ? GLASS.borderGold : COLORS.hairline,
        borderWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
      })}
    >
      <Text style={{ fontSize: 13 }}>{savedThisMatch ? '✓' : '💾'}</Text>
      <Text
        style={{
          fontSize: 11,
          fontWeight: '800',
          color: glass ? GLASS.text : COLORS.ink2,
          letterSpacing: glass ? 1.5 : 0.4,
        }}
      >
        {savedThisMatch ? 'SAVED' : 'SAVE'}
      </Text>
    </Pressable>
  );
}

/** Gold primary CTA in the glass theme (44 px min height, ink text). */
function GlassCta({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        minHeight: 44,
        paddingHorizontal: 18,
        borderRadius: 12,
        justifyContent: 'center',
        backgroundColor: disabled ? 'rgba(216,168,90,0.35)' : pressed ? '#c99a4c' : GLASS.gold,
        borderWidth: 1,
        borderColor: 'rgba(255,235,190,0.55)',
        boxShadow: disabled ? undefined : '0 8px 24px rgba(216,168,90,0.28)',
        opacity: disabled ? 0.7 : 1,
        transform: [{ scale: pressed && !disabled ? 0.97 : 1 }],
      })}
    >
      <Text style={{ color: GLASS.goldInk, fontWeight: '800', fontSize: 13, letterSpacing: 0.3 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Glass secondary button (translucent fill, gold-tinted hairline). */
function GlassChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        minHeight: 44,
        paddingHorizontal: 16,
        borderRadius: 12,
        justifyContent: 'center',
        backgroundColor: pressed ? 'rgba(216,168,90,0.22)' : GLASS.surface,
        borderWidth: 1,
        borderColor: GLASS.borderGold,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <Text style={{ color: GLASS.text, fontWeight: '800', fontSize: 13, letterSpacing: 0.3 }}>
        {label}
      </Text>
    </Pressable>
  );
}
