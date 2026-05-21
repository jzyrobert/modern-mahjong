import type { Action, GameState, Tile as MTile, Seat } from '@mahjong/game-logic';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LobbyState } from '../../state/game';
import type { FeltSkin } from '../../state/game';
import { ResultPanel } from '../ResultPanel';
import { ChatBubbles } from './ChatBubbles';
import { ClaimAnnouncementToast } from './ClaimAnnouncementToast';
import { ClaimMissedToast } from './ClaimMissedToast';
import { DrawTileOverlay } from './DrawTileOverlay';
import { LandscapeShell } from './LandscapeShell';
import { MatchModals } from './MatchModals';
import { MobileDrawCue } from './MobileDrawCue';
import { PortraitShell } from './PortraitShell';
import type { SortMode } from './SortPicker';
import type { Position } from './seatColor';
import type { SeatPlacement } from './seatPlacement';
import type { FELT_SKINS } from './skins';

interface MobileShellProps {
  state: GameState;
  seat: Seat;
  lobby: LobbyState | null;
  matchCode: string | null;
  felt: (typeof FELT_SKINS)[FeltSkin];
  isHost: boolean;
  myTurn: boolean;
  needsDraw: boolean;
  canTsumo: boolean;
  /** Faan the user would score by declaring tsumo right now — surfaced
   *  on the "Declare win" label so they can decide whether to commit.
   *  Null when `canTsumo` is false. */
  tsumoFaan: number | null;
  /** When set, the user's concealed hand has 4 copies of this face;
   *  shows a "Declare gang (concealed)" button next to the tsumo
   *  affordance. */
  concealedGangTile: MTile | null;
  /** When set, the user holds an existing peng meld of this face AND
   *  the fourth copy is in their concealed hand — surfaces a
   *  "Promote gang" button next to the tsumo / concealed-gang
   *  affordances. Dispatches `declareGangPromoted`. */
  promotedGangTile: MTile | null;
  hasClaimOption: boolean;
  /** Seat that would draw next once claims resolve. Drives the
   *  "next about to draw" gold halo on the next-seat's `OppHandStrip`
   *  badge. `null` outside `awaitingClaims`. */
  nextDrawerSeat: Seat | null;
  /** True once `pendingClaims.deadlineMs` has elapsed. */
  aboutToDraw: boolean;
  /** Whole seconds until `hardDeadlineMs` once `softExpiryMs` is crossed. */
  drawCountdown: number | null;
  /** Whole seconds until `state.turnDeadlineMs` for the active seat —
   *  `null` when the rule is off, in solo, or outside `phase: 'turn'`. */
  turnCountdown: number | null;
  latestDiscardId: number | null;
  /** Identity surfaced in the GameStatusBar pill — pre-computed in
   *  `Match.tsx` (user's own name + seat wind glyph + accent colour);
   *  the shells just forward it through. */
  userName: string;
  userWindGlyph: string;
  userWindBg: string;
  userWindFg: string;
  drawnTileId: number | null;
  /** When non-null, `Hand` highlights the matching `tileId` as the
   *  heuristic ranker's recommended discard. */
  hintTileId: number | null;
  /** Distinct wait faces when the user's concealed hand is at shanten
   *  0 (聽牌). Empty array → no badge rendered. */
  readyWaits: readonly MTile[];
  sortMode: SortMode;
  onSortModeChange: (m: SortMode) => void;
  onAction: (a: Action) => void;
  onLeave: () => void;
  onSendChat: (text: string) => void;
  onTileTap: (t: MTile) => void;
  /** `null` when the layout helper hasn't run (transport between
   *  hands). The shell omits the per-seat strips in that case. */
  byPosition: Record<Position, SeatPlacement> | null;
  seatToPosition: Record<Seat, Position>;
  /** True when the viewport is a landscape phone (width > height but
   *  still below the desktop threshold). Flattens the 3 opponent
   *  strips into a single horizontal row so the discard pool keeps
   *  vertical real estate — vertical-stack opp strips otherwise eat
   *  ~150 px and crush the flex middle to zero on a ~393 px landscape. */
  isLandscape: boolean;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  logOpen: boolean;
  setLogOpen: (open: boolean) => void;
  referenceOpen: boolean;
  setReferenceOpen: (open: boolean) => void;
  scoringOpen: boolean;
  setScoringOpen: (open: boolean) => void;
  playersOpen: boolean;
  setPlayersOpen: (open: boolean) => void;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
}

/**
 * Mobile match body dispatcher. Picks `PortraitShell` or
 * `LandscapeShell` based on `isLandscape` and hosts the shared
 * overlay surface (chat bubbles, claim toasts, draw-tile overlay,
 * the absolute-positioned `ResultPanel` between-hand summary, and
 * the `MatchModals` bottom-sheet container).
 *
 * Split out of `Match.tsx` to keep that file as a thin orchestrator;
 * pairs with `DesktopShell.tsx` for the perimeter-felt layout above
 * the desktop viewport threshold (see `Match.tsx`).
 *
 * The chrome row + scroll body + bottom band live inside the
 * orientation-specific shells. The outer felt-coloured `View` wraps
 * the SafeAreaView here so the background extends beneath the
 * safe-area inset; without it, on Android Chrome the area below the
 * URL-bar's retract zone shows the Stack's default cream
 * `contentStyle` through, which reads as a stripe of "white"
 * beneath the felt.
 */
export function MobileShell(props: MobileShellProps) {
  const {
    state,
    seat,
    lobby,
    matchCode,
    felt,
    isHost,
    myTurn,
    needsDraw,
    canTsumo,
    tsumoFaan,
    concealedGangTile,
    promotedGangTile,
    hasClaimOption,
    nextDrawerSeat,
    aboutToDraw,
    drawCountdown,
    turnCountdown,
    latestDiscardId,
    userName,
    userWindGlyph,
    userWindBg,
    userWindFg,
    drawnTileId,
    hintTileId,
    readyWaits,
    sortMode,
    onSortModeChange,
    onAction,
    onLeave,
    onSendChat,
    onTileTap,
    byPosition,
    seatToPosition,
    isLandscape,
    settingsOpen,
    setSettingsOpen,
    logOpen,
    setLogOpen,
    referenceOpen,
    setReferenceOpen,
    scoringOpen,
    setScoringOpen,
    playersOpen,
    setPlayersOpen,
    menuOpen,
    setMenuOpen,
  } = props;

  return (
    <View style={{ flex: 1, backgroundColor: felt.top }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: felt.top }} edges={['top', 'bottom']}>
        {isLandscape ? (
          <LandscapeShell
            state={state}
            seat={seat}
            lobby={lobby}
            matchCode={matchCode}
            felt={felt}
            myTurn={myTurn}
            needsDraw={needsDraw}
            canTsumo={canTsumo}
            tsumoFaan={tsumoFaan}
            concealedGangTile={concealedGangTile}
            promotedGangTile={promotedGangTile}
            hasClaimOption={hasClaimOption}
            nextDrawerSeat={nextDrawerSeat}
            aboutToDraw={aboutToDraw}
            drawCountdown={drawCountdown}
            turnCountdown={turnCountdown}
            latestDiscardId={latestDiscardId}
            userName={userName}
            userWindGlyph={userWindGlyph}
            drawnTileId={drawnTileId}
            hintTileId={hintTileId}
            readyWaits={readyWaits}
            sortMode={sortMode}
            onSortModeChange={onSortModeChange}
            onAction={onAction}
            onTileTap={onTileTap}
            byPosition={byPosition}
            seatToPosition={seatToPosition}
            setPlayersOpen={setPlayersOpen}
            setMenuOpen={setMenuOpen}
          />
        ) : (
          <PortraitShell
            state={state}
            seat={seat}
            lobby={lobby}
            matchCode={matchCode}
            felt={felt}
            myTurn={myTurn}
            needsDraw={needsDraw}
            canTsumo={canTsumo}
            tsumoFaan={tsumoFaan}
            concealedGangTile={concealedGangTile}
            promotedGangTile={promotedGangTile}
            hasClaimOption={hasClaimOption}
            nextDrawerSeat={nextDrawerSeat}
            aboutToDraw={aboutToDraw}
            drawCountdown={drawCountdown}
            turnCountdown={turnCountdown}
            latestDiscardId={latestDiscardId}
            userName={userName}
            userWindGlyph={userWindGlyph}
            userWindBg={userWindBg}
            userWindFg={userWindFg}
            drawnTileId={drawnTileId}
            hintTileId={hintTileId}
            readyWaits={readyWaits}
            sortMode={sortMode}
            onSortModeChange={onSortModeChange}
            onAction={onAction}
            onTileTap={onTileTap}
            byPosition={byPosition}
            seatToPosition={seatToPosition}
            setPlayersOpen={setPlayersOpen}
            setMenuOpen={setMenuOpen}
          />
        )}

        {/* Floating emote bubbles overlay (absolute-positioned). */}
        <ChatBubbles seatToPosition={seatToPosition} />
        <ClaimMissedToast />
        <ClaimAnnouncementToast />
        {/* Centre-of-felt draw cue + the post-tap flip/fly overlay.
            Both anchor at the same screen rect (`viewportW/2`,
            `viewportH*0.4`, 64×88), so the cue unmounts and the
            popup mounts at the same coordinates — the tap reads as
            "this tile flipped and flew into my hand" rather than
            "I tapped over there and a thing happened in the middle". */}
        <MobileDrawCue
          tile={needsDraw && state.wall.length > 0 ? state.wall[state.wall.length - 1]! : null}
          onPress={() => onAction({ t: 'draw', seat })}
        />
        <DrawTileOverlay />

        {/* ResultPanel — between-hand summary. Lifted out of the
            scrollable middle so it can overlay the felt cleanly when
            present. Wrapped in a ScrollView because in landscape (≤
            ~393 px tall) the panel's win summary + winning hand +
            rule editor + button row are taller than the viewport
            and would otherwise clip top-and-bottom with no way to
            reach the "Start next hand" button. `flexGrow: 1` on the
            content container keeps `justifyContent: 'center'`
            working when the content does fit. */}
        {state.lastResult ? (
          <ScrollView
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              top: 0,
              backgroundColor: 'rgba(0,0,0,0.55)',
            }}
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: 'center',
              padding: 16,
            }}
          >
            <ResultPanel onAction={onAction} mySeat={seat} isHost={isHost} onLeave={onLeave} />
          </ScrollView>
        ) : null}

        {/* The persistent emote bar that lives on the desktop felt is
            folded into `MenuSheet` here — see `onSendChat` below.
            Keeps the mobile body to play-relevant rows only. */}
        <MatchModals
          mySeat={seat}
          settingsOpen={settingsOpen}
          setSettingsOpen={setSettingsOpen}
          logOpen={logOpen}
          setLogOpen={setLogOpen}
          referenceOpen={referenceOpen}
          setReferenceOpen={setReferenceOpen}
          scoringOpen={scoringOpen}
          setScoringOpen={setScoringOpen}
          playersOpen={playersOpen}
          setPlayersOpen={setPlayersOpen}
          menuOpen={menuOpen}
          setMenuOpen={setMenuOpen}
          onLeave={onLeave}
          onSendChat={onSendChat}
        />
      </SafeAreaView>
    </View>
  );
}
