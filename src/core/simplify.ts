/**
 * Douglas-Peucker with distance to the segment. See docs/GEOMETRY.md for the
 * proof that the Hausdorff distance to the replaced path is at most the tolerance.
 */

import type { Polyline } from './contour';

export function segmentDistanceSquared(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  let t = 0;
  if (lengthSquared > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

/**
 * Marks the vertices to keep between two anchors, inclusive. `last` may equal the
 * vertex count of a closed path, in which case it wraps to vertex 0. The stack is
 * explicit because a noisy contour can be deep enough to hurt recursion.
 */
function markKept(
  points: Float64Array,
  first: number,
  last: number,
  toleranceSquared: number,
  keep: Uint8Array,
): void {
  const vertexCount = points.length / 2;
  const stack: number[] = [first, last];
  while (stack.length > 0) {
    const end = stack.pop() as number;
    const start = stack.pop() as number;
    if (end - start < 2) continue;
    const ax = points[start * 2];
    const ay = points[start * 2 + 1];
    const wrapped = end % vertexCount;
    const bx = points[wrapped * 2];
    const by = points[wrapped * 2 + 1];
    let worst = -1;
    let worstIndex = -1;
    for (let k = start + 1; k < end; k++) {
      const d = segmentDistanceSquared(points[k * 2], points[k * 2 + 1], ax, ay, bx, by);
      if (d > worst) {
        worst = d;
        worstIndex = k;
      }
    }
    if (worst > toleranceSquared) {
      keep[worstIndex] = 1;
      stack.push(start, worstIndex, worstIndex, end);
    }
  }
}

/** The vertex farthest from vertex 0. A closed path splits there. */
function farthestFromStart(points: Float64Array): number {
  let best = 0;
  let index = 0;
  for (let k = 2; k < points.length; k += 2) {
    const dx = points[k] - points[0];
    const dy = points[k + 1] - points[1];
    const d = dx * dx + dy * dy;
    if (d > best) {
      best = d;
      index = k / 2;
    }
  }
  return index;
}

/** The kept vertex indices of a path, in order. Spans lie between neighbours. */
export function simplifyIndices(path: Polyline, tolerance: number): Int32Array {
  const { points, closed } = path;
  const n = points.length / 2;
  if (tolerance <= 0 || n <= 2) return Int32Array.from({ length: n }, (_, i) => i);

  const keep = new Uint8Array(n);
  const toleranceSquared = tolerance * tolerance;
  keep[0] = 1;
  if (closed) {
    const split = farthestFromStart(points);
    keep[split] = 1;
    markKept(points, 0, split, toleranceSquared, keep);
    markKept(points, split, n, toleranceSquared, keep);
    ensureTriangle(points, keep, split);
  } else {
    keep[n - 1] = 1;
    markKept(points, 0, n - 1, toleranceSquared, keep);
  }

  let total = 0;
  for (let i = 0; i < n; i++) total += keep[i];
  const out = new Int32Array(total);
  let write = 0;
  for (let i = 0; i < n; i++) if (keep[i]) out[write++] = i;
  return out;
}

/**
 * A loop smaller than the tolerance would reduce to two anchors, which is a line
 * and no longer a loop. Adding a vertex can only tighten the bound, so the vertex
 * farthest from the chord stays. This is what keeps small loops alive.
 */
function ensureTriangle(points: Float64Array, keep: Uint8Array, split: number): void {
  let total = 0;
  for (let i = 0; i < keep.length; i++) total += keep[i];
  if (total >= 3) return;
  const ax = points[0];
  const ay = points[1];
  const bx = points[split * 2];
  const by = points[split * 2 + 1];
  let worst = -1;
  let index = -1;
  for (let k = 1; k < keep.length; k++) {
    if (k === split) continue;
    const d = segmentDistanceSquared(points[k * 2], points[k * 2 + 1], ax, ay, bx, by);
    if (d > worst) {
      worst = d;
      index = k;
    }
  }
  if (index !== -1) keep[index] = 1;
}

/** Copies kept vertices, rounded to a decimal lattice, removing repeats. */
export function snapPath(
  path: Polyline,
  kept: Int32Array,
  decimals: number,
): Polyline {
  const scale = 10 ** decimals;
  const out = new Float64Array(kept.length * 2);
  let write = 0;
  for (let i = 0; i < kept.length; i++) {
    const x = Math.round(path.points[kept[i] * 2] * scale) / scale;
    const y = Math.round(path.points[kept[i] * 2 + 1] * scale) / scale;
    if (write >= 2 && out[write - 2] === x && out[write - 1] === y) continue;
    out[write++] = x;
    out[write++] = y;
  }
  if (path.closed) {
    while (write >= 4 && out[0] === out[write - 2] && out[1] === out[write - 1]) write -= 2;
  }
  return { points: out.slice(0, write), closed: path.closed };
}

/** The worst case distance a vertex moves when rounded to these decimals. */
export function roundingBound(decimals: number): number {
  return (Math.SQRT2 / 2) * 10 ** -decimals;
}
