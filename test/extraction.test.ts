import { describe, expect, it } from 'vitest';
import { contourLevel, extractSegments } from '../src/core/contour';
import {
  bruteCrossings,
  bruteForceJoinCount,
  crackReport,
  gridFrom,
  orientationReport,
  pointsOf,
  polygonArea,
} from './support/oracle';

const SIZE = 100;

describe('analytic fixtures', () => {
  it('a linear field gives one straight open line on the exact position', () => {
    const f = (x: number, y: number) => 0.3 * x + 0.7 * y;
    const grid = gridFrom(SIZE, SIZE, 37, 37, f);
    const level = 41.3;
    const { paths } = contourLevel(grid, level);
    expect(paths).toHaveLength(1);
    expect(paths[0].closed).toBe(false);
    // Bilinear interpolation reproduces a linear field, so every vertex is exact.
    for (const [x, y] of pointsOf(paths[0])) {
      expect(Math.abs(f(x, y) - level)).toBeLessThan(1e-11);
    }
  });

  it('a radial field gives one closed circle within the grid error', () => {
    const f = (x: number, y: number) => Math.hypot(x - 50, y - 50);
    const radius = 30.5;
    const cells = 128;
    const grid = gridFrom(SIZE, SIZE, cells, cells, f);
    const { paths } = contourLevel(grid, radius);
    expect(paths).toHaveLength(1);
    expect(paths[0].closed).toBe(true);
    const h = SIZE / cells;
    for (const [x, y] of pointsOf(paths[0])) {
      // Interpolating a circle's distance on an edge errs by about h^2 / (8 r).
      expect(Math.abs(f(x, y) - radius)).toBeLessThan((h * h) / radius);
    }
  });

  it('grid error shrinks at the second order for a radial field', () => {
    const f = (x: number, y: number) => Math.hypot(x - 50.3, y - 49.1);
    const maxError = (cells: number) => {
      const grid = gridFrom(SIZE, SIZE, cells, cells, f);
      const { paths } = contourLevel(grid, 30);
      return Math.max(...pointsOf(paths[0]).map(([x, y]) => Math.abs(f(x, y) - 30)));
    };
    const coarse = maxError(64);
    const fine = maxError(256);
    expect(coarse / fine).toBeGreaterThan(10);
    expect(coarse / fine).toBeLessThan(22);
  });

  it('a flat field gives nothing, even when it equals the level', () => {
    const grid = gridFrom(SIZE, SIZE, 16, 16, () => 1);
    for (const level of [0.5, 1, 1.5]) {
      const result = contourLevel(grid, level);
      // At 0.5 everything is above, at 1 and 1.5 everything is below.
      expect(result.paths).toHaveLength(0);
      expect(result.degenerate).toBe(0);
    }
  });

  it('a circle cut by the domain gives open paths that end on the boundary', () => {
    const f = (x: number, y: number) => Math.hypot(x, y - 50);
    const grid = gridFrom(SIZE, SIZE, 64, 64, f);
    const { paths } = contourLevel(grid, 30);
    expect(paths).toHaveLength(1);
    expect(paths[0].closed).toBe(false);
    const pts = pointsOf(paths[0]);
    expect(pts[0][0]).toBe(0);
    expect(pts[pts.length - 1][0]).toBe(0);
  });

  it('two separated bumps give two disjoint loops, then one when they merge', () => {
    const bump = (d: number, r: number) => (d < r ? (1 - (d * d) / (r * r)) ** 3 : 0);
    const f = (x: number, y: number) =>
      bump(Math.hypot(x - 30, y - 50), 28) + bump(Math.hypot(x - 70, y - 50), 28);
    const grid = gridFrom(SIZE, SIZE, 128, 128, f);
    expect(contourLevel(grid, 0.5).paths).toHaveLength(2);
    expect(contourLevel(grid, 0.5).paths.every((p) => p.closed)).toBe(true);
    expect(contourLevel(grid, 0.05).paths).toHaveLength(1);
  });

  it('a level exactly on grid values follows the row without duplicates', () => {
    const f = (_x: number, y: number) => y;
    const grid = gridFrom(SIZE, SIZE, 10, 10, f);
    const { paths } = contourLevel(grid, 50);
    expect(paths).toHaveLength(1);
    const pts = pointsOf(paths[0]);
    expect(pts).toHaveLength(11);
    for (const [, y] of pts) expect(y).toBe(50);
  });
});

describe('ambiguous cells', () => {
  /** One cell with corners a b / d c. */
  const cell = (a: number, b: number, c: number, d: number) => ({
    nx: 1,
    ny: 1,
    width: 1,
    height: 1,
    values: new Float64Array([a, b, d, c]),
  });

  /** The bilinear interpolant of a cell, and its saddle. */
  const bilinear = (a: number, b: number, c: number, d: number) => (x: number, y: number) =>
    a * (1 - x) * (1 - y) + b * x * (1 - y) + c * x * y + d * (1 - x) * y;

  it('the pairing matches the bilinear interpolant on both sides of the saddle', () => {
    // Saddle value of this cell is (ac - bd) / (a + c - b - d) = 0.5.
    const values = [1, 0, 1, 0] as const;
    for (const [level, connectedAbove] of [
      [0.4, true],
      [0.6, false],
    ] as const) {
      const g = bilinear(...values);
      const centreAbove = g(0.5, 0.5) > level;
      expect(centreAbove).toBe(connectedAbove);
      const grid = cell(...values);
      const segments = extractSegments(grid, level);
      expect(segments.count).toBe(2);
      expect(orientationReport(grid, segments, level, g)).toEqual([]);
      expect(contourLevel(grid, level).paths).toHaveLength(2);
    }
  });

  it('a level exactly at the saddle counts the centre as below', () => {
    const grid = cell(1, 0, 1, 0);
    const segments = extractSegments(grid, 0.5);
    expect(segments.count).toBe(2);
    // Mask 5 with centre below isolates a and c: L to T and R to B.
    const paths = contourLevel(grid, 0.5).paths.map(pointsOf);
    expect(paths).toContainEqual([
      [0, 0.5],
      [0.5, 0],
    ]);
    expect(paths).toContainEqual([
      [1, 0.5],
      [0.5, 1],
    ]);
  });

  it('a level just above and just below the saddle swaps the pairing', () => {
    const scan = (a: number, b: number, c: number, d: number) => {
      const g = bilinear(a, b, c, d);
      const saddle = (a * c - b * d) / (a + c - b - d);
      for (const level of [saddle - 1e-6, saddle + 1e-6]) {
        const grid = cell(a, b, c, d);
        expect(orientationReport(grid, extractSegments(grid, level), level, g)).toEqual([]);
      }
    };
    scan(3, 0.2, 2, 1);
    scan(0.2, 3, 1, 2);
    scan(5, -1, 4, -2);
  });

  it('a saddle field xy has the right topology at every level', () => {
    const f = (x: number, y: number) => (x - 50) * (y - 50);
    const grid = gridFrom(SIZE, SIZE, 33, 33, f);
    expect(contourLevel(grid, 200).paths).toHaveLength(2);
    expect(contourLevel(grid, -200).paths).toHaveLength(2);
    expect(contourLevel(grid, 200).paths.every((p) => !p.closed)).toBe(true);
    // The saddle on a grid corner, tied exactly at the level.
    const tied = contourLevel(grid, 0);
    expect(tied.paths.length).toBeGreaterThan(0);
    expect(crackReport(grid, extractSegments(grid, 0), 0)).toEqual([]);
  });
});

describe('ties and degenerate shapes', () => {
  it('a single raised corner at the level drops as degenerate', () => {
    // A corner sits exactly at the level with everything around it above.
    // The crossing on all four edges lands on that corner: a loop of no size.
    const grid = gridFrom(4, 4, 4, 4, (x, y) => (x === 2 && y === 2 ? 1 : 2));
    const result = contourLevel(grid, 1);
    expect(result.paths).toHaveLength(0);
    expect(result.degenerate).toBe(1);
  });

  it('a pit reaching exactly the level with a real neighbour keeps its shape', () => {
    const grid = gridFrom(4, 4, 4, 4, (x, y) => (x === 2 && y === 2 ? 0 : 2));
    const { paths, degenerate } = contourLevel(grid, 1);
    expect(degenerate).toBe(0);
    expect(paths).toHaveLength(1);
    expect(paths[0].closed).toBe(true);
    expect(pointsOf(paths[0])).toHaveLength(4);
  });

  it('a plateau at exactly the level gets an outline where the field rises', () => {
    const f = (x: number, y: number) => (x > 30 && x < 70 && y > 30 && y < 70 ? 1 : 2);
    const grid = gridFrom(SIZE, SIZE, 20, 20, f);
    const { paths } = contourLevel(grid, 1);
    expect(paths).toHaveLength(1);
    expect(paths[0].closed).toBe(true);
  });

  it('a contour through tied corners has no repeated points', () => {
    // Every corner on the diagonal x + y = 10 equals the level, so neighbouring
    // crossings land on the same corner.
    const grid = gridFrom(10, 10, 10, 10, (x, y) => x + y);
    const { paths } = contourLevel(grid, 10);
    expect(paths).toHaveLength(1);
    const pts = pointsOf(paths[0]);
    for (let i = 1; i < pts.length; i++) expect(pts[i]).not.toEqual(pts[i - 1]);
    expect(pts).toHaveLength(11);
  });

  it('a boundary crossing lands exactly on a domain that does not divide evenly', () => {
    let tried = 0;
    for (const width of [1000.3, 777.7, 123.456, 1201.1]) {
      for (const nx of [7, 13, 49, 97]) {
        if ((width / nx) * nx === width) continue;
        tried++;
        const grid = gridFrom(width, 100, nx, 8, (_x, y) => y);
        const pts = pointsOf(contourLevel(grid, 33.3).paths[0]);
        expect(Math.max(pts[0][0], pts[pts.length - 1][0])).toBe(width);
      }
    }
    expect(tried).toBeGreaterThan(0);
  });

  it('tiny segments are kept and a near tie does not break joining', () => {
    const f = (x: number, y: number) => y - 50 + 1e-13 * Math.sin(x);
    const grid = gridFrom(SIZE, SIZE, 10, 10, f);
    const { paths } = contourLevel(grid, 0);
    expect(paths).toHaveLength(1);
    expect(paths[0].closed).toBe(false);
  });

  it('marks every level crossing once even in a 2 by 2 grid of saddles', () => {
    const f = (x: number, y: number) => Math.sin(x * 0.31) * Math.sin(y * 0.31);
    const grid = gridFrom(SIZE, SIZE, 16, 16, f);
    for (const level of [-0.5, 0, 0.2]) {
      const segments = extractSegments(grid, level);
      expect(crackReport(grid, segments, level)).toEqual([]);
    }
  });
});

/** A seeded generator, so that a failure can be replayed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('invariants on random corner values', () => {
  it('no cracks, right orientation, same path count as brute force, no crossings', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const random = rng(seed);
      const n = 6 + Math.floor(random() * 10);
      // Quantised values force many exact ties and ambiguous cells.
      const quantised = seed % 2 === 0;
      const data = new Float64Array((n + 1) * (n + 1)).map(() =>
        quantised ? Math.floor(random() * 5) : random(),
      );
      const grid = { nx: n, ny: n, width: n, height: n, values: data };
      const levels = quantised ? [0, 1, 2, 3] : [0.2, 0.5, 0.8];
      const all = [];
      for (const level of levels) {
        const segments = extractSegments(grid, level);
        expect(crackReport(grid, segments, level), `seed ${seed} level ${level}`).toEqual([]);
        const { paths, degenerate } = contourLevel(grid, level);
        const brute = bruteForceJoinCount(grid, segments, level);
        expect(paths.length + degenerate, `seed ${seed}`).toBe(brute.open + brute.closed);
        for (const path of paths) if (path.closed) expect(polygonArea(path)).not.toBeNaN();
        all.push(...paths);
      }
      // Paths of all levels in one grid must never properly cross.
      expect(bruteCrossings(all), `seed ${seed}`).toBe(0);
    }
  });
});
