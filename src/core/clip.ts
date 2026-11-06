/** Clips polylines to a rectangle with Liang-Barsky. See docs/GEOMETRY.md. */

import type { Polyline } from './contour';
import type { Rect } from './scene';

function isInside(x: number, y: number, rect: Rect): boolean {
  return (
    x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
  );
}

/**
 * The part of a segment inside the rectangle, as parameters in [0, 1].
 * Returns false when no part is inside.
 */
function clipSegment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rect: Rect,
  out: Float64Array,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - rect.x, rect.x + rect.width - x0, y0 - rect.y, rect.y + rect.height - y0];
  for (let k = 0; k < 4; k++) {
    if (p[k] === 0) {
      if (q[k] < 0) return false;
      continue;
    }
    const r = q[k] / p[k];
    if (p[k] < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  out[0] = t0;
  out[1] = t1;
  return true;
}

function firstOutside(points: Float64Array, rect: Rect): number {
  for (let k = 0; k < points.length; k += 2) {
    if (!isInside(points[k], points[k + 1], rect)) return k;
  }
  return -1;
}

/**
 * Clips one path. A closed path entirely inside stays closed. A closed path that
 * crosses the rectangle is rotated to start outside, so no fragment is split at
 * an arbitrary start vertex.
 */
export function clipPath(path: Polyline, rect: Rect): Polyline[] {
  const { points, closed } = path;
  const outside = firstOutside(points, rect);
  if (outside === -1) return [path];

  const n = points.length;
  const count = closed ? n / 2 + 1 : n / 2;
  const start = closed ? outside : 0;
  const at = (index: number) => (start + index * 2) % n;

  const fragments: Polyline[] = [];
  let current: number[] = [];
  const flush = () => {
    if (current.length >= 4) {
      fragments.push({ points: new Float64Array(current), closed: false });
    }
    current = [];
  };

  const range = new Float64Array(2);
  for (let i = 0; i + 1 < count; i++) {
    const a = at(i);
    const b = at(i + 1);
    const x0 = points[a];
    const y0 = points[a + 1];
    const x1 = points[b];
    const y1 = points[b + 1];
    if (!clipSegment(x0, y0, x1, y1, rect, range)) {
      flush();
      continue;
    }
    const [t0, t1] = range;
    // Exact endpoints when unclipped, so that no rounding is added to kept points.
    const sx = t0 === 0 ? x0 : x0 + (x1 - x0) * t0;
    const sy = t0 === 0 ? y0 : y0 + (y1 - y0) * t0;
    const ex = t1 === 1 ? x1 : x0 + (x1 - x0) * t1;
    const ey = t1 === 1 ? y1 : y0 + (y1 - y0) * t1;
    if (current.length === 0) {
      current.push(sx, sy);
    } else if (
      current[current.length - 2] !== sx ||
      current[current.length - 1] !== sy
    ) {
      flush();
      current.push(sx, sy);
    }
    if (sx !== ex || sy !== ey) current.push(ex, ey);
    if (t1 < 1) flush();
  }
  flush();
  return fragments;
}
