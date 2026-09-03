import type { ComponentType } from 'react';
import { Menu3DBackdrop as MenuBackdrop } from './menu/Menu3DBackdrop';
import {
  SettingsPreview3D as SettingsPreview,
  type SettingsPreview3DProps,
} from './settings/SettingsPreview3D';
import { Table3DShell as Shell, type Table3DShellProps } from './table/Table3DShell';
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
