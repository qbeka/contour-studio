/** Sizes and errors for the same compositions. These numbers are deterministic. */

import { gunzipSync, gzipSync } from 'node:zlib';
import { unsimplified } from '../src/app/report';
import { computeGeometry } from '../src/core/pipeline';
import { PRESETS } from '../src/core/presets';
import { toSvg } from '../src/core/svg';
import { estimateGridError, parseSvgPaths, sampledHausdorff } from '../src/core/verify';
import { DISTANCE_SPACING, TOLERANCES } from './workload';

export function sizeTable() {
  const rows = [];
  for (const preset of PRESETS) {
    for (const tolerance of TOLERANCES) {
      const scene = { ...preset.scene, export: { ...preset.scene.export, tolerance } };
      const geometry = computeGeometry(scene, { quality: 'final' });
      const svg = toSvg(geometry, scene);
      const full = toSvg(unsimplified(geometry, scene), scene);
      const gz = gzipSync(svg, { level: 9 });
      if (gunzipSync(gz).toString() !== svg) throw new Error('Gzip round trip failed.');
      const distance = sampledHausdorff(geometry.source.flat(), parseSvgPaths(svg), DISTANCE_SPACING);
      const grid = estimateGridError(scene, geometry, 2);
      const { stats } = geometry;
      rows.push({
        scene: preset.id,
        tolerance,
        decimals: scene.export.decimals,
        grid: `${geometry.nx}x${geometry.ny}`,
        levels: scene.levels.count,
        paths: stats.outputPaths,
        pathsBefore: stats.sourcePaths,
        loops: stats.closedPaths,
        verticesBefore: stats.sourceVertices,
        verticesAfter: stats.outputVertices,
        bytesBefore: Buffer.byteLength(full),
        bytesAfter: Buffer.byteLength(svg),
        gzipBefore: gzipSync(full, { level: 9 }).length,
        gzipAfter: gz.length,
        processingMs: stats.times.total,
        declaredBound: stats.maxBound,
        sampledDistance: distance.sampled,
        guard: distance.guard,
        samples: distance.samples,
        spacing: distance.spacing,
        gridErrorMax: grid.max,
        gridErrorRms: grid.rms,
        gridSamples: grid.samples,
        gridSkipped: grid.skipped,
        crossings: stats.crossings,
        fallbackPaths: stats.fallbackPaths,
        retainedPaths: stats.retainedPaths,
        degeneratePaths: stats.degeneratePaths,
      });
    }
  }
  return rows;
}
