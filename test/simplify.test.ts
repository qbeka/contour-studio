import { describe, expect, it } from 'vitest';
import { contourLevel, type Polyline } from '../src/core/contour';
import { attemptSettings, computeGeometry, LAST_ATTEMPT, RETAINED_DECIMALS } from '../src/core/pipeline';
import { fieldFunction } from '../src/core/field';
import { emptyScene, type Scene } from '../src/core/scene';
import { roundingBound, simplifyIndices, snapPath } from '../src/core/simplify';
import { findContacts, findSweeps, loopSurvives, signedArea } from '../src/core/topology';
import { sampledHausdorff } from '../src/core/verify';
import { bruteContacts, gridFrom, polygonArea } from './support/oracle';

const line = (...v: number[]): Polyline => ({ points: new Float64Array(v), closed: false });
const loop = (...v: number[]): Polyline => ({ points: new Float64Array(v), closed: true });

function circle(cx: number, cy: number, r: number, n: number): Polyline {
  const points = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    points[i * 2] = cx + r * Math.cos((i / n) * Math.PI * 2);
    points[i * 2 + 1] = cy + r * Math.sin((i / n) * Math.PI * 2);
  }
  return { points, closed: true };
}

const take = (path: Polyline, kept: Int32Array): Polyline => snapPath(path, kept, 9);

describe('snapping', () => {
  it('removes a closing duplicate made by rounding', () => {
    const out = snapPath(loop(0, 0, 5, 0, 5, 5, 0.1, 0.1), Int32Array.from([0, 1, 2, 3]), 0);
    expect(out.points.length).toBe(6);
  });
});

describe('Douglas-Peucker', () => {
  it('reduces a straight run to its ends', () => {
    expect([...simplifyIndices(line(0, 0, 1, 0, 2, 0, 3, 0), 0.01)]).toEqual([0, 3]);
  });

  it('keeps a spike larger than the tolerance', () => {
    expect([...simplifyIndices(line(0, 0, 5, 3, 10, 0), 1)]).toEqual([0, 1, 2]);
  });

  it('uses distance to the segment, so a point past the end still counts', () => {
    // On the infinite line through the ends, but far beyond them.
    expect([...simplifyIndices(line(0, 0, 20, 0, 10, 0), 1)]).toContain(1);
  });

  it('tolerance zero keeps everything', () => {
    expect(simplifyIndices(line(0, 0, 1, 0, 2, 0), 0)).toHaveLength(3);
  });

  it('stays within the tolerance, both ways, on a measured check', () => {
    const shape = circle(100, 100, 80, 900);
    for (const tolerance of [0.05, 0.25, 1, 4]) {
      const simplified = take(shape, simplifyIndices(shape, tolerance));
      const distance = sampledHausdorff([shape], [simplified], 0.05);
      expect(distance.sampled).toBeLessThanOrEqual(tolerance + 1e-6);
    }
  });

  it('keeps a loop smaller than the tolerance as a triangle', () => {
    const tiny = circle(50, 50, 0.3, 24);
    const kept = simplifyIndices(tiny, 5);
    expect(kept.length).toBe(3);
    const out = take(tiny, kept);
    expect(loopSurvives(tiny, out)).toBe(true);
    expect(Math.abs(polygonArea(out))).toBeGreaterThan(0);
  });
});

describe('rounding', () => {
  it('moves each vertex no further than the declared bound', () => {
    const path = line(0.123456, 7.654321, 3.141593, 2.718282);
    for (const decimals of [0, 1, 2, 3]) {
      const out = snapPath(path, Int32Array.from([0, 1]), decimals);
      for (let k = 0; k < 4; k += 2) {
        const d = Math.hypot(out.points[k] - path.points[k], out.points[k + 1] - path.points[k + 1]);
        expect(d).toBeLessThanOrEqual(roundingBound(decimals) + 1e-12);
      }
    }
  });

  it('removes repeats created by rounding', () => {
    const out = snapPath(line(0, 0, 0.1, 0.1, 5, 5), Int32Array.from([0, 1, 2]), 0);
    expect(out.points.length).toBe(4);
  });
});

describe('topology checks', () => {
  it('finds a proper crossing and blames both paths', () => {
    const { blamed, count } = findContacts([line(0, 0, 10, 10), line(0, 10, 10, 0)]);
    expect(count).toBe(1);
    expect([...blamed].sort()).toEqual([0, 1]);
  });

  it('finds a crossing that passes exactly through a vertex', () => {
    expect(findContacts([line(0, 0, 2, 2), line(0, 2, 1, 1, 2, 0)]).count).toBeGreaterThan(0);
  });

  it('finds a touch, and two paths sharing a vertex', () => {
    expect(findContacts([line(0, 0, 10, 0), line(5, 0, 5, 5)]).count).toBe(1);
    expect(findContacts([line(0, 0, 5, 5, 10, 0), line(0, 10, 5, 5, 10, 10)]).count).toBeGreaterThan(0);
  });

  it('finds collinear overlap', () => {
    expect(findContacts([line(0, 0, 10, 0), line(5, 0, 15, 0)]).count).toBe(1);
  });

  it('finds paths closer than their margins, and passes those further apart', () => {
    const paths = [line(0, 0, 100, 0), line(0, 1, 100, 1)];
    expect(findContacts(paths).count).toBe(0);
    expect(findContacts(paths, Float64Array.from([0.6, 0.6])).count).toBeGreaterThan(0);
    expect(findContacts(paths, Float64Array.from([0.4, 0.4])).count).toBe(0);
  });

  it('a margin reaches past the bucket a segment sits in', () => {
    // Many short pieces make buckets much smaller than the margin.
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i <= 400; i++) {
      a.push(i * 0.25, 0);
      b.push(i * 0.25, 5);
    }
    const paths = [line(...a), line(...b)];
    expect(findContacts(paths, Float64Array.from([3, 3])).count).toBeGreaterThan(0);
    expect(findContacts(paths, Float64Array.from([2, 2])).count).toBe(0);
  });

  it('finds a self crossing but ignores neighbouring segments', () => {
    expect(findContacts([line(0, 0, 10, 10, 10, 0, 0, 10)]).count).toBe(1);
    expect(findContacts([loop(0, 0, 10, 0, 10, 10, 0, 10)]).count).toBe(0);
  });

  it('checks the closing segment of a loop', () => {
    // Only the closing segment, from (0, 10) back to (0, 0), meets the other path.
    expect(findContacts([loop(0, 0, 10, 0, 10, 10, 0, 10), line(-5, 5, 5, 5)]).count).toBe(1);
  });

  it('agrees with brute force on random segments', () => {
    let seed = 7;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let round = 0; round < 30; round++) {
      const paths: Polyline[] = [];
      for (let p = 0; p < 6; p++) {
        const v: number[] = [];
        // A small lattice makes shared vertices and touches common.
        for (let k = 0; k < 8; k++) v.push(Math.floor(random() * 12), Math.floor(random() * 12));
        const clean = snapPath(line(...v), Int32Array.from({ length: 8 }, (_, i) => i), 0);
        paths.push(clean);
      }
      expect(findContacts(paths).count).toBe(bruteContacts(paths));
    }
  });

  it('measures the area of a tiny loop far from the origin', () => {
    const s = 1e-5;
    const area = signedArea(new Float64Array([8191.3, 8191.7, 8191.3 + s, 8191.7, 8191.3, 8191.7 + s]));
    expect(area).toBeCloseTo((s * s) / 2, 11);
    expect(area).toBeGreaterThan(0);
  });

  it('finds a chord that sweeps over a small loop with no crossing', () => {
    // A shallow arc and a small loop in the gap between the arc and its chord.
    const arc = line(0, 0, 25, 1.9, 50, 2.4, 75, 1.9, 100, 0);
    const smallLoop = circle(50, 1, 0.3, 8);
    const kept = simplifyIndices(arc, 3);
    expect([...kept]).toEqual([0, 4]);
    const simplified = take(arc, kept);
    // Nothing crosses. This is the failure rule 3 exists for.
    expect(findContacts([simplified, smallLoop]).count).toBe(0);
    const sweeps = findSweeps([
      { original: arc, kept, tolerance: 3 },
      { original: smallLoop, kept: Int32Array.from({ length: 8 }, (_, i) => i), tolerance: 3 },
    ]);
    expect([...sweeps]).toEqual([0]);
  });

  it('counts the chord as an edge of the swept region', () => {
    // The arc bulges left, so a ray to the right leaves through the chord alone.
    const arc = line(10, 0, 0, 50, 10, 100);
    const witness = circle(5, 50, 0.2, 6);
    const sweeps = findSweeps([
      { original: arc, kept: Int32Array.from([0, 2]), tolerance: 20 },
      { original: witness, kept: Int32Array.from({ length: 6 }, (_, i) => i), tolerance: 20 },
    ]);
    expect([...sweeps]).toEqual([0]);
  });

  it('checks the closing span of a loop', () => {
    // Vertices 3 and 4 sit on the closing span, which wraps back to vertex 0. Its
    // chord runs corner to corner, and the witness lies between chord and run.
    const ring = loop(0, 0, 100, 0, 100, 100, 50, 90, 0, 100);
    const witness = circle(50, 70, 0.2, 6);
    const sweeps = findSweeps([
      { original: ring, kept: Int32Array.from([0, 1, 2]), tolerance: 20 },
      { original: witness, kept: Int32Array.from({ length: 6 }, (_, i) => i), tolerance: 20 },
    ]);
    expect([...sweeps]).toEqual([0]);
  });

  it('does not blame a chord for a loop outside its swept region', () => {
    const arc = line(0, 0, 25, 1.9, 50, 2.4, 75, 1.9, 100, 0);
    const smallLoop = circle(50, 2.5, 0.05, 8);
    const kept = simplifyIndices(arc, 3);
    const sweeps = findSweeps([
      { original: arc, kept, tolerance: 3 },
      { original: smallLoop, kept: Int32Array.from({ length: 8 }, (_, i) => i), tolerance: 3 },
    ]);
    expect(sweeps.size).toBe(0);
  });
});

describe('retry ladder', () => {
  it('tightens by a factor of 4 and adds a decimal at each step', () => {
    expect(attemptSettings(0, 8, 2)).toEqual({ tolerance: 8, decimals: 2 });
    expect(attemptSettings(1, 8, 2)).toEqual({ tolerance: 2, decimals: 3 });
    expect(attemptSettings(2, 8, 2)).toEqual({ tolerance: 0.5, decimals: 4 });
  });

  it('ends at full detail on the finest lattice', () => {
    expect(attemptSettings(LAST_ATTEMPT, 8, 2)).toEqual({ tolerance: 0, decimals: RETAINED_DECIMALS });
  });

  it('never rounds more finely than the retained lattice', () => {
    expect(attemptSettings(3, 8, 4).decimals).toBe(RETAINED_DECIMALS);
  });
});

describe('pipeline', () => {
  const peak = (id: string, x: number, y: number, radius: number, height: number) => ({
    id,
    name: id,
    kind: 'peak' as const,
    enabled: true,
    x,
    y,
    radius,
    height,
  });

  function scene(partial: Partial<Scene>, exportPartial: Partial<Scene['export']> = {}): Scene {
    const base = emptyScene();
    return { ...base, ...partial, export: { ...base.export, ...exportPartial } };
  }

  it('keeps every path, closes every loop and never crosses at a coarse tolerance', () => {
    const s = scene(
      {
        seed: 4,
        sources: [peak('a', 400, 300, 380, 1), peak('b', 760, 480, 340, 0.9)],
        noise: { amplitude: 0.12, scale: 90, octaves: 3 },
        levels: { base: 0.05, spacing: 0.07, count: 12 },
      },
      { tolerance: 4, decimals: 0, resolution: 256 },
    );
    const geometry = computeGeometry(s, { quality: 'final' });
    const flat = geometry.levels.flatMap((l) => l.paths);
    expect(flat.length).toBe(geometry.source.flat().length);
    expect(geometry.stats.crossings).toBe(0);
    expect(findContacts(flat).count).toBe(0);
    flat.forEach((path, i) => {
      expect(loopSurvives(geometry.source.flat()[i], path)).toBe(true);
    });
  });

  it('the declared bound holds per path against the extracted path', () => {
    const s = scene(
      {
        seed: 12,
        sources: [peak('a', 500, 360, 420, 1)],
        noise: { amplitude: 0.08, scale: 120, octaves: 2 },
        levels: { base: 0.1, spacing: 0.1, count: 8 },
      },
      { tolerance: 0.5, decimals: 2, resolution: 256 },
    );
    const geometry = computeGeometry(s, { quality: 'final' });
    const sources = geometry.source.flat();
    geometry.levels
      .flatMap((l) => l.paths)
      .forEach((path, i) => {
        const distance = sampledHausdorff([sources[i]], [path], 0.1);
        expect(distance.sampled).toBeLessThanOrEqual(path.bound + 1e-9);
      });
  });

  it('two strands meeting at a tied corner are not reported as a crossing', () => {
    const s = scene(
      { sources: [peak('a', 300, 400, 420, 1), peak('b', 900, 400, 420, 1)] },
      { resolution: 510 },
    );
    // The saddle between the peaks lands on a grid corner: 510 by 340 cells.
    const saddle = fieldFunction(s)(600, 400);
    const tied = { ...s, levels: { base: saddle, spacing: 1, count: 1 } };
    const geometry = computeGeometry(tied, { quality: 'final' });
    const output = geometry.levels.flatMap((l) => l.paths);
    expect(bruteContacts(output)).toBeGreaterThan(0);
    expect(bruteContacts(geometry.source.flat())).toBeGreaterThan(0);
    expect(geometry.stats.retainedPaths).toBeGreaterThan(0);
    expect(geometry.stats.crossings).toBe(0);
  });

  it('stops with a clear message past the vertex limit', () => {
    const s = scene({ sources: [peak('a', 600, 400, 300, 1)] }, { resolution: 256 });
    expect(() => computeGeometry(s, { quality: 'final', maxVertices: 100 })).toThrow(/too many lines/);
    expect(computeGeometry(s, { quality: 'final' }).stats.outputPaths).toBeGreaterThan(0);
  });

  it('a level with no contours gives empty output, not an error', () => {
    const s = scene({ sources: [], levels: { base: 5, spacing: 1, count: 3 } });
    const geometry = computeGeometry(s, { quality: 'final' });
    expect(geometry.stats.outputPaths).toBe(0);
  });

  it('a duplicate of the same geometry is a fixed point of contour extraction', () => {
    const grid = gridFrom(100, 100, 32, 32, (x, y) => Math.hypot(x - 50, y - 50));
    const a = contourLevel(grid, 20);
    const b = contourLevel(grid, 20);
    expect(a).toEqual(b);
  });
});
