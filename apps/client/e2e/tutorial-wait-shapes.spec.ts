import { expect, test } from './_helpers';

/**
 * End-to-end coverage for the `wait-shapes` lesson — first strategy
 * probe in the curriculum. Covers origin AE5 (wait-shapes badge
 * highlighting + per-shape captions) AND plan-002 origin RAE2 (all
 * four shapes demonstrated as live engineered hands after U2's
 * `setupBeforeStep` backport).
 *
 * Lesson shape (see `apps/client/src/ui/tutorial/lessons/wait-shapes.ts`):
 * - `prepareState` replaces seat 0's 14-tile dealer hand with a fixed
 *   shanten-1 deal whose post-discard residual is shanten 0 with a
 *   single kanchan wait on 7-sou.
 * - Step 1: intro caption ("Got it").
 * - Step 2: discard the tail wind tile (auto-advance on first user
 *   discard). After the discard the user's hand is 13 tiles and
 *   shanten 0; `Match.tsx`'s `waitTiles` memo surfaces [7-sou] and
 *   `<ReadyHandBadge>` mounts in the right rail.
 * - Step 3 (kanchan): no `setupBeforeStep` — the user's post-discard
 *   hand IS the kanchan example.
 * - Steps 4-6 (ryanmen / shanpon / tanki): each carries a
 *   `setupBeforeStep` that installs a distinct shanten-0 hand
 *   demonstrating that shape. Ryanmen + shanpon waits have 2 tiles;
 *   tanki has 1.
 * - Step 7: "Lesson complete!" dismissal ("Done"); R14 strategy
 *   carve-out for caption dismissal lessons.
 *
 * Test scenarios:
 * - Happy path (covers RAE2): pre-mark prior 11 lessons; launch
 *   `wait-shapes`; advance through intro; discard the W tile; capture
 *   `state.hands[0]` on each of the four shape steps via
 *   `__MAHJONG_TEST_GET_STATE__`; assert all four hands are pairwise
 *   distinct; for each hand assert the badge label matches the
 *   expected wait-tile count for that shape (1 for kanchan/tanki, 2
 *   for ryanmen/shanpon). Caption-text assertions remain.
 * - Re-entry: pre-mark `wait-shapes` as already complete; launch from
 *   the menu; assert the lesson replays cleanly from step 1 AND the
 *   same four staged hands re-appear (deterministic seed-engineering).
 * - Caption-copy regression guard: assert each shape caption mentions
 *   its literal shape name (kanchan / ryanmen / shanpon / tanki).
 */

const TEST_SEED = 5;

const PRIOR_LESSONS = [
  'basics',
  'ron',
  'safety',
  'claims',
  'peng',
  'robbing-kong',
  'open-gang-claim',
  'promoted-gang',
  'win',
  'hidden-gang',
  'drawn-game',
];

interface CapturedTile {
  kind: string;
  suit?: string;
  rank?: number;
  honor?: string;
  copy?: number;
}

/**
 * Read `state.hands[0]` from the live engine mirror via the
 * `__MAHJONG_TEST_GET_STATE__` hatch. Returns null when the hatch
 * isn't installed (no live match yet) or when the state is null.
 */
async function readSeat0Hand(
  page: import('@playwright/test').Page,
): Promise<CapturedTile[] | null> {
  return await page.evaluate(() => {
    const get = (
      globalThis as unknown as {
        __MAHJONG_TEST_GET_STATE__?: () => {
          state: { hands: { 0: CapturedTile[] } } | null;
        };
      }
    ).__MAHJONG_TEST_GET_STATE__;
    const s = get?.()?.state ?? null;
    return s ? s.hands[0] : null;
  });
}

/**
 * Stable string key for a tile's face (suit+rank or honor), copy
 * index ignored. Two hands compare equal as multisets iff their
 * sorted face-id arrays match. We deliberately ignore `copy` so
 * "hand contents" equality survives the install-helper's choice of
 * which donor copy got pulled.
 */
function faceKey(t: CapturedTile): string {
  return t.kind === 'suit' ? `${t.suit}-${t.rank}` : `H-${t.honor ?? '?'}`;
}

function handFaces(hand: CapturedTile[]): string[] {
  return hand.map(faceKey).sort();
}

function handsEqualByFaces(a: CapturedTile[], b: CapturedTile[]): boolean {
  if (a.length !== b.length) return false;
  const fa = handFaces(a);
  const fb = handFaces(b);
  return fa.every((v, i) => v === fb[i]);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ seed, completed }) => {
      const g = globalThis as { __MAHJONG_TEST_SEED__?: number };
      g.__MAHJONG_TEST_SEED__ = seed;
      // Pin Math.random — same posture as the other tutorial specs.
      // The lesson never reaches a bot's claim window (the user only
      // takes one action and the lesson ends on captions), so the
      // pin is belt-and-braces only.
      Math.random = () => 0.1;
      localStorage.setItem(
        'mj.settings.v1',
        JSON.stringify({
          felt: 'sage',
          tileBack: 'cream',
          animations: true,
          sound: false,
          discardHint: false,
          botSkills: ['heuristic', 'simple', 'passive'],
          autoRecordReplays: false,
          replayQuota: 50,
          tutorialsCompleted: completed,
        }),
      );
    },
    { seed: TEST_SEED, completed: PRIOR_LESSONS },
  );
});

test.describe('tutorial: wait-shapes', () => {
  test('happy path: intro → discard → 4 live shape examples → complete', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    await page.getByLabel('Start Wait shapes').click();

    // Step 1 — intro caption.
    await expect(page.getByText('Reading your waits')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 2 — discard the W tile to enter tenpai. The lesson's
    // `prepareState` installs the 14-tile dealer hand: 1m-6m, 1p-3p,
    // 5s 5s 6s 8s, plus W at the tail. Any discard advances the
    // step, but only dropping W leaves the kanchan wait intact —
    // the lesson copy directs the user to the W tile. We can't
    // address the W tile by aria label reliably in this spec, so we
    // tap the last own-hand tile (sortHand puts W at the end).
    await expect(page.getByText('Drop the white-dragon')).toBeVisible();
    await page.getByTestId('own-hand-tile').last().click();

    // Step 3 — kanchan. The post-discard hand IS the kanchan example
    // (no `setupBeforeStep`). The badge surfaces a single 7-sou wait.
    await expect(page.getByRole('heading', { name: /Kanchan/ })).toBeVisible();
    // Caption-copy regression guard: literal shape name must appear
    // somewhere on screen (title and/or body). Locks the pedagogical
    // contract — `.first()` because both the heading and the body
    // copy mention the shape name.
    await expect(page.getByText(/kanchan/i).first()).toBeVisible();
    await expect(page.getByLabel(/Ready hand — waiting on 1 tile/)).toBeVisible();
    const kanchanHand = await readSeat0Hand(page);
    expect(kanchanHand).not.toBeNull();
    expect(kanchanHand!.length).toBe(13);
    // Engine cross-check — must contain 6s + 8s (the kanchan flanks)
    // and no 7s (the missing inner tile).
    expect(handFaces(kanchanHand!)).toContain('sou-5');
    expect(handFaces(kanchanHand!)).toContain('sou-6');
    expect(handFaces(kanchanHand!)).toContain('sou-8');
    expect(handFaces(kanchanHand!)).not.toContain('sou-7');

    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 4 — ryanmen. `setupBeforeStep` swaps in a new 13-tile
    // shanten-0 hand: chow 2m-3m-4m + chow 5m-6m-7m + chow 2p-3p-4p
    // + pair 5s-5s + ryanmen 7p-8p. Waits = 6p + 9p (2 tiles).
    await expect(page.getByRole('heading', { name: /Ryanmen/ })).toBeVisible();
    await expect(page.getByText(/ryanmen/i).first()).toBeVisible();
    await expect(page.getByLabel(/Ready hand — waiting on 2 tiles/)).toBeVisible();
    const ryanmenHand = await readSeat0Hand(page);
    expect(ryanmenHand).not.toBeNull();
    expect(ryanmenHand!.length).toBe(13);
    expect(handFaces(ryanmenHand!)).toContain('pin-7');
    expect(handFaces(ryanmenHand!)).toContain('pin-8');
    expect(handFaces(ryanmenHand!)).not.toContain('pin-6');
    expect(handFaces(ryanmenHand!)).not.toContain('pin-9');
    // Distinctness vs kanchan hand.
    expect(handsEqualByFaces(kanchanHand!, ryanmenHand!)).toBe(false);

    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 5 — shanpon. New 13-tile hand: pung 1m-1m-1m + chow
    // 2p-3p-4p + chow 5s-6s-7s + pair 9m-9m + pair 5p-5p. Waits =
    // 9m + 5p (2 tiles).
    await expect(page.getByRole('heading', { name: /Shanpon/ })).toBeVisible();
    await expect(page.getByText(/shanpon/i).first()).toBeVisible();
    await expect(page.getByLabel(/Ready hand — waiting on 2 tiles/)).toBeVisible();
    const shanponHand = await readSeat0Hand(page);
    expect(shanponHand).not.toBeNull();
    expect(shanponHand!.length).toBe(13);
    // Pair-pair structural fingerprint: two distinct faces each
    // appearing exactly twice (the shanpon pairs).
    const shanponFaceCounts = new Map<string, number>();
    for (const t of shanponHand!) {
      const k = faceKey(t);
      shanponFaceCounts.set(k, (shanponFaceCounts.get(k) ?? 0) + 1);
    }
    const shanponPairs = [...shanponFaceCounts.entries()].filter(([, n]) => n === 2);
    expect(shanponPairs.length).toBeGreaterThanOrEqual(2);
    // Distinctness vs kanchan + ryanmen.
    expect(handsEqualByFaces(kanchanHand!, shanponHand!)).toBe(false);
    expect(handsEqualByFaces(ryanmenHand!, shanponHand!)).toBe(false);

    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 6 — tanki. New 13-tile hand: pung 1m-1m-1m + chow
    // 2m-3m-4m + chow 5p-6p-7p + chow 7s-8s-9s + lone 5s. Wait = 5s
    // (1 tile, the pair-completing single).
    await expect(page.getByRole('heading', { name: /Tanki/ })).toBeVisible();
    await expect(page.getByText(/tanki/i).first()).toBeVisible();
    await expect(page.getByLabel(/Ready hand — waiting on 1 tile/)).toBeVisible();
    const tankiHand = await readSeat0Hand(page);
    expect(tankiHand).not.toBeNull();
    expect(tankiHand!.length).toBe(13);
    // Tanki structural fingerprint: exactly one face appears once
    // (the lone tile); everything else is in groups of 2 or 3.
    const tankiFaceCounts = new Map<string, number>();
    for (const t of tankiHand!) {
      const k = faceKey(t);
      tankiFaceCounts.set(k, (tankiFaceCounts.get(k) ?? 0) + 1);
    }
    const tankiSingletons = [...tankiFaceCounts.entries()].filter(([, n]) => n === 1);
    // The four chows each contribute three distinct singletons (one
    // per rank), so total singletons = 9 + the actual lone 5s = 10
    // when no pair is present. For our hand (1m1m1m pung + three
    // chows + lone 5s) singletons = 9 (chow ranks) + 1 (5s) = 10.
    // The structural invariant we care about: no two-of-a-kind pair
    // exists, which is the tanki fingerprint (the wait IS the pair).
    const tankiPairs = [...tankiFaceCounts.entries()].filter(([, n]) => n === 2);
    expect(tankiPairs.length).toBe(0);
    expect(tankiSingletons.length).toBeGreaterThan(0);
    // Distinctness vs all prior hands.
    expect(handsEqualByFaces(kanchanHand!, tankiHand!)).toBe(false);
    expect(handsEqualByFaces(ryanmenHand!, tankiHand!)).toBe(false);
    expect(handsEqualByFaces(shanponHand!, tankiHand!)).toBe(false);

    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 7 — completion.
    await expect(page.getByText('Lesson complete!')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    // Settings round-trip: tutorialsCompleted now includes 'wait-shapes'.
    const completed = await page.evaluate(() => {
      const raw = localStorage.getItem('mj.settings.v1');
      if (!raw) return null;
      try {
        const s = JSON.parse(raw) as { tutorialsCompleted?: string[] };
        return s.tutorialsCompleted ?? null;
      } catch {
        return null;
      }
    });
    expect(completed).toContain('wait-shapes');
  });

  test('re-entry after completion: same four staged hands re-appear deterministically', async ({
    page,
  }) => {
    // Override the beforeEach pre-mark so wait-shapes is ALSO
    // included. The lobby card flips to a Replay affordance; the
    // controller's `begin()` clears any leftover `justCompleted`
    // and `dismissedTutorialSeed` so the lesson opens clean.
    await page.addInitScript(() => {
      localStorage.setItem(
        'mj.settings.v1',
        JSON.stringify({
          felt: 'sage',
          tileBack: 'cream',
          animations: true,
          sound: false,
          discardHint: false,
          botSkills: ['heuristic', 'simple', 'passive'],
          autoRecordReplays: false,
          replayQuota: 50,
          tutorialsCompleted: [
            'basics',
            'ron',
            'safety',
            'claims',
            'peng',
            'robbing-kong',
            'open-gang-claim',
            'promoted-gang',
            'win',
            'hidden-gang',
            'drawn-game',
            'wait-shapes',
          ],
        }),
      );
    });

    await page.goto('/');
    await expect(page.getByLabel('Replay Wait shapes')).toBeVisible();
    await page.getByLabel('Replay Wait shapes').click();

    // The lesson opens on its first step — the intro caption.
    // Anything else (e.g. landing on a later step because state from
    // a previous run leaked) would indicate the controller's
    // `begin()` didn't reset cleanly.
    await expect(page.getByText('Reading your waits')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    await expect(page.getByText('Drop the white-dragon')).toBeVisible();
    await page.getByTestId('own-hand-tile').last().click();

    // Walk all four shape steps and confirm the staged hand at each
    // matches the deterministic engineered hand.
    await expect(page.getByRole('heading', { name: /Kanchan/ })).toBeVisible();
    const kanchan2 = await readSeat0Hand(page);
    expect(kanchan2!.length).toBe(13);
    expect(handFaces(kanchan2!)).toContain('sou-5');
    expect(handFaces(kanchan2!)).toContain('sou-6');
    expect(handFaces(kanchan2!)).toContain('sou-8');
    await page.getByRole('button', { name: 'Got it' }).click();

    await expect(page.getByRole('heading', { name: /Ryanmen/ })).toBeVisible();
    const ryanmen2 = await readSeat0Hand(page);
    expect(ryanmen2!.length).toBe(13);
    expect(handFaces(ryanmen2!)).toContain('pin-7');
    expect(handFaces(ryanmen2!)).toContain('pin-8');
    await page.getByRole('button', { name: 'Got it' }).click();

    await expect(page.getByRole('heading', { name: /Shanpon/ })).toBeVisible();
    const shanpon2 = await readSeat0Hand(page);
    expect(shanpon2!.length).toBe(13);
    expect(handFaces(shanpon2!)).toContain('man-9');
    expect(handFaces(shanpon2!)).toContain('pin-5');
    await page.getByRole('button', { name: 'Got it' }).click();

    await expect(page.getByRole('heading', { name: /Tanki/ })).toBeVisible();
    const tanki2 = await readSeat0Hand(page);
    expect(tanki2!.length).toBe(13);
    expect(handFaces(tanki2!)).toContain('sou-5');
    await page.getByRole('button', { name: 'Got it' }).click();

    await expect(page.getByText('Lesson complete!')).toBeVisible();
  });
});
