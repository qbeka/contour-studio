/**
 * The scalar field. See docs/GEOMETRY.md for the model.
 *
 * Only +, -, *, /, sqrt and Math.imul appear here, on purpose. IEEE 754 fixes the
 * results of those operations, so a scene samples to identical bits on every
 * engine. Math.sin, Math.exp and Math.pow carry no such promise.
 */

import type { Point, Scene } from './scene';

/** Straight pieces per spline span. Part of scene format version 1. */
export const RIDGE_SUBDIVISIONS = 8;

/** Pieces shorter than this add nothing, which removes the only division risk. */
const MIN_PIECE_LENGTH = 1e-9;

const RIDGE_NORMALISER = 35 / 32;

export interface Grid {
  nx: number;
  ny: number;
  width: number;
  height: number;
  /** Row by row, (nx + 1) * (ny + 1) corner samples. */
  values: Float64Array;
}

/** Sample position along an axis. Dividing last makes the end exact. */
export function gridCoord(index: number, size: number, cells: number): number {
  return (index * size) / cells;
}

/** The peak profile, as a function of squared distance over squared reach. */
function bump(q: number): number {
  if (q >= 1) return 0;
  const m = 1 - q;
  return m * m * m;
}

/** The antiderivative of (m - t^2)^3 with respect to t. */
function ridgeIntegral(m: number, t: number): number {
  const t2 = t * t;
  return t * (m * m * m + t2 * (-(m * m) + t2 * ((3 / 5) * m - t2 / 7)));
}

/** Flattens handles to a polyline. Interleaved x, y. */
export function flattenRidge(points: readonly Point[]): Float64Array {
  if (points.length === 2) {
    return new Float64Array([points[0].x, points[0].y, points[1].x, points[1].y]);
  }
  const spans = points.length - 1;
  const out = new Float64Array((spans * RIDGE_SUBDIVISIONS + 1) * 2);
  let write = 0;
  for (let i = 0; i < spans; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let k = 0; k < RIDGE_SUBDIVISIONS; k++) {
      const t = k / RIDGE_SUBDIVISIONS;
      out[write++] = catmullRom(p0.x, p1.x, p2.x, p3.x, t);
      out[write++] = catmullRom(p0.y, p1.y, p2.y, p3.y, t);
    }
  }
  const last = points[points.length - 1];
  out[write++] = last.x;
  out[write] = last.y;
  return out;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const a = 2 * p1;
  const b = p2 - p0;
  const c = 2 * p0 - 5 * p1 + 4 * p2 - p3;
  const d = -p0 + 3 * p1 - 3 * p2 + p3;
  return 0.5 * (a + t * (b + t * (c + t * d)));
}

/** Contribution of one straight piece at a point, before height. */
function ridgePiece(
  x: number,
  y: number,
  ax: number,
  ay: number,
  ux: number,
  uy: number,
  length: number,
  radius: number,
): number {
  const px = x - ax;
  const py = y - ay;
  const along = px * ux + py * uy;
  const across = px * uy - py * ux;
  const m = 1 - (across * across) / (radius * radius);
  if (m <= 0) return 0;
  const edge = Math.sqrt(m);
  const t0 = Math.max(-along / radius, -edge);
  const t1 = Math.min((length - along) / radius, edge);
  if (t1 <= t0) return 0;
  return RIDGE_NORMALISER * (ridgeIntegral(m, t1) - ridgeIntegral(m, t0));
}

/** A value in [-1, 1) fixed by the lattice point and the seed. */
function latticeValue(ix: number, iy: number, seed: number): number {
  // A 32-bit mix in the style of murmur3's finaliser.
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  // (h >>> 0) is in [0, 2^32), so this is in [-1, 1).
  return (h >>> 0) / 2147483648 - 1;
}

function quintic(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** One octave of value noise, in [-1, 1]. */
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const tx = quintic(x - ix);
  const ty = quintic(y - iy);
  const v00 = latticeValue(ix, iy, seed);
  const v10 = latticeValue(ix + 1, iy, seed);
  const v01 = latticeValue(ix, iy + 1, seed);
  const v11 = latticeValue(ix + 1, iy + 1, seed);
  const top = v00 + (v10 - v00) * tx;
  const bottom = v01 + (v11 - v01) * tx;
  return top + (bottom - top) * ty;
}

/** Fractal noise, in [-1, 1]. Each octave has its own derived seed. */
export function fractalNoise(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let weight = 1;
  let total = 0;
  let frequency = 1;
  for (let o = 0; o < octaves; o++) {
    sum += weight * valueNoise(x * frequency, y * frequency, (seed + Math.imul(o, 0x9e3779b1)) | 0);
    total += weight;
    weight *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}

interface Prepared {
  peaks: { x: number; y: number; r2: number; h: number; order: number }[];
  ridges: {
    pieces: Float64Array; // ax, ay, ux, uy, length per piece
    count: number;
    radius: number;
    h: number;
    order: number;
  }[];
}

const PIECE_STRIDE = 5;

function prepare(scene: Scene): Prepared {
  const peaks: Prepared['peaks'] = [];
  const ridges: Prepared['ridges'] = [];
  scene.sources.forEach((source, order) => {
    if (!source.enabled || source.height === 0) return;
    if (source.kind === 'peak') {
      peaks.push({
        x: source.x,
        y: source.y,
        r2: source.radius * source.radius,
        h: source.height,
        order,
      });
      return;
    }
    const line = flattenRidge(source.points);
    const pieces = new Float64Array(((line.length / 2 - 1) * PIECE_STRIDE) | 0);
    let count = 0;
    for (let i = 0; i + 3 < line.length; i += 2) {
      const dx = line[i + 2] - line[i];
      const dy = line[i + 3] - line[i + 1];
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length < MIN_PIECE_LENGTH) continue;
      pieces[count * PIECE_STRIDE] = line[i];
      pieces[count * PIECE_STRIDE + 1] = line[i + 1];
      pieces[count * PIECE_STRIDE + 2] = dx / length;
      pieces[count * PIECE_STRIDE + 3] = dy / length;
      pieces[count * PIECE_STRIDE + 4] = length;
      count++;
    }
    ridges.push({ pieces, count, radius: source.radius, h: source.height, order });
  });
  return { peaks, ridges };
}

/**
 * Returns a pointwise evaluator. Tests use it as the reference for the sampler,
 * and the grid error estimate uses it to reach the true field.
 */
export function fieldFunction(scene: Scene): (x: number, y: number) => number {
  const prepared = prepare(scene);
  const { amplitude, scale, octaves } = scene.noise;
  const seed = scene.seed | 0;
  return (x, y) => {
    let total = 0;
    let p = 0;
    let r = 0;
    // Same order as the sampler: source order, then noise.
    while (p < prepared.peaks.length || r < prepared.ridges.length) {
      const peak = prepared.peaks[p];
      const ridge = prepared.ridges[r];
      if (peak && (!ridge || peak.order < ridge.order)) {
        const dx = x - peak.x;
        const dy = y - peak.y;
        total += peak.h * bump((dx * dx + dy * dy) / peak.r2);
        p++;
      } else {
        for (let i = 0; i < ridge.count; i++) {
          const o = i * PIECE_STRIDE;
          const q = ridge.pieces;
          total +=
            ridge.h * ridgePiece(x, y, q[o], q[o + 1], q[o + 2], q[o + 3], q[o + 4], ridge.radius);
        }
        r++;
      }
    }
    if (amplitude > 0) total += amplitude * fractalNoise(x / scale, y / scale, seed, octaves);
    return total;
  };
}

/** The range of sample indices inside [low, high] along one axis, clamped. */
function footprint(low: number, high: number, size: number, cells: number): [number, number] {
  const first = Math.max(0, Math.floor((low / size) * cells) - 1);
  const last = Math.min(cells, Math.ceil((high / size) * cells) + 1);
  return [first, last];
}

/**
 * Samples the field at every grid corner.
 *
 * Sources are compact, so each one only touches the rows and columns inside its
 * reach. Terms are added in source order and then noise, which is the same order
 * as fieldFunction, so both produce identical bits.
 */
export function sampleField(scene: Scene, nx: number, ny: number): Grid {
  const { width, height } = scene.domain;
  const stride = nx + 1;
  const values = new Float64Array(stride * (ny + 1));
  const xs = new Float64Array(nx + 1);
  const ys = new Float64Array(ny + 1);
  for (let i = 0; i <= nx; i++) xs[i] = gridCoord(i, width, nx);
  for (let j = 0; j <= ny; j++) ys[j] = gridCoord(j, height, ny);

  const prepared = prepare(scene);
  let p = 0;
  let r = 0;
  while (p < prepared.peaks.length || r < prepared.ridges.length) {
    const peak = prepared.peaks[p];
    const ridge = prepared.ridges[r];
    if (peak && (!ridge || peak.order < ridge.order)) {
      addPeak(values, xs, ys, stride, width, height, nx, ny, peak);
      p++;
    } else {
      addRidge(values, xs, ys, stride, width, height, nx, ny, ridge);
      r++;
    }
  }

  const { amplitude, scale, octaves } = scene.noise;
  if (amplitude > 0) {
    const seed = scene.seed | 0;
    for (let j = 0; j <= ny; j++) {
      const row = j * stride;
      const y = ys[j] / scale;
      for (let i = 0; i <= nx; i++) {
        values[row + i] += amplitude * fractalNoise(xs[i] / scale, y, seed, octaves);
      }
    }
  }

  return { nx, ny, width, height, values };
}

function addPeak(
  values: Float64Array,
  xs: Float64Array,
  ys: Float64Array,
  stride: number,
  width: number,
  height: number,
  nx: number,
  ny: number,
  peak: Prepared['peaks'][number],
): void {
  const reach = Math.sqrt(peak.r2);
  const [i0, i1] = footprint(peak.x - reach, peak.x + reach, width, nx);
  const [j0, j1] = footprint(peak.y - reach, peak.y + reach, height, ny);
  for (let j = j0; j <= j1; j++) {
    const dy = ys[j] - peak.y;
    const row = j * stride;
    for (let i = i0; i <= i1; i++) {
      const dx = xs[i] - peak.x;
      const q = (dx * dx + dy * dy) / peak.r2;
      if (q < 1) {
        const m = 1 - q;
        values[row + i] += peak.h * (m * m * m);
      }
    }
  }
}

function addRidge(
  values: Float64Array,
  xs: Float64Array,
  ys: Float64Array,
  stride: number,
  width: number,
  height: number,
  nx: number,
  ny: number,
  ridge: Prepared['ridges'][number],
): void {
  const { pieces, count, radius, h } = ridge;
  for (let piece = 0; piece < count; piece++) {
    const o = piece * PIECE_STRIDE;
    const ax = pieces[o];
    const ay = pieces[o + 1];
    const ux = pieces[o + 2];
    const uy = pieces[o + 3];
    const length = pieces[o + 4];
    const bx = ax + ux * length;
    const by = ay + uy * length;
    const [i0, i1] = footprint(Math.min(ax, bx) - radius, Math.max(ax, bx) + radius, width, nx);
    const [j0, j1] = footprint(Math.min(ay, by) - radius, Math.max(ay, by) + radius, height, ny);
    for (let j = j0; j <= j1; j++) {
      const row = j * stride;
      const y = ys[j];
      for (let i = i0; i <= i1; i++) {
        const value = ridgePiece(xs[i], y, ax, ay, ux, uy, length, radius);
        if (value !== 0) values[row + i] += h * value;
      }
    }
  }
}
