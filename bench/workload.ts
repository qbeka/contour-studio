/**
 * The frozen benchmark workload. Changing anything here means earlier results no
 * longer compare, so the plan in docs/REPORT.md lists it as frozen.
 */

import { createHash } from 'node:crypto';
import { PRESETS } from '../src/core/presets';
import { serializeScene, type Scene } from '../src/core/scene';

export const WARMUP_ITERATIONS = 3;
export const MEASURED_ITERATIONS = 5;
export const RUNS = 7;
export const BROWSER_RUNS = 5;
export const RESOLUTIONS = [256, 512, 1024] as const;
export const TOLERANCES = [0.05, 0.15, 0.5] as const;
export const DISTANCE_SPACING = 0.25;

/** Keeps the height range of a preset but draws it with a set number of lines. */
export function withLevels(scene: Scene, count: number): Scene {
  const { base, spacing, count: original } = scene.levels;
  return {
    ...scene,
    levels: { base, spacing: (spacing * (original - 1)) / (count - 1), count },
  };
}

export interface Cell {
  id: string;
  scene: Scene;
  resolution: number;
  group: 'target' | 'default' | 'stress';
}

export function stressScene(): Scene {
  const dense = PRESETS[2].scene;
  return {
    ...withLevels(dense, 64),
    noise: { ...dense.noise, octaves: 4 },
    export: { ...dense.export, tolerance: 0.05, decimals: 3 },
  };
}

export function cells(): Cell[] {
  const out: Cell[] = [];
  for (const preset of PRESETS) {
    for (const resolution of RESOLUTIONS) {
      out.push({
        id: `${preset.id}/16-levels/${resolution}`,
        scene: withLevels(preset.scene, 16),
        resolution,
        group: 'target',
      });
    }
    out.push({
      id: `${preset.id}/default/${preset.scene.export.resolution}`,
      scene: preset.scene,
      resolution: preset.scene.export.resolution,
      group: 'default',
    });
  }
  out.push({
    id: 'interference-study/stress-64-levels/1024',
    scene: stressScene(),
    resolution: 1024,
    group: 'stress',
  });
  return out;
}

export function sceneHash(scene: Scene): string {
  return createHash('sha256').update(serializeScene(scene)).digest('hex');
}
