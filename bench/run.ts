/**
 * The benchmark. `pnpm bench` runs the frozen plan and writes a results folder.
 * `pnpm bench:smoke` runs one short pass and checks that the harness still works.
 *
 *   results/<id>/manifest.json   what ran, on what, from which commit
 *   results/<id>/raw/*.json      every sample, one file per independent run
 *   results/<id>/summary.json    run level statistics
 *   results/<id>/size-error.json the size and error table
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { sizeTable } from './size-table';
import {
  BROWSER_RUNS,
  cells,
  MEASURED_ITERATIONS,
  RESOLUTIONS,
  RUNS,
  sceneHash,
  TOLERANCES,
  WARMUP_ITERATIONS,
} from './workload';

const smoke = process.argv.includes('--smoke');
const PORT = 5184;

function sh(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

const commit = sh('git', ['rev-parse', 'HEAD']);
const dirty = sh('git', ['status', '--porcelain']) !== '';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const folder = smoke ? join('tmp', 'bench-smoke') : join('results', `bench-${stamp}`);
mkdirSync(join(folder, 'raw'), { recursive: true });

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('node_modules/.bin/tsx', args, { stdio: 'inherit' });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited with ${code}`)),
    );
  });
}

function stats(values: number[]) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  return {
    runs: n,
    mean,
    min: Math.min(...values),
    max: Math.max(...values),
    sd: Math.sqrt(variance),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

const STAGES = [
  'field', 'extract', 'join', 'clip', 'simplify', 'topology', 'serialize', 'total', 'exportTotal',
] as const;

async function stageRuns() {
  const runs = smoke ? 1 : RUNS;
  for (let r = 0; r < runs; r++) {
    console.log(`Stage run ${r + 1} of ${runs}`);
    const out = join(folder, 'raw', `stages-${r + 1}.json`);
    await run(['bench/stage-run.ts', out, ...(smoke ? ['--smoke'] : [])]);
  }
  const files = readdirSync(join(folder, 'raw')).filter((f) => f.startsWith('stages-'));
  const perRun = files.map((f) => JSON.parse(readFileSync(join(folder, 'raw', f), 'utf8')));
  return perRun[0].map((cell: { id: string; group: string; hash: string }, i: number) => {
    const row: Record<string, unknown> = { id: cell.id, group: cell.group, hash: cell.hash };
    for (const stage of STAGES) {
      // One number per independent run: the median of that run's iterations.
      row[stage] = stats(perRun.map((r) => median(r[i].samples.map((s: any) => s[stage]))));
    }
    return row;
  });
}

async function startPreview(): Promise<ChildProcess> {
  execFileSync('node_modules/.bin/vite', ['build', '--logLevel', 'error'], { stdio: 'inherit' });
  const child = spawn(
    'node_modules/.bin/vite',
    ['preview', '--port', String(PORT), '--strictPort', '--logLevel', 'error'],
    { stdio: 'inherit' },
  );
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`http://localhost:${PORT}/`);
      if (response.ok) return child;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Preview server did not start.');
}

interface BrowserFile {
  browser: string;
  log: { quality: string; startedAt: number; committedAt: number; frameAt: number | null }[];
  gaps: number[];
  longTasks: number[];
  draws: number[];
  stages: Record<string, Record<string, number>[]>;
}

async function browserRuns() {
  const preview = await startPreview();
  const url = `http://localhost:${PORT}`;
  const configs = smoke
    ? [{ mode: 'worker', throttle: 1 }]
    : [
        { mode: 'worker', throttle: 1 },
        { mode: 'main', throttle: 1 },
        { mode: 'worker', throttle: 4 },
        { mode: 'main', throttle: 4 },
      ];
  const runs = smoke ? 1 : BROWSER_RUNS;
  const summary = [];
  let browserVersion = '';
  try {
    for (const { mode, throttle } of configs) {
      const files: BrowserFile[] = [];
      for (let r = 0; r < runs; r++) {
        console.log(`Browser ${mode} x${throttle}, run ${r + 1} of ${runs}`);
        const out = join(folder, 'raw', `browser-${mode}-x${throttle}-${r + 1}.json`);
        await run(['bench/browser-run.ts', url, mode, String(throttle), out]);
        files.push(JSON.parse(readFileSync(out, 'utf8')));
      }
      browserVersion = files[0].browser;
      const latency = (quality: string) => (f: BrowserFile) =>
        f.log.filter((e) => e.quality === quality).map((e) => e.committedAt - e.startedAt);
      const framed = (quality: string) => (f: BrowserFile) =>
        f.log
          .filter((e) => e.quality === quality && e.frameAt !== null)
          .map((e) => (e.frameAt as number) - e.startedAt);
      const perRun = (pick: (f: BrowserFile) => number) => stats(files.map(pick));
      summary.push({
        mode,
        throttle,
        draftCommitsPerRun: perRun((f) => latency('draft')(f).length),
        draftCommitMedianMs: perRun((f) => median(latency('draft')(f))),
        draftCommitP95Ms: perRun((f) => percentile(latency('draft')(f), 0.95)),
        draftFrameP95Ms: perRun((f) => percentile(framed('draft')(f), 0.95)),
        finalCommitMs: perRun((f) => median(latency('final')(f))),
        longestRafGapMs: perRun((f) => Math.max(...f.gaps)),
        rafGapP95Ms: perRun((f) => percentile(f.gaps, 0.95)),
        longTaskCount: perRun((f) => f.longTasks.length),
        drawP95Ms: perRun((f) => percentile(f.draws, 0.95)),
        stages:
          throttle === 1
            ? Object.fromEntries(
                RESOLUTIONS.map((res) => [
                  res,
                  Object.fromEntries(
                    ['field', 'extract', 'join', 'clip', 'simplify', 'topology', 'serialize', 'total'].map(
                      (stage) => [
                        stage,
                        perRun((f) => median(f.stages[res].map((s) => s[stage]))),
                      ],
                    ),
                  ),
                ]),
              )
            : undefined,
      });
    }
  } finally {
    preview.kill();
  }
  return { summary, browserVersion };
}

function manifest(browserVersion: string) {
  const lock = readFileSync('pnpm-lock.yaml', 'utf8');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  return {
    commit,
    dirty,
    date: new Date().toISOString(),
    commands: [smoke ? 'pnpm bench:smoke' : 'pnpm bench'],
    dependencies: { ...pkg.dependencies, ...pkg.devDependencies },
    lockfileSha256: sh('shasum', ['-a', '256', 'pnpm-lock.yaml']).split(' ')[0],
    lockfileLines: lock.split('\n').length,
    node: process.version,
    browser: browserVersion,
    os: `${platform()} ${release()}`,
    osVersion: sh('sw_vers', ['-productVersion']),
    hardware: {
      model: sh('sysctl', ['-n', 'hw.model']),
      cpu: cpus()[0].model,
      logicalCores: cpus().length,
      memoryBytes: totalmem(),
    },
    power: sh('pmset', ['-g', 'batt']).split('\n')[0],
    loadAverageAtEnd: loadavg(),
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    seeds: Object.fromEntries(cells().map((c) => [c.id, c.scene.seed])),
    inputHashes: Object.fromEntries(cells().map((c) => [c.id, sceneHash(c.scene)])),
    protocol: {
      warmupIterations: WARMUP_ITERATIONS,
      measuredIterationsPerRun: MEASURED_ITERATIONS,
      independentStageRuns: smoke ? 1 : RUNS,
      independentBrowserRuns: smoke ? 1 : BROWSER_RUNS,
      tolerances: TOLERANCES,
      resolutions: RESOLUTIONS,
      exclusions: 'None. Every run and every measured iteration is kept.',
      cpuThrottle: 'Chrome DevTools Protocol rate 4 is synthetic, and stands in for a slower laptop.',
    },
  };
}

const stageSummary = await stageRuns();
const { summary: browserSummary, browserVersion } = await browserRuns();
const table = sizeTable();

writeFileSync(join(folder, 'manifest.json'), `${JSON.stringify(manifest(browserVersion), null, 2)}\n`);
writeFileSync(
  join(folder, 'summary.json'),
  `${JSON.stringify({ stages: stageSummary, browser: browserSummary }, null, 2)}\n`,
);
writeFileSync(join(folder, 'size-error.json'), `${JSON.stringify(table, null, 2)}\n`);

interface Row {
  id: string;
  group: string;
}
const browserNominal = browserSummary.find((b) => b.mode === 'worker' && b.throttle === 1);
const refined = browserSummary
  .filter((b) => b.throttle === 1)
  .map((b) => b.stages?.[512]?.total.max ?? Infinity);
const nodeRefined = (stageSummary as (Row & { total: { max: number } })[])
  .filter((r) => r.group === 'target' && r.id.endsWith('/512'))
  .map((r) => r.total.max);
const criteria = {
  refined512Within500Ms: Math.max(...refined, ...nodeRefined) <= 500,
  draftP95Within33Ms: (browserNominal?.draftCommitP95Ms.max ?? Infinity) <= 33,
  noLongTaskDuringDrag: (browserNominal?.longTaskCount.max ?? Infinity) === 0,
  sizeTableClean: table.every(
    (r) => r.crossings === 0 && r.paths === r.pathsBefore && r.sampledDistance <= r.declaredBound,
  ),
};
writeFileSync(join(folder, 'criteria.json'), `${JSON.stringify(criteria, null, 2)}\n`);
console.log(criteria);

const failures: string[] = [];
for (const row of table) {
  if (row.crossings !== 0) failures.push(`${row.scene}: ${row.crossings} crossings`);
  if (row.paths !== row.pathsBefore) failures.push(`${row.scene}: lost paths`);
  if (row.sampledDistance > row.declaredBound) failures.push(`${row.scene}: bound exceeded`);
}
if (dirty) console.log('Note: the working tree has uncommitted changes.');
console.log(`Results in ${folder}`);
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(smoke ? 'bench smoke passed' : 'bench passed');
