/**
 * Scene to output geometry, as a sequence of timed stages.
 *
 * The same code serves the draft preview, the refined preview and the export. A
 * draft stops after clipping. A final run goes on to simplify, round and check,
 * and its result is exactly what the SVG writer prints and the canvas draws.
 *
 * The pipeline is a generator so a worker can stop between steps. Each yield is a
 * safe point to abandon the run.
 */

import { clipPath } from './clip';
import { extractSegments, JoinTables, joinSegments, type Polyline } from './contour';
import { sampleField, type Grid } from './field';
import { gridSize, levelValues, type Rect, type Scene } from './scene';
import { roundingBound, simplifyIndices, snapPath } from './simplify';
import { findCrossings, findSweeps, loopSurvives, type SweepInput } from './topology';

export interface OutputPath extends Polyline {
  /** Decimals this path was rounded to. Each path carries its own. */
  decimals: number;
  /** Proved distance from the extracted path: tolerance used plus rounding. */
  bound: number;
}

export interface OutputLevel {
  index: number;
  value: number;
  paths: OutputPath[];
}

export interface StageTimes {
  field: number;
  extract: number;
  join: number;
  clip: number;
  simplify: number;
  topology: number;
  total: number;
}

export interface GeometryStats {
  times: StageTimes;
  /** Vertices before simplification, after clipping. */
  sourceVertices: number;
  sourcePaths: number;
  outputVertices: number;
  outputPaths: number;
  closedPaths: number;
  /** Paths with no extent, dropped after extraction. */
  degeneratePaths: number;
  /** Paths that needed tighter settings than requested. */
  fallbackPaths: number;
  /** Paths kept at full detail because tighter settings were not enough. */
  retainedPaths: number;
  /** Crossings left in the output. Anything but 0 is reported to the user. */
  crossings: number;
  /** Largest per path bound in this output. */
  maxBound: number;
}

export interface Geometry {
  quality: 'draft' | 'final';
  resolution: number;
  nx: number;
  ny: number;
  rect: Rect;
  /** True when expanded bounds were limited by the edge of the domain. */
  marginLimited: boolean;
  levels: OutputLevel[];
  /** The extracted lines after clipping. Empty for drafts. */
  source: Polyline[][];
  stats: GeometryStats;
}

export interface GeometryOptions {
  quality: 'draft' | 'final';
  /** Grid cells along the long side. Defaults to the scene's export setting. */
  resolution?: number;
}

/** The rectangle paths are clipped to and the SVG shows. */
export function outputRect(scene: Scene): { rect: Rect; limited: boolean } {
  const { clip, domain } = scene;
  if (scene.export.bounds === 'frame') return { rect: { ...clip }, limited: false };
  const m = scene.export.margin;
  const x = Math.max(0, clip.x - m);
  const y = Math.max(0, clip.y - m);
  const right = Math.min(domain.width, clip.x + clip.width + m);
  const bottom = Math.min(domain.height, clip.y + clip.height + m);
  const limited =
    x > clip.x - m ||
    y > clip.y - m ||
    right < clip.x + clip.width + m ||
    bottom < clip.y + clip.height + m;
  return { rect: { x, y, width: right - x, height: bottom - y }, limited };
}

/**
 * Attempts per path: the requested settings, three tighter, then full detail.
 * Steps are a factor of 4 because a conflict usually means two lines closer than
 * the tolerance, and halving would mostly waste passes on the way to their gap.
 */
const LAST_ATTEMPT = 4;
const RETAINED_DECIMALS = 6;

function attemptSettings(
  attempt: number,
  tolerance: number,
  decimals: number,
): { tolerance: number; decimals: number } {
  if (attempt >= LAST_ATTEMPT) return { tolerance: 0, decimals: RETAINED_DECIMALS };
  return {
    tolerance: tolerance / 4 ** attempt,
    decimals: Math.min(RETAINED_DECIMALS, decimals + attempt),
  };
}

interface PathRun {
  source: Polyline;
  level: number;
  attempt: number;
  kept: Int32Array;
  tolerance: number;
  output: OutputPath;
}

function refine(run: PathRun, tolerance: number, decimals: number): void {
  const settings = attemptSettings(run.attempt, tolerance, decimals);
  run.tolerance = settings.tolerance;
  run.kept = simplifyIndices(run.source, settings.tolerance);
  const snapped = snapPath(run.source, run.kept, settings.decimals);
  run.output = {
    ...snapped,
    decimals: settings.decimals,
    bound: settings.tolerance + roundingBound(settings.decimals),
  };
}

function now(): number {
  return performance.now();
}

/** Runs the pipeline in steps. Every yield is a safe point to stop. */
export function* geometrySteps(
  scene: Scene,
  options: GeometryOptions,
): Generator<void, Geometry, void> {
  const started = now();
  const resolution = options.resolution ?? scene.export.resolution;
  const { nx, ny } = gridSize(scene.domain, resolution);
  const { rect, limited } = outputRect(scene);
  const times: StageTimes = {
    field: 0,
    extract: 0,
    join: 0,
    clip: 0,
    simplify: 0,
    topology: 0,
    total: 0,
  };

  let mark = now();
  const grid: Grid = sampleField(scene, nx, ny);
  times.field = now() - mark;
  yield;

  const values = levelValues(scene.levels);
  const tables = JoinTables.forGrid(grid);
  const clippedByLevel: Polyline[][] = [];
  let degeneratePaths = 0;
  let sourceVertices = 0;
  let sourcePaths = 0;

  for (const value of values) {
    mark = now();
    const segments = extractSegments(grid, value);
    const afterExtract = now();
    times.extract += afterExtract - mark;

    const joined = joinSegments(grid, segments, value, tables);
    const afterJoin = now();
    times.join += afterJoin - afterExtract;
    degeneratePaths += joined.degenerate;

    const clipped: Polyline[] = [];
    for (const path of joined.paths) {
      for (const part of clipPath(path, rect)) {
        clipped.push(part);
        sourceVertices += part.points.length / 2;
      }
    }
    sourcePaths += clipped.length;
    clippedByLevel.push(clipped);
    times.clip += now() - afterJoin;
    yield;
  }

  const stats: GeometryStats = {
    times,
    sourceVertices,
    sourcePaths,
    outputVertices: sourceVertices,
    outputPaths: sourcePaths,
    closedPaths: 0,
    degeneratePaths,
    fallbackPaths: 0,
    retainedPaths: 0,
    crossings: 0,
    maxBound: 0,
  };

  if (options.quality === 'draft') {
    const levels = clippedByLevel.map((paths, index) => ({
      index,
      value: values[index],
      paths: paths.map((p) => ({ ...p, decimals: RETAINED_DECIMALS, bound: 0 })),
    }));
    times.total = now() - started;
    return {
      quality: 'draft',
      resolution,
      nx,
      ny,
      rect,
      marginLimited: limited,
      levels,
      source: [],
      stats,
    };
  }

  const { tolerance, decimals } = scene.export;
  mark = now();
  const runs: PathRun[] = [];
  clippedByLevel.forEach((paths, level) => {
    for (const source of paths) {
      const run: PathRun = {
        source,
        level,
        attempt: 0,
        kept: new Int32Array(0),
        tolerance: 0,
        output: { points: new Float64Array(0), closed: source.closed, decimals, bound: 0 },
      };
      refine(run, tolerance, decimals);
      runs.push(run);
    }
  });
  times.simplify += now() - mark;
  yield;

  // Check, tighten what failed, and check again. Each path can only move toward
  // full detail, so this ends within LAST_ATTEMPT + 1 passes.
  for (let pass = 0; pass <= LAST_ATTEMPT; pass++) {
    mark = now();
    const blamed = new Set<number>();
    runs.forEach((run, index) => {
      if (!loopSurvives(run.source, run.output)) blamed.add(index);
    });
    const crossings = findCrossings(runs.map((run) => run.output));
    for (const index of crossings.blamed) blamed.add(index);
    const sweeps: SweepInput[] = runs.map((run) => ({
      original: run.source,
      kept: run.kept,
      tolerance: run.tolerance,
    }));
    for (const index of findSweeps(sweeps)) blamed.add(index);
    times.topology += now() - mark;
    stats.crossings = crossings.count;

    mark = now();
    let changed = false;
    for (const index of blamed) {
      const run = runs[index];
      if (run.attempt >= LAST_ATTEMPT) continue;
      run.attempt++;
      refine(run, tolerance, decimals);
      changed = true;
    }
    times.simplify += now() - mark;
    if (!changed) break;
    yield;
  }

  const levels: OutputLevel[] = values.map((value, index) => ({ index, value, paths: [] }));
  let outputVertices = 0;
  let closedPaths = 0;
  for (const run of runs) {
    levels[run.level].paths.push(run.output);
    outputVertices += run.output.points.length / 2;
    if (run.output.closed) closedPaths++;
    if (run.attempt > 0) stats.fallbackPaths++;
    if (run.attempt >= LAST_ATTEMPT) stats.retainedPaths++;
    if (run.output.bound > stats.maxBound) stats.maxBound = run.output.bound;
  }
  stats.outputVertices = outputVertices;
  stats.outputPaths = runs.length;
  stats.closedPaths = closedPaths;
  times.total = now() - started;

  return {
    quality: 'final',
    resolution,
    nx,
    ny,
    rect,
    marginLimited: limited,
    levels,
    source: clippedByLevel,
    stats,
  };
}

/** Runs the pipeline to the end on the calling thread. */
export function computeGeometry(scene: Scene, options: GeometryOptions): Geometry {
  const steps = geometrySteps(scene, options);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
