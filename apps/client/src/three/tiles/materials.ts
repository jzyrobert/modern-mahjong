import { Color, MeshPhysicalMaterial, type Texture, Vector2 } from 'three';
import type { FeltSkin, TileBackSkin } from '../../state/game';
import { FELT_SKINS, TILE_BACK_SKINS } from '../../ui/match/skins';
import { CELL_SCALE } from './faceAtlas';

/**
 * Tile body material — one MeshPhysicalMaterial for the whole
 * InstancedMesh, with `onBeforeCompile` injecting:
 *   - `aFaceCell` (vec2, instanced): atlas cell offset for this tile.
 *   - `aTint` (vec3, instanced): multiplier for dimming / seat tint.
 *   - `aHighlight` (float, instanced): 0..1 gold emissive rim.
 * The +Z face samples the atlas; −Z shows the tile-back skin; the
 * four sides use the bone-ivory body colour. No per-tile materials,
 * no material switching → one draw call for up to 136 tiles.
 */
export interface TileMaterialUniforms {
  uAtlas: { value: Texture };
  uCellScale: { value: Vector2 };
  uBodyColor: { value: Color };
  uBackColor: { value: Color };
  uBackColor2: { value: Color };
  uHighlightColor: { value: Color };
  /**
   * Back-face finish. The printed back of a real tile is a matte inlay,
   * not lacquered ivory, and under a bright key + env the glossy default
   * washes the skin colour toward white. `uBackClearcoat` scales the
   * material's clearcoat *and* sheen on the −Z face (1 = same as the body);
   * `uBackRoughness` is the absolute roughness there (defaults to the
   * body roughness, so stock behaviour is unchanged until a caller
   * opts in — see `setTileBackFinish`).
   */
  uBackClearcoat: { value: number };
  uBackRoughness: { value: number };
  /**
   * Second back colour, selected per instance by `aBackVariant` (1):
   * the warm ivory-tan the table marks its dead-wall stacks with,
   * independent of the skin so it reads as a marked block on blue, plum
   * or mint rather than a tinted (greyed) copy of them.
   */
  uDeadBack: { value: Color };
  uDeadBack2: { value: Color };
}

/** Body roughness shared by the tile faces and, by default, the back. */
export const TILE_BODY_ROUGHNESS = 0.32;

export function tileBackColors(skin: TileBackSkin): { top: Color; bottom: Color } {
  const s = TILE_BACK_SKINS[skin];
  return { top: new Color(s.top), bottom: new Color(s.bottom) };
}

export function feltColors(skin: FeltSkin): { top: Color; bottom: Color } {
  const s = FELT_SKINS[skin];
  return { top: new Color(s.top), bottom: new Color(s.bottom) };
}

export function createTileMaterial(
  atlas: Texture,
  backSkin: TileBackSkin,
): MeshPhysicalMaterial & { tileUniforms: TileMaterialUniforms } {
  const back = tileBackColors(backSkin);
  const uniforms: TileMaterialUniforms = {
    uAtlas: { value: atlas },
    uCellScale: { value: new Vector2(CELL_SCALE[0], CELL_SCALE[1]) },
    uBodyColor: { value: new Color('#efe6d2') },
    uBackColor: { value: back.top },
    uBackColor2: { value: back.bottom },
    uHighlightColor: { value: new Color('#ffcf6b') },
    uBackClearcoat: { value: 1 },
    uBackRoughness: { value: TILE_BODY_ROUGHNESS },
    uDeadBack: { value: new Color('#dccaa4') },
    uDeadBack2: { value: new Color('#bda57c') },
  };
  const mat = new MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: TILE_BODY_ROUGHNESS,
    metalness: 0.0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.22,
    sheen: 0.15,
    sheenColor: new Color('#fff4dc'),
  }) as MeshPhysicalMaterial & { tileUniforms: TileMaterialUniforms };
  mat.defines = { ...(mat.defines ?? {}), USE_UV: '' };
  mat.tileUniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 aFaceCell;
        attribute vec3 aTint;
        attribute float aHighlight;
        attribute float aBackVariant;
        uniform vec2 uCellScale;
        varying vec2 vAtlasUv;
        varying vec3 vTint;
        varying float vHighlight;
        varying float vFace;
        varying float vBack;
        varying float vBackGrad;
        varying float vBackCell;
        varying float vBackVariant;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        vFace = step(0.92, objectNormal.z);
        vBack = step(0.92, -objectNormal.z);
        vBackGrad = clamp(position.y / 1.36 + 0.5, 0.0, 1.0);
        // A negative cell offset is the "show the back on +Z" sentinel
        // (TilePool writes it for BACK_CELL poses) — the fragment stage
        // swaps the atlas sample for the skin gradient.
        vBackCell = step(aFaceCell.x, -0.5);
        vAtlasUv = uv * uCellScale + max(aFaceCell, vec2(0.0));
        vTint = aTint;
        vHighlight = aHighlight;
        vBackVariant = aBackVariant;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uAtlas;
        uniform vec3 uBodyColor;
        uniform vec3 uBackColor;
        uniform vec3 uBackColor2;
        uniform vec3 uHighlightColor;
        uniform float uBackClearcoat;
        uniform float uBackRoughness;
        uniform vec3 uDeadBack;
        uniform vec3 uDeadBack2;
        varying vec2 vAtlasUv;
        varying vec3 vTint;
        varying float vHighlight;
        varying float vFace;
        varying float vBack;
        varying float vBackGrad;
        varying float vBackCell;
        varying float vBackVariant;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Slight negative LOD bias: minified river glyphs pick the
        // sharper mip (anisotropic filtering keeps it from shimmering).
        vec4 faceTexel = texture2D(uAtlas, vAtlasUv, -0.35);
        vec3 backCol = mix(
          mix(uBackColor2, uBackColor, vBackGrad),
          mix(uDeadBack2, uDeadBack, vBackGrad),
          vBackVariant
        );
        // Faint inset border on the back so face-down tiles read as
        // separate pieces in a wall / opponent row.
        vec2 edge = abs(vUv - 0.5) * 2.0;
        float rim = smoothstep(0.86, 0.97, max(edge.x, edge.y));
        backCol = mix(backCol, backCol * 0.82, rim * 0.6);
        // Any printed-back pixel — the true −Z face or the +Z sentinel
        // (a concealed rack seen from the user's seat) — also takes the
        // back finish below, so a blue rack never wears the ivory gloss.
        float showBack = max(vBack, vFace * vBackCell);
        vec3 body = mix(uBodyColor, backCol, showBack);
        float showFace = vFace * (1.0 - vBackCell);
        diffuseColor.rgb = mix(body, faceTexel.rgb, showFace) * vTint;
        // Cue glow: warm the albedo toward gold as well as adding
        // emissive so blue / plum backs read gold, not washed-out white.
        diffuseColor.rgb = mix(diffuseColor.rgb, uHighlightColor, vHighlight * 0.7);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, uBackRoughness, showBack);`,
      )
      .replace(
        'material.clearcoat = clearcoat;',
        'material.clearcoat = clearcoat * mix(1.0, uBackClearcoat, showBack);',
      )
      .replace(
        'material.sheenColor = sheenColor;',
        'material.sheenColor = sheenColor * mix(1.0, uBackClearcoat, showBack);',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uHighlightColor * vHighlight * 0.55;`,
      );
  };
  // Distinct cache key so three doesn't share the program with a stock
  // MeshPhysicalMaterial.
  mat.customProgramCacheKey = () => 'mahjong-tile-v5';
  return mat;
}

export function setTileBackSkin(
  mat: MeshPhysicalMaterial & { tileUniforms: TileMaterialUniforms },
  skin: TileBackSkin,
): void {
  const back = tileBackColors(skin);
  mat.tileUniforms.uBackColor.value.copy(back.top);
  mat.tileUniforms.uBackColor2.value.copy(back.bottom);
}

/**
 * Matte finish for the tile back (−Z face). `clearcoat` scales the
 * body clearcoat (0 = none), `roughness` is absolute. Uniform writes —
 * no recompile.
 */
export function setTileBackFinish(
  mat: MeshPhysicalMaterial & { tileUniforms: TileMaterialUniforms },
  finish: { clearcoat: number; roughness: number },
): void {
  mat.tileUniforms.uBackClearcoat.value = finish.clearcoat;
  mat.tileUniforms.uBackRoughness.value = finish.roughness;
}
