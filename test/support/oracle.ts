/**
 * Test helpers that do not share code with the production path builder.
 *
 * Everything here works from corner values or floating point positions, by brute
 * force. If the path builder is wrong, these should not be wrong in the same way.
 */

import type { Grid } from '../../src/core/field';
import { edgeCrossing, type Polyline, type Segments } from '../../src/core/contour';

export function gridFrom(
  width: number,
  height: number,
  nx: number,
  ny: number,
  f: (x: number, y: number) => number,
): Grid {
  const values = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      values[j * (nx + 1) + i] = f((i * width) / nx, (j * height) / ny);
    }
  }
  return { nx, ny, width, height, values };
}

/** Every grid edge whose ends straddle the level, found by looking at values. */
export function straddlingEdges(grid: Grid, level: number): Set<number> {
  const { nx, ny, values } = grid;
  const stride = nx + 1;
  const out = new Set<number>();
  const above = (k: number) => values[k] > level;
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = j * stride + i;
      if (i < nx && above(k) !== above(k + 1)) out.add(2 * k);
      if (j < ny && above(k) !== above(k + stride)) out.add(2 * k + 1);
    }
  }
  return out;
}

export function isBoundaryEdge(grid: Grid, edge: number): boolean {
  const { nx, ny } = grid;
  const stride = nx + 1;
  const index = edge >> 1;
  const i = index % stride;
  const j = (index - i) / stride;
  return edge & 1 ? i === 0 || i === nx : j === 0 || j === ny;
}

/**
 * The crack test. Every straddling interior edge must be entered once and left
 * once. Every straddling boundary edge must be used exactly once. No other edge
 * may be used.
 */
export function crackReport(grid: Grid, segments: Segments, level: number): string[] {
  const expected = straddlingEdges(grid, level);
  const entered = new Map<number, number>();
  const left = new Map<number, number>();
  for (let s = 0; s < segments.count; s++) {
    left.set(segments.from[s], (left.get(segments.from[s]) ?? 0) + 1);
    entered.set(segments.to[s], (entered.get(segments.to[s]) ?? 0) + 1);
  }
  const problems: string[] = [];
  for (const edge of expected) {
    const a = entered.get(edge) ?? 0;
    const b = left.get(edge) ?? 0;
    if (isBoundaryEdge(grid, edge)) {
      if (a + b !== 1) problems.push(`boundary edge ${edge} used ${a + b} times`);
    } else if (a !== 1 || b !== 1) {
      problems.push(`interior edge ${edge} entered ${a}, left ${b}`);
    }
  }
  for (const edge of [...entered.keys(), ...left.keys()]) {
    if (!expected.has(edge)) problems.push(`edge ${edge} used but does not straddle the level`);
  }
  return problems;
}

/** Above must be on the left of every segment, as seen on screen with y down. */
export function orientationReport(
  grid: Grid,
  segments: Segments,
  level: number,
  f: (x: number, y: number) => number,
): string[] {
  const a = new Float64Array(2);
  const b = new Float64Array(2);
  const problems: string[] = [];
  for (let s = 0; s < segments.count; s++) {
    edgeCrossing(grid, segments.from[s], level, a);
    edgeCrossing(grid, segments.to[s], level, b);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const step = 1e-3 * Math.min(grid.width / grid.nx, grid.height / grid.ny);
    const left = f(mx + (dy / length) * step, my - (dx / length) * step);
    const right = f(mx - (dy / length) * step, my + (dx / length) * step);
    if (!(left >= right)) problems.push(`segment ${s}: left ${left}, right ${right}`);
  }
  return problems;
}

/** Joins by comparing float positions, the naive way, to check path counts. */
export function bruteForceJoinCount(
  grid: Grid,
  segments: Segments,
  level: number,
): { open: number; closed: number } {
  const n = segments.count;
  const ends: number[][] = [];
  const a = new Float64Array(2);
  const b = new Float64Array(2);
  for (let s = 0; s < n; s++) {
    edgeCrossing(grid, segments.from[s], level, a);
    edgeCrossing(grid, segments.to[s], level, b);
    ends.push([a[0], a[1], b[0], b[1], segments.from[s], segments.to[s]]);
  }
  const parent = ends.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Edge ids here only to separate strands that meet at one tied corner.
      if (ends[i][5] === ends[j][4] || ends[j][5] === ends[i][4]) parent[find(i)] = find(j);
    }
  }
  const tails = new Set(ends.map((e) => e[5]));
  const heads = new Set(ends.map((e) => e[4]));
  const groups = new Map<number, boolean>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const open = !heads.has(ends[i][5]) || !tails.has(ends[i][4]);
    groups.set(root, (groups.get(root) ?? false) || open);
  }
  let open = 0;
  let closed = 0;
  for (const isOpen of groups.values()) {
    if (isOpen) open++;
    else closed++;
  }
  return { open, closed };
}

export function pointsOf(path: Polyline): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < path.points.length; k += 2) out.push([path.points[k], path.points[k + 1]]);
  return out;
}

export function polygonArea(path: Polyline): number {
  const pts = pointsOf(path);
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

/** Slow proper-crossing search across a set of paths. */
export function bruteCrossings(paths: Polyline[]): number {
  const segs: { p: number; k: number; n: number; c: boolean; s: number[] }[] = [];
  paths.forEach((path, p) => {
    const pts = pointsOf(path);
    const n = pts.length;
    const last = path.closed ? n : n - 1;
    for (let k = 0; k < last; k++) {
      const [x0, y0] = pts[k];
      const [x1, y1] = pts[(k + 1) % n];
      segs.push({ p, k, n, c: path.closed, s: [x0, y0, x1, y1] });
    }
  });
  const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  let crossings = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i];
      const b = segs[j];
      if (a.p === b.p) {
        const gap = Math.abs(a.k - b.k);
        if (gap <= 1 || (a.c && gap === a.n - 1)) continue;
      }
      const [x1, y1, x2, y2] = a.s;
      const [x3, y3, x4, y4] = b.s;
      const d1 = orient(x1, y1, x2, y2, x3, y3);
      const d2 = orient(x1, y1, x2, y2, x4, y4);
      const d3 = orient(x3, y3, x4, y4, x1, y1);
      const d4 = orient(x3, y3, x4, y4, x2, y2);
      if (d1 * d2 < 0 && d3 * d4 < 0) crossings++;
    }
  }
  return crossings;
}
