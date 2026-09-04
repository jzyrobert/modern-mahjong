import type { ComponentType } from 'react';
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
