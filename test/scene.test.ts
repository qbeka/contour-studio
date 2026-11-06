import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/core/presets';
import { emptyScene, gridSize, LIMITS, levelValues, parseScene, serializeScene } from '../src/core/scene';

const good = () => JSON.parse(serializeScene(PRESETS[0].scene));

function failing(mutate: (scene: ReturnType<typeof good>) => void): string[] {
  const s = good();
  mutate(s);
  const result = parseScene(JSON.stringify(s));
  if (result.ok) throw new Error('expected a failure');
  return result.errors;
}

describe('scene files', () => {
  it('round trips every preset exactly', () => {
    for (const preset of PRESETS) {
      const result = parseScene(serializeScene(preset.scene));
      expect(result.ok && result.scene).toEqual(preset.scene);
    }
  });

  it('accepts an empty scene', () => {
    expect(parseScene(serializeScene(emptyScene())).ok).toBe(true);
  });

  it('rejects text that is not JSON, or not a scene', () => {
    expect(parseScene('{nope').ok).toBe(false);
    expect(parseScene('[]').ok).toBe(false);
    expect(parseScene('null').ok).toBe(false);
    expect(parseScene('{"format":"other"}').ok).toBe(false);
  });

  it('rejects a newer version with a clear message', () => {
    const errors = failing((s) => {
      s.version = 2;
    });
    expect(errors[0]).toContain('version 2');
  });

  it('rejects an oversized file before parsing', () => {
    const result = parseScene(' '.repeat(LIMITS.fileBytes + 1));
    expect(result.ok === false && result.errors[0]).toContain('larger');
  });

  it('rejects resource limits before any array exists', () => {
    expect(failing((s) => { s.export.resolution = 100000; })[0]).toContain('export.resolution');
    expect(failing((s) => { s.levels.count = 100000; })[0]).toContain('levels.count');
    expect(failing((s) => { s.domain.width = 1e9; }).length).toBeGreaterThan(0);
  });

  it('rejects too many sources without reading them', () => {
    const errors = failing((s) => {
      s.sources = new Array(LIMITS.sources + 1).fill(s.sources[0]);
    });
    expect(errors).toHaveLength(1);
  });

  it('rejects non-finite and wrongly typed numbers', () => {
    // JSON cannot hold NaN, but a validator can still be handed one.
    expect(failing((s) => { s.seed = 'x'; })[0]).toContain('seed');
    expect(failing((s) => { s.seed = 1.5; })[0]).toContain('seed');
    expect(failing((s) => { s.sources[0].radius = 0; })[0]).toContain('radius');
    expect(failing((s) => { s.levels.spacing = 0; })[0]).toContain('spacing');
  });

  it('rejects a clip outside the domain', () => {
    expect(failing((s) => { s.clip.width = s.domain.width; }).join()).toContain('clip');
  });

  it('rejects a colour that could carry markup', () => {
    expect(failing((s) => { s.style.stroke = '"/><script>'; })[0]).toContain('style.stroke');
    expect(failing((s) => { s.style.background = 'url(x)'; })[0]).toContain('background');
  });

  it('rejects repeated source ids', () => {
    expect(failing((s) => { s.sources[1].id = s.sources[0].id; }).join()).toContain('unique');
  });

  it('rejects unknown kinds and short ridges', () => {
    expect(failing((s) => { s.sources[0].kind = 'fluid'; }).join()).toContain('peak or ridge');
    expect(failing((s) => { s.sources[0].points = [{ x: 0, y: 0 }]; }).join()).toContain('handles');
  });

  it('drops unknown fields, so no hidden data survives a load', () => {
    const s = good();
    s.secret = 'keep me';
    s.sources[0].script = 'alert(1)';
    const result = parseScene(JSON.stringify(s));
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('keep me');
    expect(JSON.stringify(result)).not.toContain('alert');
  });

  it('is not fooled by a prototype key', () => {
    const text = serializeScene(emptyScene()).replace('{', '{"__proto__":{"polluted":true},');
    const result = parseScene(text);
    expect(result.ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('lists several problems at once', () => {
    const errors = failing((s) => {
      s.seed = -1;
      s.levels.count = 0;
    });
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('grid size', () => {
  it('gives the long side the requested cells', () => {
    expect(gridSize({ width: 1000, height: 1000 }, 512)).toEqual({ nx: 512, ny: 512 });
    expect(gridSize({ width: 1600, height: 640 }, 512)).toEqual({ nx: 512, ny: 205 });
    expect(gridSize({ width: 16, height: 8192 }, 16)).toEqual({ nx: 1, ny: 16 });
  });
});

describe('levels', () => {
  it('counts up from the base', () => {
    expect(levelValues({ base: 1, spacing: 0.5, count: 3 })).toEqual([1, 1.5, 2]);
  });
});
