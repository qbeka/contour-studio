/**
 * Tint regions are built from line direction alone. These tests compare them with
 * the sampled field, which the builder never reads.
 */

import { describe, expect, it } from 'vitest';
import { sampleField } from '../src/core/field';
import { computeGeometry, type Geometry } from '../src/core/pipeline';
import { PRESETS } from '../src/core/presets';
import { emptyScene, gridSize, validateScene, type Scene, type Source } from '../src/core/scene';
import { levelStyle, toReact, toSvg } from '../src/core/svg';
import { levelRegions, regionContains, tintPass } from '../src/core/tint';
import { parseSvgPaths } from '../src/core/verify';

function rng(seed: number) {
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
  const width = 300 + Math.floor(r() * 700);
  const height = 300 + Math.floor(r() * 700);
  const sources: Source[] = [];
  const count = 1 + Math.floor(r() * 7);
  for (let i = 0; i < count; i++) {
    const radius = 40 + r() * 320;
    const h = (r() < 0.4 ? -1 : 1) * (0.2 + r());
    if (r() < 0.7) {
      sources.push({ id: `p${i}`, name: `p${i}`, kind: 'peak', enabled: true, x: r() * width, y: r() * height, radius, height: h });
    } else {
      const n = 2 + Math.floor(r() * 3);
      sources.push({
        id: `r${i}`, name: `r${i}`, kind: 'ridge', enabled: true, radius, height: h,
        points: Array.from({ length: n }, () => ({ x: r() * width, y: r() * height })),
      });
    }
  }
  const inset = r() < 0.5 ? 0 : 10 + Math.floor(r() * 40);
  return {
    ...base,
    seed: Math.floor(r() * 1e9),
    domain: { width, height },
    clip: { x: inset, y: inset, width: width - inset * 2, height: height - inset * 2 },
    sources,
    noise: { amplitude: r() * 0.1, scale: 60 + r() * 200, octaves: 1 + Math.floor(r() * 3) },
    levels: { base: -1 + r(), spacing: 0.05 + r() * 0.2, count: 3 + Math.floor(r() * 9) },
  };
}

/**
 * Counts grid corners strictly inside the frame that the region puts on the wrong
 * side of its level. A draft is the contour of the grid itself, so there should be
 * none at all.
 */
function wrongCorners(scene: Scene, geometry: Geometry): { wrong: number; checked: number } {
  const { nx, ny } = gridSize(scene.domain, geometry.resolution);
  const grid = sampleField(scene, nx, ny);
  const { rect } = geometry;
  const regions = levelRegions(geometry);
  let wrong = 0;
  let checked = 0;
  geometry.levels.forEach((level, index) => {
    const region = regions[index];
    if (!region) return;
    for (let j = 0; j <= ny; j++) {
      const y = (j * scene.domain.height) / ny;
      if (y <= rect.y || y >= rect.y + rect.height) continue;
      for (let i = 0; i <= nx; i++) {
        const x = (i * scene.domain.width) / nx;
        if (x <= rect.x || x >= rect.x + rect.width) continue;
        const value = grid.values[j * (nx + 1) + i];
        // A corner exactly on its level sits on the line.
        if (value === level.value) continue;
        checked++;
        if (regionContains(region, x, y) !== value > level.value) wrong++;
      }
    }
  });
  return { wrong, checked };
}

describe('tint regions', () => {
  it('match the field at every grid corner, for each starter', () => {
    for (const { scene } of PRESETS) {
      const geometry = computeGeometry(scene, { quality: 'draft', resolution: 96 });
      const { wrong, checked } = wrongCorners(scene, geometry);
      expect(checked).toBeGreaterThan(1000);
      expect(wrong).toBe(0);
      expect(levelRegions(geometry).every((region) => region !== null)).toBe(true);
    }
  });

  it('match the field on 200 random scenes, and are never left out', () => {
    let missing = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const scene = randomScene(seed);
      const geometry = computeGeometry(scene, { quality: 'draft', resolution: 48 });
      const { wrong } = wrongCorners(scene, geometry);
      expect(wrong, `seed ${seed}`).toBe(0);
      const regions = levelRegions(geometry);
      const anyLines = geometry.levels.some((level) => level.paths.length > 0);
      if (anyLines) missing += regions.filter((region) => region === null).length;
    }
    expect(missing).toBe(0);
  });

  it('stay within the export tolerance of the field after simplifying', () => {
    for (const { scene } of PRESETS) {
      const geometry = computeGeometry(scene, { quality: 'final', resolution: 128 });
      const { wrong, checked } = wrongCorners(scene, geometry);
      // Simplifying may move a line across a corner that sat next to it.
      expect(wrong / checked).toBeLessThan(0.002);
    }
  });

  it('regions nest: ground above a level is above every lower one', () => {
    const scene = PRESETS[1].scene;
    const geometry = computeGeometry(scene, { quality: 'draft', resolution: 64 });
    const regions = levelRegions(geometry);
    const r = rng(9);
    for (let n = 0; n < 400; n++) {
      const x = geometry.rect.x + r() * geometry.rect.width;
      const y = geometry.rect.y + r() * geometry.rect.height;
      let wasInside = true;
      for (const region of regions) {
        const inside = region !== null && regionContains(region, x, y);
        expect(inside && !wasInside).toBe(false);
        wasInside = inside;
      }
    }
  });
});

describe('print styling in the file', () => {
  const plain = PRESETS[0].scene;
  const geometry = computeGeometry(plain, { quality: 'final', resolution: 128 });

  it('a scene with no tint and no taper prints exactly as before', () => {
    const svg = toSvg(geometry, plain);
    expect(svg).not.toContain('fill-rule');
    expect(svg.match(/<path /g)?.length).toBe(geometry.stats.outputPaths);
  });

  it('tint adds one group of filled passes and leaves every line as it was', () => {
    const tinted: Scene = { ...plain, style: { ...plain.style, tint: 0.6, tintColor: '#5d7f62' } };
    const before = toSvg(geometry, plain);
    const after = toSvg(geometry, tinted);
    expect(after).toContain('fill="#5d7f62"');
    expect(after).toContain('fill-rule="evenodd"');
    const lines = (svg: string) => svg.split('\n').filter((line) => line.startsWith('<path d=') || line.startsWith('<g stroke'));
    const group = after.slice(after.indexOf('<g fill='), after.indexOf('</g>') + 4);
    expect(lines(after.replace(group, ''))).toEqual(lines(before));
    expect(after.length).toBeGreaterThan(before.length);
  });

  it('tint on the low ground fills the other side', () => {
    const high: Scene = { ...plain, style: { ...plain.style, tint: 0.5 } };
    const low: Scene = { ...plain, style: { ...plain.style, tint: -0.5 } };
    expect(toSvg(geometry, low)).not.toBe(toSvg(geometry, high));
    expect(parseSvgPaths(toSvg(geometry, low)).length).toBeGreaterThan(geometry.stats.outputPaths);
  });

  it('the passes together reach the asked depth', () => {
    for (const levels of [1, 8, 24]) {
      const pass = tintPass(1, levels);
      expect(1 - (1 - pass) ** levels).toBeCloseTo(0.72, 10);
    }
    expect(tintPass(0, 12)).toBe(0);
  });

  it('taper thins the low lines and leaves the top one alone', () => {
    const tapered: Scene = { ...plain, style: { ...plain.style, taper: 0.5 } };
    const top = plain.levels.count - 1;
    expect(levelStyle(tapered, top).width).toBe(plain.style.strokeWidth);
    expect(levelStyle(tapered, 0).width).toBeCloseTo(plain.style.strokeWidth * 0.5, 12);
    expect(levelStyle(plain, 0).width).toBe(plain.style.strokeWidth);
  });

  it('the React component carries the same tint', () => {
    const tinted: Scene = { ...plain, style: { ...plain.style, tint: 0.6 } };
    const tsx = toReact(geometry, tinted);
    expect(tsx).toContain('fillRule="evenodd"');
    expect(tsx).toContain('fillOpacity=');
  });

  it('a file from before these options opens as plain lines', () => {
    const { taper, tint, tintColor, ...oldStyle } = plain.style;
    void taper; void tint; void tintColor;
    const result = validateScene({ ...plain, style: oldStyle });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scene.style.tint).toBe(0);
      expect(result.scene.style.taper).toBe(0);
    }
  });
});
