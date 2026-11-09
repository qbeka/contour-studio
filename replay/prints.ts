/**
 * Fixed size prints: a desktop wallpaper, a phone wallpaper and a poster. Each is
 * the same field framed to a new shape, drawn by the same code as the stage.
 *
 * The layout is plain arithmetic and is tested on its own. Drawing needs a canvas.
 */

import { drawArtwork } from '../src/app/render';
import type { Geometry } from '../src/core/pipeline';
import { frameFor, type Plate } from '../src/core/plates';
import type { Scene } from '../src/core/scene';
import { tintPass } from '../src/core/tint';

export interface PrintSize {
  id: 'desktop' | 'phone' | 'poster';
  label: string;
  width: number;
  height: number;
  /** Output px for one px of line weight on the stage. */
  weight: number;
  /** Paper left around the artwork, as a part of the width. */
  margin: number;
}

export const PRINT_SIZES: readonly PrintSize[] = [
  { id: 'desktop', label: 'Desktop wallpaper', width: 3840, height: 2160, weight: 2.6, margin: 0 },
  { id: 'phone', label: 'Phone wallpaper', width: 1290, height: 2796, weight: 2.8, margin: 0 },
  // 3 to 4, the shape of an 18 by 24 inch sheet, and inside the canvas limit of a phone browser.
  { id: 'poster', label: 'Poster, 18 by 24', width: 3000, height: 4000, weight: 3.2, margin: 0.07 },
];

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PrintLayout {
  width: number;
  height: number;
  art: Box;
  /** Where the title block goes. Null when it is off. */
  block: Box | null;
  /** A poster's block sits under the artwork. A wallpaper's is a box in the corner. */
  placed: 'under' | 'corner';
}

export function layoutPrint(size: PrintSize, titleBlock: boolean): PrintLayout {
  const { width, height } = size;
  if (size.margin > 0) {
    const m = Math.round(width * size.margin);
    const band = titleBlock ? Math.round(height * 0.075) : 0;
    const gap = titleBlock ? Math.round(m * 0.45) : 0;
    const art = { x: m, y: m, width: width - 2 * m, height: height - 2 * m - band - gap };
    const block = titleBlock ? { x: m, y: art.y + art.height + gap, width: art.width, height: band } : null;
    return { width, height, art, block, placed: 'under' };
  }
  const art = { x: 0, y: 0, width, height };
  if (!titleBlock) return { width, height, art, block: null, placed: 'corner' };
  const tall = height > width;
  const inset = Math.round(width * (tall ? 0.07 : 0.03));
  const blockW = Math.round(tall ? width * 0.62 : width * 0.2);
  const blockH = Math.round(blockW * (tall ? 0.3 : 0.31));
  // A phone keeps its own controls along the bottom edge.
  const bottom = tall ? Math.round(height * 0.1) : inset;
  return {
    width,
    height,
    art,
    block: { x: inset, y: height - bottom - blockH, width: blockW, height: blockH },
    placed: 'corner',
  };
}

/** The scene a print is computed from: the same field, framed to the print's shape. */
export function printScene(plate: Plate, scene: Scene, size: PrintSize, layout: PrintLayout): Scene {
  const clip = frameFor(plate, scene, layout.art.width / layout.art.height, true);
  const perUnit = layout.art.width / clip.width;
  const units = (px: number) => Math.round(((px * size.weight) / perUnit) * 1000) / 1000;
  return {
    ...scene,
    clip,
    style: {
      ...scene.style,
      strokeWidth: units(scene.style.strokeWidth),
      indexWidth: units(scene.style.indexWidth),
    },
    export: { ...scene.export, bounds: 'frame', strokeScaling: 'scale', outputWidth: 0 },
  };
}

export interface BlockText {
  name: string;
  /** For example Plate IV, or No. 418203. */
  mark: string;
  /** For example 20 lines at 0.066. */
  lines: string;
}

export function blockText(plate: Plate, scene: Scene): BlockText {
  const spacing = scene.levels.spacing.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return {
    name: plate.name,
    mark: plate.seed === undefined ? `Plate ${plate.numeral}` : `No. ${String(plate.seed).padStart(6, '0')}`,
    lines: `${scene.levels.count} lines at ${spacing}`,
  };
}

/** The steps of the tint key, at most ten of them, lightest first. */
export function keySteps(scene: Scene): number[] {
  const { tint } = scene.style;
  const { count } = scene.levels;
  if (tint === 0) return [];
  const pass = tintPass(tint, count);
  const steps = Math.min(10, count);
  return Array.from({ length: steps }, (_, i) => {
    const passes = Math.round(((i + 1) * count) / steps);
    return 1 - (1 - pass) ** passes;
  });
}

const SERIF = "'Geist Serif', 'Times New Roman', serif";
const SANS = "'Geist', system-ui, sans-serif";

function drawKey(ctx: CanvasRenderingContext2D, scene: Scene, x: number, y: number, width: number, height: number): void {
  const steps = keySteps(scene);
  if (steps.length === 0) return;
  const cell = width / steps.length;
  const ordered = scene.style.tint < 0 ? [...steps].reverse() : steps;
  ordered.forEach((alpha, i) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = scene.style.tintColor;
    ctx.fillRect(x + i * cell, y, cell + 0.5, height);
  });
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = scene.style.stroke;
  ctx.lineWidth = Math.max(1, height / 12);
  ctx.strokeRect(x, y, width, height);
  ctx.globalAlpha = 1;
}

function drawBlock(ctx: CanvasRenderingContext2D, layout: PrintLayout, scene: Scene, text: BlockText): void {
  const block = layout.block as Box;
  const ink = scene.style.stroke;
  const paper = scene.style.background ?? '#ffffff';
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  if (layout.placed === 'under') {
    const title = block.height * 0.5;
    const small = block.height * 0.16;
    ctx.fillStyle = ink;
    ctx.font = `400 ${title}px ${SERIF}`;
    ctx.fillText(text.name, block.x - title * 0.04, block.y + title * 0.86);
    ctx.font = `400 ${small}px ${SANS}`;
    ctx.globalAlpha = 0.72;
    ctx.fillText(`${text.mark}  ·  ${text.lines}`, block.x, block.y + block.height - small * 0.2);
    ctx.textAlign = 'right';
    ctx.fillText('Contour', block.x + block.width, block.y + block.height - small * 0.2);
    ctx.globalAlpha = 1;
    const keyW = block.width * 0.22;
    drawKey(ctx, scene, block.x + block.width - keyW, block.y + title * 0.34, keyW, block.height * 0.14);
  } else {
    const pad = block.height * 0.16;
    ctx.fillStyle = paper;
    ctx.fillRect(block.x, block.y, block.width, block.height);
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1, block.height / 90);
    ctx.strokeRect(block.x, block.y, block.width, block.height);
    ctx.globalAlpha = 1;
    const title = block.height * 0.3;
    const small = block.height * 0.115;
    ctx.fillStyle = ink;
    ctx.font = `400 ${title}px ${SERIF}`;
    ctx.fillText(text.name, block.x + pad - title * 0.04, block.y + pad + title * 0.78);
    ctx.font = `400 ${small}px ${SANS}`;
    ctx.globalAlpha = 0.72;
    ctx.fillText(`${text.mark}  ·  ${text.lines}`, block.x + pad, block.y + pad + title + small * 1.5);
    ctx.globalAlpha = 1;
    drawKey(ctx, scene, block.x + pad, block.y + block.height - pad - block.height * 0.1, block.width - pad * 2, block.height * 0.1);
  }
  ctx.restore();
}

/** Draws a whole print. `geometry` must be the final for `scene`. */
export function drawPrint(
  ctx: CanvasRenderingContext2D,
  geometry: Geometry,
  scene: Scene,
  layout: PrintLayout,
  text: BlockText,
): void {
  const { art } = layout;
  const paper = scene.style.background ?? '#ffffff';
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, layout.width, layout.height);
  const scale = art.width / geometry.rect.width;
  drawArtwork(ctx, geometry, scene, {
    scale,
    x: art.x - geometry.rect.x * scale,
    y: art.y - geometry.rect.y * scale,
    dpr: 1,
  });
  if (layout.placed === 'under') {
    // A plate mark: one fine rule around the artwork.
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = scene.style.stroke;
    ctx.lineWidth = Math.max(1, layout.width / 1500);
    ctx.strokeRect(art.x, art.y, art.width, art.height);
    ctx.globalAlpha = 1;
  }
  if (layout.block) drawBlock(ctx, layout, scene, text);
}
