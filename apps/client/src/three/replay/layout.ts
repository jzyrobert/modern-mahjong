import type { CameraPreset } from '../core/camera';
import type { SyncInput } from '../table/TableScene';
import {
  PORTRAIT_NEAR_RAIL_POINT,
  PORTRAIT_RIVER_SCALE,
  PORTRAIT_STRIP_H,
  type ViewportClass,
  cameraFor,
  classifyViewport,
  heldHandFrameFor,
  heldHandTopPx,
  portraitMetrics,
  projectPreset,
} from '../table/cameraPresets';
import {
  FELT_HALF,
  HAND_Z,
  type HeldHandFrame,
  MELD_Z,
  RAIL_H,
  RAIL_WIDTH,
  SIDE_MELD_SCALE_PORTRAIT,
  SIDE_SEAT_OUT_DESKTOP,
  SIDE_SEAT_OUT_LOW,
  seatAnchor,
} from '../table/layout';
import { TILE_D, TILE_H } from '../tiles/geometry';

/**
 * Pure HUD maths for the 3D replay player (`ReplayTable3D` + the glass
 * chrome in `src/ui/replay/GlassReplayPlayer`). The replay shows the
 * *same table* the match shows — the match's camera preset per viewport
 * class, its held portrait hand, its side-seat tuning — so the chrome
 * bands here mirror `Table3DShell`'s: a chrome row, a portrait seat
 * strip, and the block under the hand the match gives to its action
 * tray + footer, which the replay gives to the scrubber.
 */
export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface ReplayChrome {
  cls: ViewportClass;
  /** Side / top padding, CSS px (12 on phones, 24 on desktop). */
  pad: number;
  /** Top edge of the chrome row (device inset included). */
  chromeTop: number;
  chromeH: number;
  /** Portrait seat strip (three badges) under the chrome row. */
  stripTop: number;
  stripH: number;
  /**
   * Portrait: height of the dock under the held hand — the match's
   * footer row + action tray + one gap — measured up from `dockBottom`.
   * The hand's baseline sits one `trayGap` above the dock's top.
   */
  dockH: number;
  /** Portrait dock's offset from the viewport bottom (safe inset included). */
  dockBottom: number;
  /** Landscape / desktop footer row height and bottom offset. */
  footerH: number;
  footerBottom: number;
  /**
   * Width the root fullscreen prompt reserves at the top-right on
   * landscape phones (web): the chrome row stops short of it.
   */
  fullscreenReserve: number;
}

/** Height of the top chrome row, CSS px (the match's `CHROME_H`). */
export const REPLAY_CHROME_H = 44;
export const REPLAY_CHROME_H_LANDSCAPE = 38;
/** Landscape footer: dense 40 px row under a 5 px pad (the match's). */
export const REPLAY_FOOTER_H_LANDSCAPE = 40;
export const REPLAY_FOOTER_PAD_LANDSCAPE = 5;
/** Desktop footer: the scrubber panel over the near rail's void band. */
export const REPLAY_FOOTER_H_DESKTOP = 64;
export const REPLAY_FOOTER_PAD_DESKTOP = 12;
/** Root `FullscreenPrompt` pill + margin on landscape phones. */
export const FULLSCREEN_RESERVE = 124 + 8 + 12;

export function replayChromeFor(width: number, height: number, insets: Insets): ReplayChrome {
  const cls = classifyViewport(width, height);
  const compact = cls !== 'desktop';
  const landscape = cls === 'phone-landscape';
  const pad = compact ? 12 : 24;
  const chromeH = landscape ? REPLAY_CHROME_H_LANDSCAPE : REPLAY_CHROME_H;
  const chromeTop = (landscape ? 8 : pad) + insets.top;
  const m = portraitMetrics(height);
  return {
    cls,
    pad,
    chromeTop,
    chromeH,
    stripTop: chromeTop + chromeH + 8,
    stripH: PORTRAIT_STRIP_H,
    dockH: REPLAY_CHROME_H + m.trayGap + m.trayH,
    dockBottom: pad + insets.bottom,
    footerH: landscape ? REPLAY_FOOTER_H_LANDSCAPE : REPLAY_FOOTER_H_DESKTOP,
    footerBottom:
      (landscape ? REPLAY_FOOTER_PAD_LANDSCAPE : REPLAY_FOOTER_PAD_DESKTOP) + insets.bottom,
    fullscreenReserve: landscape ? FULLSCREEN_RESERVE : 0,
  };
}

/** The match's camera for the viewport (portrait fits the HUD band). */
export function replayCameraFor(width: number, height: number, topInset: number): CameraPreset {
  return cameraFor(width, height, topInset);
}

/** Portrait: the near-camera frame the POV seat's hand is held in; null elsewhere. */
export function replayHeldFrameFor(
  width: number,
  height: number,
  topInset: number,
): HeldHandFrame | null {
  if (classifyViewport(width, height) !== 'phone-portrait') return null;
  return heldHandFrameFor(replayCameraFor(width, height, topInset), width, height);
}

/**
 * Per-viewport `TableScene.sync` tuning, identical to the match shell's
 * so a replayed table composes exactly like the live one.
 */
export function replaySyncTuning(
  cls: ViewportClass,
  held: boolean,
): Pick<
  SyncInput,
  | 'riverScale'
  | 'nearWallDim'
  | 'sideSeatOut'
  | 'farMeldsOnRail'
  | 'sideMeldsNear'
  | 'sideMeldScale'
  | 'ownMeldsStanding'
> {
  const landscape = cls === 'phone-landscape';
  const compact = cls !== 'desktop';
  return {
    riverScale: held ? PORTRAIT_RIVER_SCALE : 1,
    nearWallDim: landscape ? 0.85 : 1,
    sideSeatOut: landscape ? SIDE_SEAT_OUT_LOW : compact ? 0 : SIDE_SEAT_OUT_DESKTOP,
    farMeldsOnRail: landscape,
    sideMeldsNear: true,
    sideMeldScale: held ? SIDE_MELD_SCALE_PORTRAIT : 1,
    ownMeldsStanding: true,
  };
}

/** Where a seat badge docks, CSS px from the viewport edges. */
export interface BadgeSlot {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  /** Centre the badge horizontally on this x (overrides left / right). */
  centerX?: number;
}

/** Glass seat badge height, CSS px (single-line dense badge). */
export const REPLAY_BADGE_H = 34;
/** Air between a desktop badge and the table edge it keys off (the match keeps ≥ 12). */
export const DESKTOP_BADGE_GAP = 14;
/** World z the side docks key off: the rack slice level with the badge's height band on the pitched view. */
export const SIDE_KEY_Z = 3;

/** Outermost |x| a side seat's tiles reach on the desktop preset (flat meld / revealed tile edge). */
export function sideOuterExtent(): number {
  return MELD_Z + SIDE_SEAT_OUT_DESKTOP + TILE_H / 2;
}

/**
 * Desktop seat badges are placed off the table's projected landmarks
 * (the match projects the seats' world anchors): the far seat's badge
 * centred above the far rail, the side seats' badges outboard of their
 * racks at the racks' mid-height, the near seat's in the footer. Pure —
 * a function of the preset + viewport, exact once the rig has settled
 * (the replay snaps its camera, so immediately).
 */
export function desktopBadgeSlots(
  preset: CameraPreset,
  width: number,
  height: number,
  chrome: ReplayChrome,
  opts: { sideRevealed?: boolean } = {},
): { top: BadgeSlot; left: BadgeSlot; right: BadgeSlot } {
  const farRailTop = projectPreset(preset, width, height, [0, RAIL_H, -(FELT_HALF + RAIL_WIDTH)]);
  const far = projectPreset(preset, width, height, [seatAnchor(2).x, TILE_H, seatAnchor(2).z]);
  // Side seats: the widest thing a side seat shows is a flat tile on the
  // rack line — a revealed hand (POV "all" / the result frame) or its
  // melds, which the desktop preset shifts outward by
  // `SIDE_SEAT_OUT_DESKTOP` — reaching |x| = MELD_Z + out + TILE_H/2.
  // Badge edges key off that edge at a slightly near z (the rack's
  // tiles level with the badge's own height project a little further
  // out than the z = 0 slice), so a badge never touches a tile whether
  // the rack stands or lies revealed.
  const outer = sideOuterExtent();
  const top = opts.sideRevealed ? TILE_D : TILE_H;
  const leftFace = projectPreset(preset, width, height, [-outer, top, SIDE_KEY_Z]);
  const rightFace = projectPreset(preset, width, height, [outer, top, SIDE_KEY_Z]);
  const sideMid = projectPreset(preset, width, height, [HAND_Z, TILE_H / 2, 0]).y;
  const farTop = Math.max(
    chrome.chromeTop + chrome.chromeH + 8,
    Math.round(farRailTop.y - DESKTOP_BADGE_GAP - REPLAY_BADGE_H),
  );
  return {
    top: { centerX: Math.round(far.x), top: farTop },
    left: {
      right: Math.round(width - leftFace.x + DESKTOP_BADGE_GAP),
      top: Math.round(sideMid - REPLAY_BADGE_H / 2),
    },
    right: {
      left: Math.round(rightFace.x + DESKTOP_BADGE_GAP),
      top: Math.round(sideMid - REPLAY_BADGE_H / 2),
    },
  };
}

/**
 * Landscape seat badges pin like the match's: the far badge shares the
 * chrome row at the top centre (the far wall's top edge sits just under
 * the row), the side badges tuck into the top corners under the chrome
 * — the right one below the root fullscreen prompt.
 */
export function landscapeBadgeSlots(
  width: number,
  chrome: ReplayChrome,
  insets: Insets,
): { top: BadgeSlot; left: BadgeSlot; right: BadgeSlot } {
  return {
    top: { centerX: Math.round(width / 2), top: chrome.chromeTop + 2 },
    left: { left: chrome.pad + insets.left, top: chrome.chromeTop + chrome.chromeH + 14 },
    right: { right: chrome.pad + insets.right, top: chrome.chromeTop + 76 },
  };
}

/**
 * Portrait floor apron: the band between the near rail's outer bottom
 * edge and the held hand's top, CSS px from the viewport top. The match
 * paints it as the lit edge of the parlour floor (a contact shadow under
 * the rail, then warm lacquer fading into the void by the hand) so the
 * table stands on something; the replay paints the same band. Null off
 * portrait.
 */
export function portraitApronFor(
  width: number,
  height: number,
  topInset: number,
): { top: number; height: number } | null {
  if (classifyViewport(width, height) !== 'phone-portrait') return null;
  const preset = replayCameraFor(width, height, topInset);
  const railBottom = projectPreset(preset, width, height, PORTRAIT_NEAR_RAIL_POINT).y;
  const handTop = heldHandTopPx(width, height);
  return { top: Math.round(railBottom), height: Math.max(24, Math.round(handTop - railBottom)) };
}
