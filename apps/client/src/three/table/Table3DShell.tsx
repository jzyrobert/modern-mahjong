import type { Action, Tile as MTile, Seat } from '@mahjong/game-logic';
import type { GameState } from '@mahjong/game-logic';
import { seatWindFor, tileId } from '@mahjong/game-logic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Matrix4 } from 'three';
import { type LobbyState, nameForSeat, useGame } from '../../state/game';
import { ClaimBar } from '../../ui/ClaimBar';
import { ChatBubbles } from '../../ui/match/ChatBubbles';
import { ClaimAnnouncementToast } from '../../ui/match/ClaimAnnouncementToast';
import { ClaimMissedToast } from '../../ui/match/ClaimMissedToast';
import { MatchModals } from '../../ui/match/MatchModals';
import type { SortMode } from '../../ui/match/SortPicker';
import { type Position, SEAT_COLOR } from '../../ui/match/seatColor';
import { layoutFor } from '../../ui/match/seatPlacement';
import { TutorialTarget } from '../../ui/tutorial/TargetRegistry';
import { type SceneContext, type SceneHandle, SceneHost } from '../core/SceneHost';
import { TILE_H } from '../tiles/geometry';
import {
  TABLE_POOL_KEY,
  type TableDebugSnapshot,
  type TableScene,
  acquireTableScene,
  releaseTableScene,
} from './TableScene';
import {
  PORTRAIT_BAND_BIAS,
  PORTRAIT_BAND_GAP,
  PORTRAIT_BAND_TOP,
  PORTRAIT_FAR_RAIL_POINT,
  PORTRAIT_RIVER_SCALE,
  PORTRAIT_TRAY_GAP,
  PORTRAIT_TRAY_H,
  type ViewportClass,
  cameraFor,
  classifyViewport,
  heldHandFrameFor,
  heldHandTopPx,
  landscapeZoomCameraFor,
  riverZoomCameraFor,
  sheetCameraFor,
} from './cameraPresets';
import {
  ActionCtas,
  ActionRow,
  FOOTER_LEADING_MAX,
  ReadyBadgeCta,
  hasActionCtas,
} from './hud/ActionRow';
import { HandRail } from './hud/HandRail';
import { HitTargets, type HitTargetsHandle, type HudRects } from './hud/HitTargets';
import { MenuButtons } from './hud/MenuButtons';
import { ResultVeil } from './hud/ResultVeil';
import { SeatBadge, type SeatBadgeModel } from './hud/SeatBadges';
import { StatusPill } from './hud/StatusPill';
import { TableChip } from './hud/TableChip';
import { TurnChip } from './hud/TurnChip';
import { GLASS, GlassButton, HUD_CSS } from './hud/glass';
import {
  CENTRE_PLATE_RADIUS,
  FELT_HALF,
  HAND_Z,
  type HeldHandFrame,
  OWN_HAND_Z,
  RAIL_WIDTH,
  type Rel,
  SIDE_MELD_SCALE_PORTRAIT,
  SIDE_SEAT_OUT_DESKTOP,
  SIDE_SEAT_OUT_LOW,
  toWorld,
} from './layout';
import { type ScreenRect, padRect, rectsClose, unionRects } from './picking';

/**
 * The Three.js match shell `Match.tsx` mounts when the renderer
 * resolves to `'3d'`. Composes `SceneHost` (canvas + loop + camera
 * rig) with `TableScene` (felt, walls, hands, rivers, melds, plate,
 * dice — every tile through one `TilePool`) and a DOM glass HUD that
 * reuses the classic shells' logic components (`ClaimBar`,
 * `ResultPanel`, `MatchModals`, toasts, chat bubbles).
 *
 * Game state flows in through `sharedProps` (the same contract the
 * classic shells take) and is projected into the scene by `sync()`;
 * motion lives in the loop, never in React state. Anything tappable in
 * 3D is mirrored by a projected DOM hit-target (`hud/HitTargets`).
 *
 * Three viewport classes, three compositions:
 *   - phone portrait — the whole table fills the width under a chrome
 *     row + seat strip; the user's hand is *held* near the camera in
 *     two rows (`heldHandFrameFor`) so tiles stay ≥ 44 CSS px, a lit
 *     apron with the table's contact shadow between the near rail and
 *     the hand, and an action tray under the hand (turn chip, or the
 *     claim strip / declare CTAs) above the footer row.
 *   - phone landscape — low wide camera, hand across the bottom, 38 px
 *     chrome in the top-left (the root `FullscreenPrompt` owns the
 *     top-right), side badges in the top corners, a dense claim strip
 *     just above the hand, a 40 px footer tucked under it.
 *   - desktop — cinematic 3/4 view, badges projected beside each seat,
 *     claim strip in the footer's centre slot under the hand, CTAs
 *     inline in the action row, sort control at the right.
 */
export interface Table3DShellProps {
  state: GameState;
  seat: Seat;
  lobby: LobbyState | null;
  matchCode: string | null;
  isHost: boolean;
  myTurn: boolean;
  needsDraw: boolean;
  canTsumo: boolean;
  tsumoFaan: number | null;
  concealedGangTile: MTile | null;
  promotedGangTile: MTile | null;
  hasClaimOption: boolean;
  nextDrawerSeat: Seat | null;
  aboutToDraw: boolean;
  drawCountdown: number | null;
  turnCountdown: number | null;
  latestDiscardId: number | null;
  userName: string;
  userWindGlyph: string;
  drawnTileId: number | null;
  hintTileId: number | null;
  readyWaits: readonly MTile[];
  sortMode?: SortMode | undefined;
  onSortModeChange?: ((m: SortMode) => void) | undefined;
  seatToPosition?: Record<Seat, Position> | undefined;
  onAction: (a: Action) => void;
  onLeave: () => void;
  onSendChat: (text: string) => void;
  onTileTap: (t: MTile) => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  logOpen: boolean;
  setLogOpen: (v: boolean) => void;
  referenceOpen: boolean;
  setReferenceOpen: (v: boolean) => void;
  scoringOpen: boolean;
  setScoringOpen: (v: boolean) => void;
  playersOpen: boolean;
  setPlayersOpen: (v: boolean) => void;
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
}

declare global {
  // eslint-disable-next-line no-var
  var __MAHJONG_DEBUG_TILE_SHEET__: boolean | undefined;
  // eslint-disable-next-line no-var
  var __MAHJONG_TABLE_3D_DEBUG__: (() => TableDebugSnapshot | null) | undefined;
}

/**
 * Wide-preset void: the parlour lamp over the table. Two warm radials in
 * the accent gold (rgba 216,168,90) — a lamp cone from the top edge and
 * a wide low falloff behind the table centre — so a probe in desktop's
 * side voids reads warm-olive (R within ~15 % of G) rather than the flat
 * green-black of the bare gradient (round-4 #8: every sample was neutral
 * green); the cooler green radial under them keeps the felt's halo.
 */
const VOID_BG =
  'radial-gradient(ellipse 70% 45% at 50% 0%, rgba(216,168,90,0.15) 0%, rgba(216,168,90,0.06) 55%, rgba(216,168,90,0) 100%), ' +
  'radial-gradient(ellipse 95% 70% at 50% 45%, rgba(216,168,90,0.1) 0%, rgba(216,168,90,0.065) 50%, rgba(216,168,90,0) 90%), ' +
  'radial-gradient(ellipse 80% 45% at 50% 34%, rgba(58,74,58,0.28), rgba(58,74,58,0) 70%), ' +
  'linear-gradient(180deg, #0b120f 0%, #16241d 100%)';
/**
 * Portrait void. The table is width-bound, so the band above it (the
 * far rail under the seat strip, where toasts land) and the apron below
 * it (between the near rail and the held hand) are structural. The apron
 * is painted as the lit edge of the parlour floor under the table: a
 * contact shadow that takes the top ~10 px to near-black (rgba 0.78 →
 * the floor reads as *under* the rail), then a warm lacquer-brown floor
 * tone (#2a1d14 at 0.55) that fades into the void by the hand's top edge
 * (`apronH`), so the table stands on something and the hand is held in
 * front of it. Round-4 #5: the earlier radial glow measured as an ~8-unit
 * RGB dip across the band — the floor is now a stop-to-stop linear band
 * whose colours are chosen to be seen, not implied.
 */
function portraitVoidBg(
  centrePct: number,
  nearRailBottom: number | null,
  apronH: number | null,
): string {
  const c = Math.round(centrePct * 10) / 10;
  const top = nearRailBottom !== null ? Math.round(nearRailBottom) : null;
  const h = Math.max(24, Math.round(apronH ?? 36));
  const apron =
    top !== null
      ? `linear-gradient(180deg, rgba(0,0,0,0) ${top - 1}px, rgba(4,6,5,0.85) ${top}px, rgba(8,10,8,0.7) ${top + 9}px, rgba(42,29,20,0.58) ${top + 16}px, rgba(46,32,20,0.42) ${top + Math.round(h * 0.6)}px, rgba(30,26,18,0.12) ${top + h - 2}px, rgba(30,26,18,0) ${top + h + 2}px), ` +
        `radial-gradient(ellipse 70% ${Math.round(h * 1.3)}px at 50% ${top + Math.round(h * 0.55)}px, rgba(176,132,72,0.28) 0%, rgba(120,96,56,0.14) 55%, rgba(58,74,58,0) 100%), `
      : '';
  // The lamp above the table: a warm radial behind the chrome + seat
  // strip, so the band over the far rail reads as lit rather than as
  // neutral void (round-4 #8).
  return (
    `${apron}radial-gradient(ellipse 110% 28% at 50% 4%, rgba(216,168,90,0.12) 0%, rgba(216,168,90,0.05) 50%, rgba(216,168,90,0) 100%), ` +
    `radial-gradient(ellipse 150% 46% at 50% ${c}%, rgba(138,118,72,0.5) 0%, rgba(98,108,68,0.3) 40%, rgba(58,74,58,0.1) 62%, rgba(58,74,58,0) 78%), ` +
    `linear-gradient(180deg, #080c0a 0%, #16241c ${c}%, #0d1511 100%)`
  );
}
/**
 * Portrait river zoom: side-seat tiles cropped by the frame fade out
 * under these — opaque for the first 12 px so a wall column at the very
 * edge is hidden, not merely darkened.
 */
const ZOOM_EDGE_W = 28;
const ZOOM_EDGE_SOLID = 12;
/** River zoom: side-wall stacks beyond this world z (far side) are hidden. */
const ZOOM_HIDE_SIDE_WALLS_Z = -6.5;

const EMPTY_RECTS: HudRects = {
  ownHand: null,
  wallDraw: null,
  river: null,
  nearWall: null,
  discards: null,
  plateBottom: null,
  farRailTop: null,
  farRowTop: null,
  nearRailBottom: null,
};
const POSITIONS: Position[] = ['bottom', 'right', 'top', 'left'];
const REL_OF_POSITION: Record<Position, Rel> = { bottom: 0, right: 1, top: 2, left: 3 };
/** Height of the top chrome row (pill / menu buttons), CSS px. */
const CHROME_H = 44;
/**
 * Landscape chrome runs 38 px under an 8 px pad so the row's bottom edge
 * (y = 46) clears the far wall's projected top (y ≈ 54–61) by ≥ 8 px
 * instead of touching it.
 */
const CHROME_H_LANDSCAPE = 38;
/**
 * Landscape footer: 5 px safe pad + 40 px dense pills (37 px claim
 * strip) fit under the hand with ≥ 8 px between the strip's top border
 * and the tiles' bottom edge.
 */
const LANDSCAPE_FOOTER_PAD = 5;
/**
 * Desktop footer: 12 px safe pad (the chrome keeps 24). The footer's one
 * row grows upward from here into the void band under the hand row; see
 * `desktopBand`.
 */
const DESKTOP_FOOTER_PAD = 12;
/**
 * Air kept between the hand row's projected extent (`hudRects.ownHand`,
 * which already carries a 6 px pad) and any footer control.
 */
const DESKTOP_HAND_CLEAR = 4;
/**
 * Height of the desktop claim strip at `size="large"` (48 × 66 live
 * tile + 6 px pads + border + countdown bar). The strip only takes the
 * large size while the band under the hand can hold it; otherwise it
 * falls back to the 37 px `footer` strip rather than climbing onto the
 * tiles (round-FB1 critic: 10 px of every tile under the strip covered).
 */
const CLAIM_STRIP_LARGE_H = 84;
/**
 * Portrait phones ≤ 420 CSS px wide render at DPR 2 even on the `low`
 * tier: the canvas is small (≈ 1.5 MP) and the full-table river tiles
 * are ~19 CSS px, where the 1.5 clamp visibly softens the glyphs.
 */
const PORTRAIT_SHARP_MAX_WIDTH = 420;

/**
 * Table preset for a viewport. The river zoom (tap the discards) applies
 * on both phone classes: portrait eases the table in under the held
 * hand; landscape lifts the camera to 50° over the river block, framed
 * between the chrome row and the footer (the hand leaves the frame —
 * the ✕ in the chrome brings it back, and the shell exits the zoom by
 * itself when the turn comes round). Desktop rivers read at 38–40 px
 * and stay inert.
 */
function presetFor(width: number, height: number, topInset: number, zoom: boolean) {
  const cls = classifyViewport(width, height);
  if (zoom && cls === 'phone-portrait') return riverZoomCameraFor(width, height, topInset);
  if (zoom && cls === 'phone-landscape') {
    const yTop = 8 + topInset + CHROME_H_LANDSCAPE + 6;
    // The near wall's inner top edge lands just off the bottom edge.
    return landscapeZoomCameraFor(width, height, yTop, height + 3);
  }
  return cameraFor(width, height, topInset);
}
/** Held-hand frame for a viewport, or null outside phone portrait. */
function heldFrameFor(
  width: number,
  height: number,
  topInset: number,
  zoom: boolean,
): HeldHandFrame | null {
  return classifyViewport(width, height) === 'phone-portrait'
    ? heldHandFrameFor(presetFor(width, height, topInset, zoom), width, height)
    : null;
}
/**
 * Approximate height of a glass toast, CSS px (anchor maths only): the
 * claim toast's 32 px glyph line + 7 px pads + border.
 */
const TOAST_H = 50;
/** Width the root `FullscreenPrompt` reserves at the landscape top-right. */
const FULLSCREEN_PROMPT_W = 124;

export function Table3DShell(props: Table3DShellProps) {
  const felt = useGame((s) => s.settings.felt);
  const tileBack = useGame((s) => s.settings.tileBack);
  const manualOrder = useGame((s) => s.manualOrder);
  const shuffling = useGame((s) => s.shuffling);
  const drawAnimation = useGame((s) => s.drawAnimation);
  const clearDrawAnimation = useGame((s) => s.clearDrawAnimation);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const vpClass: ViewportClass = classifyViewport(width, height);
  const compact = vpClass !== 'desktop';
  const portrait = vpClass === 'phone-portrait';
  const landscape = vpClass === 'phone-landscape';
  const pad = compact ? 12 : 24;
  const chromeH = landscape ? CHROME_H_LANDSCAPE : CHROME_H;
  const sortMode: SortMode = props.sortMode ?? 'suit';
  const tileSheet = globalThis.__MAHJONG_DEBUG_TILE_SHEET__ === true;

  const sceneRef = useRef<TableScene | null>(null);
  const ctxRef = useRef<SceneContext | null>(null);
  const hitRef = useRef<HitTargetsHandle | null>(null);
  const badgeEls = useRef<Partial<Record<Position, HTMLDivElement | null>>>({});
  const lastCam = useRef(new Matrix4());
  const lastRects = useRef<HudRects>(EMPTY_RECTS);
  const lastRectPush = useRef(0);
  const settleFrames = useRef(0);
  const heldRef = useRef<HeldHandFrame | null>(null);
  const topInsetRef = useRef(insets.top);
  topInsetRef.current = insets.top;
  const [hudRects, setHudRects] = useState<HudRects>(EMPTY_RECTS);
  // Phone river zoom (tap the discards). Camera-only: the engine state
  // and the held hand are untouched, so it can flip at any time.
  const [riverZoom, setRiverZoom] = useState(false);
  const riverZoomRef = useRef(false);
  riverZoomRef.current = riverZoom && compact;

  // The 3D layer animates its own draw; drop the classic overlay's
  // pending draw-animation record so a later renderer switch doesn't
  // find a stale one.
  useEffect(() => {
    if (drawAnimation) clearDrawAnimation();
  }, [drawAnimation, clearDrawAnimation]);

  // Test / debug seam: the e2e spec + the screenshot verifier read the
  // live tile poses through this (never used by the app itself).
  useEffect(() => {
    globalThis.__MAHJONG_TABLE_3D_DEBUG__ = () =>
      sceneRef.current?.debugSnapshot(performance.now()) ?? null;
    return () => {
      globalThis.__MAHJONG_TABLE_3D_DEBUG__ = undefined;
    };
  }, []);

  // The tile to mark as "just drawn". A gang replacement comes out of
  // the dead wall without a `drew` event, so the store's `drawnTileId`
  // keeps pointing at the tile that has just gone *into* the meld — the
  // meld tile wore the drawn glow and the real replacement sorted into
  // the hand unmarked (round-FB1: "the wrong tile" on a promoted gang).
  // Diff the hand across a replacement to find the tile that arrived.
  const drawnTileId = useEffectiveDrawnTile(props.state, props.seat, props.drawnTileId);
  const shellProps = drawnTileId === props.drawnTileId ? props : { ...props, drawnTileId };

  // Latest inputs for the imperative side (built once, read live).
  const inputRef = useRef({
    props: shellProps,
    manualOrder,
    shuffling,
    sortMode,
    landscape,
    compact,
  });
  inputRef.current = { props: shellProps, manualOrder, shuffling, sortMode, landscape, compact };

  const syncScene = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const {
      props: p,
      manualOrder: mo,
      shuffling: sh,
      sortMode: sm,
      landscape: ls,
      compact: cp,
    } = inputRef.current;
    scene.sync(
      {
        state: p.state,
        me: p.seat,
        sortMode: sm,
        manualOrder: mo,
        drawnTileId: p.drawnTileId,
        latestDiscardId: p.latestDiscardId,
        hintTileId: p.hintTileId,
        needsDraw: p.needsDraw,
        canDiscard: p.myTurn && p.state.hasDrawn && p.state.phase === 'turn',
        shuffling: sh,
        heldHand: heldRef.current,
        riverScale: heldRef.current ? PORTRAIT_RIVER_SCALE : 1,
        // River zoom: the side walls' far thirds would fold back in under
        // the header bar (perspective) — drop them while zoomed.
        hideSideWallsBeyondZ: riverZoomRef.current ? ZOOM_HIDE_SIDE_WALLS_Z : undefined,
        // Landscape: the hand stands right in front of the near wall, so
        // the wall steps back a shade and the hand reads in front of it.
        nearWallDim: ls ? 0.85 : 1,
        // Landscape: side seats' racks + melds step out past the wall's
        // occlusion line (see `SIDE_SEAT_OUT_LOW`); the far seat's melds
        // stand on the far rail, clear of the far wall's silhouette.
        // Desktop: a smaller step so a side meld shows felt between
        // itself and the wall's top-face overhang (`SIDE_SEAT_OUT_DESKTOP`).
        sideSeatOut: ls ? SIDE_SEAT_OUT_LOW : cp ? 0 : SIDE_SEAT_OUT_DESKTOP,
        farMeldsOnRail: ls,
        // Landscape zoom: the side seats' rows would show as slivers at
        // the frame's edges — the rivers are what the zoom is for.
        hideSideSeats: ls && riverZoomRef.current,
        // Every preset: both side seats' melds at the corners nearest the
        // camera (the largest projection on all three cameras), and 1.15×
        // on the width-bound portrait table.
        sideMeldsNear: true,
        sideMeldScale: heldRef.current ? SIDE_MELD_SCALE_PORTRAIT : 1,
        // Wide presets: the user's melds stand in the hand row, faces to
        // the camera (the held portrait hand keeps its flat felt melds).
        ownMeldsStanding: true,
      },
      performance.now(),
    );
  }, []);

  // Project hit-targets / anchors. Runs from the loop; React state only
  // changes when the tutorial-anchor rects moved (throttled).
  const reproject = useCallback(
    (force: boolean, now: number) => {
      const scene = sceneRef.current;
      const ctx = ctxRef.current;
      if (!scene || !ctx) return;
      const cam = ctx.rig.camera;
      cam.updateMatrixWorld();
      const camMoved = !cam.matrixWorld.equals(lastCam.current);
      if (camMoved) lastCam.current.copy(cam.matrixWorld);
      if (!force && !camMoved && settleFrames.current > 2) return;
      const { props: p } = inputRef.current;
      const handRects: ScreenRect[] = [];
      // Projected extents the HUD anchors to: the near wall's stacks
      // (rel 0) and every river, so toasts / the landscape claim strip
      // land on free felt instead of a fixed offset that only held for
      // one break position.
      const nearWallRects: ScreenRect[] = [];
      const discardRects: ScreenRect[] = [];
      if (scene.layout) {
        for (const s of scene.layout) {
          if (!s) continue;
          if (s.zone === 'hand') {
            const r = scene.tileRect(s.id);
            hitRef.current?.setTileRect(s.id, r);
            // The tutorial's `own-hand` rect unions the *settled* poses,
            // so it is stable from the first frame of the deal (the
            // tap targets above still follow the visible tiles).
            const settled = scene.settledTileRect(s.id);
            if (settled) handRects.push({ ...settled });
            else if (r) handRects.push({ ...r });
          } else if ((s.zone === 'wall' || s.zone === 'deadWall') && s.rel === 0) {
            const r = scene.tileRect(s.id);
            if (r) nearWallRects.push({ ...r });
          } else if (s.zone === 'discard') {
            const r = scene.tileRect(s.id);
            if (r) discardRects.push({ ...r });
          }
        }
      }
      const nextId = scene.nextDrawTileId;
      const wallRect = p.needsDraw && nextId !== null ? scene.tileRect(nextId) : null;
      hitRef.current?.setWallRect(wallRect ? padRect(wallRect, 6, 36, 36) : null);

      // River region: the square inside the walls.
      const w = ctx.size.width;
      const h = ctx.size.height;
      const pts = [
        scene.projectPoint(-7.6, 0.3, -7.6),
        scene.projectPoint(7.6, 0.3, -7.6),
        scene.projectPoint(7.6, 0.3, 7.6),
        scene.projectPoint(-7.6, 0.3, 7.6),
      ];
      const river = unionRects(pts.map((q) => ({ left: q.x, top: q.y, width: 0, height: 0 })));
      const clampRect = (r: ScreenRect | null): ScreenRect | null => {
        if (!r) return null;
        const l = Math.max(0, r.left);
        const t = Math.max(0, r.top);
        const rgt = Math.min(w, r.left + r.width);
        const b = Math.min(h, r.top + r.height);
        return { left: l, top: t, width: Math.max(0, rgt - l), height: Math.max(0, b - t) };
      };
      const next: HudRects = {
        ownHand: clampRect(unionRects(handRects) ? padRect(unionRects(handRects)!, 6) : null),
        wallDraw: clampRect(wallRect ? padRect(wallRect, 8) : null),
        river: clampRect(river),
        nearWall: unionRects(nearWallRects),
        discards: unionRects(discardRects),
        plateBottom: scene.projectPoint(0, 0.3, CENTRE_PLATE_RADIUS + 0.4).y,
        farRailTop: scene.projectPoint(...PORTRAIT_FAR_RAIL_POINT).y,
        farRowTop: scene.projectPoint(0, TILE_H, -HAND_Z).y,
        nearRailBottom: scene.projectPoint(0, 0, FELT_HALF + RAIL_WIDTH).y,
      };

      // Desktop: seat badges follow their seat's hand row. Phones pin
      // them to the chrome instead (see `badgeFixedStyle`).
      if (!compact) {
        for (const pos of POSITIONS) {
          const el = badgeEls.current[pos];
          if (!el) continue;
          const rel = REL_OF_POSITION[pos];
          const [ax, az] = toWorld(
            rel,
            pos === 'bottom' ? -8.6 : 0,
            pos === 'bottom' ? OWN_HAND_Z : HAND_Z + 1.1,
          );
          const q = scene.projectPoint(ax, 0.9, az);
          const bw = el.offsetWidth;
          const bh = el.offsetHeight;
          let left: number;
          let top: number;
          if (pos === 'top') {
            left = q.x - bw / 2;
            top = q.y - bh - 10;
          } else if (pos === 'left') {
            left = q.x - bw - 12;
            top = q.y - bh / 2;
          } else if (pos === 'right') {
            left = q.x + 12;
            top = q.y - bh / 2;
          } else {
            left = q.x - bw - 14;
            top = q.y - bh / 2;
          }
          left = Math.min(Math.max(pad, left), w - bw - pad);
          top = Math.min(Math.max(pad + 52, top), h - bh - pad);
          el.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
        }
      }

      const changed =
        !rectsClose(next.ownHand, lastRects.current.ownHand) ||
        !rectsClose(next.wallDraw, lastRects.current.wallDraw) ||
        !rectsClose(next.river, lastRects.current.river) ||
        !rectsClose(next.nearWall, lastRects.current.nearWall) ||
        !rectsClose(next.discards, lastRects.current.discards) ||
        Math.abs((next.plateBottom ?? 0) - (lastRects.current.plateBottom ?? 0)) > 0.75 ||
        Math.abs((next.farRailTop ?? 0) - (lastRects.current.farRailTop ?? 0)) > 0.75 ||
        Math.abs((next.farRowTop ?? 0) - (lastRects.current.farRowTop ?? 0)) > 0.75 ||
        Math.abs((next.nearRailBottom ?? 0) - (lastRects.current.nearRailBottom ?? 0)) > 0.75;
      if (changed) {
        settleFrames.current = 0;
        if (force || now - lastRectPush.current > 140) {
          lastRectPush.current = now;
          lastRects.current = next;
          setHudRects(next);
        }
      } else {
        settleFrames.current++;
        if (settleFrames.current === 2 && !rectsClose(next.ownHand, hudRects.ownHand)) {
          lastRects.current = next;
          setHudRects(next);
        }
      }
    },
    [compact, pad, hudRects.ownHand],
  );
  const reprojectRef = useRef(reproject);
  reprojectRef.current = reproject;

  const build = useCallback(
    (ctx: SceneContext): SceneHandle => {
      ctxRef.current = ctx;
      const scene = acquireTableScene(ctx, {
        felt: useGame.getState().settings.felt,
        tileBack: useGame.getState().settings.tileBack,
        reducedMotion: ctx.reducedMotion,
        tileSheet,
      });
      sceneRef.current = scene;
      const inset = topInsetRef.current;
      const zoom = riverZoomRef.current;
      ctx.rig.snap(
        tileSheet
          ? sheetCameraFor(ctx.size.width, ctx.size.height)
          : presetFor(ctx.size.width, ctx.size.height, inset, zoom),
      );
      ctx.rig.halfLife = ctx.reducedMotion ? 0.04 : 0.24;
      ctx.rig.parallaxStrength = 0.45;
      heldRef.current = tileSheet
        ? null
        : heldFrameFor(ctx.size.width, ctx.size.height, inset, zoom);
      if (!tileSheet) syncScene();
      settleFrames.current = 0;
      return {
        update: (dt, now) => {
          const live = scene.update(dt, now);
          reprojectRef.current(live, now);
          return live;
        },
        resize: (w, h) => {
          const ti = topInsetRef.current;
          const zoom = riverZoomRef.current;
          ctx.rig.setPreset(tileSheet ? sheetCameraFor(w, h) : presetFor(w, h, ti, zoom));
          if (!tileSheet) {
            // The held-hand frame is viewport-derived; re-lay the hand
            // out so it slides between the table edge and the held
            // position on rotation.
            heldRef.current = heldFrameFor(w, h, ti, zoom);
            syncScene();
          }
          settleFrames.current = 0;
          reprojectRef.current(true, performance.now());
        },
        setQuality: (q) => scene.setQuality(q),
        dispose: () => {
          releaseTableScene(ctx, scene);
          sceneRef.current = null;
          ctxRef.current = null;
        },
      };
    },
    [tileSheet, syncScene],
  );

  // Project state changes into the scene. The deps are the inputs
  // `syncScene` reads through `inputRef` — listed explicitly so the
  // effect fires on exactly those changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: inputs are read via inputRef
  useEffect(() => {
    syncScene();
    settleFrames.current = 0;
    reprojectRef.current(true, performance.now());
  }, [
    syncScene,
    props.state,
    props.seat,
    props.drawnTileId,
    props.latestDiscardId,
    props.hintTileId,
    props.needsDraw,
    props.myTurn,
    drawnTileId,
    sortMode,
    manualOrder,
    shuffling,
  ]);

  // Live skin re-tint.
  useEffect(() => {
    sceneRef.current?.setSkins(felt, tileBack);
  }, [felt, tileBack]);

  // River zoom: ease the camera and re-derive the held-hand frame from
  // the new preset (the hand keeps its screen position; the table
  // eases in underneath it).
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || tileSheet) return;
    const zoom = riverZoom && compact;
    const { width: w, height: h } = ctx.size;
    ctx.rig.setPreset(presetFor(w, h, topInsetRef.current, zoom));
    heldRef.current = heldFrameFor(w, h, topInsetRef.current, zoom);
    syncScene();
    settleFrames.current = 0;
    ctx.loop.requestRender();
  }, [riverZoom, compact, tileSheet, syncScene]);
  const toggleRiverZoom = useCallback(() => setRiverZoom((v) => !v), []);
  const exitRiverZoom = useCallback(() => setRiverZoom(false), []);
  const ctaProps = {
    seat: props.seat,
    canTsumo: props.canTsumo,
    tsumoFaan: props.tsumoFaan,
    concealedGangTile: props.concealedGangTile,
    promotedGangTile: props.promotedGangTile,
    readyWaits: props.readyWaits,
    onAction: props.onAction,
    compact,
  };
  const showCtas = hasActionCtas(ctaProps);
  // Landscape zoom frames the river block and leaves the hand below the
  // footer; the footer's hand rail keeps it legible through the player's
  // own turn (that is when the rivers matter most — round-4 #1), so the
  // zoom ends by itself only when a decision wants the real hand and the
  // claim strip: a claim window or a declare CTA. Portrait keeps the
  // zoom throughout — the held hand is always in frame there. The user
  // can re-enter at any time.
  const landscapeDecides = landscape && (props.hasClaimOption || showCtas);
  useEffect(() => {
    if (landscapeDecides) setRiverZoom(false);
  }, [landscapeDecides]);

  // Pointer parallax.
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const ctx = ctxRef.current;
    if (!ctx || e.pointerType === 'touch') return;
    const nx = (e.clientX / Math.max(1, ctx.size.width)) * 2 - 1;
    const ny = (e.clientY / Math.max(1, ctx.size.height)) * 2 - 1;
    ctx.rig.setPointer(nx, -ny);
  }, []);
  const onPointerLeave = useCallback(() => ctxRef.current?.rig.setPointer(0, 0), []);

  // Derived HUD models.
  const { state, seat, lobby } = props;
  const placements = useMemo(() => layoutFor(seat, state.dealer), [seat, state.dealer]);
  const seatToPosition = useMemo(() => {
    if (props.seatToPosition) return props.seatToPosition;
    const m: Record<Seat, Position> = { 0: 'bottom', 1: 'bottom', 2: 'bottom', 3: 'bottom' };
    for (const p of placements) m[p.seat] = p.position;
    return m;
  }, [placements, props.seatToPosition]);
  const badges: SeatBadgeModel[] = placements.map((pl) => ({
    seat: pl.seat,
    position: pl.position,
    seatWind: seatWindFor(state.dealer, pl.seat),
    score: state.scoreboard[pl.seat],
    isDealer: state.dealer === pl.seat,
    isActive: state.phase === 'turn' && state.turn === pl.seat,
    aboutToDraw: props.aboutToDraw && props.nextDrawerSeat === pl.seat,
    drawCountdown: props.drawCountdown,
    turnCountdown: state.turn === pl.seat ? props.turnCountdown : null,
    isYou: pl.seat === seat,
  }));
  const badgeAt = (pos: Position) => badges.find((b) => b.position === pos);
  const activeSeat: Seat | null =
    state.phase === 'turn' && state.turn !== seat ? (state.turn as Seat) : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the scene layout is read imperatively; sort mode / manual order / drawn tile drive its order
  const ownHand = useMemo(() => {
    const scene = sceneRef.current;
    const layout = scene?.layout;
    const ids = layout
      ? layout.filter((s) => s !== null && s.zone === 'hand').map((s) => s!.id)
      : state.hands[seat].map(tileId);
    const byId = new Map(state.hands[seat].map((t) => [tileId(t), t] as const));
    const ordered: MTile[] = [];
    for (const id of ids) {
      const t = byId.get(id);
      if (t) ordered.push(t);
    }
    // Any tile the layout didn't list yet (first render) still needs a button.
    for (const t of state.hands[seat]) if (!ids.includes(tileId(t))) ordered.push(t);
    return ordered;
  }, [state, seat, sortMode, manualOrder, drawnTileId]);
  const nextDrawTile = state.wall.length > 0 ? state.wall[state.wall.length - 1]! : null;
  // Newest discard of the hand (the engine's `lastDiscard` only lives
  // through the claim window; `discardOrder` is the hand's full log).
  const lastDiscard =
    state.discardOrder.length > 0 ? state.discardOrder[state.discardOrder.length - 1]! : null;
  const canDiscard = props.myTurn && state.hasDrawn;
  const resolved = state.lastResult !== null && state.lastResult !== undefined;

  // Landscape lifts the chrome row to an 8 px pad so its bottom edge
  // clears the far wall's projected top by ≥ 8 px.
  const chromeTop = (landscape ? 8 : pad) + insets.top;
  const stripTop = chromeTop + chromeH + 8;
  const zoomed = compact && riverZoom && !resolved;
  // Both phone classes offer the zoom whenever the hand is not resolved,
  // except a landscape claim window / declare moment (see
  // `landscapeDecides`).
  const zoomAvailable = compact && !resolved && !landscapeDecides;
  // Projected near-wall extent the zoomed portrait toast drops below.
  const nearWallBottom = hudRects.nearWall
    ? hudRects.nearWall.top + hudRects.nearWall.height
    : null;
  // Toasts. Portrait (full table): over the far rail (glass on wood —
  // the rail is the one table surface that never holds a tile), sitting
  // as low as the far rack's tops allow (6 px clear) and never closer
  // than 6 px to the seat strip, which lets the table sit close under
  // the strip.
  // Portrait (river zoom): the far wall hides behind the zoom header,
  // so the toast drops to the felt between the near wall and the held
  // hand. Landscape: the chrome row beside the far seat's
  // badge. Desktop: the chrome row between the status pill and the
  // menu cluster — off the felt entirely, so a toast never lands on
  // the own-river growth zone or stacks with the footer claim strip.
  // Portrait hosts claims + CTAs in the action tray under the hand;
  // landscape and desktop host them in the footer row (landscape
  // replaces the sort control for the claim window — see `ActionRow`
  // `sortAlign="replace"`).
  const trayActions = portrait && (props.hasClaimOption || showCtas);
  const landscapeFooterClaim = landscape && (props.hasClaimOption || showCtas);
  // Landscape zoom: the hand rail takes the footer's centre slot (the
  // sort control is moot while the hand is out of frame).
  const landscapeRail = landscape && zoomed && !landscapeFooterClaim;
  const desktopStrip = !compact && props.hasClaimOption;
  // Wide presets: the footer's centre slot — directly under the hand —
  // carries the turn chip while it is the user's move (draw → discard),
  // so the cue sits where the eye already is instead of only in the
  // chrome pill. The claim strip / hand rail take the slot when they
  // need it.
  // Not during the between-hand ceremony: the dispense + 洗牌 pill own
  // that beat, and the new hand's "your turn" would read as stale chrome
  // under the veil (round-FB1 critic #6).
  const footerTurnChip = !portrait && props.myTurn && !resolved && !shuffling;
  // Desktop: the void band between the hand row's projected bottom and
  // the footer's bottom edge. Everything the footer hosts must fit in
  // it — a control that grows past it lands on the tiles.
  const footerPad = landscape ? LANDSCAPE_FOOTER_PAD : portrait ? pad : DESKTOP_FOOTER_PAD;
  const handBottom = hudRects.ownHand ? hudRects.ownHand.top + hudRects.ownHand.height : null;
  const desktopBand =
    !compact && handBottom !== null
      ? height - insets.bottom - footerPad - (handBottom + DESKTOP_HAND_CLEAR)
      : null;
  const desktopStripSize: 'large' | 'footer' =
    desktopBand === null || desktopBand >= CLAIM_STRIP_LARGE_H ? 'large' : 'footer';
  // Desktop: the CTAs (declare win / gang, promote) ride in the centre
  // slot beside the turn chip; the tenpai badge takes the left column.
  const desktopCtas = !compact && showCtas && !resolved;
  const desktopReadyBadge = !compact && props.readyWaits.length > 0 && !resolved;
  // Portrait: while the claim strip owns the tray, the compact tenpai
  // badge stands in for the (moot) sort control in the footer row.
  const portraitReadyBadge =
    portrait && trayActions && props.hasClaimOption && props.readyWaits.length > 0 && !resolved;
  // Landscape zoom header: a full-bleed glass band the far wall's row
  // (and the far seat's rack) park behind, so the chrome pills, the far
  // badge and the toast slot never sit on tile tops (round-4 #5).
  const landscapeHeaderH = chromeTop + chromeH + 6;
  // Portrait-only offset; landscape and desktop park toasts in the
  // chrome row (see `toastSlot`), the one void that never holds a tile
  // or a discard-to-be.
  // Portrait (full table): the toast rides the seat-strip row — glass
  // over glass, centred on the far seat's badge for its 1.8 s — because
  // the band between the strip and the far rail (~40 px) cannot hold a
  // 50 px toast without it lying on the rail's top edge or within a few
  // px of the far seat's rack (round-FB1 critic #9).
  const toastTop = portrait
    ? zoomed && nearWallBottom !== null
      ? nearWallBottom + 10
      : stripTop - 6
    : 0;
  // Portrait: where the table centre lands in the viewport (0–100 %),
  // for the void's lamp glow — from the projected river square once the
  // scene has one, else the band maths.
  const tableCentrePct = portrait
    ? (() => {
        if (hudRects.river && hudRects.river.height > 0)
          return ((hudRects.river.top + hudRects.river.height / 2) / height) * 100;
        const bandTop = PORTRAIT_BAND_TOP + insets.top;
        const bandBottom = heldHandTopPx(width, height) - PORTRAIT_BAND_GAP;
        return ((bandTop + PORTRAIT_BAND_BIAS * Math.max(0, bandBottom - bandTop)) / height) * 100;
      })()
    : 50;
  const toastSlot = (
    <>
      <ClaimMissedToast theme="glass" top={0} />
      <ClaimAnnouncementToast theme="glass" top={0} />
    </>
  );

  const badgeFixedStyle = (pos: Position): React.CSSProperties => {
    if (!compact) return { position: 'absolute', left: 0, top: 0, willChange: 'transform' };
    // Landscape: the far row hugs the top edge, so its badge pins to
    // the top centre; the side hands sit off-screen and their badges
    // tuck into the top corners under the chrome (the right one clears
    // the root fullscreen prompt).
    if (pos === 'top') {
      return { position: 'absolute', left: '50%', top: chromeTop, transform: 'translateX(-50%)' };
    }
    if (pos === 'left')
      return { position: 'absolute', left: pad + insets.left, top: chromeTop + chromeH + 14 };
    return { position: 'absolute', right: pad + insets.right, top: chromeTop + 76 };
  };
  const youBadge = badgeAt('bottom');

  const menuButtons = (
    <MenuButtons
      onOpenSettings={() => props.setSettingsOpen(true)}
      onOpenMenu={() => props.setMenuOpen(true)}
      menuOpen={props.menuOpen}
      matchCode={props.matchCode}
      viewers={lobby?.viewers ?? null}
      compact={compact}
      size={chromeH}
      leading={
        zoomed ? (
          <GlassButton
            kind="secondary"
            ariaLabel="Show the full table"
            testID="river-zoom-exit"
            onClick={toggleRiverZoom}
            style={{
              width: chromeH,
              height: chromeH,
              borderRadius: 999,
              padding: 0,
              fontSize: 18,
            }}
            minHeight={chromeH}
          >
            ✕
          </GlassButton>
        ) : null
      }
    />
  );

  return (
    <div
      data-testid="table-3d"
      data-viewport-class={vpClass}
      data-river-zoom={compact && riverZoom ? 'true' : 'false'}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: portrait
          ? portraitVoidBg(
              tableCentrePct,
              zoomed ? null : hudRects.nearRailBottom,
              hudRects.nearRailBottom !== null
                ? heldHandTopPx(width, height) - hudRects.nearRailBottom
                : null,
            )
          : VOID_BG,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <style>{HUD_CSS}</style>
      <SceneHost
        build={build}
        initialCamera={
          tileSheet ? sheetCameraFor(width, height) : cameraFor(width, height, insets.top)
        }
        transparent
        rebuildKey={tileSheet ? 'sheet' : 'table'}
        // Same pool as the pre-game lobby's waiting table: the match
        // re-attaches the lobby's renderer + parked scene, so the
        // opening rolls open over a table that is already compiled.
        {...(tileSheet ? {} : { poolKey: TABLE_POOL_KEY })}
        testID="table-3d-scene"
        {...(portrait && width <= PORTRAIT_SHARP_MAX_WIDTH ? { maxDpr: 2 } : {})}
      />
      {zoomed
        ? // The zoom frames the river block; the side seats' melds and
          // rows would otherwise show as slivers at the viewport edges.
          (['left', 'right'] as const).map((side) => (
            <div
              key={side}
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                [side]: 0,
                width: ZOOM_EDGE_W,
                pointerEvents: 'none',
                zIndex: 1,
                background: `linear-gradient(${side === 'left' ? 90 : 270}deg, rgba(10,16,13,0.98) 0px, rgba(10,16,13,0.98) ${ZOOM_EDGE_SOLID}px, rgba(10,16,13,0) 100%)`,
              }}
            />
          ))
        : null}

      {landscape && zoomed ? (
        <div
          data-testid="zoom-header"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: landscapeHeaderH,
            background: GLASS.bg,
            backdropFilter: GLASS.blur,
            WebkitBackdropFilter: GLASS.blur,
            borderBottom: GLASS.border,
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
      ) : null}

      {tileSheet ? null : (
        <>
          <HitTargets
            ref={hitRef}
            hand={ownHand}
            hintTileId={props.hintTileId}
            drawnTileId={drawnTileId}
            canDiscard={canDiscard}
            onTileTap={props.onTileTap}
            onHover={(id) => sceneRef.current?.setHover(id)}
            nextDrawTile={nextDrawTile}
            needsDraw={props.needsDraw}
            onDraw={() => props.onAction({ t: 'draw', seat })}
            // Landscape zoom: the rail's draw pill is the draw control.
            wallHidden={landscapeRail}
            rects={hudRects}
            onRiverTap={zoomAvailable ? toggleRiverZoom : undefined}
            riverZoomed={compact && riverZoom}
          />

          {/* Top chrome. Landscape keeps everything in the left cluster
              because the root FullscreenPrompt owns the top-right. */}
          <div
            style={{
              position: 'absolute',
              left: pad + insets.left,
              right: pad + insets.right,
              top: chromeTop,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: landscape ? 'flex-start' : 'space-between',
              gap: 8,
              pointerEvents: 'none',
              zIndex: 5,
            }}
          >
            <StatusPill
              windGlyph={props.userWindGlyph}
              name={props.userName}
              wallCount={state.wall.length}
              deadCount={state.deadWall.length}
              isMyTurn={props.myTurn && !shuffling}
              needsDraw={props.needsDraw}
              turnCountdown={props.turnCountdown}
              onPress={() => props.setPlayersOpen(true)}
              compact={compact}
              showTurn={!portrait}
              turnTarget={!footerTurnChip}
              style={landscape ? { minHeight: chromeH, padding: '4px 10px 4px 4px' } : undefined}
            />
            {compact ? null : (
              // Desktop toast slot: the free run of chrome between the
              // status pill and the menu cluster (the far seat's badge
              // projects lower, beside its hand row).
              <div
                data-testid="toast-slot"
                style={{
                  position: 'relative',
                  flex: '1 1 auto',
                  minWidth: 0,
                  alignSelf: 'stretch',
                  marginTop: -4,
                  zIndex: 6,
                }}
              >
                {toastSlot}
              </div>
            )}
            {menuButtons}
          </div>

          {/* Seat badges. Portrait: a strip under the chrome (left seat,
              far seat, right seat); the user's badge rides in the action
              row. Landscape: pinned corners. Desktop: projected. */}
          {resolved ? null : portrait ? (
            <div
              data-testid="seat-strip"
              data-zoom-bar={zoomed ? 'true' : 'false'}
              style={{
                position: 'absolute',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
                pointerEvents: 'none',
                zIndex: 2,
                // River zoom: the strip becomes a full-bleed glass header
                // and the camera parks the far wall row behind it (see
                // `ZOOM_WALL_ANCHOR_Y`), so no tile peeks out under HUD.
                // The header runs from y = 0 so the chrome row sits on
                // glass too: nothing of the wall or rail shows between
                // the pills.
                ...(zoomed
                  ? {
                      left: 0,
                      right: 0,
                      top: 0,
                      padding: `${stripTop}px ${pad + insets.right}px 6px ${pad + insets.left}px`,
                      background: GLASS.bg,
                      backdropFilter: GLASS.blur,
                      WebkitBackdropFilter: GLASS.blur,
                      borderBottom: GLASS.border,
                      transition: 'background 240ms ease-out',
                    }
                  : { left: pad + insets.left, right: pad + insets.right, top: stripTop }),
              }}
            >
              {(['left', 'top', 'right'] as Position[]).map((pos) => {
                const b = badgeAt(pos);
                return b ? (
                  <SeatBadge key={b.seat} model={b} lobby={lobby} compact dense />
                ) : (
                  <span key={pos} />
                );
              })}
            </div>
          ) : (
            badges
              .filter((b) => !(compact && b.position === 'bottom'))
              .map((b) => (
                <div
                  key={b.seat}
                  ref={(el) => {
                    badgeEls.current[b.position] = el;
                  }}
                  style={{ ...badgeFixedStyle(b.position), pointerEvents: 'none', zIndex: 2 }}
                >
                  <SeatBadge
                    model={b}
                    lobby={lobby}
                    compact={compact}
                    // Landscape: the far badge shares the 44 px chrome row
                    // with the far wall's top edge just below it.
                    dense={landscape && b.position === 'top'}
                  />
                </div>
              ))
          )}

          {/* Portrait action tray: the slot between the held hand and the
              footer row. Quiet table → the turn chip; a call → the claim
              strip (+ declare CTAs) replaces it. Fixed height so the hand
              never jumps; the slot is HUD, never table, so the strip can
              never cover a discard. */}
          {portrait && !resolved ? (
            <div
              data-testid={trayActions ? 'claim-float' : 'action-tray'}
              style={{
                position: 'absolute',
                left: pad + insets.left,
                right: pad + insets.right,
                bottom: pad + insets.bottom + 44 + PORTRAIT_TRAY_GAP,
                height: PORTRAIT_TRAY_H,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                pointerEvents: 'none',
                zIndex: 4,
              }}
            >
              {trayActions ? (
                <>
                  {/* The claim strip owns the slot during a call; the
                      ready-hand badge / declare CTAs return with the turn. */}
                  {showCtas && !props.hasClaimOption ? <ActionCtas {...ctaProps} /> : null}
                  {props.hasClaimOption ? (
                    <TutorialTarget id="claim-bar" style={{ maxWidth: '100%' }}>
                      <div
                        className="mj-hud-fade"
                        style={{ pointerEvents: 'auto', maxWidth: '100%' }}
                      >
                        <ClaimBar
                          onAction={props.onAction}
                          seat={seat}
                          orientation="portrait"
                          theme="glass"
                        />
                      </div>
                    </TutorialTarget>
                  ) : null}
                </>
              ) : (
                <div
                  className="mj-hud-fade"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    height: PORTRAIT_TRAY_H,
                  }}
                >
                  <TurnChip
                    isMyTurn={props.myTurn && !shuffling}
                    needsDraw={props.needsDraw}
                    turnCountdown={props.turnCountdown}
                    activeName={activeSeat !== null ? nameForSeat(lobby, activeSeat) : null}
                    activeColour={
                      activeSeat !== null ? SEAT_COLOR[seatToPosition[activeSeat]] : null
                    }
                    claimsOpen={state.pendingClaims !== undefined && state.pendingClaims !== null}
                  />
                  {/* The tray's resting readout: who pitched the newest
                      discard and what it was, at a size the far river
                      cannot offer; before the first discard, who opens. */}
                  <TableChip
                    lastDiscard={lastDiscard}
                    lastDiscardName={lastDiscard ? nameForSeat(lobby, lastDiscard.from) : null}
                    lastDiscardColour={
                      lastDiscard ? SEAT_COLOR[seatToPosition[lastDiscard.from]] : null
                    }
                    lastDiscardIsYou={lastDiscard?.from === seat}
                    dealerName={nameForSeat(lobby, state.dealer)}
                    dealerIsYou={state.dealer === seat}
                    prevailingWind={state.prevailingWind}
                  />
                </div>
              )}
            </div>
          ) : null}

          {/* Bottom action row. Landscape runs a dense 40 px footer under
              a 5 px pad so the pills sit in the rail gap below the hand
              instead of over its end tiles; during a claim window the
              37 px claim strip (+ CTAs) replaces the sort control there,
              centred under the hand — the one landscape slot that holds
              no tile (the felt band above the hand is the near wall's).
              Desktop hosts the claim strip in the footer's centre slot —
              directly under the hand, in the void band below the rail,
              where it can never cover a discard or stack with a toast —
              with the sort control at the right. */}
          <div
            style={{
              position: 'absolute',
              left: pad + insets.left,
              right: pad + insets.right,
              bottom: footerPad + insets.bottom,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: 10,
              pointerEvents: 'none',
              zIndex: 4,
            }}
          >
            <ActionRow
              {...ctaProps}
              sortMode={sortMode}
              onSortModeChange={props.onSortModeChange ?? (() => {})}
              ctasExternal
              dense={landscape}
              sortReplacement={
                portraitReadyBadge ? (
                  <ReadyBadgeCta waits={props.readyWaits} compact dense />
                ) : undefined
              }
              sortAlign={
                landscapeFooterClaim || landscapeRail
                  ? 'replace'
                  : // Landscape turn chip: the three-column footer so the chip
                    // takes the centre slot between the badge and the sort control.
                    footerTurnChip && landscape
                    ? 'end'
                    : compact
                      ? 'auto'
                      : 'end'
              }
              leading={
                desktopReadyBadge ? (
                  <div className="mj-hud-fade" style={{ display: 'flex', alignItems: 'center' }}>
                    <ReadyBadgeCta waits={props.readyWaits} compact={false} />
                  </div>
                ) : compact && youBadge ? (
                  <SeatBadge
                    model={youBadge}
                    lobby={lobby}
                    compact={compact}
                    dense={landscape}
                    fluid
                    style={
                      landscape
                        ? {
                            maxWidth:
                              landscapeFooterClaim || landscapeRail ? FOOTER_LEADING_MAX : 240,
                          }
                        : undefined
                    }
                  />
                ) : undefined
              }
              centre={
                landscapeRail ? (
                  <HandRail
                    hand={ownHand}
                    drawnTileId={drawnTileId}
                    needsDraw={props.needsDraw && nextDrawTile !== null}
                    onShowHand={exitRiverZoom}
                    onDraw={() => props.onAction({ t: 'draw', seat })}
                  />
                ) : (footerTurnChip || desktopCtas) && !desktopStrip && !landscapeFooterClaim ? (
                  // One row: the turn chip and, on desktop, the declare /
                  // promote CTAs beside it — never stacked above it, so
                  // the row stays one control tall under the hand.
                  <div
                    className="mj-hud-fade"
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: 12,
                      flexWrap: 'nowrap',
                    }}
                  >
                    {footerTurnChip ? (
                      <TurnChip
                        isMyTurn
                        needsDraw={props.needsDraw}
                        turnCountdown={props.turnCountdown}
                        activeName={null}
                        activeColour={null}
                        claimsOpen={false}
                        size={landscape ? 'dense' : 'large'}
                      />
                    ) : null}
                    {desktopCtas ? <ActionCtas {...ctaProps} readyBadge={false} /> : null}
                  </div>
                ) : desktopStrip || landscapeFooterClaim ? (
                  <div
                    data-testid="claim-float"
                    style={{
                      display: 'flex',
                      alignItems: 'flex-end',
                      justifyContent: 'center',
                      gap: 8,
                      maxWidth: '100%',
                      minWidth: 0,
                    }}
                  >
                    {(landscapeFooterClaim || desktopCtas) && showCtas ? (
                      <ActionCtas {...ctaProps} readyBadge={!desktopCtas} />
                    ) : null}
                    {props.hasClaimOption ? (
                      <TutorialTarget id="claim-bar" style={{ maxWidth: '100%', minWidth: 0 }}>
                        <div
                          className="mj-hud-fade"
                          style={{ pointerEvents: 'auto', maxWidth: '100%' }}
                        >
                          <ClaimBar
                            onAction={props.onAction}
                            seat={seat}
                            orientation="portrait"
                            theme="glass"
                            dense
                            size={landscape ? 'footer' : desktopStripSize}
                          />
                        </div>
                      </TutorialTarget>
                    ) : null}
                  </div>
                ) : undefined
              }
            />
          </div>

          <ChatBubbles seatToPosition={seatToPosition} />
          {landscape ? (
            // Chrome-row slot to the right of the far seat's badge and
            // left of the root FullscreenPrompt — the one void on the
            // landscape frame that never holds a tile.
            <div
              data-testid="toast-slot"
              style={{
                position: 'absolute',
                left: 'calc(50% + 60px)',
                right: pad + insets.right + FULLSCREEN_PROMPT_W,
                top: chromeTop - 4,
                height: TOAST_H,
                pointerEvents: 'none',
                zIndex: 6,
              }}
            >
              {toastSlot}
            </div>
          ) : portrait ? (
            <>
              <ClaimMissedToast theme="glass" top={toastTop} />
              <ClaimAnnouncementToast theme="glass" top={toastTop} />
            </>
          ) : null}

          {state.lastResult ? (
            <ResultVeil
              onAction={props.onAction}
              seat={seat}
              isHost={props.isHost}
              onLeave={props.onLeave}
              vpClass={vpClass}
            />
          ) : null}

          <MatchModals
            mySeat={seat}
            settingsOpen={props.settingsOpen}
            setSettingsOpen={props.setSettingsOpen}
            logOpen={props.logOpen}
            setLogOpen={props.setLogOpen}
            referenceOpen={props.referenceOpen}
            setReferenceOpen={props.setReferenceOpen}
            scoringOpen={props.scoringOpen}
            setScoringOpen={props.setScoringOpen}
            playersOpen={props.playersOpen}
            setPlayersOpen={props.setPlayersOpen}
            menuOpen={props.menuOpen}
            setMenuOpen={props.setMenuOpen}
            onLeave={props.onLeave}
            onSendChat={props.onSendChat}
            menuVariant={compact ? 'sheet' : 'sidePanel'}
          />
        </>
      )}
    </div>
  );
}

/**
 * The user's freshly drawn tile, gang replacements included. The store
 * tracks `drawnTileId` from `drew` / `discarded` events; a gang's
 * replacement draw (`gangReplacementCount` steps up, `hasDrawn` stays
 * true) emits neither, so across that step the tile now in the hand
 * that was not there before is the drawn one. The stored id wins while
 * it is still a hand tile (a normal draw); the replacement is forgotten
 * once it leaves the hand or a new hand starts.
 */
function useEffectiveDrawnTile(
  state: GameState,
  seat: Seat,
  storeDrawnTileId: number | null,
): number | null {
  const handIds = useMemo(() => new Set(state.hands[seat].map(tileId)), [state, seat]);
  const track = useRef<{
    seed: number;
    gangs: number;
    hand: Set<number>;
    replacement: number | null;
  } | null>(null);
  const prev = track.current;
  let replacement = prev && prev.seed === state.seed ? prev.replacement : null;
  if (prev && prev.seed === state.seed && state.gangReplacementCount > prev.gangs) {
    if (state.turn === seat && state.hasDrawn) {
      for (const id of handIds) if (!prev.hand.has(id)) replacement = id;
    }
  }
  if (replacement !== null && !handIds.has(replacement)) replacement = null;
  if (!prev || prev.hand !== handIds || prev.replacement !== replacement) {
    track.current = {
      seed: state.seed,
      gangs: state.gangReplacementCount,
      hand: handIds,
      replacement,
    };
  }
  if (storeDrawnTileId !== null && handIds.has(storeDrawnTileId)) return storeDrawnTileId;
  return replacement;
}
