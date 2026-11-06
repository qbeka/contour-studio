/** Sizes and errors for the same compositions. These numbers are deterministic. */

import { gunzipSync, gzipSync } from 'node:zlib';
import { unsimplified } from '../src/app/report';
import { computeGeometry } from '../src/core/pipeline';
import { PRESETS } from '../src/core/presets';
import { toSvg } from '../src/core/svg';
import type { Polyline } from '../src/core/contour';
import type { Scene } from '../src/core/scene';
import { estimateGridError, parseSvgPaths, sampledHausdorff } from '../src/core/verify';
import { DISTANCE_SPACING, TOLERANCES } from './workload';

const REFERENCE_RESOLUTION = 2048;

/** Extracted lines, as drawn at a grid. Drafts stop before simplifying. */
function extracted(scene: Scene, resolution: number): Polyline[] {
  const geometry = computeGeometry(scene, { quality: 'draft', resolution });
  return geometry.levels.flatMap((level) => level.paths);
}

export function sizeTable() {
  const rows = [];
  for (const preset of PRESETS) {
    // A reference for grid error that does not use the first-order estimate: the
    // same scene at four times the grid, and so about a sixteenth of the error.
    const reference = sampledHausdorff(
      extracted(preset.scene, preset.scene.export.resolution),
      extracted(preset.scene, REFERENCE_RESOLUTION),
      1,
    );
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
        referenceDistance: reference.sampled,
        referenceResolution: REFERENCE_RESOLUTION,
        crossings: stats.crossings,
        fallbackPaths: stats.fallbackPaths,
        retainedPaths: stats.retainedPaths,
        degeneratePaths: stats.degeneratePaths,
      });
    }
  }
  return rows;
}
