/**
 * Measures exported geometry. See docs/GEOMETRY.md for what each number means.
 *
 * The parser here reads SVG text with no knowledge of how the writer works, so a
 * mismatch between writer and file is caught, not assumed away.
 */

import type { Polyline } from './contour';
import { fieldFunction } from './field';
import type { Geometry } from './pipeline';
import type { Scene } from './scene';
import { segmentDistanceSquared } from './simplify';
import { BucketGrid } from './topology';

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

/** Parses path data with commands M, m, L, l, H, h, V, v, Z and z. */
export function parsePathData(d: string): Polyline[] {
  const paths: Polyline[] = [];
  let current: number[] = [];
  let x = 0;
  let y = 0;
  let index = 0;
  let command = '';

  const flush = (closed: boolean) => {
    if (current.length >= 4) paths.push({ points: new Float64Array(current), closed });
    current = [];
  };
  const skip = () => {
    while (index < d.length && /[\s,]/.test(d[index])) index++;
  };
  const number = (): number => {
    skip();
    NUMBER.lastIndex = index;
    const match = NUMBER.exec(d);
    if (!match) throw new Error(`Expected a number at ${index} in path data.`);
    index += match[0].length;
    return Number(match[0]);
  };

  for (;;) {
    skip();
    if (index >= d.length) break;
    const c = d[index];
    if (/[a-zA-Z]/.test(c)) {
      command = c;
      index++;
      if (c === 'z' || c === 'Z') {
        if (current.length < 2) throw new Error('Closing an empty path.');
        const startX = current[0];
        const startY = current[1];
        flush(true);
        x = startX;
        y = startY;
        command = '';
        continue;
      }
    } else if (command === '') {
      throw new Error(`Unexpected "${c}" in path data.`);
    }

    switch (command) {
      case 'M':
      case 'm': {
        flush(false);
        const dx = number();
        const dy = number();
        x = command === 'M' ? dx : x + dx;
        y = command === 'M' ? dy : y + dy;
        current.push(x, y);
        // Further pairs after a move are line commands, per the SVG grammar.
        command = command === 'M' ? 'L' : 'l';
        break;
      }
      case 'L':
        x = number();
        y = number();
        current.push(x, y);
        break;
      case 'l':
        x += number();
        y += number();
        current.push(x, y);
        break;
      case 'H':
        x = number();
        current.push(x, y);
        break;
      case 'h':
        x += number();
        current.push(x, y);
        break;
      case 'V':
        y = number();
        current.push(x, y);
        break;
      case 'v':
        y += number();
        current.push(x, y);
        break;
      default:
        throw new Error(`Unsupported path command "${command}".`);
    }
  }
  flush(false);
  return paths;
}

/** All paths in an SVG string, in file order. */
export function parseSvgPaths(svg: string): Polyline[] {
  const out: Polyline[] = [];
  for (const match of svg.matchAll(/<path\b[^>]*\sd="([^"]*)"/g)) {
    out.push(...parsePathData(match[1]));
  }
  return out;
}

function pathSegments(paths: readonly Polyline[]): Float64Array {
  let count = 0;
  for (const p of paths) {
    const n = p.points.length / 2;
    count += p.closed ? n : n - 1;
  }
  const out = new Float64Array(count * 4);
  let s = 0;
  for (const { points, closed } of paths) {
    const n = points.length / 2;
    const last = closed ? n : n - 1;
    for (let k = 0; k < last; k++) {
      const next = (k + 1) % n;
      out[s++] = points[k * 2];
      out[s++] = points[k * 2 + 1];
      out[s++] = points[next * 2];
      out[s++] = points[next * 2 + 1];
    }
  }
  return out;
}

/** Nearest distance queries against a set of segments. */
class DistanceIndex {
  private grid: BucketGrid;

  constructor(private segments: Float64Array) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < segments.length; k += 2) {
      if (segments[k] < minX) minX = segments[k];
      if (segments[k] > maxX) maxX = segments[k];
      if (segments[k + 1] < minY) minY = segments[k + 1];
      if (segments[k + 1] > maxY) maxY = segments[k + 1];
    }
    this.grid = new BucketGrid(
      minX,
      minY,
      maxX - minX,
      maxY - minY,
      segments.length / 4,
      (i, target, visit) =>
        target.coverSegment(
          segments[i * 4],
          segments[i * 4 + 1],
          segments[i * 4 + 2],
          segments[i * 4 + 3],
          visit,
        ),
    );
  }

  /**
   * Searches square rings of cells outward from the query. It stops once the
   * nearest ring not yet searched cannot beat the best distance found.
   */
  distance(x: number, y: number): number {
    const { grid, segments } = this;
    const cx = grid.cellX(x);
    const cy = grid.cellY(y);
    let best = Infinity;
    const maxRing = Math.max(grid.cols, grid.rows);
    const visit = (c: number, r: number) => {
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return;
      const cell = r * grid.cols + c;
      for (let i = grid.starts[cell]; i < grid.starts[cell + 1]; i++) {
        const s = grid.items[i] * 4;
        const d = segmentDistanceSquared(
          x,
          y,
          segments[s],
          segments[s + 1],
          segments[s + 2],
          segments[s + 3],
        );
        if (d < best) best = d;
      }
    };
    for (let ring = 0; ring <= maxRing; ring++) {
      if (ring > 0 && best !== Infinity) {
        // A point in this ring is at least (ring - 1) whole cells away.
        const reach = (ring - 1) * Math.min(grid.cellW, grid.cellH);
        if (reach * reach > best) break;
      }
      if (ring === 0) {
        visit(cx, cy);
        continue;
      }
      for (let c = cx - ring; c <= cx + ring; c++) {
        visit(c, cy - ring);
        visit(c, cy + ring);
      }
      for (let r = cy - ring + 1; r <= cy + ring - 1; r++) {
        visit(cx - ring, r);
        visit(cx + ring, r);
      }
    }
    return Math.sqrt(best);
  }
}

/** Walks paths, calling back at points no more than `spacing` apart. */
function samplePaths(
  paths: readonly Polyline[],
  spacing: number,
  visit: (x: number, y: number) => void,
): number {
  let samples = 0;
  for (const { points, closed } of paths) {
    const n = points.length / 2;
    const last = closed ? n : n - 1;
    for (let k = 0; k < last; k++) {
      const next = (k + 1) % n;
      const ax = points[k * 2];
      const ay = points[k * 2 + 1];
      const bx = points[next * 2];
      const by = points[next * 2 + 1];
      const pieces = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / spacing));
      for (let i = 0; i < pieces; i++) {
        const t = i / pieces;
        visit(ax + (bx - ax) * t, ay + (by - ay) * t);
        samples++;
      }
      if (!closed && k === last - 1) {
        visit(bx, by);
        samples++;
      }
    }
  }
  return samples;
}

export interface SampledDistance {
  /** Largest distance from a sample on A to B. */
  forward: number;
  /** Largest distance from a sample on B to A. */
  backward: number;
  /** The larger of the two. This is a sampled estimate, a lower bound. */
  sampled: number;
  /** sampled + spacing / 2, which is a true upper bound. See docs/GEOMETRY.md. */
  guard: number;
  spacing: number;
  samples: number;
}

/**
 * A sampled Hausdorff distance between two sets of paths. Empty against empty is
 * 0. Empty against non-empty is infinite, because a path has gone missing.
 */
export function sampledHausdorff(
  a: readonly Polyline[],
  b: readonly Polyline[],
  spacing: number,
): SampledDistance {
  const segA = pathSegments(a);
  const segB = pathSegments(b);
  if (segA.length === 0 && segB.length === 0) {
    return { forward: 0, backward: 0, sampled: 0, guard: spacing / 2, spacing, samples: 0 };
  }
  if (segA.length === 0 || segB.length === 0) {
    return {
      forward: Infinity,
      backward: Infinity,
      sampled: Infinity,
      guard: Infinity,
      spacing,
      samples: 0,
    };
  }
  const toB = new DistanceIndex(segB);
  const toA = new DistanceIndex(segA);
  let forward = 0;
  let backward = 0;
  let samples = samplePaths(a, spacing, (x, y) => {
    const d = toB.distance(x, y);
    if (d > forward) forward = d;
  });
  samples += samplePaths(b, spacing, (x, y) => {
    const d = toA.distance(x, y);
    if (d > backward) backward = d;
  });
  const sampled = Math.max(forward, backward);
  return { forward, backward, sampled, guard: sampled + spacing / 2, spacing, samples };
}

export interface GridErrorEstimate {
  /** Largest first-order distance from a sampled point to the true isoline. */
  max: number;
  /** Root mean square of the same distances. */
  rms: number;
  samples: number;
  /** Points skipped because the slope is too small for the estimate to work. */
  skipped: number;
}

/**
 * Estimates how far extracted paths sit from the true isolines, using one Newton
 * step at sampled points. It is an estimate, reported as such.
 */
export function estimateGridError(
  scene: Scene,
  geometry: Geometry,
  spacing: number,
): GridErrorEstimate {
  const f = fieldFunction(scene);
  const step = 1e-3 * Math.max(scene.domain.width, scene.domain.height) / geometry.resolution;
  let max = 0;
  let sum = 0;
  let samples = 0;
  let skipped = 0;
  geometry.source.forEach((paths, level) => {
    const value = geometry.levels[level].value;
    samplePaths(paths, spacing, (x, y) => {
      const gx = (f(x + step, y) - f(x - step, y)) / (2 * step);
      const gy = (f(x, y + step) - f(x, y - step)) / (2 * step);
      const slope = Math.hypot(gx, gy);
      if (slope < 1e-9) {
        skipped++;
        return;
      }
      const d = Math.abs(f(x, y) - value) / slope;
      if (d > max) max = d;
      sum += d * d;
      samples++;
    });
  });
  return { max, rms: samples > 0 ? Math.sqrt(sum / samples) : 0, samples, skipped };
}
