/** The numbers shown in the Export panel. All of them describe one composition. */

import type { Geometry, OutputLevel } from '../core/pipeline';
import type { Scene } from '../core/scene';
import { roundingBound, snapPath } from '../core/simplify';
import { toSvg } from '../core/svg';
import {
  estimateGridError,
  parseSvgPaths,
  sampledHausdorff,
  type GridErrorEstimate,
  type SampledDistance,
} from '../core/verify';

export interface FileCost {
  bytes: number;
  gzipBytes: number;
}

export interface ExportReport {
  simplified: FileCost;
  unsimplified: FileCost;
  distance: SampledDistance;
  grid: GridErrorEstimate;
}

/** The same scene at the same decimals with nothing removed. */
export function unsimplified(geometry: Geometry, scene: Scene): Geometry {
  const decimals = scene.export.decimals;
  const levels: OutputLevel[] = geometry.levels.map((level, i) => ({
    ...level,
    paths: geometry.source[i].map((path) => {
      const all = Int32Array.from({ length: path.points.length / 2 }, (_, k) => k);
      return { ...snapPath(path, all, decimals), decimals, bound: roundingBound(decimals) };
    }),
  }));
  return { ...geometry, levels };
}

export async function gzipSize(text: string): Promise<number> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const compressed = await new Response(stream).arrayBuffer();
  return compressed.byteLength;
}

export async function fileCost(text: string): Promise<FileCost> {
  return { bytes: new TextEncoder().encode(text).length, gzipBytes: await gzipSize(text) };
}

export const SAMPLE_SPACING = 0.5;
export const GRID_SAMPLE_SPACING = 4;

export async function buildReport(geometry: Geometry, scene: Scene): Promise<ExportReport> {
  const svg = toSvg(geometry, scene);
  const full = toSvg(unsimplified(geometry, scene), scene);
  return {
    simplified: await fileCost(svg),
    unsimplified: await fileCost(full),
    // The parsed file is what the user receives, so that is what gets measured.
    distance: sampledHausdorff(geometry.source.flat(), parseSvgPaths(svg), SAMPLE_SPACING),
    grid: estimateGridError(scene, geometry, GRID_SAMPLE_SPACING),
  };
}
