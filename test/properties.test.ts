/**
 * Random scenes, seeded so that a failure can be replayed. Checks here go through
 * the public pipeline and use the independent oracle where one exists.
 */

import { describe, expect, it } from 'vitest';
import { computeGeometry } from '../src/core/pipeline';
import { emptyScene, parseScene, serializeScene, type Scene, type Source } from '../src/core/scene';
import { toSvg } from '../src/core/svg';
import { signedArea } from '../src/core/topology';
import { fieldFunction } from '../src/core/field';
import { parseSvgPaths, sampledHausdorff } from '../src/core/verify';
import { bruteContacts, nesting } from './support/oracle';

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomScene(seed: number): Scene {
  const r = rng(seed);
  const base = emptyScene();
  const width = 200 + Math.floor(r() * 800);
  const height = 200 + Math.floor(r() * 800);
  const count = 1 + Math.floor(r() * 8);
  const sources: Source[] = [];
  for (let i = 0; i < count; i++) {
    const radius = 30 + r() * 300;
    const height_ = (r() < 0.5 ? -1 : 1) * (0.2 + r());
    if (r() < 0.7) {
      sources.push({
        id: `p${i}`, name: `p${i}`, kind: 'peak', enabled: true,
        x: r() * width, y: r() * height, radius, height: height_,
      });
    } else {
      const n = 2 + Math.floor(r() * 3);
      sources.push({
        id: `r${i}`, name: `r${i}`, kind: 'ridge', enabled: true, radius, height: height_,
        points: Array.from({ length: n }, () => ({ x: r() * width, y: r() * height })),
      });
    }
  }
  return {
    ...base,
    seed: Math.floor(r() * 1e9),
    domain: { width, height },
    clip: {
      x: Math.floor(r() * 40), y: Math.floor(r() * 40),
      width: width - 60, height: height - 60,
    },
    sources,
    noise: { amplitude: r() * 0.15, scale: 40 + r() * 200, octaves: 1 + Math.floor(r() * 3) },
    levels: { base: -1 + r(), spacing: 0.05 + r() * 0.2, count: 3 + Math.floor(r() * 8) },
    export: {
      ...base.export,
      resolution: 64 + Math.floor(r() * 96),
      tolerance: [0, 0.1, 0.5, 2, 6][Math.floor(r() * 5)],
      decimals: Math.floor(r() * 3),
    },
  };
}

/** Lines packed tighter than the rounding lattice. This is where rounding bites. */
function crowdedScene(seed: number): Scene {
  const r = rng(seed);
  const base = emptyScene();
  const side = 12 + Math.floor(r() * 40);
  return {
    ...base,
    domain: { width: side, height: side },
    clip: { x: 0, y: 0, width: side, height: side },
    sources: [
      {
        id: 'p', name: 'p', kind: 'peak', enabled: true,
        x: side * (0.3 + r() * 0.4), y: side * (0.3 + r() * 0.4),
        radius: 2 + r() * side * 0.4, height: (r() < 0.5 ? -1 : 1) * (1 + r() * 3),
      },
    ],
    noise: { amplitude: r() * 0.3, scale: 6 + r() * 10, octaves: 2 },
    levels: { base: -2 + r(), spacing: 0.03 + r() * 0.2, count: 6 + Math.floor(r() * 12) },
    export: {
      ...base.export,
      resolution: 24 + Math.floor(r() * 64),
      tolerance: [0, 0.02, 0.2][Math.floor(r() * 3)],
      decimals: Math.floor(r() * 3),
    },
  };
}

describe('crowded scenes', () => {
  it('rounding never makes a contact or moves a loop to the other side', () => {
    let tightened = 0;
    let nested = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const scene = crowdedScene(seed);
      const label = `seed ${seed}`;
      const geometry = computeGeometry(scene, { quality: 'final' });
      const output = geometry.levels.flatMap((l) => l.paths);
      const source = geometry.source.flat();
      expect(geometry.stats.crossings, label).toBe(0);
      expect(bruteContacts(output), label).toBe(0);
      expect(output.length + geometry.stats.degeneratePaths, label).toBeGreaterThanOrEqual(source.length);
      if (output.length === source.length) {
        expect(nesting(output), label).toEqual(nesting(source));
        nested += nesting(source).flat().filter(Boolean).length;
      }
      tightened += geometry.stats.fallbackPaths;
    }
    // Guards against scenes that stopped being hard.
    expect(tightened).toBeGreaterThan(100);
    expect(nested).toBeGreaterThan(100);
  });
});

describe('random scenes', () => {
  it('every rule holds in every scene', () => {
    let fallbacks = 0;
    let closed = 0;
    let paths = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const scene = randomScene(seed);
      const label = `seed ${seed}`;
      expect(parseScene(serializeScene(scene)).ok, label).toBe(true);
      const geometry = computeGeometry(scene, { quality: 'final' });
      const output = geometry.levels.flatMap((l) => l.paths);
      const source = geometry.source.flat();

      expect(output.length, label).toBe(source.length);
      expect(geometry.stats.crossings, label).toBe(0);
      expect(bruteContacts(output), label).toBe(0);

      output.forEach((path, i) => {
        if (path.closed) {
          closed++;
          expect(path.points.length, label).toBeGreaterThanOrEqual(6);
          expect(Math.sign(signedArea(path.points)), label).toBe(
            Math.sign(signedArea(source[i].points)),
          );
        }
        const distance = sampledHausdorff([source[i]], [path], 0.4);
        expect(distance.sampled, `${label} path ${i}`).toBeLessThanOrEqual(path.bound + 1e-9);
      });

      // Each output vertex stays inside the output rectangle, up to rounding.
      const { rect } = geometry;
      for (const path of output) {
        const slack = 0.8 * 10 ** -path.decimals;
        for (let k = 0; k < path.points.length; k += 2) {
          expect(path.points[k], label).toBeGreaterThanOrEqual(rect.x - slack);
          expect(path.points[k], label).toBeLessThanOrEqual(rect.x + rect.width + slack);
          expect(path.points[k + 1], label).toBeGreaterThanOrEqual(rect.y - slack);
          expect(path.points[k + 1], label).toBeLessThanOrEqual(rect.y + rect.height + slack);
        }
      }

      // The file carries the same paths.
      expect(parseSvgPaths(toSvg(geometry, scene)).length, label).toBe(output.length);

      paths += output.length;
      fallbacks += geometry.stats.fallbackPaths;
    }
    // Guards against a generator that stopped producing interesting cases.
    expect(paths).toBeGreaterThan(1000);
    expect(closed).toBeGreaterThan(100);
    expect(fallbacks).toBeGreaterThan(0);
  });

  it('extracted vertices sit on the level of the interpolated field', () => {
    for (let seed = 200; seed < 220; seed++) {
      const scene = randomScene(seed);
      const geometry = computeGeometry(scene, { quality: 'final' });
      const f = fieldFunction(scene);
      const cell = Math.max(scene.domain.width / geometry.nx, scene.domain.height / geometry.ny);
      geometry.source.forEach((paths, level) => {
        const value = geometry.levels[level].value;
        for (const { points } of paths) {
          for (let k = 0; k < points.length; k += 16) {
            // Within one cell of a true crossing: the field must change sign
            // somewhere in a small box, or the path is in the wrong place.
            const x = points[k];
            const y = points[k + 1];
            const samples = [
              f(x, y), f(x + cell, y), f(x - cell, y), f(x, y + cell), f(x, y - cell),
              f(x + cell, y + cell), f(x - cell, y - cell), f(x + cell, y - cell), f(x - cell, y + cell),
            ];
            const low = Math.min(...samples);
            const high = Math.max(...samples);
            const slack = 1e-3;
            expect(low - slack, `seed ${seed}`).toBeLessThanOrEqual(value);
            expect(high + slack, `seed ${seed}`).toBeGreaterThanOrEqual(value);
          }
        }
      });
    }
  });

  it('is fully deterministic', () => {
    const scene = randomScene(7);
    const a = toSvg(computeGeometry(scene, { quality: 'final' }), scene);
    const b = toSvg(computeGeometry(scene, { quality: 'final' }), scene);
    expect(a).toBe(b);
  });

  it('coordinates of a known scene stay byte stable', async () => {
    const { createHash } = await import('node:crypto');
    const scene = randomScene(3);
    const svg = toSvg(computeGeometry(scene, { quality: 'final' }), scene);
    // If this changes on purpose, the scene format version needs a decision too.
    expect(createHash('sha256').update(svg).digest('hex').slice(0, 16)).toMatchSnapshot();
  });
});
