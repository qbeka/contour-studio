import { describe, expect, it } from 'vitest';
import { computeGeometry } from '../src/core/pipeline';
import { PALETTES, PLATES, SEED_LIMIT, applyPalette, frameFor, generatePlate, paletteOf } from '../src/core/plates';
import { PRESETS } from '../src/core/presets';
import { serializeScene, validateScene, type PeakSource, type Scene } from '../src/core/scene';
import { toSvg } from '../src/core/svg';
import { levelRegions } from '../src/core/tint';

const SHAPES = [0.3, 0.56, 0.68, 1, 1.125, 1.69, 2.06, 3];

describe('the plate set', () => {
  it('has six plates with their own names and numerals', () => {
    expect(PLATES).toHaveLength(6);
    expect(new Set(PLATES.map((p) => p.id)).size).toBe(6);
    expect(new Set(PLATES.map((p) => p.name)).size).toBe(6);
    expect(PLATES.map((p) => p.numeral)).toEqual(['I', 'II', 'III', 'IV', 'V', 'VI']);
  });

  it('every plate passes the scene rules and prints in a palette of the set', () => {
    for (const plate of PLATES) {
      expect(validateScene(JSON.parse(serializeScene(plate.scene))).ok).toBe(true);
      expect(paletteOf(plate.scene)).toBeDefined();
      expect(plate.scene.sources.find((s) => s.id === plate.primary)?.kind).toBe('peak');
    }
  });

  it('the first three keep the starter fields, apart from the one tuned source', () => {
    PRESETS.forEach((preset, index) => {
      const plate = PLATES[index];
      const { scene } = plate;
      expect(scene.domain).toEqual(preset.scene.domain);
      expect(scene.levels).toEqual(preset.scene.levels);
      expect(scene.noise).toEqual(preset.scene.noise);
      expect(scene.seed).toBe(preset.scene.seed);
      expect(scene.export).toEqual(preset.scene.export);
      const rest = (s: Scene) => s.sources.filter((source) => source.id !== plate.primary);
      expect(rest(scene)).toEqual(rest(preset.scene));
    });
  });

  it('print styling never moves a line', () => {
    const preset = PRESETS[0].scene;
    const styled: Scene = { ...preset, style: PLATES[0].scene.style };
    const a = computeGeometry(preset, { quality: 'final', resolution: 128 });
    const b = computeGeometry(styled, { quality: 'final', resolution: 128 });
    expect(b.levels.map((l) => l.paths.map((p) => Array.from(p.points)))).toEqual(
      a.levels.map((l) => l.paths.map((p) => Array.from(p.points))),
    );
    expect(b.stats.outputVertices).toBe(a.stats.outputVertices);
  });

  it('every plate gives a tint region for every level, at stage shapes', () => {
    for (const plate of PLATES) {
      for (const shape of [0.68, 1.93]) {
        const scene = { ...plate.scene, clip: frameFor(plate, plate.scene, shape) };
        const geometry = computeGeometry(scene, { quality: 'draft', resolution: 96 });
        expect(levelRegions(geometry).every((region) => region !== null)).toBe(true);
      }
    }
  });
});

describe('frames', () => {
  const moved = (scene: Scene, id: string, x: number, y: number): Scene => ({
    ...scene,
    sources: scene.sources.map((s) => (s.id === id ? { ...(s as PeakSource), x, y } : s)),
  });

  it('every frame fits its sheet and passes the scene rules, at any stage shape', () => {
    for (const plate of [...PLATES, generatePlate(7), generatePlate(8)]) {
      for (const shape of SHAPES) {
        const clip = frameFor(plate, plate.scene, shape);
        expect(validateScene({ ...plate.scene, clip }).ok).toBe(true);
        expect(clip.x + clip.width).toBeLessThanOrEqual(plate.scene.domain.width);
        expect(clip.y + clip.height).toBeLessThanOrEqual(plate.scene.domain.height);
      }
    }
  });

  it('keeps the primary source inside the frame wherever it was left', () => {
    for (const plate of PLATES) {
      const { width, height } = plate.scene.domain;
      for (const [x, y] of [[20, 20], [width - 20, 20], [20, height - 20], [width - 20, height - 20]]) {
        const scene = moved(plate.scene, plate.primary, x, y);
        for (const shape of [0.56, 1, 1.69]) {
          const clip = frameFor(plate, scene, shape);
          expect(x).toBeGreaterThanOrEqual(clip.x);
          expect(x).toBeLessThanOrEqual(clip.x + clip.width);
          expect(y).toBeGreaterThanOrEqual(clip.y);
          expect(y).toBeLessThanOrEqual(clip.y + clip.height);
        }
      }
    }
  });

  it('still frames a plate whose primary source was removed', () => {
    const plate = PLATES[0];
    const scene = { ...plate.scene, sources: plate.scene.sources.filter((s) => s.id !== plate.primary) };
    const clip = frameFor(plate, scene, 1.69);
    expect(validateScene({ ...scene, clip }).ok).toBe(true);
  });

  it('the basin stays tall on a wide stage', () => {
    const clip = frameFor(PLATES[1], PLATES[1].scene, 1.69);
    expect(clip.height).toBeGreaterThan(clip.width);
  });
});

describe('palettes', () => {
  it('changing palette changes three colours and nothing else', () => {
    const scene = PLATES[0].scene;
    for (const palette of PALETTES) {
      const next = applyPalette(scene, palette);
      expect(paletteOf(next)).toBe(palette);
      expect({ ...next, style: null }).toEqual({ ...scene, style: null });
      expect({ ...next.style, stroke: '', background: '', tintColor: '' }).toEqual({
        ...scene.style, stroke: '', background: '', tintColor: '',
      });
    }
  });
});

describe('the generator', () => {
  it('gives the same scene for the same seed, byte for byte', () => {
    for (const seed of [0, 1, 4821, 999_999]) {
      expect(serializeScene(generatePlate(seed).scene)).toBe(serializeScene(generatePlate(seed).scene));
    }
  });

  it('gives a different scene for a different seed', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(JSON.stringify(generatePlate(seed).scene.sources));
    expect(seen.size).toBe(60);
  });

  it('wraps any number into the seed range', () => {
    expect(generatePlate(SEED_LIMIT + 5).seed).toBe(5);
    expect(generatePlate(-1).seed).toBe(SEED_LIMIT - 1);
    expect(generatePlate(12.9).seed).toBe(12);
  });

  it('every scene is valid, names a real peak and draws a useful number of lines', () => {
    for (let seed = 0; seed < 120; seed++) {
      const plate = generatePlate(seed);
      const parsed = validateScene(JSON.parse(serializeScene(plate.scene)));
      expect(parsed.ok, `seed ${seed}`).toBe(true);
      expect(plate.scene.sources.find((s) => s.id === plate.primary)?.kind).toBe('peak');
      expect(plate.name).toMatch(/^[A-Z][a-z]+ [a-z]+$/);
      const geometry = computeGeometry(plate.scene, { quality: 'draft', resolution: 64 });
      const drawn = geometry.levels.filter((level) => level.paths.length > 0).length;
      expect(drawn, `seed ${seed}`).toBeGreaterThanOrEqual(8);
      expect(levelRegions(geometry).every((region) => region !== null), `seed ${seed}`).toBe(true);
    }
  });

  it('whole positions and rounded heights, so no engine can disagree', () => {
    const { scene } = generatePlate(31337);
    for (const source of scene.sources) {
      const points = source.kind === 'peak' ? [source] : source.points;
      for (const p of points) {
        expect(Number.isInteger(p.x)).toBe(true);
        expect(Number.isInteger(p.y)).toBe(true);
      }
      expect(Math.round(source.height * 100) / 100).toBe(source.height);
      expect(Number.isInteger(source.radius)).toBe(true);
    }
  });

  it('a generated plate exports with its tint', () => {
    const { scene } = generatePlate(21);
    const svg = toSvg(computeGeometry(scene, { quality: 'final', resolution: 128 }), scene);
    expect(svg).toContain('fill-rule="evenodd"');
  });
});
