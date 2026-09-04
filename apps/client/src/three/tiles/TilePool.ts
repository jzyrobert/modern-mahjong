import { TOTAL_TILES, type Tile, tileId } from '@mahjong/game-logic';
import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  type MeshPhysicalMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import type { TileBackSkin } from '../../state/game';
import { BACK_CELL, buildFaceAtlas, cellIndexFor, cellOffset } from './faceAtlas';
import { tileGeometry } from './geometry';
import { type TileMaterialUniforms, createTileMaterial, setTileBackSkin } from './materials';

/**
 * One InstancedMesh holding every physical tile (136 instances, keyed
 * by engine `tileId`). Subsystems set a per-tile *pose* (position,
 * quaternion, scale, faceUp, tint, highlight, visible) and call
 * `commit()` once per frame — the pool writes instance matrices and
 * attributes in one pass. Hidden tiles collapse to scale 0 so the
 * instance count never changes (stable draw call, no re-allocation).
 *
 * Face-up vs face-down is *not* a rotation flag: the +Z face of the
 * geometry is the printed face; callers rotate the pose so +Z points
 * where the face should look. `faceCell` lets a pose show the back
 * cell on the +Z side too (opponent hands seen from the user's seat).
 */
export interface TilePose {
  position: Vector3;
  quaternion: Quaternion;
  scale: number;
  /** false → collapsed (scale 0) and skipped by raycasts. */
  visible: boolean;
  /** Atlas cell shown on +Z. Defaults to the tile's own face. */
  faceCell: number;
  tint: Color;
  highlight: number;
}

export interface TilePoolOptions {
  /** Face-atlas raster scale (1 default, ≤ 1.25 on high tier). */
  atlasScale?: number | undefined;
  /** Anisotropic filtering for the face atlas. */
  anisotropy?: number | undefined;
}

const _obj = new Object3D();
const _m = new Matrix4();

export class TilePool {
  readonly mesh: InstancedMesh;
  readonly poses: TilePose[] = [];
  readonly material: MeshPhysicalMaterial & { tileUniforms: TileMaterialUniforms };
  private faceCellAttr: InstancedBufferAttribute;
  private tintAttr: InstancedBufferAttribute;
  private highlightAttr: InstancedBufferAttribute;
  private dirty = true;

  constructor(backSkin: TileBackSkin, opts: TilePoolOptions = {}) {
    const atlas = buildFaceAtlas({ scale: opts.atlasScale, anisotropy: opts.anisotropy });
    this.material = createTileMaterial(atlas.texture, backSkin);
    // Per-pool clone of the shared rounded-box: the instanced
    // attributes below are attached to the geometry, so two live
    // pools (table + settings preview) must not share one instance.
    const geo = tileGeometry().clone();
    this.mesh = new InstancedMesh(geo, this.material, TOTAL_TILES);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'tiles';

    this.faceCellAttr = new InstancedBufferAttribute(new Float32Array(TOTAL_TILES * 2), 2);
    this.tintAttr = new InstancedBufferAttribute(new Float32Array(TOTAL_TILES * 3), 3);
    this.highlightAttr = new InstancedBufferAttribute(new Float32Array(TOTAL_TILES), 1);
    this.faceCellAttr.setUsage(DynamicDrawUsage);
    this.tintAttr.setUsage(DynamicDrawUsage);
    this.highlightAttr.setUsage(DynamicDrawUsage);
    geo.setAttribute('aFaceCell', this.faceCellAttr);
    geo.setAttribute('aTint', this.tintAttr);
    geo.setAttribute('aHighlight', this.highlightAttr);

    for (let id = 0; id < TOTAL_TILES; id++) {
      this.poses.push({
        position: new Vector3(),
        quaternion: new Quaternion(),
        scale: 1,
        visible: false,
        faceCell: id >> 2,
        tint: new Color(1, 1, 1),
        highlight: 0,
      });
    }
    this.commit();
  }

  pose(t: Tile | number): TilePose {
    const id = typeof t === 'number' ? t : tileId(t);
    const p = this.poses[id];
    if (!p) throw new Error(`tile id out of range: ${id}`);
    return p;
  }

  /** Reset a pose to show its own face. */
  showFace(t: Tile | number): void {
    const p = this.pose(t);
    p.faceCell = (typeof t === 'number' ? t : tileId(t)) >> 2;
  }

  /** Show the back cell on the +Z side (concealed tile seen from above). */
  showBack(t: Tile | number): void {
    this.pose(t).faceCell = BACK_CELL;
  }

  hideAll(): void {
    for (const p of this.poses) p.visible = false;
    this.dirty = true;
  }

  markDirty(): void {
    this.dirty = true;
  }

  setBackSkin(skin: TileBackSkin): void {
    setTileBackSkin(this.material, skin);
  }

  /** Write every pose into the GPU buffers. Cheap when nothing changed. */
  commit(force = false): boolean {
    if (!this.dirty && !force) return false;
    const fc = this.faceCellAttr.array as Float32Array;
    const tn = this.tintAttr.array as Float32Array;
    const hl = this.highlightAttr.array as Float32Array;
    for (let id = 0; id < TOTAL_TILES; id++) {
      const p = this.poses[id]!;
      const s = p.visible ? p.scale : 0;
      _obj.position.copy(p.position);
      _obj.quaternion.copy(p.quaternion);
      _obj.scale.setScalar(s);
      _obj.updateMatrix();
      this.mesh.setMatrixAt(id, _obj.matrix);
      if (p.faceCell === BACK_CELL) {
        // Sentinel: the material swaps the atlas sample for the skin
        // gradient on the +Z side (see `materials.ts`).
        fc[id * 2] = -1;
        fc[id * 2 + 1] = -1;
      } else {
        const [ox, oy] = cellOffset(p.faceCell);
        fc[id * 2] = ox;
        fc[id * 2 + 1] = oy;
      }
      tn[id * 3] = p.tint.r;
      tn[id * 3 + 1] = p.tint.g;
      tn[id * 3 + 2] = p.tint.b;
      hl[id] = p.highlight;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.faceCellAttr.needsUpdate = true;
    this.tintAttr.needsUpdate = true;
    this.highlightAttr.needsUpdate = true;
    this.dirty = false;
    return true;
  }

  /** World matrix of one instance (for projection to screen / picking). */
  matrixAt(id: number, out: Matrix4 = _m): Matrix4 {
    this.mesh.getMatrixAt(id, out);
    return out.premultiply(this.mesh.matrixWorld);
  }

  dispose(): void {
    this.mesh.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

export { cellIndexFor };
