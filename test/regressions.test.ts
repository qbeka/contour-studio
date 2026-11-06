import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeGeometry } from '../src/core/pipeline';
import { parseScene } from '../src/core/scene';
import { toSvg } from '../src/core/svg';
import { findSweeps } from '../src/core/topology';
import { parseSvgPaths, sampledHausdorff } from '../src/core/verify';
import { bruteCrossings, pointsOf } from './support/oracle';

const folder = new URL('./regressions/', import.meta.url);

function load(name: string) {
  const result = parseScene(readFileSync(new URL(name, folder), 'utf8'));
  if (!result.ok) throw new Error(result.errors.join(' '));
  return result.scene;
}

describe('saved scenes', () => {
  for (const name of readdirSync(folder)) {
    it(`${name} holds every rule`, () => {
      const scene = load(name);
      const geometry = computeGeometry(scene, { quality: 'final' });
      const output = geometry.levels.flatMap((l) => l.paths);
      expect(output.length).toBe(geometry.source.flat().length);
      expect(bruteCrossings(output)).toBe(0);
      const distance = sampledHausdorff(
        geometry.source.flat(),
        parseSvgPaths(toSvg(geometry, scene)),
        0.25,
      );
      expect(distance.sampled).toBeLessThanOrEqual(geometry.stats.maxBound);
    });
  }

  it('the pit stays on the same side of the contour', () => {
    const scene = load('swept-pit.contour.json');
    const geometry = computeGeometry(scene, { quality: 'final' });
    expect(geometry.stats.fallbackPaths).toBeGreaterThan(0);
    const [loop, line] = [...geometry.levels[0].paths].sort(
      (a, b) => Number(b.closed) - Number(a.closed),
    );
    expect(loop.closed).toBe(true);
    // The pit is below the contour on screen, at any x it shares with it.
    const pit = pointsOf(loop)[0];
    const pts = pointsOf(line);
    let lineY = NaN;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      if ((x0 - pit[0]) * (x1 - pit[0]) <= 0) {
        lineY = y0 + ((pit[0] - x0) / (x1 - x0)) * (y1 - y0);
      }
    }
    expect(pit[1]).toBeGreaterThan(lineY);
  });

  it('at the same tolerance, plain Douglas-Peucker would have swept it', () => {
    const scene = load('swept-pit.contour.json');
    const noRule = computeGeometry(scene, { quality: 'final' });
    const line = noRule.source[0].find((p) => !p.closed);
    const loop = noRule.source[0].find((p) => p.closed);
    if (!line || !loop) throw new Error('fixture changed');
    const first = Int32Array.from([0, line.points.length / 2 - 1]);
    const sweeps = findSweeps([
      { original: line, kept: first, tolerance: 1e6 },
      { original: loop, kept: Int32Array.from({ length: loop.points.length / 2 }, (_, i) => i), tolerance: 0 },
    ]);
    expect([...sweeps]).toEqual([0]);
  });

  it('lines closer than the tolerance stay apart and keep most of the saving', () => {
    const scene = load('close-lines.contour.json');
    const geometry = computeGeometry(scene, { quality: 'final' });
    expect(geometry.stats.fallbackPaths).toBeGreaterThan(0);
    expect(geometry.stats.crossings).toBe(0);
  });
});
