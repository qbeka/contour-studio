import { describe, expect, it } from 'vitest';
import { decodeEdits, encodeEdits, isOriginal, readLink, writeLink } from '../replay/link';
import { addPeak, removeSource, setHandle, updateSource } from '../src/app/edits';
import { PALETTES, PLATES, applyPalette, generatePlate, paletteOf } from '../src/core/plates';
import type { Scene } from '../src/core/scene';

// Everything that decides the drawing. A name is a label and draws nothing.
const field = (scene: Scene) =>
  JSON.stringify([scene.sources.map((s) => ({ ...s, name: '' })), scene.levels, scene.noise, scene.style]);

describe('a drawing as a link', () => {
  it('the first plate untouched needs no parameters at all', () => {
    expect(writeLink(PLATES[0], PLATES[0].scene).toString()).toBe('');
  });

  it('names a plate, and a seed for a generated one', () => {
    expect(writeLink(PLATES[3], PLATES[3].scene).toString()).toBe('plate=caldera');
    const made = generatePlate(418203);
    expect(writeLink(made, made.scene).toString()).toBe('seed=418203');
  });

  it('restores every plate and a seed exactly', () => {
    for (const plate of [...PLATES, generatePlate(77)]) {
      const back = readLink(writeLink(plate, plate.scene));
      expect(back.plate.id).toBe(plate.id);
      expect(field(back.scene)).toBe(field(plate.scene));
    }
  });

  it('restores a drawing after a move, an added peak, a removed source and new settings', () => {
    for (const plate of [PLATES[0], PLATES[4], generatePlate(9)]) {
      let scene = plate.scene;
      scene = setHandle(scene, plate.primary, 0, 411, 287);
      scene = addPeak(scene, 512, 300).scene;
      scene = updateSource(scene, plate.primary, { height: -0.37, radius: 143 });
      scene = removeSource(scene, scene.sources[0].id);
      const ridge = scene.sources.find((s) => s.kind === 'ridge');
      if (ridge) scene = setHandle(scene, ridge.id, 1, 700, 345);
      scene = { ...scene, levels: { ...scene.levels, spacing: 0.065, count: 18 }, noise: { ...scene.noise, amplitude: 0.014 } };
      scene = { ...scene, style: { ...scene.style, tint: -0.35 } };
      scene = applyPalette(scene, PALETTES[2]);
      expect(isOriginal(plate, scene)).toBe(false);
      const back = readLink(new URLSearchParams(writeLink(plate, scene).toString()));
      expect(back.plate.id).toBe(plate.id);
      expect(field(back.scene)).toBe(field(scene));
      expect(paletteOf(back.scene)).toBe(PALETTES[2]);
    }
  });

  it('a palette alone does not count as an edit', () => {
    const scene = applyPalette(PLATES[0].scene, PALETTES[3]);
    expect(isOriginal(PLATES[0], scene)).toBe(true);
    expect(writeLink(PLATES[0], scene).toString()).toBe('ink=terracotta');
  });

  it('keeps parameters it does not own', () => {
    const out = writeLink(PLATES[1], PLATES[1].scene, new URLSearchParams('hook=1&plate=old&e=zzz'));
    expect(out.get('hook')).toBe('1');
    expect(out.get('plate')).toBe('asymmetric-basin');
    expect(out.has('e')).toBe(false);
  });

  it('falls back to the plate on text it cannot read', () => {
    const bad = [
      '', 'v2.85.14.22.50', 'v1.85.14.22', 'v1.85.14.22.50_summit.1.2', 'v1.85.14.22.50_a.170.34.262',
      'v1.85.14.22.50_a.170.34.1.2_a.170.34.1.2', 'v1.85.999.22.50', 'v1.85.14.22.50_<script>.1.1.1.1',
      'v1.85.14.22.50_a.170.34.99999999.2', 'v1.0.14.22.50',
    ];
    for (const text of bad) {
      expect(decodeEdits(PLATES[0], text), text).toBeNull();
      const back = readLink(new URLSearchParams({ e: text }));
      expect(field(back.scene)).toBe(field(PLATES[0].scene));
    }
    expect(readLink(new URLSearchParams('plate=nothing&ink=neon&seed=abc')).plate).toBe(PLATES[0]);
    expect(readLink(new URLSearchParams('seed=9999999')).plate).toBe(PLATES[0]);
  });

  it('edits stay short enough for a link', () => {
    for (const plate of PLATES) expect(encodeEdits(plate.scene).length).toBeLessThan(500);
  });
});
