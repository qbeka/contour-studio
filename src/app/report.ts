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
  /** What the tint passes add to the exported file. Zero when the scene has no tint. */
  tint: FileCost;
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

/** Enough for a stable reading. Bounds each step, so that a cancel lands quickly. */
const REPORT_SAMPLES = 200_000;
const REPORT_GRID_SAMPLES = 20_000;

/**
 * Builds the report in steps. `pause` runs between steps and returns true when
 * the report is no longer wanted. The numbers cost more than the geometry on a
 * large scene, so they must never hold up the next edit.
 */
export async function buildReport(
  geometry: Geometry,
  scene: Scene,
  pause: () => Promise<boolean> = async () => false,
): Promise<ExportReport | null> {
  const svg = toSvg(geometry, scene);
  if (await pause()) return null;
  // Tint passes repeat the lines as filled shapes. Sizes are compared and distance
  // is measured on the lines alone, and the cost of the tint is reported beside them.
  const tinted = scene.style.tint !== 0;
  const linesOnly: Scene = tinted ? { ...scene, style: { ...scene.style, tint: 0 } } : scene;
  const lines = tinted ? toSvg(geometry, linesOnly) : svg;
  const full = toSvg(unsimplified(geometry, scene), linesOnly);
  if (await pause()) return null;
  const simplifiedCost = await fileCost(lines);
  if (await pause()) return null;
  const unsimplifiedCost = await fileCost(full);
  if (await pause()) return null;
  let tint: FileCost = { bytes: 0, gzipBytes: 0 };
  if (tinted) {
    const whole = await fileCost(svg);
    tint = { bytes: whole.bytes - simplifiedCost.bytes, gzipBytes: whole.gzipBytes - simplifiedCost.gzipBytes };
    if (await pause()) return null;
  }
  // The parsed file is what the user receives, so that is what gets measured.
  const distance = sampledHausdorff(
    geometry.source.flat(),
    parseSvgPaths(lines),
    SAMPLE_SPACING,
    REPORT_SAMPLES,
  );
  if (await pause()) return null;
  const grid = estimateGridError(scene, geometry, GRID_SAMPLE_SPACING, REPORT_GRID_SAMPLES);
  return { simplified: simplifiedCost, unsimplified: unsimplifiedCost, tint, distance, grid };
}
