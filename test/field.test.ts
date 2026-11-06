import { describe, expect, it } from 'vitest';
import { contourLevel } from '../src/core/contour';
import { fieldFunction, flattenRidge, fractalNoise, gridCoord, sampleField } from '../src/core/field';
import { emptyScene, type Scene } from '../src/core/scene';
import { pointsOf } from './support/oracle';

function scene(partial: Partial<Scene>): Scene {
  return { ...emptyScene(), ...partial };
}

const ridge = (points: { x: number; y: number }[], radius: number, height: number) => ({
  id: 'r',
  name: 'Ridge',
  kind: 'ridge' as const,
  enabled: true,
  points,
  radius,
  height,
});

const peak = (x: number, y: number, radius: number, height: number, id = 'p') => ({
  id,
  name: 'Peak',
  kind: 'peak' as const,
  enabled: true,
  x,
  y,
  radius,
  height,
});

describe('peak kernel', () => {
  it('equals height at the centre and zero at and beyond the reach', () => {
    const s = scene({ sources: [peak(600, 400, 200, 0.8)] });
    const f = fieldFunction(s);
    expect(f(600, 400)).toBe(0.8);
    expect(f(800, 400)).toBe(0);
    expect(f(900, 400)).toBe(0);
  });

  it('its contours are circles at the known radius', () => {
    const R = 300;
    const s = scene({ sources: [peak(600, 400, R, 1)] });
    const grid = sampleField(s, 512, 341);
    for (const level of [0.1, 0.5, 0.9]) {
      const expected = R * Math.sqrt(1 - Math.cbrt(level));
      const { paths } = contourLevel(grid, level);
      expect(paths).toHaveLength(1);
      expect(paths[0].closed).toBe(true);
      for (const [x, y] of pointsOf(paths[0])) {
        expect(Math.abs(Math.hypot(x - 600, y - 400) - expected)).toBeLessThan(0.05);
      }
    }
  });
});

describe('ridge kernel', () => {
  it('a long straight ridge has a crest of 1 and the expected cross section', () => {
    const s = scene({
      sources: [ridge([{ x: -5000, y: 400 }, { x: 5000, y: 400 }], 100, 1)],
    });
    const f = fieldFunction(s);
    expect(f(600, 400)).toBeCloseTo(1, 12);
    expect(f(600, 500)).toBeCloseTo(0, 12);
    // Off the crest the integral scales as m^(7/2).
    const d = 40;
    const m = 1 - (d * d) / (100 * 100);
    expect(f(600, 440)).toBeCloseTo(m ** 3.5, 10);
  });

  it('matches numeric integration of the peak profile along the piece', () => {
    const R = 80;
    const s = scene({ sources: [ridge([{ x: 100, y: 100 }, { x: 400, y: 260 }], R, 1)] });
    const f = fieldFunction(s);
    const numeric = (px: number, py: number) => {
      const steps = 40000;
      const L = Math.hypot(300, 160);
      let sum = 0;
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps;
        const x = 100 + 300 * t;
        const y = 100 + 160 * t;
        const q = ((px - x) ** 2 + (py - y) ** 2) / (R * R);
        if (q < 1) sum += (1 - q) ** 3;
      }
      return ((sum * L) / steps / R) * (35 / 32);
    };
    for (const [x, y] of [[250, 180], [120, 90], [410, 270], [300, 260], [90, 110]]) {
      expect(f(x, y)).toBeCloseTo(numeric(x, y), 5);
    }
  });

  it('splitting a straight ridge in two does not change the field', () => {
    const one = fieldFunction(
      scene({ sources: [ridge([{ x: 100, y: 200 }, { x: 900, y: 500 }], 90, 1)] }),
    );
    const two = fieldFunction(
      scene({
        sources: [
          { ...ridge([{ x: 100, y: 200 }, { x: 500, y: 350 }], 90, 1), id: 'a' },
          { ...ridge([{ x: 500, y: 350 }, { x: 900, y: 500 }], 90, 1), id: 'b' },
        ],
      }),
    );
    for (const [x, y] of [[500, 350], [495, 340], [510, 370], [300, 280]]) {
      expect(one(x, y)).toBeCloseTo(two(x, y), 10);
    }
  });

  it('a zero length ridge adds nothing and stays finite', () => {
    const f = fieldFunction(
      scene({ sources: [ridge([{ x: 300, y: 300 }, { x: 300, y: 300 }], 90, 1)] }),
    );
    expect(f(300, 300)).toBe(0);
  });

  it('the curve passes through its handles', () => {
    const points = [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 200, y: 0 }, { x: 300, y: 80 }];
    const line = flattenRidge(points);
    expect(line.length).toBe((3 * 8 + 1) * 2);
    points.forEach((p, i) => {
      expect(line[i * 16]).toBe(p.x);
      expect(line[i * 16 + 1]).toBe(p.y);
    });
  });
});

describe('noise', () => {
  it('is bounded by 1 for every octave count', () => {
    for (let octaves = 1; octaves <= 4; octaves++) {
      for (let k = 0; k < 20000; k++) {
        const x = (k * 0.137) % 83;
        const y = (k * 0.311) % 61;
        expect(Math.abs(fractalNoise(x - 40, y - 30, 12345, octaves))).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is continuous across lattice lines', () => {
    const e = 1e-7;
    for (const lattice of [-3, 0, 5]) {
      const a = fractalNoise(lattice - e, 0.37, 7, 1);
      const b = fractalNoise(lattice + e, 0.37, 7, 1);
      expect(Math.abs(a - b)).toBeLessThan(1e-5);
    }
  });

  it('changes with the seed and repeats with the same seed', () => {
    expect(fractalNoise(1.3, 2.7, 1, 3)).toBe(fractalNoise(1.3, 2.7, 1, 3));
    expect(fractalNoise(1.3, 2.7, 1, 3)).not.toBe(fractalNoise(1.3, 2.7, 2, 3));
  });
});

describe('sampling', () => {
  it('the grid matches pointwise evaluation bit for bit', () => {
    const s = scene({
      seed: 91,
      noise: { amplitude: 0.2, scale: 170, octaves: 3 },
      sources: [
        peak(310, 200, 260, 0.9, 'a'),
        ridge([{ x: 100, y: 500 }, { x: 500, y: 300 }, { x: 1000, y: 600 }], 180, 0.7),
        peak(800, 650, 140, -0.5, 'b'),
        peak(2000, 2000, 100, 1, 'off domain'),
      ],
    });
    const nx = 96;
    const ny = 64;
    const grid = sampleField(s, nx, ny);
    const f = fieldFunction(s);
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = gridCoord(i, 1200, nx);
        const y = gridCoord(j, 800, ny);
        expect(grid.values[j * (nx + 1) + i]).toBe(f(x, y));
      }
    }
  });

  it('skips disabled sources', () => {
    const on = peak(600, 400, 100, 1);
    const s = scene({ sources: [{ ...on, enabled: false }] });
    expect(sampleField(s, 32, 32).values.every((v) => v === 0)).toBe(true);
  });

  it('the last sample lands exactly on the domain edge', () => {
    expect(gridCoord(7, 1000, 7)).toBe(1000);
    expect(gridCoord(511, 1200, 511)).toBe(1200);
  });
});
