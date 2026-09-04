import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeltSkin, TileBackSkin } from '../../state/game';
import { type SceneContext, type SceneHandle, SceneHost } from '../core/SceneHost';
import { PreviewScene } from './PreviewScene';
import { PREVIEW_CAMERA } from './previewConfig';

/**
 * Live 3D preview at the top of the settings panel — felt swatch, wood
 * rail and three tiles (see `PreviewScene`). Skin props re-tint the
 * running scene through `setSkins` (uniform writes); the scene is only
 * rebuilt when `SceneHost` itself remounts (quality / animations
 * setting change, context restore).
 *
 * Web-only: `entry.tsx` exports `null` on native, and callers also
 * gate on `hasWebGL2()` so a no-WebGL browser falls back to the
 * panel's static swatch preview.
 */
export interface SettingsPreview3DProps {
  felt: FeltSkin;
  tileBack: TileBackSkin;
  height?: number;
}

export function SettingsPreview3D({ felt, tileBack, height = 210 }: SettingsPreview3DProps) {
  const sceneRef = useRef<PreviewScene | null>(null);
  // Latest skins for the (ref-read) `build` — the scene may mount
  // after a prop change, so it must not close over stale values.
  const skinsRef = useRef({ felt, tileBack });
  skinsRef.current = { felt, tileBack };
  const [fatal, setFatal] = useState<string | null>(null);

  const build = useCallback((ctx: SceneContext): SceneHandle => {
    const scene = new PreviewScene(ctx, skinsRef.current);
    sceneRef.current = scene;
    return {
      update: scene.update,
      resize: scene.resize,
      dispose: () => {
        scene.dispose();
        if (sceneRef.current === scene) sceneRef.current = null;
      },
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setSkins({ felt, tileBack });
  }, [felt, tileBack]);

  if (fatal) return null;

  return (
    <div
      data-testid="settings-preview-3d"
      style={{
        position: 'relative',
        height,
        borderRadius: 14,
        overflow: 'hidden',
        // Parlour void: vertical gradient with a warm radial glow behind
        // the table. Painted in CSS so the canvas can stay transparent.
        background:
          'radial-gradient(ellipse 70% 55% at 50% 58%, rgba(58,74,58,0.55) 0%, rgba(58,74,58,0) 70%), linear-gradient(180deg, #0b120f 0%, #16241d 100%)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 -24px 40px rgba(0,0,0,0.35)',
        cursor: 'grab',
        touchAction: 'none',
      }}
    >
      <SceneHost
        build={build}
        initialCamera={PREVIEW_CAMERA}
        transparent
        releaseContextOnUnmount
        // Full sharpness on every tier: the canvas is small and the
        // scene is ~6.6k triangles, and the face glyphs must stay crisp.
        // `minDpr` supersamples 2× on dpr-1 desktops (stair-step edges
        // otherwise — software / non-MSAA contexts ignore `antialias`).
        maxDpr={2}
        minDpr={2}
        onFatal={setFatal}
        testID="settings-preview-scene"
      />
      {/* Top-left: the void above the far rail is guaranteed on every
          aspect, while the near rail's bevel reaches the bottom edge on
          phone canvases and put the badge on the wood. */}
      <div
        aria-hidden
        data-testid="settings-preview-badge"
        style={{
          position: 'absolute',
          left: 12,
          top: 10,
          padding: '4px 8px',
          borderRadius: 999,
          fontFamily: 'system-ui, sans-serif',
          fontSize: 11,
          lineHeight: '13px',
          fontWeight: 700,
          letterSpacing: 2,
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.62)',
          background: 'rgba(14,20,17,0.55)',
          border: '1px solid rgba(255,255,255,0.1)',
          pointerEvents: 'none',
        }}
      >
        Live preview
      </div>
    </div>
  );
}
