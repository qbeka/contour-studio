/**
 * The drawing as a link. The address holds the plate or the seed, the palette,
 * and any edits, so that opening it gives the same drawing again.
 *
 * Edits are written only when the drawing differs from its plate. They are short
 * tokens of whole numbers, which survive any place a link gets pasted.
 */

import { PLATES, SEED_LIMIT, applyPalette, generatePlate, paletteById, paletteOf, type Plate } from '../src/core/plates';
import { DEFAULT_LAMP, clampLamp, type Lamp } from '../src/core/relief';
import { LIMITS, validateScene, type Scene, type Source } from '../src/core/scene';

/** How the drawing is shown: as a line print, or as a stack of cut card under a lamp. */
export interface Look {
  view: 'lines' | 'relief';
  lamp: Lamp;
}

export const DEFAULT_LOOK: Look = { view: 'lines', lamp: DEFAULT_LAMP };

export interface LinkState {
  plate: Plate;
  scene: Scene;
  look: Look;
}

const VERSION = 'v1';

const sameField = (a: Scene, b: Scene) =>
  JSON.stringify([a.sources, a.levels, a.noise, a.style.tint]) ===
  JSON.stringify([b.sources, b.levels, b.noise, b.style.tint]);

/** True when the drawing is its plate, in any palette. */
export function isOriginal(plate: Plate, scene: Scene): boolean {
  return sameField(plate.scene, scene);
}

function encodeSource(source: Source): string {
  const head = [source.id, Math.round(source.radius), Math.round(source.height * 100)];
  if (source.kind === 'peak') return [...head, Math.round(source.x), Math.round(source.y)].join('.');
  // A disabled source is simply left out, which draws the same.
  return [...head, ...source.points.flatMap((p) => [Math.round(p.x), Math.round(p.y)])].join('.');
}

export function encodeEdits(scene: Scene): string {
  const head = [
    VERSION,
    Math.round(scene.levels.spacing * 1000),
    scene.levels.count,
    Math.round(scene.noise.amplitude * 1000),
    Math.round(scene.style.tint * 100),
  ].join('.');
  return [head, ...scene.sources.filter((s) => s.enabled).map(encodeSource)].join('_');
}

const ID = /^[A-Za-z0-9]{1,24}$/;
const WHOLE = /^-?\d{1,6}$/;

/** Rebuilds a scene from edits, on top of its plate. Null when the text is not valid. */
export function decodeEdits(plate: Plate, text: string): Scene | null {
  const [head, ...rest] = text.split('_');
  const top = head.split('.');
  if (top.length !== 5 || top[0] !== VERSION || !top.slice(1).every((t) => WHOLE.test(t))) return null;
  if (rest.length > LIMITS.sources) return null;
  const [spacing, count, amplitude, tint] = top.slice(1).map(Number);
  const base = plate.scene;
  const known = new Map(base.sources.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const part of rest) {
    const [id, ...numbers] = part.split('.');
    if (!ID.test(id) || seen.has(id) || !numbers.every((t) => WHOLE.test(t))) return null;
    seen.add(id);
    const [radius, height, ...at] = numbers.map(Number);
    const name = known.get(id)?.name;
    const h = height / 100;
    if (at.length === 2) {
      sources.push({ id, name: name ?? 'Added peak', kind: 'peak', enabled: true, x: at[0], y: at[1], radius, height: h });
    } else if (at.length >= 4 && at.length % 2 === 0) {
      const points = [];
      for (let k = 0; k < at.length; k += 2) points.push({ x: at[k], y: at[k + 1] });
      sources.push({ id, name: name ?? 'Added ridge', kind: 'ridge', enabled: true, points, radius, height: h });
    } else {
      return null;
    }
  }
  const scene: Scene = {
    ...base,
    sources,
    levels: { ...base.levels, spacing: spacing / 1000, count },
    noise: { ...base.noise, amplitude: amplitude / 1000 },
    style: { ...base.style, tint: tint / 100 },
  };
  const checked = validateScene(scene);
  return checked.ok ? scene : null;
}

/** The query for a drawing. Parameters that say nothing new are left out. */
export function writeLink(
  plate: Plate,
  scene: Scene,
  query: URLSearchParams = new URLSearchParams(),
  look: Look = DEFAULT_LOOK,
): URLSearchParams {
  const out = new URLSearchParams(query);
  for (const key of ['plate', 'seed', 'ink', 'e', 'view', 'lamp']) out.delete(key);
  if (plate.seed !== undefined) out.set('seed', String(plate.seed));
  else if (plate !== PLATES[0]) out.set('plate', plate.id);
  const palette = paletteOf(scene);
  if (palette && palette !== paletteOf(plate.scene)) out.set('ink', palette.id);
  if (!isOriginal(plate, scene)) out.set('e', encodeEdits(scene));
  if (look.view === 'relief') {
    out.set('view', 'relief');
    // The lamp is written in hundredths of the frame, and only once it has been moved.
    const lamp = encodeLamp(look.lamp);
    if (lamp !== encodeLamp(DEFAULT_LAMP)) out.set('lamp', lamp);
  }
  return out;
}

const encodeLamp = (lamp: Lamp) => `${Math.round(clampLamp(lamp).u * 100)}.${Math.round(clampLamp(lamp).v * 100)}`;

/** Reads the view and the lamp. Anything it cannot read is the default. */
export function readLook(query: URLSearchParams): Look {
  const view = query.get('view') === 'relief' ? 'relief' : 'lines';
  const at = /^(\d{1,3})\.(\d{1,3})$/.exec(query.get('lamp') ?? '');
  const lamp = at ? clampLamp({ u: Number(at[1]) / 100, v: Number(at[2]) / 100 }) : DEFAULT_LAMP;
  return { view, lamp };
}

/** Reads a drawing from a query. Anything it cannot read falls back, never fails. */
export function readLink(query: URLSearchParams): LinkState {
  let plate: Plate = PLATES[0];
  const seed = query.get('seed');
  if (seed !== null && /^\d{1,6}$/.test(seed) && Number(seed) < SEED_LIMIT) {
    plate = generatePlate(Number(seed));
  } else {
    plate = PLATES.find((p) => p.id === query.get('plate')) ?? PLATES[0];
  }
  let scene = plate.scene;
  const edits = query.get('e');
  if (edits !== null && edits.length <= 4000) scene = decodeEdits(plate, edits) ?? scene;
  const palette = paletteById(query.get('ink'));
  if (palette) scene = applyPalette(scene, palette);
  return { plate, scene, look: readLook(query) };
}
