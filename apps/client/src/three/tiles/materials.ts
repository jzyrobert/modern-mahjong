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
        uniform vec2 uCellScale;
        varying vec2 vAtlasUv;
        varying vec3 vTint;
        varying float vHighlight;
        varying float vFace;
        varying float vBack;
        varying float vBackGrad;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        vFace = step(0.92, objectNormal.z);
        vBack = step(0.92, -objectNormal.z);
        vBackGrad = clamp(position.y / 1.36 + 0.5, 0.0, 1.0);
        vAtlasUv = uv * uCellScale + aFaceCell;
        vTint = aTint;
        vHighlight = aHighlight;`,
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
        varying vec2 vAtlasUv;
        varying vec3 vTint;
        varying float vHighlight;
        varying float vFace;
        varying float vBack;
        varying float vBackGrad;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec4 faceTexel = texture2D(uAtlas, vAtlasUv);
        vec3 backCol = mix(uBackColor2, uBackColor, vBackGrad);
        vec3 body = mix(uBodyColor, backCol, vBack);
        diffuseColor.rgb = mix(body, faceTexel.rgb, vFace) * vTint;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, uBackRoughness, vBack);`,
      )
      .replace(
        'material.clearcoat = clearcoat;',
        'material.clearcoat = clearcoat * mix(1.0, uBackClearcoat, vBack);',
      )
      .replace(
        'material.sheenColor = sheenColor;',
        'material.sheenColor = sheenColor * mix(1.0, uBackClearcoat, vBack);',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uHighlightColor * vHighlight * 0.55;`,
      );
  };
  // Distinct cache key so three doesn't share the program with a stock
  // MeshPhysicalMaterial.
  mat.customProgramCacheKey = () => 'mahjong-tile-v2';
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
