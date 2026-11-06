/**
 * Source mutation check. Each mutation is a small deliberate bug. It is applied
 * to a temporary copy of the repository, and the unit tests must fail.
 *
 * A survivor means the tests would not notice that bug. The run also records the
 * failing test names, because a mutant that dies from a crash in setup says less
 * than one that dies on the test written for it.
 *
 *   pnpm exec tsx scripts/mutate.ts
 */

import { execFileSync, spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface Mutation {
  id: string;
  file: string;
  find: string;
  replace: string;
  why: string;
}

const MUTATIONS: Mutation[] = [
  { id: 'tie-up', file: 'src/core/contour.ts', find: '(a > level ? 1 : 0)', replace: '(a >= level ? 1 : 0)', why: 'Tie rule differs on corner a only.' },
  { id: 'decider-flip', file: 'src/core/contour.ts', find: 'const saddleAbove = mask === 5 ? numerator > 0 : numerator < 0;', replace: 'const saddleAbove = mask === 5 ? numerator < 0 : numerator > 0;', why: 'Ambiguous cells choose the wrong pairing.' },
  { id: 'decider-tie', file: 'src/core/contour.ts', find: 'mask === 5 ? numerator > 0 : numerator < 0', replace: 'mask === 5 ? numerator >= 0 : numerator < 0', why: 'An exact saddle tie counts as above.' },
  { id: 'decider-tie-b', file: 'src/core/contour.ts', find: 'mask === 5 ? numerator > 0 : numerator < 0', replace: 'mask === 5 ? numerator > 0 : numerator <= 0', why: 'An exact saddle tie on the other diagonal counts as above.' },
  { id: 'case-swap', file: 'src/core/contour.ts', find: '[R, B], // 4 c', replace: '[B, R], // 4 c', why: 'One case is reversed.' },
  { id: 'edge-interp', file: 'src/core/contour.ts', find: 'let t = (level - v0) / (v1 - v0);', replace: 'let t = 0.5;', why: 'Crossings sit at edge midpoints.' },
  { id: 'edge-x-end', file: 'src/core/contour.ts', find: 'out[0] = (i * width) / nx;', replace: 'out[0] = i * (width / nx);', why: 'The last sample misses the domain edge by rounding.' },
  { id: 'no-dedupe', file: 'src/core/contour.ts', find: 'if (write > 0 && out[write - 2] === x && out[write - 1] === y) continue;', replace: '', why: 'Exact duplicates stay in paths.' },
  { id: 'keep-degenerate', file: 'src/core/contour.ts', find: 'const minimum = closed ? 6 : 4;', replace: 'const minimum = 2;', why: 'Paths with no extent are kept.' },
  { id: 'no-close', file: 'src/core/contour.ts', find: 'if (next === start) return true;', replace: 'if (next === start) return false;', why: 'Loops are marked open.' },
  { id: 'peak-power', file: 'src/core/field.ts', find: 'return m * m * m;\n}', replace: 'return m * m;\n}', why: 'Pointwise peak profile differs from the sampler.' },
  { id: 'sampler-order', file: 'src/core/field.ts', find: "if (amplitude > 0) total += amplitude * fractalNoise(x / scale, y / scale, seed, octaves);", replace: "if (amplitude > 0) total += amplitude * 0.5 * fractalNoise(x / scale, y / scale, seed, octaves);", why: 'Pointwise noise differs from the sampler.' },
  { id: 'ridge-norm', file: 'src/core/field.ts', find: 'const RIDGE_NORMALISER = 35 / 32;', replace: 'const RIDGE_NORMALISER = 1;', why: 'Ridge crest is not 1.' },
  { id: 'ridge-clip', file: 'src/core/field.ts', find: 'const t1 = Math.min((length - along) / radius, edge);', replace: 'const t1 = edge;', why: 'A ridge piece has no end.' },
  { id: 'noise-normal', file: 'src/core/field.ts', find: 'return sum / total;', replace: 'return sum;', why: 'Noise is no longer bounded by 1.' },
  { id: 'clip-rotate', file: 'src/core/clip.ts', find: 'const start = closed ? outside : 0;', replace: 'const start = 0;', why: 'Closed loops split at their first vertex.' },
  { id: 'clip-edge', file: 'src/core/clip.ts', find: 'x >= rect.x && x <= rect.x + rect.width', replace: 'x > rect.x && x < rect.x + rect.width', why: 'A point on the edge counts as outside.' },
  { id: 'dp-line', file: 'src/core/simplify.ts', find: 'if (t < 0) t = 0;\n    else if (t > 1) t = 1;', replace: '', why: 'Distance to the infinite line, not the segment.' },
  { id: 'dp-tolerance', file: 'src/core/simplify.ts', find: 'if (worst > toleranceSquared) {', replace: 'if (worst > 4 * toleranceSquared) {', why: 'Tolerance silently doubled.' },
  { id: 'no-triangle', file: 'src/core/simplify.ts', find: '    ensureTriangle(points, keep, split);\n', replace: '', why: 'Small loops collapse to a line.' },
  { id: 'rounding-bound', file: 'src/core/simplify.ts', find: 'return (Math.SQRT2 / 2) * 10 ** -decimals;', replace: 'return 0;', why: 'The declared bound ignores rounding.' },
  { id: 'no-crossings', file: 'src/core/topology.ts', find: 'blamed.add(owner[a]);', replace: '', why: 'Only one path of a crossing is blamed.' },
  { id: 'touch-ignored', file: 'src/core/topology.ts', find: 'if (limit === 0 ? distance > 0 : distance >= limit * limit) continue;', replace: 'if (limit === 0 ? distance >= 0 : distance >= limit * limit) continue;', why: 'Exact contact is never found.' },
  { id: 'margin-ignored', file: 'src/core/topology.ts', find: 'const limit = samePath || !margins ? 0 : margins[owner[a]] + margins[owner[b]];', replace: 'const limit = 0;', why: 'Paths may sit closer than rounding can move them.' },
  { id: 'cover-no-pad', file: 'src/core/topology.ts', find: "        largest,\n        visit,", replace: "        0,\n        visit,", why: 'Buckets ignore the margin.' },
  { id: 'closing-skip', file: 'src/core/topology.ts', find: 'const last = closed ? n : n - 1;\n    for (let k = 0; k < last; k++) {\n      const next = (k + 1) % n;\n      coords[s * 4] = points[k * 2];', replace: 'const last = n - 1;\n    for (let k = 0; k < last; k++) {\n      const next = (k + 1) % n;\n      coords[s * 4] = points[k * 2];', why: 'The closing segment of a loop is not checked.' },
  { id: 'ring-no-chord', file: 'src/core/topology.ts', find: 'let prev = last;', replace: 'let prev = first;', why: 'The swept region has no chord edge.' },
  { id: 'sweep-no-wrap', file: 'src/core/topology.ts', find: 'const spanCount = closed ? kept.length : kept.length - 1;', replace: 'const spanCount = kept.length - 1;', why: 'A loop never checks its closing span.' },
  { id: 'area-origin', file: 'src/core/topology.ts', find: 'const ox = points[0];', replace: 'const ox = 0;', why: 'Small far loops lose their area.' },
  { id: 'sweep-off', file: 'src/core/topology.ts', find: 'if (swept) blamed.add(index);', replace: '', why: 'Rule 3 never blames anything.' },
  { id: 'loop-off', file: 'src/core/topology.ts', find: 'if (simplified.points.length < 6) return false;', replace: '', why: 'Rule 2 accepts a two point loop.' },
  { id: 'rule1-ignored', file: 'src/core/pipeline.ts', find: 'for (const index of contacts.blamed) blamed.add(index);', replace: '', why: 'The pipeline ignores crossings.' },
  { id: 'rule3-ignored', file: 'src/core/pipeline.ts', find: 'for (const index of findSweeps(sweeps)) blamed.add(index);', replace: '', why: 'The pipeline ignores sweeps.' },
  { id: 'bound-no-rounding', file: 'src/core/pipeline.ts', find: 'bound: settings.tolerance + roundingBound(settings.decimals),', replace: 'bound: settings.tolerance,', why: 'The declared bound leaves out rounding.' },
  { id: 'ladder-factor', file: 'src/core/pipeline.ts', find: 'tolerance: tolerance / 4 ** attempt,', replace: 'tolerance: tolerance / 2 ** attempt,', why: 'Retries tighten too slowly.' },
  { id: 'ladder-decimals', file: 'src/core/pipeline.ts', find: 'decimals: Math.min(RETAINED_DECIMALS, decimals + attempt),', replace: 'decimals,', why: 'Retries never add decimals.' },
  { id: 'ladder-short', file: 'src/core/pipeline.ts', find: 'export const LAST_ATTEMPT = 4;', replace: 'export const LAST_ATTEMPT = 1;', why: 'Full detail is reached after one retry.' },
  { id: 'retained-coarse', file: 'src/core/pipeline.ts', find: 'export const RETAINED_DECIMALS = 6;', replace: 'export const RETAINED_DECIMALS = 3;', why: 'Full detail keeps a coarse lattice.' },
  { id: 'stale-count', file: 'src/core/pipeline.ts', find: 'stats.crossings = unexplainedContacts(runs, contacts.blamed.size > 0);', replace: 'stats.crossings = contacts.count;', why: 'The crossing count is not from the final output.' },
  { id: 'keep-pointlike', file: 'src/core/pipeline.ts', find: 'if (!loopSurvives(run.source, run.output)) {\n      stats.degeneratePaths++;\n      continue;\n    }', replace: '', why: 'A loop below the lattice is written as one point.' },
  { id: 'vertex-cap', file: 'src/core/pipeline.ts', find: 'if (sourceVertices > (options.maxVertices ?? MAX_SOURCE_VERTICES)) {', replace: 'if (false) {', why: 'No limit on total extracted vertices.' },
  { id: 'margin-limit', file: 'src/core/pipeline.ts', find: 'const x = Math.max(0, clip.x - m);', replace: 'const x = clip.x - m;', why: 'Expanded bounds leave the domain.' },
  { id: 'relative-lattice', file: 'src/core/svg.ts', find: 'lastX = x;\n    lastY = y;', replace: 'lastX = x;', why: 'Relative commands accumulate a wrong y.' },
  { id: 'absolute-off', file: 'src/core/svg.ts', find: 'if (i % ABSOLUTE_EVERY === 0) {', replace: 'if (false) {', why: 'No absolute anchor, so drift is unbounded.' },
  { id: 'xml-chars', file: 'src/core/svg.ts', find: ".replace(NOT_XML, '')", replace: '', why: 'A title can hold characters XML forbids.' },
  { id: 'no-escape', file: 'src/core/svg.ts', find: ".replace(/</g, '&lt;')", replace: '', why: 'Scene names can inject markup.' },
  { id: 'no-z', file: 'src/core/svg.ts', find: "if (closed) parts.push('z');", replace: '', why: 'Closed paths are not closed in the file.' },
  { id: 'colour-check', file: 'src/core/scene.ts', find: "if (typeof value !== 'string' || !HEX_COLOR.test(value)) {", replace: "if (typeof value !== 'string') {", why: 'Any text can reach an SVG attribute.' },
  { id: 'guard-half', file: 'src/core/verify.ts', find: 'guard: sampled + used / 2,', replace: 'guard: sampled,', why: 'The guard is not an upper bound.' },
  { id: 'end-sample', file: 'src/core/verify.ts', find: "if (!closed && k === last - 1) {", replace: 'if (false) {', why: 'The last point of an open path is never sampled.' },
  { id: 'grid-no-slope', file: 'src/core/verify.ts', find: 'const d = Math.abs(f(x, y) - value) / slope;', replace: 'const d = Math.abs(f(x, y) - value);', why: 'Grid error is a height, not a distance.' },
  { id: 'snap-closing', file: 'src/core/simplify.ts', find: 'while (write >= 4 && out[0] === out[write - 2] && out[1] === out[write - 1]) write -= 2;\n  }\n  return { points: out.slice(0, write), closed: path.closed };', replace: '}\n  return { points: out.slice(0, write), closed: path.closed };', why: 'Rounding can repeat the first point at the end.' },
  { id: 'size-check', file: 'src/core/scene.ts', find: 'if (text.length > LIMITS.fileBytes) {', replace: 'if (false) {', why: 'Huge files reach the parser.' },
  { id: 'commit-order', file: 'src/app/jobs.ts', find: 'if (result.revision !== shown.revision) return result.revision > shown.revision;', replace: 'if (result.revision !== shown.revision) return true;', why: 'An old final can overwrite a newer draft.' },
  { id: 'cancel-drafts', file: 'src/app/jobs.ts', find: "const cancel = this.running.quality === 'final' ? this.running.id : null;", replace: 'const cancel = this.running.id;', why: 'Drafts starve during a drag.' },
  { id: 'unbounded-queue', file: 'src/app/jobs.ts', find: 'this.waiting = job;', replace: 'this.waiting = this.waiting ?? job;', why: 'The newest request is dropped.' },
  { id: 'history-coalesce', file: 'src/app/history.ts', find: "return { past, present: next, future: [] };", replace: "return { past, present: next, future: history.future };", why: 'A new edit keeps stale redo entries.' },
];

const repo = process.cwd();
const sandbox = mkdtempSync(join(tmpdir(), 'contour-mutants-'));
for (const entry of ['src', 'test', 'package.json', 'tsconfig.json', 'vite.config.ts']) {
  cpSync(join(repo, entry), join(sandbox, entry), { recursive: true });
}
symlinkSync(join(repo, 'node_modules'), join(sandbox, 'node_modules'));

interface Outcome {
  passed: boolean;
  /** The run hit the time limit. Usually a mutant that makes a test spin. */
  timedOut: boolean;
  failed: string[];
  suiteErrors: number;
}

const TIME_LIMIT_MS = 45_000;

async function runTests(): Promise<Outcome> {
  const report = join(sandbox, 'report.json');
  // A stale report would be read as this mutant's result, so it goes first.
  rmSync(report, { force: true });
  const child = spawn('node_modules/.bin/vitest', ['run', '--reporter=json', `--outputFile=${report}`], {
    cwd: sandbox,
    stdio: 'ignore',
    detached: true,
  });
  let timedOut = false;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true;
      // The negative pid reaches vitest's forked workers as well.
      process.kill(-(child.pid as number), 'SIGKILL');
    }, TIME_LIMIT_MS);
    child.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (timedOut || !existsSync(report)) {
    return { passed: false, timedOut: true, failed: [], suiteErrors: 0 };
  }
  const json = JSON.parse(readFileSync(report, 'utf8')) as {
    testResults: { status: string; assertionResults: { status: string; fullName: string }[] }[];
  };
  const failed = json.testResults.flatMap((file) =>
    file.assertionResults.filter((a) => a.status === 'failed').map((a) => a.fullName),
  );
  const suiteErrors = json.testResults.filter(
    (file) => file.status === 'failed' && file.assertionResults.length === 0,
  ).length;
  return { passed: failed.length === 0 && suiteErrors === 0, timedOut: false, failed, suiteErrors };
}

const baseline = await runTests();
if (!baseline.passed) {
  console.error('The unmodified suite fails in the sandbox, so results would mean nothing.');
  console.error(baseline.failed);
  process.exit(1);
}

const results = [];
for (const mutation of MUTATIONS) {
  const path = join(sandbox, mutation.file);
  const original = readFileSync(path, 'utf8');
  if (!original.includes(mutation.find)) {
    results.push({
      id: mutation.id,
      file: mutation.file,
      why: mutation.why,
      status: 'not-applied',
      failed: [] as string[],
      suiteErrors: 0,
    });
    continue;
  }
  writeFileSync(path, original.replace(mutation.find, mutation.replace));
  const outcome = await runTests();
  writeFileSync(path, original);
  const status = outcome.timedOut ? 'timed-out' : outcome.passed ? 'survived' : 'killed';
  console.log(`${status.padEnd(12)} ${mutation.id.padEnd(20)} ${outcome.failed.length} failing`);
  results.push({
    id: mutation.id,
    file: mutation.file,
    why: mutation.why,
    status,
    failed: outcome.failed,
    suiteErrors: outcome.suiteErrors,
  });
}

rmSync(sandbox, { recursive: true, force: true });

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
mkdirSync(join(repo, 'results/mutations'), { recursive: true });
writeFileSync(
  join(repo, 'results/mutations/latest.json'),
  `${JSON.stringify({ commit, unmodifiedSuitePassed: true, total: results.length, killed: results.filter((r) => r.status === 'killed').length, timedOut: results.filter((r) => r.status === 'timed-out').length, results }, null, 2)}\n`,
);
const survivors = results.filter((r) => r.status !== 'killed');
console.log(`\n${results.length - survivors.length} of ${results.length} killed by a named test.`);
for (const s of survivors) console.log(`${s.status}: ${s.id} (${s.why})`);
