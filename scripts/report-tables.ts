/**
 * Copies measured numbers into the docs, between marker comments, so that no
 * number in a table is typed by hand.
 *
 *   pnpm exec tsx scripts/report-tables.ts results/bench-<id>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const folder = process.argv[2];
if (!folder) throw new Error('Pass a results folder.');

const summary = JSON.parse(readFileSync(join(folder, 'summary.json'), 'utf8'));
const size = JSON.parse(readFileSync(join(folder, 'size-error.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
const criteria = JSON.parse(readFileSync(join(folder, 'criteria.json'), 'utf8'));

interface Stat {
  mean: number;
  min: number;
  max: number;
  sd: number;
}

const ms = (s: Stat, digits = 1) => s.mean.toFixed(digits);
const range = (s: Stat, digits = 1) =>
  `${s.mean.toFixed(digits)} (${s.min.toFixed(digits)} to ${s.max.toFixed(digits)})`;
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const int = (n: number) => n.toLocaleString('en-US');

function stageTable(group: string): string {
  const rows = summary.stages.filter((r: { group: string }) => r.group === group);
  const head =
    '| Workload | Field | Extract | Join | Clip | Simplify | Topology | Serialize | Pipeline total | Export total |\n|---|---|---|---|---|---|---|---|---|---|';
  return [
    head,
    ...rows.map(
      (r: Record<string, Stat> & { id: string }) =>
        `| ${r.id} | ${ms(r.field)} | ${ms(r.extract)} | ${ms(r.join)} | ${ms(r.clip)} | ${ms(r.simplify)} | ${ms(r.topology)} | ${ms(r.serialize)} | ${range(r.total)} | ${ms(r.exportTotal)} |`,
    ),
  ].join('\n');
}

const SCENES: Record<string, string> = {
  target: 'Target, 512, 16 levels',
  stress: 'Stress, 1024, 64 levels',
};

const MODES: Record<string, string> = {
  worker: 'Worker',
  main: 'Main thread, time sliced',
  blocking: 'Main thread, blocking',
};

function browserTable(): string {
  const head =
    '| Scene | Mode | CPU | Drafts per run | Input to draft, p50 | Input to draft, p95 | To next frame, p95 | Input to final | Long tasks | Largest frame gap |\n|---|---|---|---|---|---|---|---|---|---|';
  return [
    head,
    ...summary.browser.map(
      (b: Record<string, Stat> & { mode: string; throttle: number; scene: string }) =>
        `| ${SCENES[b.scene]} | ${MODES[b.mode]} | ${b.throttle}x | ${b.draftCommitsPerRun.mean.toFixed(0)} | ${range(b.draftCommitMedianMs)} | ${range(b.draftCommitP95Ms)} | ${ms(b.draftFrameP95Ms)} | ${range(b.finalCommitMs, 0)} | ${b.longTaskCount.mean.toFixed(1)} | ${range(b.longestRafGapMs, 0)} |`,
    ),
  ].join('\n');
}

function chromiumStages(): string {
  const main = summary.browser.find(
    (b: { mode: string; throttle: number; scene: string }) =>
      b.mode === 'worker' && b.throttle === 1 && b.scene === 'target',
  );
  const head =
    '| Grid | Field | Extract | Join | Clip | Simplify | Topology | Serialize | Pipeline total |\n|---|---|---|---|---|---|---|---|---|';
  const rows = Object.entries(main.stages as Record<string, Record<string, Stat>>).map(
    ([grid, s]) =>
      `| ${grid} | ${ms(s.field)} | ${ms(s.extract)} | ${ms(s.join)} | ${ms(s.clip)} | ${ms(s.simplify)} | ${ms(s.topology)} | ${ms(s.serialize)} | ${range(s.total)} |`,
  );
  const draw = `Canvas draw calls took ${ms(main.drawP95Ms, 2)} ms at the 95th percentile. That covers recording commands in JavaScript. The browser rasterises later, so it is a lower bound on render cost.`;
  return [head, ...rows, '', draw].join('\n');
}

function sizeTable(): string {
  const head =
    '| Scene | Allowed | Nodes | Paths | Bytes | Gzip | Time ms | Bound | Sampled | Guard | Grid max | Grid RMS | Crossings | Fallbacks |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  return [
    head,
    ...size.map(
      (r: Record<string, number> & { scene: string }) =>
        `| ${r.scene} | ${r.tolerance} | ${int(r.verticesBefore)} to ${int(r.verticesAfter)} | ${r.pathsBefore} to ${r.paths} | ${kb(r.bytesBefore)} to ${kb(r.bytesAfter)} | ${kb(r.gzipBefore)} to ${kb(r.gzipAfter)} | ${r.processingMs.toFixed(0)} | ${r.declaredBound.toFixed(3)} | ${r.sampledDistance.toFixed(3)} | ${r.guard.toFixed(3)} | ${r.gridErrorMax.toFixed(3)} | ${r.gridErrorRms.toFixed(4)} | ${r.crossings} | ${r.fallbackPaths} |`,
    ),
  ].join('\n');
}

function environment(): string {
  const m = manifest;
  return [
    `- Commit \`${m.commit}\`${m.dirty ? ' with uncommitted changes' : ''}, ${m.date}`,
    `- ${m.hardware.cpu}, model ${m.hardware.model}, ${Math.round(m.hardware.memoryBytes / 2 ** 30)} GB, ${m.hardware.logicalCores} logical cores`,
    `- macOS ${m.osVersion}, Node ${m.node}, Chromium ${m.browser}`,
    `- Power: ${m.power}`,
    `- Load average at the end of the run: ${m.loadAverageAtEnd.map((v: number) => v.toFixed(1)).join(', ')}`,
    `- Raw samples: \`${folder}/raw\`. Manifest: \`${folder}/manifest.json\`.`,
  ].join('\n');
}

function criteriaTable(): string {
  const names: Record<string, string> = {
    refined512Within500Ms: 'Refined 512 by 512, 16 levels, within 500 ms in Chromium on every target scene',
    draftP95Within33Ms: 'Edit to draft at p95 within 33 ms, worker at 1x',
    noLongTaskDuringDrag: 'No long task during the drag, worker at 1x',
    sizeTableClean: 'No crossings, no lost paths, sampled distance within the bound',
  };
  return [
    '| Criterion | Result |\n|---|---|',
    ...Object.entries(criteria).map(([k, v]) => `| ${names[k]} | ${v ? 'Passed' : 'Missed'} |`),
  ].join('\n');
}

const fragments: Record<string, string> = {
  environment: environment(),
  criteria: criteriaTable(),
  'stages-target': stageTable('target'),
  'stages-default': stageTable('default'),
  'stages-stress': stageTable('stress'),
  browser: browserTable(),
  'chromium-stages': chromiumStages(),
  size: sizeTable(),
};

for (const file of ['docs/REPORT.md', 'README.md']) {
  let text = readFileSync(file, 'utf8');
  for (const [name, body] of Object.entries(fragments)) {
    const pattern = new RegExp(`(<!-- results:${name} -->)[\\s\\S]*?(<!-- /results -->)`, 'g');
    text = text.replace(pattern, `$1\n${body}\n$2`);
  }
  writeFileSync(file, text);
}
console.log(`Updated from ${folder}`);
