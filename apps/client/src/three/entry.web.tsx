import type { ComponentType } from 'react';
import {
  getCameraMotion,
  getRiverInterior,
  subscribeCameraMotion,
  subscribeRiverInterior,
} from './core/sceneRects';
import type { ReplayHudLayout, TutorialSceneRects } from './entry';
import { Menu3DBackdrop as MenuBackdrop, Menu3DHero as MenuHero } from './menu/Menu3DBackdrop';
import { type ReplayShelf3DProps, ReplayShelf3D as Shelf } from './menu/ReplayShelf3D';
import { ReplayTable3D as ReplayTable, type ReplayTable3DProps } from './replay/ReplayTable3D';
import {
  desktopBadgeSlots,
  landscapeBadgeSlots,
  portraitApronFor,
  replayCameraFor,
  replayChromeFor,
} from './replay/layout';
import {
  SettingsPreview3D as SettingsPreview,
  type SettingsPreview3DProps,
} from './settings/SettingsPreview3D';
import { Table3DShell as Shell, type Table3DShellProps } from './table/Table3DShell';
import {
  PORTRAIT_STRIP_H,
  PORTRAIT_STRIP_TOP,
  classifyViewport,
  portraitDiceBandShort as diceBandShort,
  portraitDiceLessonTop as diceLessonTop,
  heldHandTopPx,
} from './table/cameraPresets';
import { type Lobby3DViewProps, LobbyGlass } from './table/hud/LobbyGlass';
import { Tutorial3D as Tutorial } from './tutorial/Tutorial3D';

/**
 * Web entry for the Three.js layer — see `entry.tsx` for the platform
 * split. Types mirror the native stub exactly so call sites can be
 * written once with a null check.
 */
export const Table3DShell: ComponentType<Table3DShellProps> | null = Shell;
export const Menu3DBackdrop: ComponentType<Record<string, never>> | null = MenuBackdrop;
export const Menu3DHero: ComponentType<Record<string, never>> | null = MenuHero;
export const SettingsPreview3D: ComponentType<SettingsPreview3DProps> | null = SettingsPreview;
export const Tutorial3D: ComponentType<Record<string, never>> | null = Tutorial;
export const Lobby3DView: ComponentType<Lobby3DViewProps> | null = LobbyGlass;
export const ReplayShelf3D: ComponentType<ReplayShelf3DProps> | null = Shelf;
export const ReplayTable3D: ComponentType<ReplayTable3DProps> | null = ReplayTable;
/** Glass replay chrome maths (see `entry.tsx`). */
export const replayHudLayout: ReplayHudLayout | null = {
  chrome: replayChromeFor,
  badgeSlots: (width, height, insets, opts) => {
    const chrome = replayChromeFor(width, height, insets);
    if (chrome.cls === 'desktop')
      return desktopBadgeSlots(
        replayCameraFor(width, height, insets.top),
        width,
        height,
        chrome,
        opts ?? {},
      );
    if (chrome.cls === 'phone-landscape') return landscapeBadgeSlots(width, chrome, insets);
    return null;
  },
  apron: (width, height, insets) => portraitApronFor(width, height, insets.top),
};
/** Scene bounds the tutorial overlay clips its targets to (`core/sceneRects`). */
export const tutorialSceneRects: TutorialSceneRects | null = {
  subscribe: subscribeRiverInterior,
  getRiverInterior,
  subscribeCamera: subscribeCameraMotion,
  getCameraMotion,
};
/** Top of the held hand on phone portrait (see `entry.tsx`). */
export const portraitHeldHandTop: ((width: number, height: number) => number | null) | null = (
  width,
  height,
) => (classifyViewport(width, height) === 'phone-portrait' ? heldHandTopPx(width, height) : null);
/** Short dice band on portrait (see `entry.tsx`). */
export const portraitDiceBandShort: ((width: number, height: number) => boolean | null) | null = (
  width,
  height,
) => (classifyViewport(width, height) === 'phone-portrait' ? diceBandShort(width, height) : null);
/** Dice card top while a lesson spotlights it on a short portrait phone (see `entry.tsx`). */
export const portraitDiceLessonTop:
  | ((width: number, height: number, topInset: number, diceCardH: number | null) => number | null)
  | null = (width, height, topInset, diceCardH) =>
  classifyViewport(width, height) === 'phone-portrait'
    ? diceLessonTop(width, height, topInset, diceCardH)
    : null;
/** Bottom of the portrait seat strip (see `entry.tsx`). */
export const portraitStripBottom: ((width: number, height: number) => number | null) | null = (
  width,
  height,
) =>
  classifyViewport(width, height) === 'phone-portrait'
    ? PORTRAIT_STRIP_TOP + PORTRAIT_STRIP_H
    : null;
