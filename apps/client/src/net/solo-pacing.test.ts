import { type GameState, type Tile, emptyState, soloRulesFrom } from '@mahjong/game-logic';
import type { ServerMessage } from '@mahjong/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BOT_CLAIM_MAX_MS,
  DEFAULT_BOT_CLAIM_MIN_MS,
  botClaimDelayMs,
  createSoloTransport,
} from './solo-transport';

/**
 * Test-override hooks for solo claim pacing. The production default
 * (per-bot 2-6 s stagger before each bot submits its claim pick)
 * gives the user time to read a discard between bot moves; specs
 * need to suppress it to keep the suite fast and deterministic. The
 * post-user-discard floor was removed — when no bot claims, the next
 * bot's draw fires immediately and the bot's own pre-discard thinking
 * gap covers the read window.
 */

interface PacingGlobals {
  __MAHJONG_TEST_BOT_CLAIM_DELAY_MS__: number | undefined;
}

function pacingGlobals(): PacingGlobals {
  return globalThis as unknown as PacingGlobals;
}

describe('botClaimDelayMs', () => {
  beforeEach(() => {
    pacingGlobals().__MAHJONG_TEST_BOT_CLAIM_DELAY_MS__ = undefined;
  });
  afterEach(() => {
    pacingGlobals().__MAHJONG_TEST_BOT_CLAIM_DELAY_MS__ = undefined;
  });

  it('returns a value in the production range when no override is set', () => {
    // Sample multiple draws — the underlying Math.random() means a
    // single call can land anywhere in `[MIN, MAX)`. The invariant
    // we're enforcing is that every draw stays inside the range, and
    // that the spread covers more than a single point so the
    // production stagger genuinely varies between bots.
    const samples = Array.from({ length: 64 }, () => botClaimDelayMs());
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(DEFAULT_BOT_CLAIM_MIN_MS);
      expect(s).toBeLessThan(DEFAULT_BOT_CLAIM_MAX_MS);
    }
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    // With 64 samples the observed spread should be a meaningful chunk
    // of the 4000 ms window; 500 ms is a low bar that still rules out
    // "every call returns the same value" regressions.
    expect(max - min).toBeGreaterThan(500);
  });

  it('returns the override unchanged when set, killing the jitter', () => {
    pacingGlobals().__MAHJONG_TEST_BOT_CLAIM_DELAY_MS__ = 0;
    for (let i = 0; i < 32; i++) {
      expect(botClaimDelayMs()).toBe(0);
    }
    pacingGlobals().__MAHJONG_TEST_BOT_CLAIM_DELAY_MS__ = 250;
    for (let i = 0; i < 32; i++) {
      expect(botClaimDelayMs()).toBe(250);
    }
  });

  it('falls back to the random range when the override is non-numeric', () => {
    (pacingGlobals() as unknown as Record<string, unknown>).__MAHJONG_TEST_BOT_CLAIM_DELAY_MS__ =
      null;
    const sample = botClaimDelayMs();
    expect(sample).toBeGreaterThanOrEqual(DEFAULT_BOT_CLAIM_MIN_MS);
    expect(sample).toBeLessThan(DEFAULT_BOT_CLAIM_MAX_MS);
  });
});

describe('pacing override constants', () => {
  it('exposes production defaults that align with the design handoff', () => {
    // Pinned so a refactor that mistakenly narrows the bot-stagger
    // window lands red instead of silently shrinking the variance.
    expect(DEFAULT_BOT_CLAIM_MIN_MS).toBe(2_000);
    expect(DEFAULT_BOT_CLAIM_MAX_MS).toBe(6_000);
  });
});

/**
 * Locks the synchronous-pass optimization in `solo-transport.ts`'s
 * `driveBots` loop.
 *
 * Pre-optimization, every bot whose `pickClaim` returned `pass`
 * still went through a `setTimeout(submitPass, botClaimDelayMs())`
 * stagger of 2–6 seconds. In a 3-passive-bot solo match, every
 * claim window stalled by up to 6 s of pure dead time before the
 * engine could resolve all-passes and move on. The optimization
 * short-circuits the pass branch: a passing bot has its claim
 * applied inline via `applyAction({ t: 'declareClaim', … })` and
 * skips the timer entirely.
 *
 * The contract we lock here: when every non-discarder bot picks
 * pass, **no `setTimeout` is scheduled with the claim-stagger
 * sentinel delay** during the drain. A regression that reverts to
 * the unconditional `setTimeout(…, botClaimDelayMs())` lands red
 * on the sentinel assertion.
 *
 * Strategy: override `__MAHJONG_TEST_BOT_CLAIM_DELAY_MS__` to a
 * unique non-zero sentinel (12345 ms) and spy on `setTimeout`. The
 * sentinel value is the discriminator — it can't collide with the
 * init-handle (`setTimeout(…, 0)`) or the post-resolution bot-pace
 * timer (`__MAHJONG_TEST_BOT_PACE_MS__` overrides `botPaceMs()` to
 * `0` in beforeEach so the bot-pace timer also runs at delay `0`).
 *
 * Stubbing `Math.random` to `0.1` forces `passiveBot.pickClaim`
 * (which guards behind `Math.random() < 0.5`) into the pass branch
 * 100% of the time.
 */
describe('driveBots synchronous-pass optimization', () => {
  const SENTINEL_DELAY_MS = 12345;

  // `vi.spyOn(globalThis, 'setTimeout')` returns a `MockInstance<typeof
  // setTimeout>` which the tsc check rejects when annotated more loosely
  // (the typeof setTimeout overload set isn't assignable to a generic
  // signature). Captured via the SetTimeoutCalls helper below — we only
  // need the `mock.calls` slice (delay = position 1), not the spy
  // identity, so we lift those to module locals.
  type Spy = { mockRestore: () => void; mock: { calls: unknown[][] } };
  let mathRandomSpy: Spy | null = null;
  let setTimeoutSpy: Spy | null = null;
  let createdTransport: { close: () => void } | null = null;

  function setTimeoutCallsAt(delay: number): unknown[][] {
    return (setTimeoutSpy?.mock.calls ?? []).filter((args) => args[1] === delay);
  }

  function honor(h: 'E' | 'S' | 'W' | 'N' | 'Z' | 'F' | 'B', copy: 0 | 1 | 2 | 3 = 0): Tile {
    return { kind: 'honor', honor: h, copy };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { __MAHJONG_TEST_BOT_PACE_MS__?: number }).__MAHJONG_TEST_BOT_PACE_MS__ = 0;
    (
      globalThis as { __MAHJONG_TEST_BOT_CLAIM_DELAY_MS__?: number }
    ).__MAHJONG_TEST_BOT_CLAIM_DELAY_MS__ = SENTINEL_DELAY_MS;
    // Force passiveBot.pickClaim into the `Math.random() < 0.5 →
    // pass` branch unconditionally.
    mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1) as unknown as Spy;
    // Spy on `setTimeout` to capture all scheduled delays. The
    // existing `vi.useFakeTimers()` already wraps setTimeout; layering
    // a spyOn on top of the fake-timer wrapper still records every
    // invocation.
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout') as unknown as Spy;
  });

  afterEach(() => {
    try {
      createdTransport?.close();
    } finally {
      createdTransport = null;
      mathRandomSpy?.mockRestore();
      mathRandomSpy = null;
      setTimeoutSpy?.mockRestore();
      setTimeoutSpy = null;
      const g = globalThis as unknown as Record<string, unknown>;
      g.__MAHJONG_TEST_BOT_CLAIM_DELAY_MS__ = undefined;
      g.__MAHJONG_TEST_BOT_PACE_MS__ = undefined;
      vi.useRealTimers();
    }
  });

  it('drains an all-pass claim window without scheduling per-bot stagger timers', () => {
    // Build a minimally-valid `GameState` parked in `awaitingClaims`
    // with seat 0 as the discarder and seats 1/2/3 pending. Hands +
    // melds + discards are left empty — `passiveBot.pickClaim` only
    // reads `Math.random()` (stubbed) and `state.lastDiscard` (set)
    // before returning pass, so the engine doesn't traverse the
    // synthetic hands.
    const base = emptyState(soloRulesFrom());
    const discardTile = honor('E');
    const seed: GameState = {
      ...base,
      phase: 'awaitingClaims',
      turn: 0,
      hasDrawn: false,
      drewThisTurn: false,
      lastDiscard: { tile: discardTile, from: 0 },
      pendingClaims: {
        discard: { tile: discardTile, from: 0 },
        // Soft floor in the past so `resolveAndApply`'s pre-floor
        // checks (none — resolveAndApply doesn't gate on now vs.
        // deadlineMs, the alarm path does) are non-issues. Any value
        // works; using `Date.now() - 1` documents intent.
        deadlineMs: Date.now() - 1,
        submitted: {},
      },
    };

    const transport = createSoloTransport({
      playerId: 'p0',
      displayName: 'You',
      botSkills: ['passive', 'passive', 'passive'],
      seedState: seed,
    });
    createdTransport = transport;

    // Subscribe so the deferred `setTimeout(emit, 0)` boot path
    // delivers messages we can introspect. The synchronous all-pass
    // drain happens inside the init callback, before any microtask
    // boundary, so the latest 'delta' before that boundary has the
    // resolved phase.
    const phases: string[] = [];
    transport.onMessage((m: ServerMessage) => {
      if ((m.t === 'state' || m.t === 'delta') && m.state) {
        phases.push(m.state.phase);
      }
    });

    // Fire the boot setTimeout. The init handle is `setTimeout(…, 0)`
    // so a single 1-ms advance is sufficient. driveBots then runs
    // synchronously inside the init callback; passes are submitted
    // inline; the engine resolves.
    vi.advanceTimersByTime(1);

    // Sentinel assertion: no setTimeout was called with the claim-
    // stagger delay. If the optimization regresses, each passing bot
    // would schedule a `setTimeout(callback, SENTINEL_DELAY_MS)`.
    expect(setTimeoutCallsAt(SENTINEL_DELAY_MS)).toEqual([]);

    // Sanity-check the drain landed: the most recent state delta
    // should have phase 'turn' (resolution flipped phase forward to
    // the next seat's turn). Without this, a regression that bails
    // out of the loop entirely (no submissions at all) could pass the
    // sentinel check by also doing nothing.
    expect(phases[phases.length - 1]).toBe('turn');
  });

  it('does schedule a stagger timer when a bot picks a non-pass claim', () => {
    // Companion: prove the sentinel assertion above is load-bearing —
    // a `Math.random` value that drives `passiveBot.pickClaim` past
    // the pass branch and into a meaningful claim DOES schedule the
    // stagger timer. Without this, the all-pass test could be
    // silently passing because `setTimeout` is never called at all,
    // not because the optimization is intact.
    //
    // Setup: bot 1 holds 2× East wind in hand → peng of East is
    // legal when seat 0 discards East. With `Math.random` returning
    // `0.7` (above the 0.5 pass gate), passiveBot walks the priority
    // chain and picks peng.
    mathRandomSpy?.mockRestore();
    mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.7) as unknown as Spy;

    const base = emptyState(soloRulesFrom());
    // Two distinct copies of East — `legalClaimsFor` counts by face,
    // not by tile identity, so any two East tiles give peng legality.
    const east1 = honor('E', 0);
    const east2 = honor('E', 1);
    const discardEast = honor('E', 2);
    const seed: GameState = {
      ...base,
      phase: 'awaitingClaims',
      turn: 0,
      hasDrawn: false,
      drewThisTurn: false,
      lastDiscard: { tile: discardEast, from: 0 },
      hands: { ...base.hands, 1: [east1, east2] },
      pendingClaims: {
        discard: { tile: discardEast, from: 0 },
        deadlineMs: Date.now() - 1,
        submitted: {},
      },
    };

    const transport = createSoloTransport({
      playerId: 'p0',
      displayName: 'You',
      botSkills: ['passive', 'passive', 'passive'],
      seedState: seed,
    });
    createdTransport = transport;
    transport.onMessage(() => {});

    vi.advanceTimersByTime(1);

    // Bot 1 picks peng → a stagger timer fires at the sentinel delay.
    // Bots 2 and 3 hold no East copies, so they walk the priority chain,
    // find no legal non-pass action, and pass inline. Net: at least one
    // sentinel timer (the peng stagger).
    expect(setTimeoutCallsAt(SENTINEL_DELAY_MS).length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Tutorial mode forces every unscripted bot claim to pass. Without
   * this, the passive bot's 50% opportunistic peng/gang/hu roll can
   * silently break a lesson — e.g. the peng lesson nudges the user
   * to discard an honour tile, but a bot holding a pair of that
   * honour will peng on the coin flip. Sentinel: with the East-peng
   * setup that drives a non-pass claim in the previous test,
   * flipping on `__MAHJONG_TUTORIAL_FORCE_PASS__` must drop the
   * stagger timer count to zero.
   */
  it('forces unscripted claims to pass when tutorial mode is active', () => {
    mathRandomSpy?.mockRestore();
    mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.7) as unknown as Spy;

    const base = emptyState(soloRulesFrom());
    const east1 = honor('E', 0);
    const east2 = honor('E', 1);
    const discardEast = honor('E', 2);
    const seed: GameState = {
      ...base,
      phase: 'awaitingClaims',
      turn: 0,
      hasDrawn: false,
      drewThisTurn: false,
      lastDiscard: { tile: discardEast, from: 0 },
      hands: { ...base.hands, 1: [east1, east2] },
      pendingClaims: {
        discard: { tile: discardEast, from: 0 },
        deadlineMs: Date.now() - 1,
        submitted: {},
      },
    };

    (globalThis as { __MAHJONG_TUTORIAL_FORCE_PASS__?: boolean }).__MAHJONG_TUTORIAL_FORCE_PASS__ =
      true;
    try {
      const transport = createSoloTransport({
        playerId: 'p0',
        displayName: 'You',
        botSkills: ['passive', 'passive', 'passive'],
        seedState: seed,
      });
      createdTransport = transport;
      transport.onMessage(() => {});

      vi.advanceTimersByTime(1);

      // With force-pass on, every bot returns `{ kind: 'pass' }`
      // inline — same fast path as the all-pass test. No stagger
      // timers fire.
      expect(setTimeoutCallsAt(SENTINEL_DELAY_MS)).toEqual([]);
    } finally {
      (
        globalThis as { __MAHJONG_TUTORIAL_FORCE_PASS__?: boolean | undefined }
      ).__MAHJONG_TUTORIAL_FORCE_PASS__ = undefined;
    }
  });
});
