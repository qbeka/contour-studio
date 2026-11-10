/**
 * Draws geometry to a canvas.
 *
 * The transform is explicit: device px = dpr * (view.scale * model + view.offset).
 * Nothing here feeds back into the scene, so moving a window to a display with a
 * different pixel ratio changes the raster and leaves the geometry alone.
 */

import type { Geometry } from '../core/pipeline';
import type { Scene } from '../core/scene';
import { levelStyle } from '../core/svg';
import { buildRelief, scaleAbout, type Lamp } from '../core/relief';
import { levelRegions, tintLoops, tintPass } from '../core/tint';

/** Recent draw times in ms, for the browser benchmark. Bounded on purpose. */
export const drawLog: number[] = [];

/** Path2D objects per geometry, so that pan and zoom never rebuild them. */
const cache = new WeakMap<Geometry, Path2D[]>();

function levelPaths(geometry: Geometry): Path2D[] {
  const hit = cache.get(geometry);
  if (hit) return hit;
  const built = geometry.levels.map((level) => {
    const path = new Path2D();
    for (const { points, closed } of level.paths) {
      path.moveTo(points[0], points[1]);
      for (let k = 2; k < points.length; k += 2) path.lineTo(points[k], points[k + 1]);
      if (closed) path.closePath();
    }
    return path;
  });
  cache.set(geometry, built);
  return built;
}

/** One Path2D per tint pass, lowest first, kept with the direction it was built for. */
const tintCache = new WeakMap<Geometry, { low: boolean; passes: Path2D[] }>();

function tintPasses(geometry: Geometry, low: boolean): Path2D[] {
  const hit = tintCache.get(geometry);
  if (hit && hit.low === low) return hit.passes;
  const passes: Path2D[] = [];
  for (const region of levelRegions(geometry)) {
    if (!region) continue;
    const loops = tintLoops(region, geometry.rect, low);
    if (loops.length === 0) continue;
    const path = new Path2D();
    for (const points of loops) {
      path.moveTo(points[0], points[1]);
      for (let k = 2; k < points.length; k += 2) path.lineTo(points[k], points[k + 1]);
      path.closePath();
    }
    passes.push(path);
  }
  tintCache.set(geometry, { low, passes });
  return passes;
}

export interface DrawTransform {
  scale: number;
  x: number;
  y: number;
  dpr: number;
}

/** Draws only the artwork. PNG export uses this too, so it matches the preview. */
export function drawArtwork(
  ctx: CanvasRenderingContext2D,
  geometry: Geometry,
  scene: Scene,
  t: DrawTransform,
): void {
  const started = performance.now();
  const { rect } = geometry;
  ctx.save();
  ctx.setTransform(t.dpr * t.scale, 0, 0, t.dpr * t.scale, t.dpr * t.x, t.dpr * t.y);
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  if (scene.style.background) {
    ctx.fillStyle = scene.style.background;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
  const { tint } = scene.style;
  if (tint !== 0) {
    ctx.fillStyle = scene.style.tintColor;
    ctx.globalAlpha = tintPass(tint, geometry.levels.length);
    for (const pass of tintPasses(geometry, tint < 0)) ctx.fill(pass, 'evenodd');
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = scene.style.stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const paths = levelPaths(geometry);
  geometry.levels.forEach((level, i) => {
    const look = levelStyle(scene, level.index);
    ctx.globalAlpha = look.opacity;
    ctx.lineWidth =
      scene.export.strokeScaling === 'fixed' ? look.width / t.scale : look.width;
    ctx.stroke(paths[i]);
  });
  ctx.restore();
  if (drawLog.length < 4096) drawLog.push(performance.now() - started);
}

/** One Path2D for each sheet of card, in the order the relief lists them. */
const sheetCache = new WeakMap<Geometry, Map<number, Path2D>>();

function sheetPath(geometry: Geometry, level: number, loops: Float64Array[]): Path2D {
  let made = sheetCache.get(geometry);
  if (!made) sheetCache.set(geometry, (made = new Map()));
  let path = made.get(level);
  if (!path) {
    path = new Path2D();
    for (const points of loops) {
      path.moveTo(points[0], points[1]);
      for (let k = 2; k < points.length; k += 2) path.lineTo(points[k], points[k + 1]);
      path.closePath();
    }
    made.set(level, path);
  }
  return path;
}

/**
 * Draws the drawing as a stack of cut card under a lamp. It fills the same
 * outlines the relief file names, in the same order and with the same transforms:
 * each sheet goes down over its shadow copies and its lit edge.
 */
export function drawRelief(
  ctx: CanvasRenderingContext2D,
  geometry: Geometry,
  scene: Scene,
  t: DrawTransform,
  lamp: Lamp,
  lift = 1,
): void {
  const started = performance.now();
  const relief = buildRelief(geometry, scene, lamp, lift);
  const { rect, shadow } = relief;
  const k = t.dpr * t.scale;
  const ox = t.dpr * t.x;
  const oy = t.dpr * t.y;
  const about = (scale: number) => {
    const [a, , , d, e, f] = scaleAbout(scale, relief.lamp.x, relief.lamp.y);
    return () => ctx.setTransform(k * a, 0, 0, k * d, k * e + ox, k * f + oy);
  };
  const base = about(1);
  ctx.save();
  base();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.fillStyle = relief.board;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  // Flat on the board there is nothing to throw a shadow, and the copies are skipped.
  const raised = relief.lit.scale !== 1;
  const grown = shadow.scales.map(about);
  const lit = about(relief.lit.scale);
  for (const sheet of relief.sheets) {
    const path = sheetPath(geometry, sheet.level, sheet.loops);
    if (raised) {
      ctx.fillStyle = shadow.colour;
      ctx.globalAlpha = shadow.opacity;
      for (const copy of grown) {
        copy();
        ctx.fill(path, 'evenodd');
      }
      ctx.fillStyle = relief.lit.colour;
      ctx.globalAlpha = relief.lit.opacity;
      lit();
      ctx.fill(path, 'evenodd');
      base();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = sheet.colour;
    ctx.fill(path, 'evenodd');
  }
  ctx.restore();
  if (drawLog.length < 4096) drawLog.push(performance.now() - started);
}

export function drawNodes(
  ctx: CanvasRenderingContext2D,
  geometry: Geometry,
  t: DrawTransform,
  color: string,
): void {
  ctx.save();
  ctx.setTransform(t.dpr, 0, 0, t.dpr, 0, 0);
  ctx.fillStyle = color;
  const size = 2.5;
  for (const level of geometry.levels) {
    for (const { points } of level.paths) {
      for (let k = 0; k < points.length; k += 2) {
        ctx.fillRect(
          points[k] * t.scale + t.x - size / 2,
          points[k + 1] * t.scale + t.y - size / 2,
          size,
          size,
        );
      }
    }
  }
  ctx.restore();
}
