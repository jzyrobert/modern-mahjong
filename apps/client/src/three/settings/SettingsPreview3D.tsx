import type { FeltSkin, TileBackSkin } from '../../state/game';

/**
 * PLACEHOLDER — the settings feature agent replaces this with the live
 * felt + tile preview (ARCHITECTURE.md §1 `settings/`).
 */
export interface SettingsPreview3DProps {
  felt: FeltSkin;
  tileBack: TileBackSkin;
  height?: number;
}

export function SettingsPreview3D(_props: SettingsPreview3DProps) {
  return null;
}
