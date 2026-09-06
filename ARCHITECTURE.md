# Three.js frontend rewrite — architecture

This document is the contract every feature agent and critic works against.
It covers the render layer only; the engine (`packages/game-logic`), the
protocol, the transports and the zustand `useGame` store are unchanged and
remain the single source of truth for game state. **The 3D layer is a
projection of store state, never a second copy of it.**

## 0. Goals and non-goals

| Goal | How we hold ourselves to it |
| --- | --- |
| A significantly more modern, 3D, animated look for menu, match, tutorial and settings | Critic gauntlet (`docs/STATUS.json`): every subsystem scores ≥ 8.5 / 10 with zero console errors before it counts as done. |
| ≥ 60 fps on an average modern phone (2023-class mid-range Android, e.g. Snapdragon 7-series / Dimensity 8000, 1080×2400 at DPR ≤ 2) | Draw-call, triangle, texture and JS-frame-time budgets below, enforced by the screenshot verifier's JSON log. |
| CC0 assets only | Asset policy (§5). No downloads at build time; everything is procedural or vendored CC0. |
| Nothing regresses for the engine, server, protocol, native app or the existing Playwright suite | Renderer is a runtime switch (§3). Legacy shells stay in the tree and stay tested. |

Non-goals for this pass: native (Android) WebGL via `expo-gl` (the native
app keeps the legacy shells; see §3), WebGPU (three r185's WebGPURenderer is
not yet a safe default on mid-range Android browsers), replacing the replay
library / lobby-browser CRUD screens (they get the new theme, not a 3D scene).

## 1. Folder layout — one folder per subsystem

All new code lives under `apps/client/src/three/`. Everything in that tree
is **web-only** (`three` needs a real `WebGL2RenderingContext`); the single
entry point is platform-split so Metro never bundles it for native.

```
apps/client/src/three/
├── core/          Shared runtime. No game knowledge.
│   ├── SceneHost.tsx      React wrapper: owns <canvas>, resize, DPR clamp,
│   │                      visibility pause, context-loss recovery.
│   ├── loop.ts            Single requestAnimationFrame loop; fixed-step
│   │                      tweens; "render on demand" when nothing animates.
│   ├── quality.ts         Quality tiers (low / mid / high) + auto-detect.
│   ├── perf.ts            Frame-time ring buffer + renderer.info sampler;
│   │                      publishes window.__MAHJONG_PERF__ (§4).
│   ├── camera.ts          Camera rig: presets per viewport class, eased
│   │                      transitions, parallax on pointer / gyro.
│   ├── lights.ts          Key + fill + rim, baked-ish env (PMREM of a
│   │                      procedural gradient sky), soft contact shadows.
│   ├── tween.ts           Tiny spring / ease helpers (no GSAP dependency).
│   ├── postfx.ts          Optional bloom + vignette, high tier only.
│   └── hud/               Shared HTML-over-canvas primitives (glass panel,
│                          pill, button) used by every subsystem's HUD.
├── tiles/         Tile assets. Shared by menu, table, settings, tutorial.
│   ├── geometry.ts        Rounded-box tile geometry (one BufferGeometry).
│   ├── faceAtlas.ts       Canvas2D-drawn 136-face atlas (ports TileGlyph
│   │                      SVG geometry + Noto Serif TC glyphs to Canvas).
│   ├── materials.ts       Face / back / side materials, skin-aware
│   │                      (reads FELT_SKINS / TILE_BACK_SKINS).
│   └── TilePool.ts        InstancedMesh pool: 136 tiles max, per-instance
│                          face UV offset + tint; the only way tiles draw.
├── table/         In-game subsystem (`/match` when phase !== 'waiting').
│   ├── TableScene.ts      Scene graph: felt, rail, four walls, four hands,
│   │                      discards, melds, dice, centre marker.
│   ├── layout.ts          World-space slots for every tile given GameState
│   │                      + user seat (pure function; unit-tested). The
│   │                      four walls sit `WALL_D` from the centre as a
│   │                      pinwheel: each 17-stack run is staggered
│   │                      `WALL_STAGGER` along its own axis toward its
│   │                      owner's right and turned `WALL_YAW` (2.5°) about
│   │                      its centre, overhanging end outward (same sense
│   │                      for all four), so one end overhangs the
│   │                      neighbouring wall's inner face (`WALL_END`) and
│   │                      the other stops short of it — the staggered,
│   │                      slightly askew square of a real table. Rows
│   │                      keep `ROW_OVERHANG_GAP` from an overhang's tip
│   │                      (`rowLeftLimit`).
│   ├── choreography.ts    Diffs successive GameStates into tile motions
│   │                      (draw, discard, claim, dispense, gang).
│   ├── picking.ts         Raycast → tile / wall-slot; hover + press.
│   ├── Table3DShell.tsx   The shell `Match.tsx` mounts. Composes
│   │                      SceneHost + TableScene + HUD.
│   └── hud/               Match HUD (turn pill, claim bar, result panel,
│                          menu). Re-uses the existing ClaimBar /
│                          ResultPanel logic; restyles them.
├── menu/          Main menu subsystem (`/`). Two canvases:
│   ├── HeroScene.ts       The rack + dice, in a canvas mounted *inside the
│   │                      lobby's hero band* (`ui/menu/HeroBandSlot`) —
│   │                      ScrollView content, so it scrolls with the title
│   │                      on the compositor. Renders the band's sub-frame
│   │                      of a viewport-sized frame (`setViewOffset`).
│   ├── DriftScene.ts      The drift field in the fixed full-viewport
│   │                      backdrop (`ui/menu/LobbyBackdrop`): depth fog,
│   │                      pointer parallax, DOM-occluder fades. Never
│   │                      follows scroll.
│   ├── layout.ts          Pure fit maths shared by both (unit-tested).
│   ├── menuDebug.ts       `__MAHJONG_MENU_DEBUG__`, merged from both.
│   ├── MenuSceneView.tsx  The two SceneHost views; Menu3DBackdrop.tsx
│   │                      lazy-loads them after first paint + idle.
│   └── ShelfScene.ts      Replay library's empty-state shelf.
├── settings/      Settings subsystem (panel + live preview).
│   ├── PreviewScene.ts    One tile + felt swatch, orbiting slowly; skin
│   │                      changes re-tint live.
│   ├── Settings3D.tsx
│   └── quality.tsx        Renderer / quality controls (classic ↔ 3D).
├── tutorial/      Tutorial subsystem.
│   ├── Spotlight.ts       3D spotlight + rim highlight on the target
│   │                      tiles / slots (world-space, not DOM rects).
│   ├── targets.ts         Maps TutorialTargetId → world anchor, projects
│   │                      to screen so the existing coach-mark overlay
│   │                      (TutorialOverlay) keeps working unchanged.
│   └── Tutorial3D.tsx
└── replay/        Replay player (`/replays/[id]` under the 3D renderer).
    ├── ReplayTable3D.tsx  Read-only table: the match's TableScene fed
    │                      `frames[cursor].state`, camera behind the
    │                      point-of-view seat, no hit targets; a cursor
    │                      step springs the moved tiles (snaps under
    │                      reduced motion).
    └── layout.ts          HUD bands + seat-badge docks per viewport
                           class, mirroring Table3DShell's (pure,
                           unit-tested). The glass chrome itself is
                           universal RN (`src/ui/replay/Glass*`) and
                           reaches these through `entry.tsx`.
```

Rules:

- `core/` and `tiles/` must not import from `table/`, `menu/`, `settings/`
  or `tutorial/`. Subsystems may import `core/` and `tiles/` and nothing
  from each other — with one deliberate exception: `replay/` imports
  `table/` (`TableScene`, `layout`, `cameraPresets`), because a replay
  *is* the match's table shown at a recorded frame; it never re-derives
  the scene.
- Game logic, scoring, claim rules: import from `@mahjong/game-logic`.
  Never re-derive in the render layer.
- Anything a user clicks must also exist as a DOM element with the same
  `data-testid` the legacy shells use (`own-hand-tile`, `wall-draw-next`,
  `claim-bar`, …). We project the world-space tile rect to a transparent,
  absolutely-positioned `<button>` (`table/picking.ts → hud/HitTargets`).
  This is what keeps the existing Playwright suite meaningful and keeps
  the game usable with a screen reader.

## 2. Rendering model

- **three r185 (`three@0.185.1`), WebGLRenderer, imperative scene graph.**
  No `react-three-fiber`: the reconciler adds per-frame overhead and a
  second component tree; we already have a store to subscribe to. React
  owns the HUD (DOM); three owns the canvas; `SceneHost` is the only
  bridge (mount / resize / dispose).
- **State → scene is a pure diff.** `choreography.ts` receives
  `(prevState, nextState, engineEvent)` from a `useGame.subscribe`
  listener and enqueues tile motions. Tile identity is the engine's
  `tileId` (0..135), so a tile keeps its instance across hand → discard →
  meld and animates naturally (this replaces `FlipBag`).
- **One InstancedMesh for all tiles** (`TilePool`). Faces come from a
  single atlas texture (17 columns × 2 rows of 256×352 cells → 4352×704,
  fits in a 8192² limit with room for a 2× DPR crisp variant). Per-
  instance attributes: `faceOffset` (vec2), `tint` (vec3), `highlight`
  (float). Result: **the whole table is ≤ 12 draw calls** (felt, rail,
  tiles, dice ×2, centre marker, shadows, text sprites, HUD is DOM).
- **Text** on the felt (wind markers, scores) is DOM in the HUD, not
  3D text, except the dealer marker which is a canvas sprite.
- **Animation**: all motion is in the render loop (`tween.ts` springs),
  never React state. Camera transitions, tile flights, dice tumble, win
  burst are transform/opacity-equivalent operations on Object3D
  instances or instance matrices; no per-frame geometry rebuilds, no
  per-frame material recompiles.
- **Render on demand.** When no tween is live and the pointer is still,
  the loop idles (`needsRender=false`) — a still table costs 0 GPU
  frames. Menu backdrop idles to 30 fps when the tab is not focused and
  pauses entirely on `visibilitychange: hidden`.
- **Anything that must move with scrolled DOM is DOM.** A canvas that
  chases scroll events (re-aiming a camera from a scroll listener) is
  redrawn a frame or more behind the compositor-scrolled page on a real
  phone and reads as jitter. The menu hero therefore renders into a
  canvas that *is* scroll content (inside the hero band) and only the
  fixed drift field stays in the backdrop; `__MAHJONG_PERF__` sums the
  live canvases so the budget still covers the page.
- **Reduced motion** (`settings.animations === false` or the OS query)
  collapses every tween to ≤ 120 ms and disables parallax and post-fx.

## 3. Integration and the renderer switch

- New setting `settings.renderer: 'auto' | '3d' | 'classic'` in
  `UserSettings` (default `'auto'`), persisted through the existing
  `loadSettings` / `persistSettings` path.
- `resolveRenderer()` → `'3d'` when `Platform.OS === 'web'`, WebGL2 is
  available, and the setting isn't `'classic'`; otherwise `'classic'`.
  A `?renderer=classic|3d` query param and a
  `globalThis.__MAHJONG_TEST_RENDERER__` global override both, so the
  legacy e2e suite pins `classic` in one place (`e2e/_helpers.ts`) and
  new 3D specs pin `3d`.
- `Match.tsx` mounts `Table3DShell` instead of `DesktopShell` /
  `MobileShell` when the renderer resolves to `'3d'`; the shared derived
  props (`sharedProps`) are unchanged. `Lobby.tsx` mounts `Menu3D` the
  same way, but through the stricter `resolveMenuBackdrop()`: under
  `auto` the `low` quality tier (software GL, ≤ 4 cores / ≤ 3 GB) keeps
  the DOM-only menu, while an explicit `'3d'` (setting, query or the
  test global — the verifier's SwiftShader path) always mounts. The
  backdrop chunk is imported after first paint + `requestIdleCallback`
  so LCP / TBT are measured on the DOM menu.
  `SettingsPanel` gains the live preview and renderer control.
  The tutorial overlay is untouched; `tutorial/targets.ts` feeds it
  projected rects through the existing `TargetRegistry`.
- Native builds resolve to `'classic'` always (the three tree is
  `.web.tsx`-split at the entry; a `three-entry.native.tsx` exports null
  components), so the Android APK size and behaviour don't change.
- Context loss: `SceneHost` listens for `webglcontextlost`, shows the
  glass "Restoring table…" veil, rebuilds on `webglcontextrestored`; after
  two losses in a session it falls back to classic and persists nothing.

## 4. Performance budget (≥ 60 fps on an average modern phone)

Reference device: 2023 mid-range Android (Snapdragon 7 Gen 1 / Dimensity
8100 class, Adreno 644 / Mali-G610 GPU), Chrome, 1080×2400 panel at DPR
2.625 — of which the browser viewport is ~1080×1830 device px ≈
**412×700 CSS px** once the address bar and system bars take their share
(the full 412×915 is the installed / fullscreen case) → we clamp DPR to
**≤ 2** (≤ 1.5 on `low` tier).

| Metric | Budget (mid tier, in-game) | Where measured |
| --- | --- | --- |
| JS main-thread frame time (p95) | ≤ 8 ms | `__MAHJONG_PERF__.frameMsP95` |
| Draw calls per frame | ≤ 40 in-game, ≤ 20 menu, ≤ 8 settings preview | `renderer.info.render.calls` |
| Triangles per frame | ≤ 150 k | `renderer.info.render.triangles` |
| Texture memory | ≤ 48 MB (atlas ≤ 24 MB incl. mips) | `renderer.info.memory.textures` + atlas size |
| Programs (shaders) | ≤ 12 compiled, all compiled during the load veil | `renderer.info.programs.length` |
| Lights | ≤ 1 shadow-casting directional + 1 hemisphere + env | code review |
| Shadow map | 1024² mid / 512² low / 2048² high, updated only when tiles move | `lights.ts` |
| Post-processing | none on low / mid; bloom + vignette on high only | `postfx.ts` |
| Bundle | `three` core + addons used ≤ 700 kB minified before gzip (~170 kB gz); no `drei`, no `postprocessing`, no GSAP | `expo export` size log |
| First interactive (menu) | ≤ 2.5 s on Moto G-class 4G (Lighthouse perf ≥ 0.9 stays green) | CI Lighthouse |
| Steady-state idle | 0 renders/s when nothing animates | `__MAHJONG_PERF__.idle` |

Quality tiers (`core/quality.ts`): `high` (desktop-class GPU: DPR ≤ 2,
2048 shadows, post-fx), `mid` (default phone: DPR ≤ 2, 1024 shadows, no
post-fx), `low` (`navigator.hardwareConcurrency ≤ 4` or `deviceMemory ≤ 4`
or a measured p95 > 12 ms for 2 s: DPR ≤ 1.5, 512 shadows, no env
reflections, no parallax). Auto-downgrade is one-way per session.

Headless-CI caveat: the verifier runs on SwiftShader (software GL), so GPU
frame time there is **not** the phone number. The verifier therefore
reports and gates on the CPU-side metrics (JS frame time, draw calls,
triangles, texture bytes, program count), which are device-independent,
and records the SwiftShader fps for trend only. A red draw-call or
triangle budget is a real failure; a low SwiftShader fps is not. Lighthouse
runs the same software GL without pinning `'3d'`, so it exercises the
`auto` → `low` → DOM-only menu path (§3) and never pays for the backdrop.

## 5. Asset policy — CC0 only

- **Allowed sources**: Poly Haven (CC0), ambientCG (CC0), and procedural
  generation in code. Nothing else. No Sketchfab, no Google Fonts font
  files beyond what the app already ships (Noto Serif TC is loaded by the
  existing client and is SIL OFL, which is already accepted in the repo).
- **Default is procedural.** Felt is a procedural noise-cloth normal +
  roughness map generated once on a canvas (`tiles/materials.ts` /
  `table/TableScene.ts`); tile faces are drawn on canvas from the same
  geometry as `TileGlyph.tsx`; tile bodies use a procedural bone-ivory
  gradient with subtle noise; the sky/env is a procedural gradient
  PMREM. This keeps the bundle at zero binary assets for the 3D layer.
- **If a downloaded texture is ever added**: vendor it under
  `apps/client/assets/cc0/<source>/<name>/` with a `LICENSE.txt` naming
  the source URL and "CC0 1.0", downsized to ≤ 1024² and ≤ 300 kB per
  map, and list it in `docs/ASSETS.md`. Agents must not fetch assets
  at build or run time.
- No emoji, no stock icons, no AI-generated images committed as assets.
  Icons are inline SVG paths (existing `menu/icons.tsx`).

## 6. Verification loop

`apps/client/scripts/shot.mjs` — the only accepted evidence of a visual
claim. Headless Chromium (Playwright's bundled build, SwiftShader GL),
loads the exported bundle, drives to a named state, and writes
`<out>/<state>.png` + `<out>/<state>.json`:

```json
{
  "state": "match-my-turn",
  "renderer": "3d",
  "viewport": { "width": 412, "height": 700, "dpr": 2.625, "name": "phone" },
  "consoleErrors": [],
  "pageErrors": [],
  "perf": { "fps": 58, "frameMsP95": 6.1, "drawCalls": 11, "triangles": 41000,
            "textures": 3, "programs": 6, "geometries": 4 },
  "budget": { "pass": true, "violations": [] }
}
```

States are recipes in `scripts/shot-states.mjs` (menu, menu-online,
settings, settings-skins, tutorial-basics-step0, match-dealt,
match-my-turn, match-claim, match-result, replay-library,
replay-player-mid, …). Each recipe
is a list of steps (goto, click, waitFor, evaluate, setSetting). Adding a
state = adding a recipe. `--renderer classic|3d`, `--viewport
phone|phone-tall|phone-small|phone-landscape|tablet|desktop`, `--dist
<dir>`, `--out <dir>` are the knobs. `phone` is a phone *in a browser*
(412×700 CSS px at dpr 2.625, aspect 1.69); `phone-tall` is the 412×915
fullscreen case and `phone-small` a 360×640 budget phone — portrait
states are verified at `phone` and `phone-small`, with `phone-tall` as
the regression check. A recipe that pins `viewport: 'phone'` only fixes
the orientation: a CLI viewport of the same class wins. Run one
`shot.mjs` process at a time: SwiftShader shares one CPU, and parallel
runs have captured a frame with the camera still easing in from the
lobby preset.

Rule for every agent, feature or critic: **you may not describe what the
app looks like unless you have run `shot.mjs` for that state and looked
at the PNG.** Critics take their own screenshots; they never trust the
feature agent's.

## 7. Scoring and the gauntlet

- `docs/STATUS.json` is the persistent scoreboard. Shape:
  `{ "round": n, "subsystems": { "<name>": { "score": 0-10, "errors": n,
  "pass": bool, "issues": [ { "rank", "severity", "title", "state",
  "detail" } ], "history": [...] } }, "wholeGame": {...}, "blindJudges":
  [...] }`.
- Pass = score ≥ 8.5 **and** zero console / page errors **and** perf
  budget pass on every state the subsystem owns.
- Up to 4 feature → critic rounds per subsystem. After that the open
  issues are left in STATUS.json for the next `/loop` iteration, which
  always resumes from the lowest-scoring subsystem.
- Final: whole-game critic scores the full flow; blind judges see pairs
  labelled A / B (3D vs. baseline `dist-baseline/` render of the same
  state) with the labels shuffled per pair and say which they prefer and
  why. Their verdicts are persisted, including the losses.

## 8. Testing

- `layout.ts`, `choreography.ts`, `quality.ts`, `faceAtlas.ts` (cell
  indexing) get vitest unit tests; they are pure.
- New Playwright specs live in `apps/client/e2e/three-*.spec.ts`, pin
  `__MAHJONG_TEST_RENDERER__ = '3d'`, and assert on DOM hit-targets +
  `__MAHJONG_PERF__` + zero console errors. They are slotted into shards
  per `playwright.config.ts` rules.
- Legacy specs pin `classic` in `e2e/_helpers.ts` and keep running.
