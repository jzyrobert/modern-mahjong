import type { Action, Tile as MTile, Seat } from '@mahjong/game-logic';
import type { GameState } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import { useCallback, useRef } from 'react';
import { Color, Mesh, MeshStandardMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { type LobbyState, useGame } from '../../state/game';
import { type SceneContext, type SceneHandle, SceneHost } from '../core/SceneHost';
import { buildLights } from '../core/lights';
import { TilePool } from '../tiles/TilePool';
import { TILE_D, TILE_W } from '../tiles/geometry';
import { feltColors } from '../tiles/materials';

/**
 * PLACEHOLDER shell — proves the pipeline (Metro → three → WebGL →
 * screenshot verifier). The in-game feature agent replaces this file
 * with the real TableScene / layout / choreography / HUD composition
 * described in ARCHITECTURE.md §1. Keep the exported prop contract:
 * it's `Match.tsx`'s `sharedProps`.
 */
export interface Table3DShellProps {
  state: GameState;
  seat: Seat;
  lobby: LobbyState | null;
  matchCode: string | null;
  isHost: boolean;
  myTurn: boolean;
  needsDraw: boolean;
  canTsumo: boolean;
  tsumoFaan: number | null;
  concealedGangTile: MTile | null;
  promotedGangTile: MTile | null;
  hasClaimOption: boolean;
  nextDrawerSeat: Seat | null;
  aboutToDraw: boolean;
  drawCountdown: number | null;
  turnCountdown: number | null;
  latestDiscardId: number | null;
  userName: string;
  userWindGlyph: string;
  drawnTileId: number | null;
  hintTileId: number | null;
  readyWaits: MTile[];
  onAction: (a: Action) => void;
  onLeave: () => void;
  onSendChat: (text: string) => void;
  onTileTap: (t: MTile) => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  logOpen: boolean;
  setLogOpen: (v: boolean) => void;
  referenceOpen: boolean;
  setReferenceOpen: (v: boolean) => void;
  scoringOpen: boolean;
  setScoringOpen: (v: boolean) => void;
  playersOpen: boolean;
  setPlayersOpen: (v: boolean) => void;
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
}

const CAMERA = {
  position: [0, 9.5, 8.5] as [number, number, number],
  target: [0, 0, -0.4] as [number, number, number],
  fov: 42,
};

export function Table3DShell(props: Table3DShellProps) {
  const felt = useGame((s) => s.settings.felt);
  const tileBack = useGame((s) => s.settings.tileBack);
  const stateRef = useRef({ current: props.state, seat: props.seat }).current;
  stateRef.current = props.state;
  stateRef.seat = props.seat;

  const build = useCallback(
    (ctx: SceneContext): SceneHandle => {
      const { scene, renderer, quality, loop } = ctx;
      const lights = buildLights(scene, renderer, quality);
      const fc = feltColors(felt);
      const feltMat = new MeshStandardMaterial({ color: fc.top, roughness: 0.95 });
      const feltMesh = new Mesh(new PlaneGeometry(18, 18), feltMat);
      feltMesh.rotation.x = -Math.PI / 2;
      feltMesh.receiveShadow = true;
      scene.add(feltMesh);
      scene.background = new Color(fc.bottom).multiplyScalar(0.35);

      const pool = new TilePool(tileBack);
      scene.add(pool.mesh);

      const faceUp = new Quaternion();
      const faceDown = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
      const standing = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2 + 0.35);

      const sync = () => {
        const st = stateRef.current;
        const me = stateRef.seat;
        pool.hideAll();
        // Own hand: standing, facing camera, along the near edge.
        const hand = st.hands[me];
        const gap = TILE_W * 1.08;
        hand.forEach((t, i) => {
          const p = pool.pose(t);
          p.visible = true;
          p.position.set((i - (hand.length - 1) / 2) * gap, 0.7, 5.6);
          p.quaternion.copy(standing);
          p.scale = 1;
          pool.showFace(t);
        });
        // Discards flat in the centre, face up, per seat rows.
        for (const seat of [0, 1, 2, 3] as Seat[]) {
          const ds = st.discards[seat];
          const rel = (seat - me + 4) % 4;
          ds.forEach((t, i) => {
            const p = pool.pose(t);
            p.visible = true;
            const col = i % 6;
            const row = Math.floor(i / 6);
            const x = (col - 2.5) * (TILE_W * 1.05);
            const z = 2.2 + row * 1.45;
            const v = new Vector3(x, TILE_D / 2, z);
            v.applyAxisAngle(new Vector3(0, 1, 0), (rel * Math.PI) / 2);
            p.position.copy(v);
            p.quaternion
              .copy(faceUp)
              .premultiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2));
            p.quaternion.premultiply(
              new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (rel * Math.PI) / 2),
            );
            pool.showFace(t);
          });
        }
        // Wall: face-down stacks around the perimeter.
        st.wall.forEach((t, i) => {
          const p = pool.pose(t);
          p.visible = true;
          const side = Math.floor(i / 34);
          const slot = i % 34;
          const stack = slot % 2;
          const idx = Math.floor(slot / 2);
          const v = new Vector3((idx - 8) * TILE_W * 1.02, TILE_D / 2 + stack * TILE_D, 7.2);
          v.applyAxisAngle(new Vector3(0, 1, 0), (side * Math.PI) / 2);
          p.position.copy(v);
          p.quaternion
            .copy(faceDown)
            .premultiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2));
          pool.showBack(t);
        });
        pool.markDirty();
        pool.commit();
        loop.requestRender();
      };
      sync();
      const unsub = useGame.subscribe((s, prev) => {
        if (s.state !== prev.state && s.state) {
          stateRef.current = s.state;
          sync();
        }
      });
      return {
        dispose() {
          unsub();
          lights.dispose();
          pool.dispose();
          feltMesh.geometry.dispose();
          feltMat.dispose();
          scene.remove(feltMesh, pool.mesh);
        },
      };
    },
    [felt, tileBack, stateRef],
  );

  return (
    <div style={{ position: 'absolute', inset: 0 }} data-testid="table-3d">
      <SceneHost build={build} initialCamera={CAMERA} rebuildKey={`${felt}:${tileBack}`} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          justifyContent: 'center',
          gap: 6,
          padding: 8,
          pointerEvents: 'none',
        }}
      >
        {props.state.hands[props.seat].map((t) => (
          <button
            key={tileId(t)}
            type="button"
            data-testid="own-hand-tile"
            aria-label={`tile ${tileId(t)}`}
            onClick={() => props.onTileTap(t)}
            style={{
              pointerEvents: 'auto',
              width: 28,
              height: 40,
              opacity: 0.001,
              border: 0,
              background: 'transparent',
            }}
          />
        ))}
      </div>
    </div>
  );
}
