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
   * the shade the table marks its dead-wall stacks with. Derived from
   * the skin (`deadBackColors`): the same hue a step darker and a touch
   * less saturated, so the block reads as a shaded segment of the *same*
   * set — round-3 critique: an independent ivory-tan read as mixed tile
   * sets.
   */
  uDeadBack: { value: Color };
  uDeadBack2: { value: Color };
  /**
   * How much of the back skin's top→bottom gradient the −Z face shows:
   * 1 (default) runs the full swatch range; smaller values compress it
   * about the mid-tone so the light end stays a colour. See
   * `setTileBackGradient` — the table sets 0.55 because a wall stack's
   * near-white light end merged with the ivory edge highlight and the
   * stack's top face read as sitting lower than its darker dead-wall
   * neighbours (round-4 #5).
   */
  uBackGradAmount: { value: number };
  /** Gold of the dead-wall inlay band (`aBackVariant` 1). */
  uDeadInlay: { value: Color };
}

/** Body roughness shared by the tile faces and, by default, the back. */
export const TILE_BODY_ROUGHNESS = 0.32;

export function tileBackColors(skin: TileBackSkin): { top: Color; bottom: Color } {
  const s = TILE_BACK_SKINS[skin];
  return { top: new Color(s.top), bottom: new Color(s.bottom) };
}

/**
 * Dead-wall back shade for a skin: same hue, lightness × 0.68,
 * saturation × 0.8 — unmistakably darker beside the live stacks under
 * the same key light, never a different colour.
 */
export function deadBackColors(skin: TileBackSkin): { top: Color; bottom: Color } {
  const back = tileBackColors(skin);
  const shade = (c: Color) => {
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    return new Color().setHSL(hsl.h, hsl.s * 0.8, hsl.l * 0.68);
  };
  return { top: shade(back.top), bottom: shade(back.bottom) };
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
  const dead = deadBackColors(backSkin);
  const uniforms: TileMaterialUniforms = {
    uAtlas: { value: atlas },
    uCellScale: { value: new Vector2(CELL_SCALE[0], CELL_SCALE[1]) },
    uBodyColor: { value: new Color('#efe6d2') },
    uBackColor: { value: back.top },
    uBackColor2: { value: back.bottom },
    // A saturated lacquer gold: the cue rim must read *gold* on an
    // ivory face under the bright key + ACES, not a whiter white.
    uHighlightColor: { value: new Color('#f3b74a') },
    uBackClearcoat: { value: 1 },
    uBackRoughness: { value: TILE_BODY_ROUGHNESS },
    uDeadBack: { value: dead.top },
    uDeadBack2: { value: dead.bottom },
    uBackGradAmount: { value: 1 },
    uDeadInlay: { value: new Color('#d8a85a') },
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
        attribute float aStackTop;
        uniform vec2 uCellScale;
        varying vec2 vAtlasUv;
        varying vec3 vTint;
        varying float vHighlight;
        varying float vFace;
        varying float vBack;
        varying float vBackGrad;
        varying float vBackCell;
        varying float vBackVariant;
        varying float vInnerSide;
        varying float vStackTop;
        varying vec2 vLocalYZ;`,
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
        vBackVariant = aBackVariant;
        // Dead-wall inlay (fragment): the −Y side is the wall stack's
        // inner long side (face-down tiles keep local −Y toward the
        // table centre on every wall), local y / z locate the band.
        vInnerSide = step(0.92, -objectNormal.y);
        vStackTop = aStackTop;
        vLocalYZ = vec2(position.y / 1.36, position.z / 0.62);`,
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
        uniform float uBackGradAmount;
        uniform vec3 uDeadBack;
        uniform vec3 uDeadBack2;
        varying vec2 vAtlasUv;
        varying vec3 vTint;
        varying float vHighlight;
        varying float vFace;
        varying float vBack;
        varying float vBackGrad;
        varying float vBackCell;
        varying float vBackVariant;
        varying float vInnerSide;
        varying float vStackTop;
        varying vec2 vLocalYZ;
        uniform vec3 uDeadInlay;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Slight negative LOD bias: minified river glyphs pick the
        // sharper mip (anisotropic filtering keeps it from shimmering).
        vec4 faceTexel = texture2D(uAtlas, vAtlasUv, -0.35);
        // Every selector below is a per-vertex step / clamp interpolated
        // across the triangle. At a silhouette pixel MSAA shades the
        // fragment at the pixel centre, which can lie *outside* the
        // triangle, so the varyings arrive extrapolated past [0, 1].
        // Unclamped, mix(uBackColor2, uBackColor, grad) overshot along
        // the skin's gradient and painted a 1 px hairline of the wrong
        // hue along the far edge of every wall top (violet on the blue
        // skin, green on plum). Clamp before use.
        float vFaceC = clamp(vFace, 0.0, 1.0);
        float vBackC = clamp(vBack, 0.0, 1.0);
        float vInnerSideC = clamp(vInnerSide, 0.0, 1.0);
        float backGrad = mix(0.5, clamp(vBackGrad, 0.0, 1.0), uBackGradAmount);
        vec3 backCol = mix(
          mix(uBackColor2, uBackColor, backGrad),
          mix(uDeadBack2, uDeadBack, backGrad),
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
        float showBack = max(vBackC, vFaceC * vBackCell);
        vec3 body = mix(uBodyColor, backCol, showBack);
        // Dead-wall inlay: a gold band along the inner edge of the back
        // (the up-facing side of a face-down stack) and the upper part of
        // the inner side face, so the segment reads as marked from every
        // camera — the far wall shows the side band face-on, the near
        // wall its top edge, the side walls both. Replaces a felt hairline
        // beside the stacks that read as a stray line on the cloth.
        // Kept slim (a hairline along the inner edge, the upper third of
        // the inner side) and blended at 0.8 so seven marked stacks read
        // as an inlaid trim, not a dashed yellow stripe down the wall.
        // The side band is drawn on the stack's exposed top tile only
        // (aStackTop): on both tiles of a two-high stack the 31° and
        // 44° cameras saw two bars per stack, and a marked segment read
        // as a ladder of gold dashes instead of one continuous trim.
        float inlayTop = vBackC * step(vLocalYZ.x, -0.5 + 0.09);
        float inlaySide = vInnerSideC * vStackTop * step(vLocalYZ.y, -0.5 + 0.36);
        float inlay = vBackVariant * clamp(inlayTop + inlaySide, 0.0, 1.0) * 0.8;
        body = mix(body, uDeadInlay, inlay);
        float showFace = vFaceC * (1.0 - vBackCell);
        diffuseColor.rgb = mix(body, faceTexel.rgb, showFace) * vTint;
        // The inlay is lacquer, not the matte back: keep it glossy.
        showBack *= 1.0 - inlay;
        // Cue glow: warm the albedo toward gold as well as adding
        // emissive so blue / plum backs read gold, not washed-out white.
        // On a face the warming is masked by the texel's luminance so
        // only the ivory body takes the gold: printed ink — black
        // numerals, the red 萬, green bamboo — keeps its own colour and
        // a spotlit hand stays legible (glyph contrast ≥ 4.5:1 at the
        // top of the tutorial breath instead of ~1.4:1).
        float faceLuma = dot(faceTexel.rgb, vec3(0.299, 0.587, 0.114));
        float inkMask = mix(1.0, smoothstep(0.3, 0.6, faceLuma), showFace);
        // Glow band along the face's edge — where the emissive gold read
        // comes from on a lit face, instead of a flat wash over the ink.
        float glowRim = smoothstep(0.72, 0.97, max(edge.x, edge.y));
        diffuseColor.rgb = mix(diffuseColor.rgb, uHighlightColor, vHighlight * 0.7 * inkMask);
        // …and the ink itself deepens a little under the light, so the
        // lit face gains contrast (red 萬 ≥ 5:1 against the ivory) the
        // way a printed glyph does under a lamp, rather than flattening.
        diffuseColor.rgb *= 1.0 - 0.4 * vHighlight * (1.0 - inkMask);`,
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
        // Backs / sides: flat gold emissive. Faces: a rim glow plus a
        // gentle lift on the ivory body only (masked off the ink).
        float glowAmt = mix(0.55, 0.2 * inkMask + 0.5 * glowRim, showFace);
        totalEmissiveRadiance += uHighlightColor * vHighlight * glowAmt;
        // The dead-wall inlay keeps a faint self-glow so it stays gold in
        // the stacks' shadow instead of dropping to brown.
        totalEmissiveRadiance += uDeadInlay * inlay * 0.1;`,
      );
  };
  // Distinct cache key so three doesn't share the program with a stock
  // MeshPhysicalMaterial.
  mat.customProgramCacheKey = () => 'mahjong-tile-v9';
  return mat;
}

export function setTileBackSkin(
  mat: MeshPhysicalMaterial & { tileUniforms: TileMaterialUniforms },
  skin: TileBackSkin,
): void {
  const back = tileBackColors(skin);
  const dead = deadBackColors(skin);
  mat.tileUniforms.uBackColor.value.copy(back.top);
  mat.tileUniforms.uBackColor2.value.copy(back.bottom);
  mat.tileUniforms.uDeadBack.value.copy(dead.top);
  mat.tileUniforms.uDeadBack2.value.copy(dead.bottom);
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

/**
 * Compress the back gradient (see `TileMaterialUniforms.uBackGradAmount`).
 * Additive: stock materials keep the full range until a caller opts in.
 */
export function setTileBackGradient(
  mat: MeshPhysicalMaterial & { tileUniforms: TileMaterialUniforms },
  amount: number,
): void {
  mat.tileUniforms.uBackGradAmount.value = Math.min(1, Math.max(0, amount));
}
