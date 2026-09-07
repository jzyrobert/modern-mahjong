# Bringing the 3D renderer to the native (Android) app

Status: **assessment only, not scheduled.** Written after PR #434 (the
Three.js rewrite) so the next person to ask "is the expo-gl port easy?" has
the answer and the numbers without re-surveying the tree.

**Short answer: no.** It is a medium-to-large project (weeks, not days) with
its own verification problem. Two cheaper routes are listed at the end.

## What the native app does today

`apps/client/src/three/entry.tsx` is a native stub exporting `null`s; Metro
picks `entry.web.tsx` on web (ARCHITECTURE.md §3). `resolveRenderer()`
therefore returns `'classic'` on native and the Android app runs the legacy
RN shells (`DesktopShell` / `MobileShell`). Nothing under `src/three/` other
than `renderer.ts` and `entry.tsx` is bundled for Android.

## Why an expo-gl port is not a mechanical swap

The 3D layer (`apps/client/src/three/`, ~19.7k lines excluding tests) was
written against the browser, and the coupling is in several layers at once.
Counts below are from `grep` over `src/three` at the round-6 head (052bdd8).

### 1. Every texture is drawn on a 2D canvas

There are no image assets: the CC0 policy (ARCHITECTURE.md §5) made
everything procedural, and "procedural" means `document.createElement('canvas')`
+ `CanvasRenderingContext2D` wrapped in `CanvasTexture`.

| Where | What is drawn |
| --- | --- |
| `tiles/faceAtlas.ts` | the glyph atlas (every tile face, plus the ink mask the carved-glyph shader reads as a height map) |
| `table/textures.ts` | 10 textures: felt albedo + cloth normal map, rail wood, centre plate (wind glyph + live / dead count), dice faces, chip, glow atlas, … |
| `table/TableScene.ts` | one more runtime canvas (the plate's live count re-draw) |
| `core/lights.ts` | the key light's gobo / soft-shadow texture |
| `menu/dice.ts` | the menu dice atlas |
| `settings/textures.ts` | preview felt + rail swatches |

Expo has no Canvas 2D. Options are `@shopify/react-native-skia` (draw the
same textures with Skia, read back pixels, upload as `DataTexture`) or
pre-baked PNGs (breaks the "no build-time assets" rule and loses the
per-skin re-tinting the settings preview does live). Either way every
drawing routine is a rewrite, and the glyph atlas is the hard one: the
shader's relief depends on the exact ink-mask raster.

### 2. The HUD is DOM

The tap targets for the hand are projected `<span>`s
(`table/hud/HitTargets.tsx`, `data-testid="own-hand-tile"`), drag-to-reorder
uses pointer events, coach-card placement and the seat-badge keep-outs read
`getBoundingClientRect`, orientation uses `matchMedia`, sizing uses
`ResizeObserver` and `window.devicePixelRatio`. 20 files under `src/three`
touch `document` / `window` / `matchMedia` / `getBoundingClientRect` /
`ResizeObserver` directly:

```
core/SceneHost.tsx  core/lights.ts  core/loop.ts  core/perf.ts  core/quality.ts
core/sizing.ts  menu/DriftScene.ts  menu/HeroScene.ts  menu/dice.ts  renderer.ts
replay/ReplayTable3D.tsx  settings/textures.ts  table/TableScene.ts
table/hud/ActionRow.tsx  table/hud/HitTargets.tsx  table/hud/LobbyGlass.tsx
table/hud/LobbyTableBackdrop.tsx  table/hud/ResultVeil.tsx  table/textures.ts
tiles/faceAtlas.ts
```

The glass HUD (`table/hud/*`, `ui/match/sheetLayout.ts`, the tutorial
overlay) is RN-web with web-only styling (`backdrop-filter`, CSS
`env(safe-area-inset-*)`, `position: fixed` chrome). On native those need
`expo-blur` + safe-area-context equivalents, and every projected rect must
come from the GL view's layout instead of the DOM.

### 3. Renderer, shaders and the three version

- `core/SceneHost.tsx` builds a `WebGLRenderer` on a DOM canvas, listens for
  `webglcontextlost` / `webglcontextrestored`, and redraws synchronously on
  `setSize`. expo-gl needs a `GLView` + `onContextCreate` bridge, its own
  context-loss story (backgrounding the app), and `renderer.setSize` /
  `setPixelRatio` fed from the view's layout.
- `tiles/materials.ts` uses `fwidth()` in the fragment shader (the
  footprint-aware carve step and the face-px fade). That needs GLSL ES 3.0
  or `OES_standard_derivatives`. expo-gl's WebGL2 support has historically
  lagged the three release in use (r185 here); expect shader / extension
  debugging on real devices, and possibly a WebGL1 fallback path for the
  relief.
- The tile pool relies on instancing (`InstancedMesh`, `InstancedBufferAttribute`
  for `aShadowCast`, `aBackVariant`, lift), a custom `MeshDepthMaterial` for
  per-instance shadow casting, `MeshPhysicalMaterial` clearcoat and PCF
  shadow maps. All WebGL2-era features that must be re-verified on
  expo-gl's ANGLE-less path.
- `core/loop.ts` is a `requestAnimationFrame` render-on-demand loop with
  `performance.now()` timing; RN has rAF but not the browser's vsync
  guarantees, and expo-gl requires an explicit `gl.endFrameEXP()` per frame.

### 4. The verification loop does not transfer

Every claim in this project was gated by `scripts/shot.mjs` (headless
Chromium on SwiftShader), the `three-*.spec.ts` Playwright suites and the
`__MAHJONG_PERF__` / `__MAHJONG_TABLE_3D_DEBUG__` hatches. None of that runs
on a device. A native port needs a new evidence pipeline (Maestro / Detox
screenshots on an emulator with GPU, or a debug-menu screenshot dump) before
the critic loop can judge it, or it ships unverified.

### 5. Performance is a re-measurement, not a given

expo-gl marshals GL calls over a JS-to-native bridge. The table is already
tuned to ≤ 12 draw calls / ~83k triangles, which is the right shape for that
bridge, but per-frame instance-buffer writes for 136 tiles, texture uploads
on skin change, and the shadow pass all need re-measuring on a mid-range
Android device (the budget target is a 2023 Snapdragon 7-series class phone,
ARCHITECTURE.md §0). The web path meets it in Chrome; the bridge path is
unknown.

## Rough sizing

| Piece | Estimate |
| --- | --- |
| GLView bridge, loop, sizing, context loss | 2–3 days |
| Texture generation on Skia (7 modules, glyph atlas the hardest) | 4–6 days |
| HUD: hit targets, drag, badges, toasts, glass sheets on native layout | 4–6 days |
| Shader / extension fixes on real devices (fwidth, instancing, shadows) | 2–4 days |
| Tutorial spotlight + coach-card placement from GL layout | 2–3 days |
| Menu backdrop (hero canvas that scrolls with the title) and replay table | 3–4 days |
| Device evidence pipeline + perf pass | 3–5 days |

**Total: roughly 3–6 weeks** for parity with the web renderer, before any
critic rounds. Table-only (menu, tutorial and replay stay classic on native)
is about half that.

## Cheaper alternatives

1. **Ship the exported web build inside the Android app in a WebView.** The
   3D renderer already runs on Android Chrome (that is what every manual
   play-test round used, via the Pages preview). Wrapping the `expo export`
   output in `react-native-webview` keeps the renderer, the HUD and the whole
   verification loop unchanged. Cost is a few days, mostly re-plumbing the
   native-only features (LAN host discovery, `@capacitor/preferences`
   storage, fullscreen / orientation lock) across the WebView bridge, plus
   deciding whether the classic shells stay as the offline fallback.
2. **Leave native on the classic shells and point Android users at the PWA
   install** for the 3D experience. Zero engineering; the preview alias is
   already installable, and the classic shells remain fully tested.

Recommendation if the 3D look is wanted on the store build: do (1) first,
measure retention / complaints, and only then decide whether the ~1 month of
(2)-style native work is worth it.

## If the port does go ahead

- Start by making `src/three/core` platform-neutral behind an interface
  (`createCanvas()`, `now()`, `onResize()`, `pixelRatio()`), so the web path
  keeps running through the same seams and the Playwright suite still gates
  every change.
- Port textures first and diff them pixel-for-pixel against the web canvases
  (dump both to PNG); the carved-glyph shader will show any atlas drift.
- Keep the DOM `HitTargets` on web; native gets a `Pressable` overlay driven
  by the same `TableScene.tileRect` projections.
- Treat "works in the Android emulator's SwiftShader" as the SwiftShader
  budget rule from CLAUDE.md: gate on draw calls / triangles / frame time,
  not fps.
