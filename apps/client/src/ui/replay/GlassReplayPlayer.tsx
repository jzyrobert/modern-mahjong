import { SEATS, type Seat, seatWindFor, tileId } from '@mahjong/game-logic';
import { useMemo, useState } from 'react';
import { Platform, Text, View, type ViewStyle, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayback } from '../../replay/playback';
import { ReplayTable3D, replayHudLayout } from '../../three/entry';
import { Tile } from '../Tile';
import { type Position, SEAT_COLOR } from '../match/seatColor';
import { GlassCard } from '../menu/GlassCard';
import { ChevronLeftIcon, TrashIcon } from '../menu/icons';
import { MENU, TYPE, webStyle } from '../menu/theme';
import { GlassScrubber } from './GlassScrubber';
import { useChapters } from './chapters';
import {
  ChromeIconButton,
  ChromeToast,
  EventTicker,
  EventsRail,
  ReplaySeatBadge,
  type ReplaySeatBadgeProps,
  ReplayStatusPill,
  SEAT_BADGE_H,
} from './glassParts';
import { ExportIcon } from './icons';
import { positionMapFor, povSeat } from './seats';

/**
 * The replay player under the 3D renderer: the match's own Three.js
 * table (`ReplayTable3D`) projecting `frames[cursor].state` from behind
 * the point-of-view seat, with the parlour's glass chrome laid out in
 * the match shell's bands (`three/replay/layout`):
 *
 *   - phone portrait — chrome row (status pill, back / export / delete),
 *     the three other seats' badges in a strip under it, the table with
 *     the POV hand held near the camera, and the dock under the hand:
 *     the newest event's line, then the glass scrubber (POV seat badge
 *     + POV picker, chapter timeline, transport + speed);
 *   - phone landscape — the chrome row's left cluster, the far seat's
 *     badge in the row, side badges in the top corners, and the dense
 *     footer row (badge, transport, timeline, speed, POV);
 *   - desktop — the chrome row, an events rail under the status pill,
 *     seat badges docked off the table's projected landmarks, and a
 *     glass footer panel over the void band under the hand.
 *
 * The page behind is `LobbyBackdrop scene={false}` (the route paints
 * it), so a WebGL failure falls back to a glass card over the void.
 */
export interface ReplayPlayerActions {
  onBack: () => void;
  onExport: () => void;
  onDelete: () => void;
  exportLabel: string | null;
}

export function GlassReplayPlayer({ actions }: { actions?: ReplayPlayerActions | undefined }) {
  const playback = usePlayback();
  const { state, header, pov, cursor, totalFrames, events } = playback;
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const chrome = useMemo(
    () => replayHudLayout?.chrome(width, height, insets) ?? null,
    [width, height, insets],
  );
  // Side seats show flat tiles (a revealed hand, or melds) that reach
  // further out than a standing rack — the desktop docks key off that.
  const sideRevealed = pov === 'all' || state.phase === 'resolved';
  const badgeSlots = useMemo(
    () => replayHudLayout?.badgeSlots(width, height, insets, { sideRevealed }) ?? null,
    [width, height, insets, sideRevealed],
  );
  const apron = useMemo(
    () => replayHudLayout?.apron(width, height, insets) ?? null,
    [width, height, insets],
  );
  const [tableFailed, setTableFailed] = useState(false);

  const me = povSeat(pov, header.localSeat);
  const positions = useMemo(() => positionMapFor(pov, header.localSeat), [pov, header.localSeat]);
  const seatAt = useMemo(() => {
    const out: Partial<Record<Position, Seat>> = {};
    for (const seat of SEATS) out[positions[seat]] = seat;
    return out as Record<Position, Seat>;
  }, [positions]);
  // The POV seat's drawn tile this frame (gap + glow in its hand), and
  // the newest discard for the river cue.
  const drawnTileId = useMemo(() => {
    if (!(state.phase === 'turn' && state.turn === me && state.hasDrawn && state.drewThisTurn))
      return null;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (e.t === 'drew' && e.seat === me) return tileId(e.tile);
    }
    return null;
  }, [state, me, events]);
  const latestDiscardId =
    state.discardOrder.length > 0
      ? tileId(state.discardOrder[state.discardOrder.length - 1]!.tile)
      : null;
  const handNumber = useMemo(() => {
    // Hands started up to the cursor — the chapter the frame sits in.
    let n = 0;
    for (const b of playback.bookmarks) if (b.kind === 'hand-start' && b.seq <= cursor) n++;
    return Math.max(1, n);
  }, [playback.bookmarks, cursor]);
  const chapters = useChapters();
  const badgeFor = (seat: Seat): ReplaySeatBadgeProps => {
    const player = header.players[seat];
    return {
      name: player?.displayName ?? `Seat ${seat}`,
      seatColor: SEAT_COLOR[positions[seat]],
      seatWind: seatWindFor(state.dealer, seat),
      score: state.scoreboard[seat],
      isDealer: state.dealer === seat,
      isActive: state.phase === 'turn' && state.turn === seat,
      isYou: header.localSeat === seat,
      isBot: player?.isBot ?? false,
    };
  };
  const latestEvent = events.length > 0 ? events[events.length - 1]! : null;
  const nameFor = (seat: Seat) => header.players[seat]?.displayName ?? `Seat ${seat}`;

  if (!chrome) {
    // No layout maths (native): the route only asks for glass on web.
    return null;
  }
  const { cls, pad } = chrome;
  const portrait = cls === 'phone-portrait';
  const landscape = cls === 'phone-landscape';
  const compact = cls !== 'desktop';
  const buttonSize = landscape ? chrome.chromeH : 44;
  const iconColor = MENU.text2;

  const table =
    ReplayTable3D && !tableFailed ? (
      <ReplayTable3D
        state={state}
        me={me}
        revealAll={pov === 'all'}
        drawnTileId={drawnTileId}
        latestDiscardId={latestDiscardId}
        topInset={insets.top}
        onFatal={() => setTableFailed(true)}
      />
    ) : (
      <TableFallback me={me} />
    );

  const chromeButtons = actions ? (
    <>
      <ChromeIconButton
        label="← Library"
        icon={<ChevronLeftIcon size={12} color={iconColor} />}
        onPress={actions.onBack}
        size={buttonSize}
        testID="replay-back"
      />
      <ChromeIconButton
        label="Export replay JSON"
        icon={<ExportIcon size={16} color={iconColor} />}
        onPress={actions.onExport}
        size={buttonSize}
        testID="replay-export"
      />
      <ChromeIconButton
        label="Delete replay"
        icon={<TrashIcon size={15} color="#e59a8b" />}
        onPress={actions.onDelete}
        size={buttonSize}
        danger
        testID="replay-delete"
      />
    </>
  ) : null;

  const youBadge = (
    <ReplaySeatBadge {...badgeFor(me)} fluid dense={compact} testID="replay-you-badge" />
  );

  return (
    <View
      testID="replay-player"
      {...dataAttrs({ theme: 'glass', viewport: cls, cursor: String(cursor), pov: String(pov) })}
      style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        // Portrait: the lit floor band the table stands on, between
        // the near rail and the held hand (the match paints the same).
        ...(apron ? webStyle({ backgroundImage: apronBg(apron.top, apron.height) }) : {}),
      }}
    >
      {table}

      {/* Chrome row */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          left: pad + insets.left,
          right: pad + insets.right + chrome.fullscreenReserve,
          top: chrome.chromeTop,
          minHeight: chrome.chromeH,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          zIndex: 5,
        }}
      >
        <ReplayStatusPill
          prevailingWind={state.prevailingWind}
          handNumber={handNumber}
          cursor={cursor}
          totalFrames={totalFrames}
          wallCount={state.wall.length}
          compact={compact}
          dense={landscape}
          showCounter={!portrait}
          dealt={state.phase !== 'waiting'}
        />
        <View style={{ flex: 1 }} />
        {actions?.exportLabel ? <ChromeToast>{actions.exportLabel}</ChromeToast> : null}
        {chromeButtons}
      </View>

      {/* Seat badges */}
      {portrait ? (
        <View
          testID="replay-seat-strip"
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: pad + insets.left,
            right: pad + insets.right,
            top: chrome.stripTop,
            height: chrome.stripH,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            zIndex: 2,
          }}
        >
          {(['left', 'top', 'right'] as Position[]).map((pos) => (
            <ReplaySeatBadge
              key={pos}
              {...badgeFor(seatAt[pos])}
              dense
              stacked
              testID={`replay-seat-badge-${pos}`}
            />
          ))}
        </View>
      ) : badgeSlots ? (
        (['top', 'left', 'right'] as const).map((pos) => {
          const slot = badgeSlots[pos];
          const style: ViewStyle = {
            position: 'absolute',
            zIndex: 2,
            ...(slot.centerX !== undefined
              ? { left: slot.centerX, transform: [{ translateX: '-50%' }] }
              : {}),
            ...(slot.left !== undefined && slot.centerX === undefined ? { left: slot.left } : {}),
            ...(slot.right !== undefined ? { right: slot.right } : {}),
            ...(slot.top !== undefined ? { top: slot.top } : {}),
            ...(slot.bottom !== undefined ? { bottom: slot.bottom } : {}),
          };
          return (
            <View key={pos} pointerEvents="none" style={style}>
              <ReplaySeatBadge {...badgeFor(seatAt[pos])} dense={landscape} />
            </View>
          );
        })
      ) : null}

      {/* Desktop events rail under the status pill */}
      {compact ? null : (
        <EventsRail
          events={events}
          handNumber={handNumber}
          nameFor={nameFor}
          style={{
            position: 'absolute',
            left: pad + insets.left,
            top: chrome.stripTop,
            width: 272,
            maxHeight: 220,
            zIndex: 3,
          }}
        />
      )}

      {/* Portrait dock under the held hand */}
      {portrait ? (
        <View
          testID="replay-dock"
          style={{
            position: 'absolute',
            left: pad + insets.left,
            right: pad + insets.right,
            bottom: chrome.dockBottom,
            height: chrome.dockH,
            justifyContent: 'flex-end',
            gap: 4,
            zIndex: 4,
          }}
        >
          <EventTicker event={latestEvent} nameFor={nameFor} style={{ paddingHorizontal: 6 }} />
          <GlassScrubber chapters={chapters} layout="stack" compact leading={youBadge} />
        </View>
      ) : (
        <View
          testID="replay-footer"
          style={{
            position: 'absolute',
            left: pad + insets.left,
            right: pad + insets.right,
            bottom: chrome.footerBottom,
            height: chrome.footerH,
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 4,
          }}
        >
          {landscape ? (
            <View style={{ alignSelf: 'stretch', flex: 1, justifyContent: 'center' }}>
              <GlassScrubber
                chapters={chapters}
                layout="row"
                compact
                leading={youBadge}
                showCounter={false}
              />
            </View>
          ) : (
            <View
              style={{
                ...glassPanel,
                alignSelf: 'stretch',
                maxWidth: 1180,
                width: '100%',
                marginHorizontal: 'auto',
                height: chrome.footerH,
                justifyContent: 'center',
                paddingHorizontal: 12,
              }}
            >
              <GlassScrubber
                chapters={chapters}
                layout="row"
                compact={false}
                showCounter={false}
                leading={
                  <View style={{ flexShrink: 0, maxWidth: 260, height: SEAT_BADGE_H }}>
                    {youBadge}
                  </View>
                }
              />
            </View>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * `dataSet` is an RN-web prop (→ `data-*` attributes) the RN typings
 * don't know; the 3D replay spec reads `data-cursor` / `data-pov` off
 * the root. Empty off-web.
 */
function dataAttrs(values: Record<string, string>): Record<string, unknown> {
  return Platform.OS === 'web' ? { dataSet: values } : {};
}

/**
 * The portrait apron's paint (CSS background layers): a contact shadow
 * that takes the top ~10 px to near-black (the floor reads as *under*
 * the rail), a warm lacquer-brown floor tone fading into the void by
 * the hand's top edge, and a soft lamp pool centred on the band.
 */
function apronBg(top: number, h: number): string {
  return (
    `linear-gradient(180deg, rgba(0,0,0,0) ${top - 1}px, rgba(4,6,5,0.85) ${top}px, rgba(8,10,8,0.7) ${top + 9}px, rgba(42,29,20,0.58) ${top + 16}px, rgba(46,32,20,0.42) ${top + Math.round(h * 0.6)}px, rgba(30,26,18,0.12) ${top + h - 2}px, rgba(30,26,18,0) ${top + h + 2}px), ` +
    `radial-gradient(ellipse 70% ${Math.round(h * 1.3)}px at 50% ${top + Math.round(h * 0.55)}px, rgba(176,132,72,0.28) 0%, rgba(120,96,56,0.14) 55%, rgba(58,74,58,0) 100%)`
  );
}

const glassPanel: ViewStyle = {
  backgroundColor: MENU.glassBg,
  borderWidth: 1,
  borderColor: MENU.hairline,
  borderRadius: 16,
  boxShadow: MENU.shadow,
  backdropFilter: 'blur(16px) saturate(140%)',
  WebkitBackdropFilter: 'blur(16px) saturate(140%)',
} as ViewStyle;

/**
 * WebGL gave up (or the three entry is unavailable): keep the replay
 * usable — the point-of-view hand as DOM tiles on a glass card over the
 * void, with the same chrome around it.
 */
function TableFallback({ me }: { me: Seat }) {
  const { state, header } = usePlayback();
  const name = header.players[me]?.displayName ?? `Seat ${me}`;
  return (
    <View
      testID="replay-table-fallback"
      style={{
        position: 'absolute',
        inset: 0,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <GlassCard
        hover={false}
        style={{ padding: 20, gap: 12, alignItems: 'center', maxWidth: 520 }}
      >
        <Text style={[TYPE.label, { color: MENU.gold }]}>3D table unavailable</Text>
        <Text style={[TYPE.body, { textAlign: 'center' }]}>
          The graphics context could not start. Showing {name}'s hand for this frame.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3, justifyContent: 'center' }}>
          {state.hands[me].map((t, i) => (
            <Tile key={`${tileId(t)}-${i}`} tile={t} width={30} height={42} />
          ))}
        </View>
      </GlassCard>
    </View>
  );
}
