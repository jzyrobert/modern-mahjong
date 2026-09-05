import type { ComponentType } from 'react';
import type { CameraMotion, ScreenBounds } from './core/sceneRects';
import type { ReplayShelf3DProps } from './menu/ReplayShelf3D';
import type { ReplayTable3DProps } from './replay/ReplayTable3D';
import type { BadgeSlot, Insets, ReplayChrome } from './replay/layout';
import type { SettingsPreview3DProps } from './settings/SettingsPreview3D';
import type { Table3DShellProps } from './table/Table3DShell';
import type { Lobby3DViewProps } from './table/hud/LobbyGlass';

/**
 * Native fallback for the Three.js layer. Metro resolves
 * `./entry.web.tsx` on web (the real components) and this file
 * everywhere else, so the WebGL tree never lands in the Android
 * bundle. `resolveRenderer()` already returns `'classic'` on native,
 * so nothing renders these — they exist so the imports type-check.
 * Consumers must null-check every export.
 */
export const Table3DShell: ComponentType<Table3DShellProps> | null = null;
export const Menu3DBackdrop: ComponentType<Record<string, never>> | null = null;
export const SettingsPreview3D: ComponentType<SettingsPreview3DProps> | null = null;
export const Tutorial3D: ComponentType<Record<string, never>> | null = null;
export const Lobby3DView: ComponentType<Lobby3DViewProps> | null = null;
export const ReplayShelf3D: ComponentType<ReplayShelf3DProps> | null = null;
/** Read-only 3D table for the replay player (`replay/ReplayTable3D`). */
export const ReplayTable3D: ComponentType<ReplayTable3DProps> | null = null;
/**
 * HUD bands + seat-badge docks for the glass replay chrome
 * (`replay/layout`): the chrome row, portrait seat strip, the dock under
 * the held hand, footer rows, and where each seat's badge pins per
 * viewport class. Null on native (the classic player renders there).
 */
export interface ReplayHudLayout {
  chrome(width: number, height: number, insets: Insets): ReplayChrome;
  badgeSlots(
    width: number,
    height: number,
    insets: Insets,
  ): { top: BadgeSlot; left: BadgeSlot; right: BadgeSlot } | null;
  /** Portrait floor band between the near rail and the held hand (`replay/layout`). */
  apron(width: number, height: number, insets: Insets): { top: number; height: number } | null;
}
export const replayHudLayout: ReplayHudLayout | null = null;

/**
 * Read-only handle on the scene-derived bounds the table publishes
 * (`core/sceneRects`): the tutorial overlay clips the discard-pool
 * coach-mark to the river interior so its ring never crosses the walls.
 * Null on native (no scene).
 */
export interface TutorialSceneRects {
  subscribe(cb: () => void): () => void;
  getRiverInterior(): ScreenBounds | null;
  /** Camera rig motion (`core/sceneRects`): the overlay holds a lesson's
   *  first coach card until the rig has come to rest. */
  subscribeCamera(cb: () => void): () => void;
  getCameraMotion(): CameraMotion;
}
export const tutorialSceneRects: TutorialSceneRects | null = null;

/**
 * Screen y (CSS px) of the top of the held hand on the phone-portrait 3D
 * table, or null when the viewport is not phone portrait. Root overlays
 * (the opening-rolls card) keep clear of the hand with it. Null on
 * native (no 3D table).
 */
export const portraitHeldHandTop: ((width: number, height: number) => number | null) | null = null;
/**
 * Screen y (CSS px) of the bottom of the seat strip on the phone-portrait
 * 3D table (chrome row + strip, before the device's top inset), or null
 * off portrait. Root overlays centre between it and `portraitHeldHandTop`.
 */
export const portraitStripBottom: ((width: number, height: number) => number | null) | null = null;
/**
 * Whether the band between the portrait seat strip and the held hand is
 * too short for the regular opening-rolls card (a phone in a browser):
 * the dice ceremony renders its dense card and, while a lesson step
 * spotlights the dice, the 3D shell parks the hand below the viewport
 * so the lesson card docks on free scrim. `null` off portrait / off web.
 */
export const portraitDiceBandShort: ((width: number, height: number) => boolean | null) | null =
  null;
/**
 * Top edge (CSS px) of the dice card while a lesson spotlights it on a
 * short portrait phone: the dice card + docked caption pair is centred in
 * the band under the seat strip (`portraitDiceLessonTop`). `null` off
 * portrait / off web.
 */
export const portraitDiceLessonTop:
  | ((width: number, height: number, topInset: number, diceCardH: number | null) => number | null)
  | null = null;
