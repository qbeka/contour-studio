/**
 * Marching squares with exact joining. See docs/GEOMETRY.md.
 *
 * Crossings are identified by grid edge, never by position. That single choice
 * rules out cracks and tolerance mistakes, because two cells that share an edge
 * share an integer, and an integer cannot disagree with itself.
 */

import type { Grid } from './field';

export interface Polyline {
  /** Interleaved x, y. A closed path does not repeat its first point. */
  points: Float64Array;
  closed: boolean;
}

/** Oriented segments for one level, as pairs of edge ids. */
export interface Segments {
  count: number;
  from: Int32Array;
  to: Int32Array;
}

/** Edge names in a cell. T, R, B, L are top, right, bottom, left. */
const T = 0;
const R = 1;
const B = 2;
const L = 3;

/**
 * Oriented pairs per corner mask, with the above side on the left on screen.
 * Mask bits: a = 1 (top left), b = 2 (top right), c = 4 (bottom right),
 * d = 8 (bottom left). Masks 5 and 10 are ambiguous and handled in the loop.
 */
const CASES: readonly (readonly number[])[] = [
  [], // 0
  [L, T], // 1 a
  [T, R], // 2 b
  [L, R], // 3 a b
  [R, B], // 4 c
  [], // 5 a c, ambiguous
  [T, B], // 6 b c
  [L, B], // 7 a b c
  [B, L], // 8 d
  [B, T], // 9 a d
  [], // 10 b d, ambiguous
  [B, R], // 11 a b d
  [R, L], // 12 c d
  [R, T], // 13 a c d
  [T, L], // 14 b c d
  [], // 15
];

/**
 * Finds every oriented segment for a level.
 *
 * A corner is above when strictly greater than the level. Ties count as below,
 * which behaves like raising the level by an infinitely small amount.
 */
export function extractSegments(grid: Grid, level: number): Segments {
  const { nx, ny, values } = grid;
  const stride = nx + 1;
  let capacity = 1024;
  let from = new Int32Array(capacity);
  let to = new Int32Array(capacity);
  let count = 0;
  const edgeIds = new Int32Array(4);

  for (let j = 0; j < ny; j++) {
    const row = j * stride;
    for (let i = 0; i < nx; i++) {
      const ia = row + i;
      const a = values[ia];
      const b = values[ia + 1];
      const c = values[ia + stride + 1];
      const d = values[ia + stride];
      const mask =
        (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
      if (mask === 0 || mask === 15) continue;

      edgeIds[T] = 2 * ia;
      edgeIds[B] = 2 * (ia + stride);
      edgeIds[L] = 2 * ia + 1;
      edgeIds[R] = 2 * (ia + 1) + 1;

      if (count + 2 > capacity) {
        capacity *= 2;
        const nextFrom = new Int32Array(capacity);
        const nextTo = new Int32Array(capacity);
        nextFrom.set(from);
        nextTo.set(to);
        from = nextFrom;
        to = nextTo;
      }

      if (mask === 5 || mask === 10) {
        // Asymptotic decider. The sign of the saddle is the sign of the
        // numerator, flipped for mask 10, where the denominator is negative.
        const ga = a - level;
        const gb = b - level;
        const gc = c - level;
        const gd = d - level;
        const numerator = ga * gc - gb * gd;
        const saddleAbove = mask === 5 ? numerator > 0 : numerator < 0;
        if (mask === 5) {
          if (saddleAbove) {
            // a and c connect through the centre; b and d are cut off.
            from[count] = edgeIds[R];
            to[count++] = edgeIds[T];
            from[count] = edgeIds[L];
            to[count++] = edgeIds[B];
          } else {
            from[count] = edgeIds[L];
            to[count++] = edgeIds[T];
            from[count] = edgeIds[R];
            to[count++] = edgeIds[B];
          }
        } else if (saddleAbove) {
          // b and d connect through the centre; a and c are cut off.
          from[count] = edgeIds[T];
          to[count++] = edgeIds[L];
          from[count] = edgeIds[B];
          to[count++] = edgeIds[R];
        } else {
          from[count] = edgeIds[T];
          to[count++] = edgeIds[R];
          from[count] = edgeIds[B];
          to[count++] = edgeIds[L];
        }
        continue;
      }

      const pair = CASES[mask];
      from[count] = edgeIds[pair[0]];
      to[count++] = edgeIds[pair[1]];
    }
  }
  return { count, from, to };
}

/**
 * The position of a level crossing on a grid edge.
 *
 * Corners are always read in index order, so the answer does not depend on which
 * neighbouring cell asks. The caller guarantees one corner is above the level and
 * the other is not, so the denominator is never zero.
 */
export function edgeCrossing(grid: Grid, edge: number, level: number, out: Float64Array): void {
  const { nx, ny, width, height, values } = grid;
  const stride = nx + 1;
  const index = edge >> 1;
  const vertical = (edge & 1) === 1;
  const i = index % stride;
  const j = (index - i) / stride;
  const v0 = values[index];
  const v1 = values[vertical ? index + stride : index + 1];
  let t = (level - v0) / (v1 - v0);
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  if (vertical) {
    out[0] = (i * width) / nx;
    out[1] = ((j + t) * height) / ny;
  } else {
    out[0] = ((i + t) * width) / nx;
    out[1] = (j * height) / ny;
  }
}

/** Reusable lookup tables, so that a 16 level run allocates them once. */
export class JoinTables {
  outgoing: Int32Array;
  incoming: Int32Array;

  constructor(edgeCount: number) {
    this.outgoing = new Int32Array(edgeCount).fill(-1);
    this.incoming = new Int32Array(edgeCount).fill(-1);
  }

  static forGrid(grid: Grid): JoinTables {
    return new JoinTables(2 * (grid.nx + 1) * (grid.ny + 1));
  }
}

export interface JoinResult {
  paths: Polyline[];
  /** Paths with no length or area after duplicate removal. */
  degenerate: number;
}

/**
 * Joins oriented segments into ordered paths.
 *
 * Each edge has at most one segment leaving it and one arriving, because a level
 * crosses a grid edge at most once. A violation means extraction is wrong, so it
 * throws instead of producing a quietly damaged path.
 */
export function joinSegments(
  grid: Grid,
  segments: Segments,
  level: number,
  tables: JoinTables = JoinTables.forGrid(grid),
): JoinResult {
  const { count, from, to } = segments;
  const { outgoing, incoming } = tables;
  for (let s = 0; s < count; s++) {
    if (outgoing[from[s]] !== -1 || incoming[to[s]] !== -1) {
      resetTables(tables, segments, s);
      throw new Error(`Contour edge used twice at level ${level}.`);
    }
    outgoing[from[s]] = s;
    incoming[to[s]] = s;
  }

  const paths: Polyline[] = [];
  let degenerate = 0;
  const visited = new Uint8Array(count);
  const buffer = new Growable();
  const scratch = new Float64Array(2);

  const walk = (start: number): boolean => {
    buffer.length = 0;
    edgeCrossing(grid, from[start], level, scratch);
    buffer.push(scratch[0], scratch[1]);
    let s = start;
    for (;;) {
      visited[s] = 1;
      edgeCrossing(grid, to[s], level, scratch);
      buffer.push(scratch[0], scratch[1]);
      const next = outgoing[to[s]];
      if (next === -1) return false;
      if (next === start) return true;
      s = next;
    }
  };

  const finish = (closed: boolean): void => {
    const path = cleanPath(buffer, closed);
    if (path) paths.push(path);
    else degenerate++;
  };

  // Open paths first. They start on a boundary edge with nothing arriving.
  for (let s = 0; s < count; s++) {
    if (!visited[s] && incoming[from[s]] === -1) finish(walk(s));
  }
  // Whatever remains is a closed loop.
  for (let s = 0; s < count; s++) {
    if (!visited[s]) finish(walk(s));
  }

  resetTables(tables, segments, count);
  return { paths, degenerate };
}

function resetTables(tables: JoinTables, segments: Segments, count: number): void {
  for (let s = 0; s < count; s++) {
    tables.outgoing[segments.from[s]] = -1;
    tables.incoming[segments.to[s]] = -1;
  }
}

/** Removes exact duplicates and rejects paths with no extent. */
function cleanPath(buffer: Growable, closed: boolean): Polyline | null {
  const raw = buffer.data;
  let length = buffer.length;
  // A walk that closes ends on its first point.
  if (closed) length -= 2;
  const out = new Float64Array(length);
  let write = 0;
  for (let k = 0; k < length; k += 2) {
    const x = raw[k];
    const y = raw[k + 1];
    if (write > 0 && out[write - 2] === x && out[write - 1] === y) continue;
    out[write++] = x;
    out[write++] = y;
  }
  if (closed) {
    while (write >= 4 && out[0] === out[write - 2] && out[1] === out[write - 1]) write -= 2;
  }
  const minimum = closed ? 6 : 4;
  if (write < minimum) return null;
  return { points: out.slice(0, write), closed };
}

class Growable {
  data = new Float64Array(1024);
  length = 0;

  push(x: number, y: number): void {
    if (this.length + 2 > this.data.length) {
      const next = new Float64Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = x;
    this.data[this.length++] = y;
  }
}

/** Extracts and joins one level. */
export function contourLevel(grid: Grid, level: number, tables?: JoinTables): JoinResult {
  return joinSegments(grid, extractSegments(grid, level), level, tables);
}
