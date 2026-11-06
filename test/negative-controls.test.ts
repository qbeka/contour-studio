/**
 * Seeded failures. A check that cannot fail proves nothing, so each harness here
 * is handed a deliberately broken input and must report it. If one of these goes
 * undetected, results from that harness are not valid.
 */

import { describe, expect, it } from 'vitest';
import { extractSegments, type Polyline } from '../src/core/contour';
import { sampleField } from '../src/core/field';
import { computeGeometry } from '../src/core/pipeline';
import { PRESETS } from '../src/core/presets';
import { toSvg } from '../src/core/svg';
import { findContacts, loopSurvives } from '../src/core/topology';
import { parseSvgPaths, sampledHausdorff } from '../src/core/verify';
import { bruteContacts, crackReport, gridFrom, orientationReport } from './support/oracle';

const preset = PRESETS[2].scene;
const grid = sampleField(preset, 128, 85);
const LEVEL = 0.05;

describe('crack detector', () => {
  const segments = extractSegments(grid, LEVEL);

  it('passes the real output', () => {
    expect(crackReport(grid, segments, LEVEL)).toEqual([]);
  });

  it('catches one missing segment', () => {
    const broken = { ...segments, count: segments.count - 1 };
    expect(crackReport(grid, broken, LEVEL).length).toBeGreaterThan(0);
  });

  it('catches one segment moved to a wrong edge', () => {
    const to = segments.to.slice();
    to[10] = 2;
    expect(crackReport(grid, { ...segments, to }, LEVEL).length).toBeGreaterThan(0);
  });
});

describe('orientation check', () => {
  const f = (x: number, y: number) => Math.hypot(x - 50, y - 50);
  const small = gridFrom(100, 100, 32, 32, f);
  const segments = extractSegments(small, 30);

  it('passes the real output', () => {
    expect(orientationReport(small, segments, 30, f)).toEqual([]);
  });

  it('catches one reversed segment', () => {
    const from = segments.from.slice();
    const to = segments.to.slice();
    [from[3], to[3]] = [to[3], from[3]];
    expect(orientationReport(small, { ...segments, from, to }, 30, f).length).toBeGreaterThan(0);
  });
});

describe('sampled distance', () => {
  const geometry = computeGeometry(preset, { quality: 'final', resolution: 128 });
  const svg = toSvg(geometry, preset);
  const parsed = parseSvgPaths(svg);

  it('finds a single displaced vertex at about its true size', () => {
    const moved = parsed.map((p) => ({ ...p, points: p.points.slice() }));
    const shift = 3;
    moved[5].points[3] += shift;
    const clean = sampledHausdorff(geometry.source.flat(), parsed, 0.25);
    const distance = sampledHausdorff(geometry.source.flat(), moved, 0.25);
    expect(distance.sampled).toBeGreaterThan(clean.sampled + 0.5);
    expect(distance.sampled).toBeLessThanOrEqual(shift + clean.sampled + 0.25);
  });

  it('finds a whole missing path', () => {
    const missing = parsed.filter((_, i) => i !== 8);
    const distance = sampledHausdorff(geometry.source.flat(), missing, 0.25);
    expect(distance.sampled).toBeGreaterThan(5);
  });

  it('reports an emptied file as infinite', () => {
    expect(sampledHausdorff(geometry.source.flat(), [], 0.25).sampled).toBe(Infinity);
  });

  it('stays bounded on a wildly wrong file and widens its spacing honestly', () => {
    const a: Polyline = { points: new Float64Array([0, 0, 100, 0]), closed: false };
    const far: Polyline = { points: new Float64Array([0, 1e9, 1e9, 1e9]), closed: false };
    const distance = sampledHausdorff([a], [far], 0.25);
    expect(distance.sampled).toBeGreaterThan(1e8);
    expect(distance.spacing).toBeGreaterThan(0.25);
    expect(distance.samples).toBeLessThanOrEqual(4_000_010);
  });

  it('a sample budget widens the spacing and keeps the guard true', () => {
    const a: Polyline = { points: new Float64Array([0, 0, 1000, 0]), closed: false };
    const b: Polyline = { points: new Float64Array([0, 3, 1000, 3]), closed: false };
    const distance = sampledHausdorff([a], [b], 0.25, 100);
    expect(distance.spacing).toBe(10);
    expect(distance.sampled).toBe(3);
    expect(distance.guard).toBe(8);
  });

  it('the guard covers a maximum that the samples miss', () => {
    // The farthest point of a is at x = 50, between two short pieces of b. At this
    // spacing the samples land at thirds, so the sampled value falls short of 49.
    const a: Polyline = { points: new Float64Array([0, 0, 100, 0]), closed: false };
    const b: Polyline[] = [
      { points: new Float64Array([0, 0, 1, 0]), closed: false },
      { points: new Float64Array([99, 0, 100, 0]), closed: false },
    ];
    const distance = sampledHausdorff([a], b, 40);
    expect(distance.sampled).toBeLessThan(49);
    expect(distance.guard).toBeGreaterThanOrEqual(49);
  });

  it('reaches the last point of an open path', () => {
    // Everything matches except the far end, which only the end sample can see.
    const a: Polyline = { points: new Float64Array([0, 0, 10, 0, 10, 8]), closed: false };
    const b: Polyline = { points: new Float64Array([0, 0, 10, 0]), closed: false };
    expect(sampledHausdorff([a], [b], 100).sampled).toBe(8);
  });
});

describe('crossing check', () => {
  it('catches a crossing injected in real output', () => {
    const geometry = computeGeometry(preset, { quality: 'final', resolution: 128 });
    const paths = geometry.levels.flatMap((l) => l.paths);
    expect(findContacts(paths).count).toBe(0);
    const longest = paths.reduce((a, b) => (b.points.length > a.points.length ? b : a));
    const broken = paths.map((p) => (p === longest ? { ...p, points: p.points.slice() } : p));
    const target = broken[paths.indexOf(longest)];
    // Pull one vertex far across its neighbours.
    target.points[40] += 90;
    target.points[41] += 90;
    expect(findContacts(broken).count).toBeGreaterThan(0);
    expect(bruteContacts(broken)).toBeGreaterThan(0);
  });
});

describe('loop check', () => {
  it('catches a collapsed and a flipped loop', () => {
    const loop: Polyline = { points: new Float64Array([0, 0, 10, 0, 10, 10, 0, 10]), closed: true };
    expect(loopSurvives(loop, { points: new Float64Array([0, 0, 10, 0]), closed: true })).toBe(false);
    const flipped = new Float64Array([0, 10, 10, 10, 10, 0, 0, 0]);
    expect(loopSurvives(loop, { points: flipped, closed: true })).toBe(false);
    // A loop with no area has no sign to compare, so the count must catch this.
    const flat: Polyline = { points: new Float64Array([0, 0, 5, 0, 10, 0]), closed: true };
    expect(loopSurvives(flat, { points: new Float64Array([0, 0, 10, 0]), closed: true })).toBe(false);
  });
});

describe('SVG parser', () => {
  it('rejects data it cannot read, so a bad file cannot pass as empty', () => {
    const geometry = computeGeometry(preset, { quality: 'final', resolution: 64 });
    const svg = toSvg(geometry, preset).replace(/ l/, ' q');
    expect(() => parseSvgPaths(svg.replace('M', 'Q'))).toThrow();
  });
});
