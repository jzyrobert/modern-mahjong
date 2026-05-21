import type { Action, Tile as MTile, Seat } from '@mahjong/game-logic';
import { nextDealer, sameTile, sortHand, tileId } from '@mahjong/game-logic';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRecorder } from '../replay/recorder';
import { useGame } from '../state/game';
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
}

/**
 * End-of-hand result.
 * Wins show a one-line summary + a "View breakdown" button that opens
 * `ScoringBreakdownModal` with the per-pattern faan list.
 */
export function ResultPanel({ onAction, mySeat, isHost, onLeave }: ResultPanelProps) {
  const state = useGame((s) => s.state);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  if (!state || !state.lastResult) return null;
  const r = state.lastResult;
  const dealerForNext = nextDealer(state);

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
        <PrimaryButton
          disabled={!isHost}
          onPress={() => onAction({ t: 'startHand', seed: randomSeed(), dealer: dealerForNext })}
        >
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
function WinningHand({ winner, winningTile }: { winner: Seat; winningTile: MTile }) {
  const state = useGame((s) => s.state);
  if (!state) return null;
  const concealed = sortHand(state.hands[winner]);
  const melds = state.melds[winner];
  return (
    <View
      // `testID` so the scoring-intro / yaku-gallery regression
      // spec can assert the winning-hand row is on-screen and not
      // covered by the tutorial caption card.
      testID="winning-hand"
      style={{ gap: 6, marginTop: 4 }}
    >
      {melds.length > 0 ? <MeldStrip melds={melds} tileWidth={22} tileHeight={30} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
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
                  backgroundColor: '#fff5d6',
                  borderColor: '#d4a73a',
                  borderWidth: 1,
                }}
              >
                <Tile tile={t} width={26} height={36} />
              </View>
            );
          }
          return <Tile key={tileId(t)} tile={t} width={26} height={36} />;
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
function SaveReplayButton() {
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
        backgroundColor: pressed ? COLORS.cream : 'white',
        borderColor: COLORS.hairline,
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
          color: COLORS.ink2,
          letterSpacing: 0.4,
        }}
      >
        {savedThisMatch ? 'SAVED' : 'SAVE'}
      </Text>
    </Pressable>
  );
}
