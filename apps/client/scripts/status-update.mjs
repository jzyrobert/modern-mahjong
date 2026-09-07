#!/usr/bin/env node
/**
 * Merge a critic verdict into docs/STATUS.json (the gauntlet scoreboard).
 *
 *   node scripts/status-update.mjs --subsystem table --round 2 \
 *        --score 7.5 --errors 0 --perf-pass true --issues issues.json \
 *        [--critic "art-director"] [--notes "…"] [--now 2026-09-03T21:00:00Z]
 *   node scripts/status-update.mjs --whole-game --score 8.7 --errors 0 --issues i.json
 *   node scripts/status-update.mjs --blind-judge judge.json   # appends one verdict
 *
 * `issues.json` is an array of { rank, severity, title, state, detail }.
 * Pass = score ≥ passThreshold AND errors === 0 AND perf-pass.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATUS = path.resolve(__dirname, '../../../docs/STATUS.json');

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const key = a.slice(2);
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) args[key] = true;
  else args[key] = argv[++i];
}

const status = JSON.parse(readFileSync(STATUS, 'utf8'));
const now = args.now ?? new Date().toISOString();
const readIssues = (p) => (p ? JSON.parse(readFileSync(path.resolve(p), 'utf8')) : []);

if (args['blind-judge']) {
  const verdict = JSON.parse(readFileSync(path.resolve(args['blind-judge']), 'utf8'));
  status.blindJudges.push({ ...verdict, at: now });
} else {
  const target = args['whole-game'] ? status.wholeGame : status.subsystems[args.subsystem];
  if (!target) throw new Error(`unknown subsystem ${args.subsystem}`);
  const score = Number(args.score);
  const errors = Number(args.errors ?? 0);
  const perfPass = String(args['perf-pass'] ?? 'true') !== 'false';
  const issues = readIssues(args.issues);
  const pass = score >= status.passThreshold && errors === 0 && perfPass;
  target.history.push({
    round: Number(args.round ?? status.round),
    score,
    errors,
    perfPass,
    pass,
    critic: args.critic ?? 'critic',
    openIssues: issues.length,
    notes: args.notes ?? '',
    at: now,
  });
  target.score = score;
  target.errors = errors;
  target.pass = pass;
  target.issues = issues;
  if (args.round) status.round = Math.max(status.round, Number(args.round));
}
status.updatedAt = now;
writeFileSync(STATUS, `${JSON.stringify(status, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, updatedAt: now }));
