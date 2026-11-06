/** One independent run of the stage timings. run.ts starts this in a new process. */

import { writeFileSync } from 'node:fs';
import { computeGeometry } from '../src/core/pipeline';
import { toSvg } from '../src/core/svg';
import { cells, MEASURED_ITERATIONS, sceneHash, WARMUP_ITERATIONS } from './workload';

const out = process.argv[2];
const smoke = process.argv.includes('--smoke');
const selected = cells().filter((c) => !smoke || c.id === 'quiet-ridge/16-levels/512');

const results = selected.map((cell) => {
  const options = { quality: 'final' as const, resolution: cell.resolution };
  for (let i = 0; i < (smoke ? 1 : WARMUP_ITERATIONS); i++) {
    toSvg(computeGeometry(cell.scene, options), cell.scene);
  }
  const samples = [];
  for (let i = 0; i < (smoke ? 2 : MEASURED_ITERATIONS); i++) {
    const geometry = computeGeometry(cell.scene, options);
    const started = performance.now();
    const svg = toSvg(geometry, cell.scene);
    const serialize = performance.now() - started;
    samples.push({
      ...geometry.stats.times,
      serialize,
      exportTotal: geometry.stats.times.total + serialize,
      bytes: svg.length,
    });
  }
  return { id: cell.id, group: cell.group, hash: sceneHash(cell.scene), samples };
});

writeFileSync(out, JSON.stringify(results));
