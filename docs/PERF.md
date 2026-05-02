# Performance audit — animations + tile transitions

**Goal**: every animation in the app runs on the compositor (GPU) — only
`transform` and `opacity` mutate per frame. No `width`, `top`, `left`,
`box-shadow`, `background-color`, or other paint-triggering keyframes in
animated properties. Static visual styling (resting `box-shadow` for
tile depth, etc.) is fine — only animated props matter.

Tile transitions are bounded at **≤ 250 ms** so the table never feels
sluggish. The shared `SPRING` config in `Tile.tsx`
(`stiffness: 420, damping: 32, mass: 0.6`) settles in roughly **150 ms**
for typical UI deltas — comfortably under budget.

## Animations inventory

| Component | Property | Type | Notes |
| --- | --- | --- | --- |
| `Tile` (FLIP) | `transform` (auto via `layoutId`) | transform | framer-motion uses transform for FLIP layout transitions. |
| `Tile` (whileTap) | `scale` | transform | |
| `Wall` (pulse halo) | `scale`, `opacity` | transform + opacity | Implemented as a separate halo `<div>` so the underlying tile's static `box-shadow` stays. The halo grows + fades, no per-frame paint. |
| `ShuffleOverlay` (backdrop) | `opacity` | opacity | |
| `ShuffleOverlay` (spinning tile) | `x`, `y`, `rotate`, `opacity` | transform + opacity | |
| `DiceCeremony` (backdrop) | `opacity` | opacity | |
| `DiceCeremony` (die) | `rotate`, `scale`, `opacity` | transform + opacity | |
| `ScoringBreakdownModal` | static `box-shadow` only | n/a | Modal fade comes from `Modal.tsx` (no animated props). |

No animation in the codebase mutates a paint-triggering property per
frame. The `box-shadow` strings that appear in the source are all
**static** styles for resting depth — `Tile.tsx`, `ShuffleOverlay`'s
spinning-tile rest style, the dice rest shadow, etc. They're set once
and don't change.

## How to verify

- Open Chrome DevTools → **Performance → Rendering** → enable **Paint
  flashing**. Trigger any animation. Only the very first paint should
  flash (initial composite). Subsequent frames should be empty.
- Open **More tools → Layers**. Animated elements should each get their
  own composited layer (look for `transform: translate3d(...)` in the
  compositing reasons).
- The Lighthouse CI job (`lighthouse` step on every PR) enforces a
  Performance score ≥ 0.9 against `vite preview`. A regression in
  animation paint cost would surface here as a drop in **Speed Index**
  or **Total Blocking Time**.

## Future regressions to watch for

- Any new `motion.*` element that animates `box-shadow`, `width`,
  `height`, `top`, `left`, or `background-color`. If you need a glow
  effect, render it as an absolutely-positioned overlay div and animate
  its `opacity`/`scale` (as `Wall.tsx` does for the next-draw pulse).
- `framer-motion` `layout` prop on a deep tree — `layoutId` is OK
  because each ID is unique. But `layout` (without ID) can trigger
  child re-mounts.
- Long springs. Anything > 250 ms feels slow on a phone. Prefer a
  shorter `duration` or stiffer spring.
