import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import config from '../playwright.config';

/**
 * Guards the hand-balanced Playwright shard assignments in
 * `apps/client/playwright.config.ts`. The default `--shard=N/M`
 * was replaced with named projects (`shard-1` … `shard-4`) in #400
 * after the alphabetical-by-file split clustered all 5 screenshot
 * specs into shard 3. Shard membership is by literal filename in
 * `SHARD_N_SPECS` arrays + a `testIgnore` catch-all on shard-4.
 *
 * Two failure modes this test catches that CI alone would not:
 *   - A spec listed in two `SHARD_N_SPECS` arrays runs twice and
 *     counts against the wall-clock of both shards.
 *   - A spec listed in `SHARD_N_SPECS` but renamed / deleted on
 *     disk silently disappears from CI (shard 4's catch-all picks
 *     up the new filename, but the typo'd entry no-ops).
 *
 * Vitest exit code surfaces these at PR time; debugging from a
 * shard-timing skew on `main` would otherwise take a while.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const E2E_DIR = resolve(__dirname, '..', 'e2e');

const shards = (config.projects ?? []).filter((p) => p.name?.startsWith('shard-'));

describe('Playwright shard configuration', () => {
  test('defines exactly four shards', () => {
    expect(shards.map((p) => p.name).sort()).toEqual(['shard-1', 'shard-2', 'shard-3', 'shard-4']);
  });

  test('no spec is assigned to two shards', () => {
    const assigned = shards.flatMap((p) =>
      Array.isArray(p.testMatch) ? (p.testMatch as string[]) : [],
    );
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const spec of assigned) {
      if (seen.has(spec)) dups.push(spec);
      seen.add(spec);
    }
    expect(dups).toEqual([]);
  });

  test('every spec listed in a shard exists in e2e/', () => {
    const missing: string[] = [];
    for (const project of shards) {
      const list = Array.isArray(project.testMatch) ? (project.testMatch as string[]) : [];
      for (const spec of list) {
        if (!existsSync(join(E2E_DIR, spec))) {
          missing.push(`${project.name}: ${spec}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test('every spec file in e2e/ is covered by exactly one project', () => {
    const onDisk = readdirSync(E2E_DIR).filter((f) => f.endsWith('.spec.ts') && !f.startsWith('_'));
    const assigned = new Set(
      shards.flatMap((p) => (Array.isArray(p.testMatch) ? (p.testMatch as string[]) : [])),
    );
    // Shard 4 is the catch-all: anything not in another shard's
    // testMatch lands there via testIgnore. Verify the catch-all
    // contents match the on-disk universe minus the explicit
    // assignments.
    const shard4 = shards.find((p) => p.name === 'shard-4');
    const shard4Ignore = Array.isArray(shard4?.testIgnore) ? (shard4!.testIgnore as string[]) : [];
    const shard4Ignored = new Set(shard4Ignore);

    // Every on-disk spec is either explicitly assigned or implicitly
    // routed to shard 4 (i.e. not in shard 4's testIgnore).
    const orphaned: string[] = [];
    for (const spec of onDisk) {
      const inExplicit = assigned.has(spec);
      const goesToShard4 = !shard4Ignored.has(spec);
      const coverage = (inExplicit ? 1 : 0) + (goesToShard4 ? 1 : 0);
      if (coverage !== 1) {
        orphaned.push(`${spec} (explicit=${inExplicit}, shard-4=${goesToShard4})`);
      }
    }
    expect(orphaned).toEqual([]);
  });
});
