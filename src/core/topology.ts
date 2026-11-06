/**
 * The topology rules from docs/GEOMETRY.md.
 *
 * Rule 1: no two output segments properly cross.
 * Rule 2: no closed path loses its shape.
 * Rule 3: a chord sweeps over no vertex of any original path.
 *
 * All three report the index of a path to blame, so that the pipeline can retry
 * just that path with tighter settings.
 */

import type { Polyline } from './contour';
import { segmentDistanceSquared } from './simplify';

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** A uniform bucket grid. Cells hold indices in compressed row form. */
export class BucketGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly starts: Int32Array;
  readonly items: Int32Array;

  /** `cover(i, visit)` must visit every cell that item i touches. */
  constructor(
    readonly minX: number,
    readonly minY: number,
    width: number,
    height: number,
    itemCount: number,
    cover: (index: number, grid: BucketGrid, visit: (cell: number) => void) => void,
  ) {
    // About one item per cell. The limit stops a huge allocation.
    const side = Math.ceil(Math.sqrt(Math.max(1, itemCount)));
    this.cols = Math.min(2048, side);
    this.rows = Math.min(2048, side);
    this.cellW = Math.max(width, 1e-9) / this.cols;
    this.cellH = Math.max(height, 1e-9) / this.rows;

    const total = this.cols * this.rows;
    const counts = new Int32Array(total + 1);
    for (let i = 0; i < itemCount; i++) {
      cover(i, this, (cell) => {
        counts[cell + 1]++;
      });
    }
    for (let c = 0; c < total; c++) counts[c + 1] += counts[c];
    this.starts = counts;
    this.items = new Int32Array(counts[total]);
    const cursor = counts.slice();
    for (let i = 0; i < itemCount; i++) {
      cover(i, this, (cell) => {
        this.items[cursor[cell]++] = i;
      });
    }
  }

  cellX(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.cellW)));
  }

  cellY(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.minY) / this.cellH)));
  }

  coverBox(x0: number, y0: number, x1: number, y1: number, visit: (cell: number) => void): void {
    const c0 = this.cellX(x0);
    const c1 = this.cellX(x1);
    const r0 = this.cellY(y0);
    const r1 = this.cellY(y1);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) visit(r * this.cols + c);
    }
  }

  /**
   * Visits the cells along a segment, row by row, plus one cell either side so
   * rounding cannot miss one. Cost follows the segment length, where a bounding
   * box would follow its area and make long diagonal chords very expensive.
   */
  coverSegment(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    visit: (cell: number) => void,
  ): void {
    const r0 = this.cellY(Math.min(y0, y1));
    const r1 = this.cellY(Math.max(y0, y1));
    const slope = y1 === y0 ? 0 : (x1 - x0) / (y1 - y0);
    for (let r = r0; r <= r1; r++) {
      const top = this.minY + r * this.cellH;
      const bottom = top + this.cellH;
      const low = Math.max(top, Math.min(y0, y1));
      const high = Math.min(bottom, Math.max(y0, y1));
      const xa = y1 === y0 ? Math.min(x0, x1) : x0 + (low - y0) * slope;
      const xb = y1 === y0 ? Math.max(x0, x1) : x0 + (high - y0) * slope;
      const c0 = Math.max(0, this.cellX(Math.min(xa, xb)) - 1);
      const c1 = Math.min(this.cols - 1, this.cellX(Math.max(xa, xb)) + 1);
      for (let c = c0; c <= c1; c++) visit(r * this.cols + c);
    }
  }
}

function boundsOf(paths: readonly Polyline[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { points } of paths) {
    for (let k = 0; k < points.length; k += 2) {
      if (points[k] < minX) minX = points[k];
      if (points[k] > maxX) maxX = points[k];
      if (points[k + 1] < minY) minY = points[k + 1];
      if (points[k + 1] > maxY) maxY = points[k + 1];
    }
  }
  return [minX, minY, maxX, maxY];
}

/**
 * Rule 1. Returns the set of paths in a proper crossing. Touching at a point is
 * not a crossing, because exact ties can make two strands meet at a grid corner.
 */
export function findCrossings(paths: readonly Polyline[]): { blamed: Set<number>; count: number } {
  let segmentCount = 0;
  for (const p of paths) {
    const n = p.points.length / 2;
    segmentCount += p.closed ? n : n - 1;
  }
  const blamed = new Set<number>();
  if (segmentCount === 0) return { blamed, count: 0 };

  const coords = new Float64Array(segmentCount * 4);
  const owner = new Int32Array(segmentCount);
  const position = new Int32Array(segmentCount);
  let s = 0;
  paths.forEach((path, index) => {
    const { points, closed } = path;
    const n = points.length / 2;
    const last = closed ? n : n - 1;
    for (let k = 0; k < last; k++) {
      const next = (k + 1) % n;
      coords[s * 4] = points[k * 2];
      coords[s * 4 + 1] = points[k * 2 + 1];
      coords[s * 4 + 2] = points[next * 2];
      coords[s * 4 + 3] = points[next * 2 + 1];
      owner[s] = index;
      position[s] = k;
      s++;
    }
  });

  const [minX, minY, maxX, maxY] = boundsOf(paths);
  const grid = new BucketGrid(
    minX,
    minY,
    maxX - minX,
    maxY - minY,
    segmentCount,
    (i, target, visit) =>
      target.coverSegment(
        coords[i * 4],
        coords[i * 4 + 1],
        coords[i * 4 + 2],
        coords[i * 4 + 3],
        visit,
      ),
  );

  // A pair can meet in several cells, so crossings are counted through a set.
  const crossings = new Set<number>();
  const total = grid.cols * grid.rows;
  for (let cell = 0; cell < total; cell++) {
    const from = grid.starts[cell];
    const to = grid.starts[cell + 1];
    for (let i = from; i < to; i++) {
      const a = grid.items[i];
      const ax0 = coords[a * 4];
      const ay0 = coords[a * 4 + 1];
      const ax1 = coords[a * 4 + 2];
      const ay1 = coords[a * 4 + 3];
      for (let j = i + 1; j < to; j++) {
        const b = grid.items[j];
        const bx0 = coords[b * 4];
        const by0 = coords[b * 4 + 1];
        const bx1 = coords[b * 4 + 2];
        const by1 = coords[b * 4 + 3];

        const d1 = orient(ax0, ay0, ax1, ay1, bx0, by0);
        const d2 = orient(ax0, ay0, ax1, ay1, bx1, by1);
        if (d1 * d2 >= 0) continue;
        const d3 = orient(bx0, by0, bx1, by1, ax0, ay0);
        const d4 = orient(bx0, by0, bx1, by1, ax1, ay1);
        if (d3 * d4 >= 0) continue;

        // Neighbouring segments of one path share a point and never count.
        if (owner[a] === owner[b]) {
          const path = paths[owner[a]];
          const n = path.points.length / 2;
          const gap = Math.abs(position[a] - position[b]);
          if (gap <= 1 || (path.closed && gap === n - 1)) continue;
        }
        crossings.add(Math.min(a, b) * segmentCount + Math.max(a, b));
        blamed.add(owner[a]);
        blamed.add(owner[b]);
      }
    }
  }
  return { blamed, count: crossings.size };
}

export function signedArea(points: Float64Array): number {
  let sum = 0;
  const n = points.length;
  for (let k = 0; k < n; k += 2) {
    const next = (k + 2) % n;
    sum += points[k] * points[next + 1] - points[next] * points[k + 1];
  }
  return sum / 2;
}

/** Rule 2 for one path. A closed path keeps three vertices and its area sign. */
export function loopSurvives(original: Polyline, simplified: Polyline): boolean {
  if (!original.closed) return simplified.points.length >= 4;
  if (simplified.points.length < 6) return false;
  return Math.sign(signedArea(original.points)) === Math.sign(signedArea(simplified.points));
}

/** Even-odd test against a run of vertices closed by its chord. */
function insideRing(
  x: number,
  y: number,
  points: Float64Array,
  vertexCount: number,
  first: number,
  last: number,
): boolean {
  let inside = false;
  let prev = last;
  for (let k = first; k <= last; k++) {
    const a = (k % vertexCount) * 2;
    const b = (prev % vertexCount) * 2;
    const ax = points[a];
    const ay = points[a + 1];
    const bx = points[b];
    const by = points[b + 1];
    if (ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) inside = !inside;
    prev = k;
  }
  return inside;
}

export interface SweepInput {
  original: Polyline;
  /** Indices of the vertices kept by simplification, in order. */
  kept: Int32Array;
  tolerance: number;
}

/**
 * Rule 3. Returns the paths with a chord that swept over a vertex of any original
 * path, its own included. Every original vertex is a witness. Vertices that the
 * span itself replaced are excluded, since they are expected to be there.
 */
export function findSweeps(inputs: readonly SweepInput[]): Set<number> {
  const blamed = new Set<number>();
  const originals = inputs.map((input) => input.original);
  let vertexCount = 0;
  for (const p of originals) vertexCount += p.points.length / 2;
  if (vertexCount === 0) return blamed;

  const px = new Float64Array(vertexCount);
  const py = new Float64Array(vertexCount);
  const owner = new Int32Array(vertexCount);
  const local = new Int32Array(vertexCount);
  let v = 0;
  originals.forEach((path, index) => {
    for (let k = 0; k < path.points.length; k += 2) {
      px[v] = path.points[k];
      py[v] = path.points[k + 1];
      owner[v] = index;
      local[v] = k / 2;
      v++;
    }
  });

  const [minX, minY, maxX, maxY] = boundsOf(originals);
  const grid = new BucketGrid(
    minX,
    minY,
    maxX - minX,
    maxY - minY,
    vertexCount,
    (i, target, visit) => visit(target.cellY(py[i]) * target.cols + target.cellX(px[i])),
  );

  inputs.forEach((input, index) => {
    const { original, kept, tolerance } = input;
    const { points, closed } = original;
    const n = points.length / 2;
    if (kept.length === n || tolerance <= 0) return;
    const spanCount = closed ? kept.length : kept.length - 1;
    const limit = tolerance * tolerance;

    for (let s = 0; s < spanCount && !blamed.has(index); s++) {
      const first = kept[s];
      const lastRaw = s + 1 < kept.length ? kept[s + 1] : kept[0] + n;
      if (lastRaw - first < 2) continue;

      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let k = first; k <= lastRaw; k++) {
        const w = k % n;
        const x = points[w * 2];
        const y = points[w * 2 + 1];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }

      const ax = points[first * 2];
      const ay = points[first * 2 + 1];
      const bx = points[(lastRaw % n) * 2];
      const by = points[(lastRaw % n) * 2 + 1];

      let swept = false;
      grid.coverBox(x0, y0, x1, y1, (cell) => {
        if (swept) return;
        for (let i = grid.starts[cell]; i < grid.starts[cell + 1]; i++) {
          const w = grid.items[i];
          const x = px[w];
          const y = py[w];
          if (x < x0 || x > x1 || y < y0 || y > y1) continue;
          if (owner[w] === index) {
            const at = local[w];
            const wrapped = at + n;
            if ((at >= first && at <= lastRaw) || (wrapped >= first && wrapped <= lastRaw)) continue;
          }
          // The swept region lies inside the tolerance stadium around the chord,
          // so this cheap distance rejects almost every witness.
          if (segmentDistanceSquared(x, y, ax, ay, bx, by) > limit) continue;
          if (insideRing(x, y, points, n, first, lastRaw)) {
            swept = true;
            return;
          }
        }
      });
      if (swept) blamed.add(index);
    }
  });
  return blamed;
}
