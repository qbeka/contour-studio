/**
 * The ground above each level, as closed loops, for hypsometric tint.
 *
 * Nothing here samples the field. Extraction orients every path with the higher
 * ground on its left on screen, and clipping and simplifying keep that order. So
 * a path that leaves the frame continues along the frame's edge, counter
 * clockwise on screen, until the next path comes in. The loops are made of the
 * output vertices themselves, which is why a tint edge always sits on its line.
 */

import type { Geometry, OutputLevel } from './pipeline';
import type { Rect } from './scene';
import { signedArea } from './topology';

export interface LevelRegion {
  /** Closed loops, interleaved x, y. Filled with the even-odd rule. */
  loops: Float64Array[];
  /** The largest decimals among the paths used, for printing. */
  decimals: number;
}

/**
 * Distance along the frame's edge, counter clockwise on screen from the bottom
 * left corner, with each side one unit long. A point is read on its nearest side.
 */
function edgeParameter(x: number, y: number, rect: Rect): number {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const toBottom = Math.abs(y - bottom);
  const toRight = Math.abs(x - right);
  const toTop = Math.abs(y - rect.y);
  const toLeft = Math.abs(x - rect.x);
  const nearest = Math.min(toBottom, toRight, toTop, toLeft);
  const along = (value: number) => Math.min(1, Math.max(0, value));
  if (nearest === toBottom) return along((x - rect.x) / rect.width);
  if (nearest === toRight) return 1 + along((bottom - y) / rect.height);
  if (nearest === toTop) return 2 + along((right - x) / rect.width);
  return 3 + along((y - rect.y) / rect.height);
}

/** Corner k is where side k ends. Corner 4 is the bottom left again. */
function corner(k: number, rect: Rect): [number, number] {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  switch (((k % 4) + 4) % 4) {
    case 1:
      return [right, bottom];
    case 2:
      return [right, rect.y];
    case 3:
      return [rect.x, rect.y];
    default:
      return [rect.x, bottom];
  }
}

function frameLoop(rect: Rect): Float64Array {
  return Float64Array.from([0, 1, 2, 3].flatMap((k) => corner(k, rect)));
}

interface Built {
  region: LevelRegion | null;
  /** What a level with no lines of its own can learn from this one. */
  hasLines: boolean;
}

function buildLevel(level: OutputLevel, rect: Rect): Built {
  const open = level.paths.filter((path) => !path.closed);
  const closed = level.paths.filter((path) => path.closed);
  if (level.paths.length === 0) return { region: null, hasLines: false };

  const loops: Float64Array[] = closed.map((path) => path.points);
  let decimals = 0;
  for (const path of level.paths) decimals = Math.max(decimals, path.decimals);

  if (open.length === 0) {
    // With no line reaching the edge, the edge is all above or all below. The
    // largest loop is outside every other, and its direction says which.
    let largest = 0;
    for (const loop of loops) {
      const area = signedArea(loop);
      if (Math.abs(area) > Math.abs(largest)) largest = area;
    }
    // On screen y points down, so a positive area is clockwise: a hollow.
    if (largest > 0) loops.push(frameLoop(rect));
    return { region: { loops, decimals }, hasLines: true };
  }

  // Each path's end is joined to the next start along the edge.
  const starts = open
    .map((path, index) => ({ index, t: edgeParameter(path.points[0], path.points[1], rect) }))
    .sort((a, b) => a.t - b.t);
  const next = new Int32Array(open.length).fill(-1);
  const arrivals = new Uint8Array(open.length);
  const endAt = open.map((path) => {
    const n = path.points.length;
    return edgeParameter(path.points[n - 2], path.points[n - 1], rect);
  });
  for (let i = 0; i < open.length; i++) {
    const t = endAt[i];
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (starts[mid].t < t) low = mid + 1;
      else high = mid;
    }
    const target = starts[low % starts.length].index;
    next[i] = target;
    arrivals[target]++;
  }
  // Every start must be reached once. Anything else is not a set of boundaries,
  // and a wrong fill is worse than none.
  for (let i = 0; i < open.length; i++) {
    if (arrivals[i] !== 1) return { region: null, hasLines: true };
  }

  const visited = new Uint8Array(open.length);
  for (let first = 0; first < open.length; first++) {
    if (visited[first]) continue;
    const loop: number[] = [];
    let i = first;
    do {
      visited[i] = 1;
      const { points } = open[i];
      for (let k = 0; k < points.length; k++) loop.push(points[k]);
      const j = next[i];
      const from = endAt[i];
      let to = edgeParameter(open[j].points[0], open[j].points[1], rect);
      if (to < from) to += 4;
      for (let k = Math.floor(from) + 1; k <= to; k++) {
        const [cx, cy] = corner(k, rect);
        const n = loop.length;
        if (loop[n - 2] !== cx || loop[n - 1] !== cy) loop.push(cx, cy);
      }
      i = j;
    } while (i !== first);
    loops.push(Float64Array.from(loop));
  }
  return { region: { loops, decimals }, hasLines: true };
}

const cache = new WeakMap<Geometry, (LevelRegion | null)[]>();

/**
 * The region above each level, in level order. A region with no loops is ground
 * that is all below its level. Null means the region could not be worked out, and
 * nothing is drawn for it.
 */
export function levelRegions(geometry: Geometry): (LevelRegion | null)[] {
  const hit = cache.get(geometry);
  if (hit) return hit;
  const { rect, levels } = geometry;
  const built = levels.map((level) => buildLevel(level, rect));
  const regions = built.map((b) => b.region);
  // A level with no lines covers the whole frame or none of it. Regions nest, so
  // a higher level that has lines means this one covers everything.
  // One below a level that has lines covers nothing.
  const any = built.some((b) => b.hasLines);
  let linesAbove = false;
  for (let k = levels.length - 1; k >= 0; k--) {
    if (built[k].hasLines) linesAbove = true;
    else if (any) regions[k] = { loops: linesAbove ? [frameLoop(rect)] : [], decimals: 0 };
  }
  cache.set(geometry, regions);
  return regions;
}

/** The opacity of one pass, chosen so that all the passes together reach `tint`. */
export function tintPass(tint: number, levels: number): number {
  const depth = Math.min(1, Math.abs(tint)) * 0.72;
  if (depth === 0 || levels < 1) return 0;
  return 1 - (1 - depth) ** (1 / levels);
}

/** The loops to fill for one level: the ground above it, or under it when `low`. */
export function tintLoops(region: LevelRegion, rect: Rect, low: boolean): Float64Array[] {
  return low ? [frameLoop(rect), ...region.loops] : region.loops;
}

/** Whether a point is inside a region. Used by the tests. */
export function regionContains(region: LevelRegion, x: number, y: number): boolean {
  let inside = false;
  for (const loop of region.loops) {
    const n = loop.length;
    for (let k = 0, j = n - 2; k < n; j = k, k += 2) {
      const xi = loop[k];
      const yi = loop[k + 1];
      const xj = loop[j];
      const yj = loop[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
