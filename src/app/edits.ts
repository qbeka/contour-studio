/** Pure scene edits. Each returns a new scene and leaves the old one untouched. */

import { LIMITS, type PeakSource, type RidgeSource, type Scene, type Source } from '../core/scene';

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function clampPosition(value: number): number {
  return clamp(value, LIMITS.position.min, LIMITS.position.max);
}

function nextId(scene: Scene): string {
  let n = scene.sources.length + 1;
  const used = new Set(scene.sources.map((s) => s.id));
  while (used.has(`s${n}`)) n++;
  return `s${n}`;
}

function nextName(scene: Scene, word: string): string {
  const used = new Set(scene.sources.map((s) => s.name));
  let n = 1;
  while (used.has(`${word} ${n}`)) n++;
  return `${word} ${n}`;
}

export function defaultReach(scene: Scene): number {
  return Math.round(Math.min(scene.clip.width, scene.clip.height) * 0.35);
}

/** Every way of adding a source checks this, so a scene cannot outgrow the format. */
export function hasRoom(scene: Scene): boolean {
  return scene.sources.length < LIMITS.sources;
}

export function addPeak(scene: Scene, x: number, y: number): { scene: Scene; id: string } {
  const id = nextId(scene);
  const source: PeakSource = {
    id,
    name: nextName(scene, 'Peak'),
    kind: 'peak',
    enabled: true,
    x: clampPosition(x),
    y: clampPosition(y),
    radius: defaultReach(scene),
    height: 1,
  };
  return { scene: { ...scene, sources: [...scene.sources, source] }, id };
}

export function addRidge(
  scene: Scene,
  points: { x: number; y: number }[],
): { scene: Scene; id: string } {
  const id = nextId(scene);
  const source: RidgeSource = {
    id,
    name: nextName(scene, 'Ridge'),
    kind: 'ridge',
    enabled: true,
    points: points.map((p) => ({ x: clampPosition(p.x), y: clampPosition(p.y) })),
    radius: Math.round(defaultReach(scene) * 0.6),
    height: 0.8,
  };
  return { scene: { ...scene, sources: [...scene.sources, source] }, id };
}

export function updateSource(scene: Scene, id: string, change: Partial<Source>): Scene {
  return {
    ...scene,
    sources: scene.sources.map((s) => (s.id === id ? ({ ...s, ...change } as Source) : s)),
  };
}

export function moveSource(scene: Scene, id: string, dx: number, dy: number): Scene {
  return {
    ...scene,
    sources: scene.sources.map((s) => {
      if (s.id !== id) return s;
      if (s.kind === 'peak') {
        return { ...s, x: clampPosition(s.x + dx), y: clampPosition(s.y + dy) };
      }
      return {
        ...s,
        points: s.points.map((p) => ({
          x: clampPosition(p.x + dx),
          y: clampPosition(p.y + dy),
        })),
      };
    }),
  };
}

export function setHandle(scene: Scene, id: string, index: number, x: number, y: number): Scene {
  return {
    ...scene,
    sources: scene.sources.map((s) => {
      if (s.id !== id) return s;
      const px = clampPosition(x);
      const py = clampPosition(y);
      if (s.kind === 'peak') return { ...s, x: px, y: py };
      return { ...s, points: s.points.map((p, i) => (i === index ? { x: px, y: py } : p)) };
    }),
  };
}

export function addHandle(scene: Scene, id: string, after: number): Scene {
  return {
    ...scene,
    sources: scene.sources.map((s) => {
      if (s.id !== id || s.kind !== 'ridge' || s.points.length >= LIMITS.handles.max) return s;
      const a = s.points[after];
      const b = s.points[Math.min(s.points.length - 1, after + 1)];
      const extra =
        a === b
          ? { x: clampPosition(a.x + 80), y: a.y }
          : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const points = [...s.points];
      points.splice(after + 1, 0, extra);
      return { ...s, points };
    }),
  };
}

export function removeHandle(scene: Scene, id: string, index: number): Scene {
  return {
    ...scene,
    sources: scene.sources.map((s) => {
      if (s.id !== id || s.kind !== 'ridge' || s.points.length <= LIMITS.handles.min) return s;
      return { ...s, points: s.points.filter((_, i) => i !== index) };
    }),
  };
}

export function duplicateSource(scene: Scene, id: string): { scene: Scene; id: string } | null {
  const source = scene.sources.find((s) => s.id === id);
  if (!source || !hasRoom(scene)) return null;
  const copyId = nextId(scene);
  const offset = 40;
  const name = `${source.name} copy`.slice(0, LIMITS.name);
  const copy: Source =
    source.kind === 'peak'
      ? {
          ...source,
          id: copyId,
          name,
          x: clampPosition(source.x + offset),
          y: clampPosition(source.y + offset),
        }
      : {
          ...source,
          id: copyId,
          name,
          points: source.points.map((p) => ({
            x: clampPosition(p.x + offset),
            y: clampPosition(p.y + offset),
          })),
        };
  const index = scene.sources.findIndex((s) => s.id === id);
  const sources = [...scene.sources];
  sources.splice(index + 1, 0, copy);
  return { scene: { ...scene, sources }, id: copyId };
}

export function removeSource(scene: Scene, id: string): Scene {
  return { ...scene, sources: scene.sources.filter((s) => s.id !== id) };
}

export const SNAP_STEP = 10;

/** Rounds to the snap grid, and to the frame centre when that is nearer. */
export function snapPoint(scene: Scene, x: number, y: number): { x: number; y: number } {
  const cx = scene.clip.x + scene.clip.width / 2;
  const cy = scene.clip.y + scene.clip.height / 2;
  const axis = (value: number, centre: number) => {
    const rounded = Math.round(value / SNAP_STEP) * SNAP_STEP;
    return Math.abs(value - centre) < Math.abs(value - rounded) ? centre : rounded;
  };
  return { x: axis(x, cx), y: axis(y, cy) };
}
