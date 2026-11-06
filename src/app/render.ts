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
