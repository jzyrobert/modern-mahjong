import type { ComponentType } from 'react';
import { getRiverInterior, subscribeRiverInterior } from './core/sceneRects';
import type { TutorialSceneRects } from './entry';
import { Menu3DBackdrop as MenuBackdrop } from './menu/Menu3DBackdrop';
import { type ReplayShelf3DProps, ReplayShelf3D as Shelf } from './menu/ReplayShelf3D';
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
export const SettingsPreview3D: ComponentType<SettingsPreview3DProps> | null = SettingsPreview;
export const Tutorial3D: ComponentType<Record<string, never>> | null = Tutorial;
export const Lobby3DView: ComponentType<Lobby3DViewProps> | null = LobbyGlass;
export const ReplayShelf3D: ComponentType<ReplayShelf3DProps> | null = Shelf;
/** Scene bounds the tutorial overlay clips its targets to (`core/sceneRects`). */
export const tutorialSceneRects: TutorialSceneRects | null = {
  subscribe: subscribeRiverInterior,
  getRiverInterior,
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
/** Bottom of the portrait seat strip (see `entry.tsx`). */
export const portraitStripBottom: ((width: number, height: number) => number | null) | null = (
  width,
  height,
) =>
  classifyViewport(width, height) === 'phone-portrait'
    ? PORTRAIT_STRIP_TOP + PORTRAIT_STRIP_H
    : null;
