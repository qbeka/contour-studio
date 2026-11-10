/**
 * The relief is cut from the tint regions and nothing else. These tests check the
 * stack against the lines and the plain export, which it must never change.
 */

import { describe, expect, it } from 'vitest';
import { computeGeometry } from '../src/core/pipeline';
import { PLATES } from '../src/core/plates';
import { PRESETS } from '../src/core/presets';
import { DEFAULT_LAMP, SHADOW_COPIES, buildRelief, clampLamp, lampPoint, mixColour, reliefColours, reliefFile, scaleAbout } from '../src/core/relief';
import type { Scene } from '../src/core/scene';
import { linesOnly, tintPaths, toSvg } from '../src/core/svg';
import { levelRegions, regionContains, tintPass } from '../src/core/tint';

const final = (scene: Scene) => computeGeometry(scene, { quality: 'final', resolution: 256 });

describe('relief', () => {
  it('cuts one sheet for each level that has ground above it, lowest first', () => {
    for (const plate of PLATES) {
      const geometry = final(plate.scene);
      const relief = buildRelief(geometry, plate.scene, DEFAULT_LAMP);
      const regions = levelRegions(geometry);
      const expected = regions.flatMap((region, level) => (region && region.loops.length > 0 ? [level] : []));
      expect(relief.sheets.map((sheet) => sheet.level)).toEqual(expected);
      expect(relief.sheets.length).toBeGreaterThan(5);
    }
  });

  it('stacks so that every sheet lies on the one below it', () => {
    for (const plate of PLATES.slice(0, 4)) {
      const geometry = final(plate.scene);
      const { sheets, rect } = buildRelief(geometry, plate.scene, DEFAULT_LAMP);
      let checked = 0;
      for (let j = 1; j < 40; j++) {
        for (let i = 1; i < 60; i++) {
          // Off the lattice the lines are rounded to, so no point sits on an edge.
          const x = rect.x + (rect.width * i) / 60 + 0.0137;
          const y = rect.y + (rect.height * j) / 40 + 0.0171;
          let covered = true;
          for (const sheet of sheets) {
            const inside = regionContains(sheet, x, y);
            if (inside) expect(covered).toBe(true);
            covered = inside;
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(10_000);
    }
  });

  it('gives each sheet the colour the tinted print reaches there', () => {
    const scene = PLATES[0].scene;
    const count = scene.levels.count;
    const pass = tintPass(scene.style.tint, count);
    const { board, sheets } = reliefColours(scene, count);
    expect(board).toBe(scene.style.background);
    expect(sheets[0]).toBe(mixColour(board, scene.style.tintColor, pass));
    expect(sheets[count - 1]).toBe(mixColour(board, scene.style.tintColor, 1 - (1 - pass) ** count));
    // Below zero the tint deepens with depth, so the board is the darkest.
    const low = reliefColours(PLATES[1].scene, PLATES[1].scene.levels.count);
    expect(low.board).toBe(mixColour(PLATES[1].scene.style.background as string, PLATES[1].scene.style.tintColor, 1 - (1 - tintPass(PLATES[1].scene.style.tint, 20)) ** 20));
    expect(low.sheets[19]).toBe(PLATES[1].scene.style.background);
    // A drawing with no tint still steps from sheet to sheet.
    const plain = reliefColours(PLATES[2].scene, 24);
    expect(new Set(plain.sheets).size).toBeGreaterThan(12);
  });

  it('keeps the lamp on the frame', () => {
    expect(clampLamp({ u: -2, v: 9 })).toEqual({ u: 0, v: 1 });
    expect(clampLamp({ u: Number.NaN, v: 0.25 })).toEqual({ u: 0.5, v: 0.25 });
    expect(lampPoint({ x: 80, y: 80, width: 1000, height: 400 }, { u: 0.5, v: 0.25 })).toEqual({ x: 580, y: 180 });
  });

  it('throws a shadow that leaves the point under the lamp where it is', () => {
    const [a, b, c, d, e, f] = scaleAbout(1.02, 300, 120);
    expect([a * 300 + c * 120 + e, b * 300 + d * 120 + f].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([300, 120]);
    // A point away from the lamp moves straight away from it.
    expect(a * 400 + e).toBeCloseTo(402, 9);
  });
});

describe('relief file', () => {
  const plate = PLATES[0];
  const geometry = final(plate.scene);
  const file = reliefFile(geometry, plate.scene, DEFAULT_LAMP);

  it('writes each outline once and refers to it for the sheet, its shadow and its lit edge', () => {
    const outlines = file.svg.match(/<path id="s\d+" d="[^"]+"\/>/g) ?? [];
    const uses = file.svg.match(/<use /g) ?? [];
    expect(outlines).toHaveLength(file.sheets);
    expect(uses).toHaveLength(file.sheets * (SHADOW_COPIES + 2));
    expect(file.copies).toBe(file.sheets * (SHADOW_COPIES + 1));
    expect(file.svg).not.toMatch(/<filter|<image|<script|<style|stroke=/);
  });

  it('cuts every sheet along the same outline the tint pass fills', () => {
    const outlines = (file.svg.match(/<path id="s\d+" d="([^"]+)"\/>/g) ?? []).map((text) => text.replace(/^.* d="/, '').replace(/"\/>$/, ''));
    expect(outlines).toEqual(tintPaths(geometry, { ...plate.scene, style: { ...plate.scene.style, tint: 1 } }));
  });

  it('is the same bytes for the same drawing and lamp, and different for another lamp', () => {
    expect(reliefFile(final(plate.scene), plate.scene, DEFAULT_LAMP).svg).toBe(file.svg);
    expect(reliefFile(geometry, plate.scene, { u: 0.8, v: 0.7 }).svg).not.toBe(file.svg);
  });

  it('leaves the plain export of the measured scene exactly as it was', () => {
    const scene = { ...PRESETS[0].scene, export: { ...PRESETS[0].scene.export, tolerance: 0.15 } };
    const measured = computeGeometry(scene, { quality: 'final' });
    const before = toSvg(measured, linesOnly(scene));
    reliefFile(measured, scene, DEFAULT_LAMP);
    buildRelief(measured, scene, { u: 0.4, v: 0.4 });
    expect(toSvg(measured, linesOnly(scene))).toBe(before);
    expect(measured.stats.sourceVertices).toBe(12_104);
    expect(measured.stats.outputVertices).toBe(1_771);
  });
});
