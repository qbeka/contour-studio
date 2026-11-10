/**
 * Paper relief: the same field as a stack of cut card, one sheet for the ground
 * above each level, lit by a lamp held over the sheet.
 *
 * Nothing here samples the field or moves a line. A sheet is the tint region of
 * its level, so its cut edge is the exported line itself. A lamp at a finite
 * height throws the shadow of a raised sheet as that sheet made a little larger
 * about the point under the lamp. That is one similarity transform, so the canvas
 * and a vector file can both draw it exactly, with no blur and no raster.
 */

import type { Geometry } from './pipeline';
import type { Rect, Scene } from './scene';
import { escapeText, formatNumber, pathData } from './svg';
import { levelRegions, tintPass } from './tint';

/** Where the lamp hangs, as a part of the frame from its top left corner. */
export interface Lamp {
  u: number;
  v: number;
}

export const DEFAULT_LAMP: Lamp = { u: 0.17, v: 0.2 };

/** How much larger than its sheet the widest shadow copy is. */
export const SHADOW_GROW = 0.018;
/** A shadow is this many copies of its sheet, each a step larger and all equally faint. */
export const SHADOW_COPIES = 4;
/** The lit edge is one copy this much smaller, so it shows on the side that faces the lamp. */
export const LIT_SHRINK = 0.0035;
/** A drawing with no tint still gets this much tone, so that every sheet can be told from the next. */
const LEAST_TONE = 0.22;

export interface ReliefSheet {
  /** The level this sheet is cut along. */
  level: number;
  /** Closed loops, interleaved x, y, filled with the even-odd rule. */
  loops: Float64Array[];
  decimals: number;
  colour: string;
}

export interface Relief {
  rect: Rect;
  /** The board everything is stacked on. */
  board: string;
  /** Lowest first, which is also the order they are laid down. */
  sheets: ReliefSheet[];
  /** The point under the lamp, in drawing units. */
  lamp: { x: number; y: number };
  shadow: {
    colour: string;
    /** Opacity of one copy. */
    opacity: number;
    /** Scale of each copy about the lamp, smallest first. */
    scales: number[];
  };
  /** The cut edge that faces the lamp: one copy of the sheet, a little smaller about the lamp. */
  lit: { colour: string; opacity: number; scale: number };
}

export function clampLamp(lamp: Lamp): Lamp {
  const part = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5);
  return { u: part(lamp.u), v: part(lamp.v) };
}

export function lampPoint(rect: Rect, lamp: Lamp): { x: number; y: number } {
  const { u, v } = clampLamp(lamp);
  return { x: rect.x + rect.width * u, y: rect.y + rect.height * v };
}

function channels(hex: string): [number, number, number] {
  const text = hex.replace('#', '');
  const full = text.length === 3 ? [...text].map((c) => c + c).join('') : text;
  return [0, 2, 4].map((k) => parseInt(full.slice(k, k + 2), 16)) as [number, number, number];
}

/** One colour laid over another at an opacity, as a flat pass of tint would be. */
export function mixColour(under: string, over: string, opacity: number): string {
  const a = channels(under);
  const b = channels(over);
  return `#${a
    .map((value, k) => Math.round(value + (b[k] - value) * opacity).toString(16).padStart(2, '0'))
    .join('')}`;
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The colour of the board and of each sheet. They are the colours the tinted line
 * print reaches after the same number of passes, so the two views agree.
 */
export function reliefColours(scene: Scene, count: number): { board: string; sheets: string[] } {
  const paper = scene.style.background ?? '#ffffff';
  const { tint, tintColor } = scene.style;
  const tone = Math.abs(tint) >= LEAST_TONE ? tint : tint < 0 ? -LEAST_TONE : LEAST_TONE;
  const pass = tintPass(tone, count);
  const after = (passes: number) => mixColour(paper, tintColor, 1 - (1 - pass) ** passes);
  // Above zero the ground deepens with height. Below zero it deepens with depth.
  return tone > 0
    ? { board: paper, sheets: Array.from({ length: count }, (_, k) => after(k + 1)) }
    : { board: after(count), sheets: Array.from({ length: count }, (_, k) => after(count - 1 - k)) };
}

const cache = new WeakMap<Geometry, { key: string; relief: Relief }>();

/** The stack for a drawing. A level whose ground could not be worked out is left out. */
export function buildRelief(geometry: Geometry, scene: Scene, lamp: Lamp): Relief {
  const { style } = scene;
  const at = clampLamp(lamp);
  const key = [style.background, style.stroke, style.tint, style.tintColor, at.u, at.v].join('|');
  const hit = cache.get(geometry);
  if (hit && hit.key === key) return hit.relief;

  const { rect, levels } = geometry;
  const colours = reliefColours(scene, levels.length);
  const sheets: ReliefSheet[] = [];
  levelRegions(geometry).forEach((region, level) => {
    if (!region || region.loops.length === 0) return;
    sheets.push({ level, loops: region.loops, decimals: region.decimals, colour: colours.sheets[level] });
  });
  const dark = luminance(colours.board) < 0.2;
  const relief: Relief = {
    rect,
    board: colours.board,
    sheets,
    lamp: lampPoint(rect, at),
    shadow: {
      // On dark paper the ink is light, and a light shadow would read as a glow.
      colour: dark ? '#000000' : style.stroke,
      opacity: dark ? 0.16 : 0.08,
      scales: Array.from({ length: SHADOW_COPIES }, (_, k) => 1 + (SHADOW_GROW * (k + 1)) / SHADOW_COPIES),
    },
    lit: { colour: dark ? mixColour(style.tintColor, '#ffffff', 0.35) : '#ffffff', opacity: dark ? 0.5 : 0.7, scale: 1 - LIT_SHRINK },
  };
  cache.set(geometry, { key, relief });
  return relief;
}

/** A scale about a point, as the six numbers of an affine matrix. */
export function scaleAbout(scale: number, x: number, y: number): [number, number, number, number, number, number] {
  return [scale, 0, 0, scale, x * (1 - scale), y * (1 - scale)];
}

export interface ReliefFile {
  svg: string;
  sheets: number;
  /** Shadow and lit edge copies in the file. Each is a reference to its sheet, not a second outline. */
  copies: number;
}

/**
 * The relief as a file. Every sheet's outline is written once. The sheet and its
 * shadow copies are references to it, so the file holds no raster, no filter and
 * no line that the plain export does not also have.
 */
export function reliefFile(geometry: Geometry, scene: Scene, lamp: Lamp): ReliefFile {
  const relief = buildRelief(geometry, scene, lamp);
  const { rect, shadow } = relief;
  const width = scene.export.outputWidth || rect.width;
  const height = (width * rect.height) / rect.width;
  const box = [rect.x, rect.y, rect.width, rect.height].map((value) => formatNumber(value, 3));
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${box.join(' ')}" width="${formatNumber(width, 3)}" height="${formatNumber(height, 3)}" fill-rule="evenodd">`,
  ];
  if (scene.name) out.push(`<title>${escapeText(scene.name)}</title>`);
  out.push(`<rect x="${box[0]}" y="${box[1]}" width="${box[2]}" height="${box[3]}" fill="${relief.board}"/>`);
  out.push('<defs>');
  relief.sheets.forEach((sheet, k) => {
    const d = sheet.loops
      .map((points) => pathData({ points, closed: true, decimals: sheet.decimals, bound: 0 }))
      .join('');
    out.push(`<path id="s${k + 1}" d="${d}"/>`);
  });
  out.push('</defs>');
  const about = (scale: number) => {
    const [a, , , d, e, f] = scaleAbout(scale, relief.lamp.x, relief.lamp.y);
    return `matrix(${formatNumber(a, 4)} 0 0 ${formatNumber(d, 4)} ${formatNumber(e, 3)} ${formatNumber(f, 3)})`;
  };
  const transforms = shadow.scales.map(about);
  const lit = about(relief.lit.scale);
  relief.sheets.forEach((sheet, k) => {
    const copies = transforms.map((transform) => `<use xlink:href="#s${k + 1}" transform="${transform}"/>`).join('');
    out.push(`<g fill="${shadow.colour}" fill-opacity="${formatNumber(shadow.opacity, 3)}">${copies}</g>`);
    out.push(`<use xlink:href="#s${k + 1}" transform="${lit}" fill="${relief.lit.colour}" fill-opacity="${formatNumber(relief.lit.opacity, 3)}"/>`);
    out.push(`<use xlink:href="#s${k + 1}" fill="${sheet.colour}"/>`);
  });
  out.push('</svg>');
  return { svg: `${out.join('\n')}\n`, sheets: relief.sheets.length, copies: relief.sheets.length * (shadow.scales.length + 1) };
}
