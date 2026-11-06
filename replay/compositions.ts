/**
 * The three drawings on the project page. Each one is a studio preset, a source
 * that takes the handle, and the part of its sheet that suits the stage.
 *
 * The stage changes shape with the window, so the frame is worked out from the
 * stage instead of being stored. The field never changes with it. A wider stage
 * shows more of the same drawing, and a narrow one crops in on the handle.
 */

import { PRESETS, type Preset } from '../src/core/presets';
import type { PeakSource, Rect, Scene } from '../src/core/scene';

export interface Composition {
  id: string;
  /** The name on the toolbar. */
  label: string;
  preset: Preset;
  scene: Scene;
  /** The source the handle moves. */
  source: string;
  /** The frame stays centred here unless the handle needs it to move. */
  focus: { x: number; y: number };
  /** The widest and narrowest frame this drawing can take, as width over height. */
  aspect: [number, number];
}

function compose(
  index: number,
  label: string,
  source: string,
  focus: Composition['focus'],
  aspect: Composition['aspect'],
): Composition {
  const preset = PRESETS[index];
  return { id: preset.id, label, preset, scene: preset.scene, source, focus, aspect };
}

export const COMPOSITIONS: readonly Composition[] = [
  compose(0, 'Quiet ridge', 'summit', { x: 340, y: 320 }, [0.5, 2.5]),
  compose(1, 'Tall basin', 'island', { x: 500, y: 500 }, [0.5, 0.8]),
  compose(2, 'Interference', 's6', { x: 600, y: 400 }, [0.5, 2]),
];

export function compositionOf(scene: Scene): Composition {
  return COMPOSITIONS.find((c) => c.scene.name === scene.name) ?? COMPOSITIONS[0];
}

export function handleOf(scene: Scene): PeakSource {
  const { source } = compositionOf(scene);
  return scene.sources.find((s) => s.id === source) as PeakSource;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Keeps the handle at least this far inside the frame when the stage changes shape. */
const HANDLE_MARGIN = 48;

/** The largest frame of the stage's shape that fits the sheet, around the focus. */
export function frameFor(scene: Scene, stageAspect: number): Rect {
  const c = compositionOf(scene);
  const { width: W, height: H } = scene.domain;
  const aspect = clamp(stageAspect, c.aspect[0], c.aspect[1]);
  const width = Math.min(W, Math.round(H * aspect));
  const height = Math.min(H, Math.round(width / aspect));
  const point = handleOf(scene);
  const along = (focus: number, at: number, size: number, sheet: number) => {
    const low = clamp(at - size + HANDLE_MARGIN, 0, sheet - size);
    const high = clamp(at - HANDLE_MARGIN, 0, sheet - size);
    return Math.round(clamp(focus - size / 2, Math.min(low, high), Math.max(low, high)));
  };
  return {
    x: along(c.focus.x, point.x, width, W),
    y: along(c.focus.y, point.y, height, H),
    width,
    height,
  };
}
