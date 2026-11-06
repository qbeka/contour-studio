import { describe, expect, it } from 'vitest';
import { computeGeometry, type OutputPath } from '../src/core/pipeline';
import { emptyScene, type Scene } from '../src/core/scene';
import { componentName, formatNumber, pathData, toReact, toSvg } from '../src/core/svg';
import { parsePathData, parseSvgPaths, sampledHausdorff } from '../src/core/verify';

const scene: Scene = {
  ...emptyScene(),
  name: 'Test & <scene>',
  seed: 3,
  sources: [
    { id: 'a', name: 'a', kind: 'peak', enabled: true, x: 420, y: 340, radius: 380, height: 1 },
    { id: 'b', name: 'b', kind: 'ridge', enabled: true, radius: 150, height: 0.7, points: [
      { x: 500, y: 700 }, { x: 800, y: 500 }, { x: 1100, y: 620 },
    ] },
  ],
  noise: { amplitude: 0.05, scale: 200, octaves: 2 },
};

const output = (values: number[], decimals: number, closed = false): OutputPath => ({
  points: new Float64Array(values),
  closed,
  decimals,
  bound: 0,
});

describe('numbers', () => {
  it('prints short forms', () => {
    expect(formatNumber(0.5, 2)).toBe('.5');
    expect(formatNumber(-0.5, 2)).toBe('-.5');
    expect(formatNumber(10, 2)).toBe('10');
    expect(formatNumber(-0.001, 2)).toBe('0');
    expect(formatNumber(1200.25, 2)).toBe('1200.25');
  });
});

describe('path data', () => {
  it('round trips exactly on the decimal lattice', () => {
    const path = output([1.25, 2.5, 3.75, -0.25, 0, 0, 100.01, 99.99], 2);
    const back = parsePathData(pathData(path));
    expect(back).toHaveLength(1);
    back[0].points.forEach((v, i) => expect(v).toBeCloseTo(path.points[i], 9));
  });

  it('closes loops with z and does not repeat the first point', () => {
    const d = pathData(output([0, 0, 10, 0, 10, 10], 0, true));
    expect(d.endsWith('z')).toBe(true);
    const [back] = parsePathData(d);
    expect(back.closed).toBe(true);
    expect(back.points.length).toBe(6);
  });

  it('adds an absolute command every 64 nodes', () => {
    const values: number[] = [];
    for (let i = 0; i < 200; i++) values.push(i * 1.5, Math.round(50 + 40 * Math.sin(i)));
    const d = pathData(output(values, 2));
    expect(d.match(/L/g)).toHaveLength(3);
    const [back] = parsePathData(d);
    back.points.forEach((v, i) => expect(v).toBeCloseTo(values[i], 9));
  });
});

describe('SVG file', () => {
  const geometry = computeGeometry(scene, { quality: 'final', resolution: 256 });
  const svg = toSvg(geometry, scene);

  it('uses only the declared elements and attributes', () => {
    const tags = new Set([...svg.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1]));
    for (const tag of tags) expect(['svg', 'title', 'rect', 'g', 'path']).toContain(tag);
    const attrs = new Set([...svg.matchAll(/\s([a-zA-Z-]+)="/g)].map((m) => m[1]));
    const allowed = new Set([
      'xmlns', 'viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
      'stroke-linejoin', 'stroke-opacity', 'vector-effect', 'x', 'y', 'd',
    ]);
    for (const attr of attrs) expect(allowed.has(attr), attr).toBe(true);
  });

  it('has no script, style, reference or scene data', () => {
    expect(svg).not.toMatch(/<script|<style|<image|<use|<foreign|href=|url\(|on[a-z]+=|data-/i);
    expect(svg).not.toContain('contour-scene');
  });

  it('escapes the title', () => {
    expect(svg).toContain('<title>Test &amp; &lt;scene&gt;</title>');
  });

  it('has a viewBox matching the frame', () => {
    expect(svg).toContain('viewBox="0 0 1200 800"');
    expect(svg).toContain('width="1200"');
  });

  it('parses back to the same geometry the pipeline produced', () => {
    const parsed = parseSvgPaths(svg);
    const flat = geometry.levels.flatMap((l) => l.paths);
    expect(parsed).toHaveLength(flat.length);
    parsed.forEach((path, i) => {
      expect(path.closed).toBe(flat[i].closed);
      expect(path.points.length).toBe(flat[i].points.length);
      path.points.forEach((v, k) => expect(v).toBeCloseTo(flat[i].points[k], 9));
    });
  });

  it('measured distance to the extracted lines is within the declared bound', () => {
    const parsed = parseSvgPaths(svg);
    const distance = sampledHausdorff(geometry.source.flat(), parsed, 0.25);
    expect(distance.sampled).toBeLessThanOrEqual(geometry.stats.maxBound);
  });

  it('expanded bounds grow the viewBox and report a limited margin', () => {
    const framed: Scene = {
      ...scene,
      clip: { x: 100, y: 100, width: 800, height: 500 },
      export: { ...scene.export, bounds: 'expanded', margin: 60 },
    };
    const g = computeGeometry(framed, { quality: 'final', resolution: 128 });
    expect(toSvg(g, framed)).toContain('viewBox="40 40 920 620"');
    expect(g.marginLimited).toBe(false);
    const tight = { ...framed, export: { ...framed.export, margin: 400 } };
    const limited = computeGeometry(tight, { quality: 'final', resolution: 64 });
    expect(limited.marginLimited).toBe(true);
    expect(toSvg(limited, tight)).toContain('viewBox="0 0 1200 800"');
  });

  it('fixed stroke mode marks every path, and only that mode does', () => {
    expect(svg).not.toContain('vector-effect');
    const fixed = { ...scene, export: { ...scene.export, strokeScaling: 'fixed' as const } };
    const text = toSvg(computeGeometry(fixed, { quality: 'final', resolution: 64 }), fixed);
    const paths = text.match(/<path/g)?.length ?? 0;
    expect(text.match(/vector-effect="non-scaling-stroke"/g)?.length).toBe(paths);
  });

  it('is byte identical across runs', () => {
    const again = computeGeometry(scene, { quality: 'final', resolution: 256 });
    expect(toSvg(again, scene)).toBe(svg);
  });
});

describe('React output', () => {
  const geometry = computeGeometry(scene, { quality: 'final', resolution: 64 });

  it('renames attributes and spreads props', () => {
    const text = toReact(geometry, scene);
    expect(text).toContain('strokeWidth="1"');
    expect(text).toContain('{...props}');
    expect(text).not.toContain('stroke-width');
    expect(text).toContain('export function TestSceneArtwork');
  });

  it('makes a valid name from any scene name', () => {
    expect(componentName({ ...scene, name: '' })).toBe('ContourArtwork');
    expect(componentName({ ...scene, name: '3 hills' })).toBe('ContourArtwork');
    expect(componentName({ ...scene, name: 'quiet ridge' })).toBe('QuietRidgeArtwork');
  });
});
