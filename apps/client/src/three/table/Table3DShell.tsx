import type { Action, Tile as MTile, Seat } from '@mahjong/game-logic';
import type { GameState } from '@mahjong/game-logic';
import { seatWindFor, tileId } from '@mahjong/game-logic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Matrix4 } from 'three';
import { type LobbyState, useGame } from '../../state/game';
import { ClaimBar } from '../../ui/ClaimBar';
import { ChatBubbles } from '../../ui/match/ChatBubbles';
import { ClaimAnnouncementToast } from '../../ui/match/ClaimAnnouncementToast';
import { ClaimMissedToast } from '../../ui/match/ClaimMissedToast';
import { MatchModals } from '../../ui/match/MatchModals';
import type { SortMode } from '../../ui/match/SortPicker';
import type { Position } from '../../ui/match/seatColor';
import { layoutFor } from '../../ui/match/seatPlacement';
import { TutorialTarget } from '../../ui/tutorial/TargetRegistry';
import { type SceneContext, type SceneHandle, SceneHost } from '../core/SceneHost';
import { type TableDebugSnapshot, TableScene } from './TableScene';
import {
  PORTRAIT_RIVER_SCALE,
  type ViewportClass,
  cameraFor,
  classifyViewport,
  heldHandFrameFor,
  riverZoomCameraFor,
  sheetCameraFor,
} from './cameraPresets';
import { ActionCtas, ActionRow, hasActionCtas } from './hud/ActionRow';
import { HitTargets, type HitTargetsHandle, type HudRects } from './hud/HitTargets';
import { MenuButtons } from './hud/MenuButtons';
import { ResultVeil } from './hud/ResultVeil';
import { SeatBadge, type SeatBadgeModel } from './hud/SeatBadges';
import { StatusPill } from './hud/StatusPill';
import { GLASS, GlassButton, HUD_CSS } from './hud/glass';
import {
  CENTRE_PLATE_RADIUS,
  HAND_Z,
  type HeldHandFrame,
  OWN_HAND_Z,
  type Rel,
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
 *     two rows (`heldHandFrameFor`) so tiles stay ≥ 44 CSS px; claims
 *     and CTAs float in the band between the near rail and the hand.
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

const VOID_BG =
  'radial-gradient(ellipse 80% 45% at 50% 34%, rgba(58,74,58,0.28), rgba(58,74,58,0) 70%), linear-gradient(180deg, #0b120f 0%, #16241d 100%)';

const EMPTY_RECTS: HudRects = {
  ownHand: null,
  wallDraw: null,
  river: null,
  nearWall: null,
  discards: null,
  plateBottom: null,
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
/** Landscape footer: 6 px safe pad + 40 px dense pills fit under the hand. */
const LANDSCAPE_FOOTER_PAD = 6;
/**
 * Portrait phones ≤ 420 CSS px wide render at DPR 2 even on the `low`
 * tier: the canvas is small (≈ 1.5 MP) and the full-table river tiles
 * are ~19 CSS px, where the 1.5 clamp visibly softens the glyphs.
 */
const PORTRAIT_SHARP_MAX_WIDTH = 420;

/** Table preset for a viewport — the river zoom applies on portrait only. */
function presetFor(width: number, height: number, topInset: number, zoom: boolean) {
  return zoom && classifyViewport(width, height) === 'phone-portrait'
    ? riverZoomCameraFor(width, height, topInset)
    : cameraFor(width, height, topInset);
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
/** Approximate height of a glass toast, CSS px (anchor maths only). */
const TOAST_H = 52;
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
  // Portrait river zoom (tap the discards). Camera-only: the engine
  // state and the held hand are untouched, so it can flip at any time.
  const [riverZoom, setRiverZoom] = useState(false);
  const riverZoomRef = useRef(false);
  riverZoomRef.current = riverZoom && portrait;

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

  // Latest inputs for the imperative side (built once, read live).
  const inputRef = useRef({ props, manualOrder, shuffling, sortMode });
  inputRef.current = { props, manualOrder, shuffling, sortMode };

  const syncScene = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const { props: p, manualOrder: mo, shuffling: sh, sortMode: sm } = inputRef.current;
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
        shuffling: sh,
        heldHand: heldRef.current,
        riverScale: heldRef.current ? PORTRAIT_RIVER_SCALE : 1,
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
            if (r) handRects.push({ ...r });
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
        Math.abs((next.plateBottom ?? 0) - (lastRects.current.plateBottom ?? 0)) > 0.75;
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
      const scene = new TableScene(ctx, {
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
          scene.dispose();
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
    const zoom = riverZoom && portrait;
    const { width: w, height: h } = ctx.size;
    ctx.rig.setPreset(presetFor(w, h, topInsetRef.current, zoom));
    heldRef.current = heldFrameFor(w, h, topInsetRef.current, zoom);
    syncScene();
    settleFrames.current = 0;
    ctx.loop.requestRender();
  }, [riverZoom, portrait, tileSheet, syncScene]);
  const toggleRiverZoom = useCallback(() => setRiverZoom((v) => !v), []);

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
  }, [state, seat, sortMode, manualOrder, props.drawnTileId]);
  const nextDrawTile = state.wall.length > 0 ? state.wall[state.wall.length - 1]! : null;
  const canDiscard = props.myTurn && state.hasDrawn;

  const ctaProps = {
    seat,
    canTsumo: props.canTsumo,
    tsumoFaan: props.tsumoFaan,
    concealedGangTile: props.concealedGangTile,
    promotedGangTile: props.promotedGangTile,
    readyWaits: props.readyWaits,
    onAction: props.onAction,
    compact,
  };
  const showCtas = hasActionCtas(ctaProps);
  // Phones float claims + CTAs in the band just above the hand's
  // projected top edge (portrait: between the near rail and the held
  // hand; landscape: over the near felt).
  const handTop = hudRects.ownHand?.top ?? null;
  const resolved = state.lastResult !== null && state.lastResult !== undefined;
  const aboveHandBottom =
    handTop !== null
      ? Math.max(pad + insets.bottom + 60, height - handTop + (landscape ? 6 : 10))
      : height * 0.32;

  // Landscape lifts the chrome row to an 8 px pad so its bottom edge
  // clears the far wall's projected top by ≥ 8 px.
  const chromeTop = (landscape ? 8 : pad) + insets.top;
  const stripTop = chromeTop + chromeH + 8;
  const zoomed = portrait && riverZoom && !resolved;
  // Projected near-wall / river extents the toasts avoid.
  const nearWallTop = hudRects.nearWall?.top ?? null;
  const nearWallBottom = hudRects.nearWall
    ? hudRects.nearWall.top + hudRects.nearWall.height
    : null;
  const discardsBottom = Math.max(
    hudRects.discards ? hudRects.discards.top + hudRects.discards.height : 0,
    hudRects.plateBottom ?? 0,
  );
  // Toasts. Portrait (full table): the void between the seat strip and
  // the far rail. Portrait (river zoom): the far wall hides behind the
  // zoom header, so the toast drops to the felt between the near wall
  // and the held hand. Landscape: the chrome row beside the far seat's
  // badge (the only void that never holds a tile). Desktop: the felt
  // band above the near wall, never lower than the rivers — the claim
  // strip lives in the footer, so the two can never stack.
  const claimFloating = compact && (props.hasClaimOption || showCtas);
  const desktopStrip = !compact && props.hasClaimOption;
  const toastTop = portrait
    ? zoomed && nearWallBottom !== null && !claimFloating
      ? nearWallBottom + 10
      : stripTop + 40
    : landscape
      ? 0
      : nearWallTop !== null
        ? Math.max(discardsBottom + 6, nearWallTop - TOAST_H - 10)
        : height * 0.55;

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
      data-river-zoom={portrait && riverZoom ? 'true' : 'false'}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: VOID_BG,
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
        testID="table-3d-scene"
        {...(portrait && width <= PORTRAIT_SHARP_MAX_WIDTH ? { maxDpr: 2 } : {})}
      />

      {tileSheet ? null : (
        <>
          <HitTargets
            ref={hitRef}
            hand={ownHand}
            hintTileId={props.hintTileId}
            drawnTileId={props.drawnTileId}
            canDiscard={canDiscard}
            onTileTap={props.onTileTap}
            onHover={(id) => sceneRef.current?.setHover(id)}
            nextDrawTile={nextDrawTile}
            needsDraw={props.needsDraw}
            onDraw={() => props.onAction({ t: 'draw', seat })}
            rects={hudRects}
            onRiverTap={portrait && !resolved ? toggleRiverZoom : undefined}
            riverZoomed={portrait && riverZoom}
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
              isMyTurn={props.myTurn}
              needsDraw={props.needsDraw}
              turnCountdown={props.turnCountdown}
              onPress={() => props.setPlayersOpen(true)}
              compact={compact}
              style={landscape ? { minHeight: chromeH, padding: '4px 10px 4px 4px' } : undefined}
            />
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

          {/* Phones: claims + CTAs float just above the hand's projected
              top edge. Portrait stacks them in the band between the near
              rail and the held hand; landscape lays them in one dense
              strip that sits squarely in front of the near wall's backs
              (the hand hides the wall's bottom edge, the strip its top —
              a deliberate "claim shelf", never a half-covered row). */}
          {compact && (props.hasClaimOption || showCtas) ? (
            <div
              data-testid="claim-float"
              style={{
                position: 'absolute',
                left: pad + insets.left,
                right: pad + insets.right,
                bottom: aboveHandBottom,
                display: 'flex',
                flexDirection: landscape ? 'row' : 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                pointerEvents: 'none',
                zIndex: 4,
              }}
            >
              {showCtas ? <ActionCtas {...ctaProps} /> : null}
              {props.hasClaimOption ? (
                <TutorialTarget id="claim-bar" style={{ maxWidth: '100%' }}>
                  <div className="mj-hud-fade" style={{ pointerEvents: 'auto', maxWidth: '100%' }}>
                    <ClaimBar
                      onAction={props.onAction}
                      seat={seat}
                      orientation="portrait"
                      theme="glass"
                      dense={landscape}
                    />
                  </div>
                </TutorialTarget>
              ) : null}
            </div>
          ) : null}

          {/* Bottom action row. Landscape runs a dense 40 px footer under
              a 6 px pad so the pills sit in the rail gap below the hand
              instead of over its end tiles. Desktop hosts the claim strip
              in the footer's centre slot — directly under the hand, in
              the void band below the rail, where it can never cover a
              discard or stack with a toast — with the sort control at the
              right. */}
          <div
            style={{
              position: 'absolute',
              left: pad + insets.left,
              right: pad + insets.right,
              bottom: (landscape ? LANDSCAPE_FOOTER_PAD : pad) + insets.bottom,
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
              ctasExternal={compact}
              dense={landscape}
              sortAlign={compact ? 'auto' : 'end'}
              leading={
                compact && youBadge ? (
                  <SeatBadge
                    model={youBadge}
                    lobby={lobby}
                    compact={compact}
                    dense={landscape}
                    fluid
                    style={landscape ? { maxWidth: 240 } : undefined}
                  />
                ) : undefined
              }
              centre={
                desktopStrip ? (
                  <div data-testid="claim-float" style={{ display: 'flex', maxWidth: '100%' }}>
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
                          dense
                        />
                      </div>
                    </TutorialTarget>
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
              <ClaimMissedToast theme="glass" top={0} />
              <ClaimAnnouncementToast theme="glass" top={0} />
            </div>
          ) : (
            <>
              <ClaimMissedToast theme="glass" top={toastTop} />
              <ClaimAnnouncementToast theme="glass" top={toastTop} />
            </>
          )}

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
