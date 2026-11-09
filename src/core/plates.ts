/**
 * Plates: finished compositions with their print styling, and the seeded
 * generator that makes new ones.
 *
 * The first three plates are the starter scenes with nothing about their fields
 * changed, so every measurement made on a starter still describes its plate. The
 * other three were placed by hand for this project. Nothing is traced.
 */

import { fieldFunction } from './field';
import { PRESETS } from './presets';
import { emptyScene, type PeakSource, type Rect, type RidgeSource, type Scene, type Source } from './scene';

export interface Palette {
  id: string;
  name: string;
  paper: string;
  ink: string;
  tint: string;
}

export const PALETTES: readonly Palette[] = [
  { id: 'forest', name: 'Forest', paper: '#f7f4ec', ink: '#1d3a2a', tint: '#5f8a66' },
  { id: 'ink', name: 'Ink', paper: '#f8f6f1', ink: '#16181a', tint: '#8b8d8c' },
  { id: 'indigo', name: 'Indigo', paper: '#f4f2ec', ink: '#1f2a52', tint: '#6478ad' },
  { id: 'terracotta', name: 'Terracotta', paper: '#f8f1e7', ink: '#58291a', tint: '#c9743c' },
  { id: 'night', name: 'Night', paper: '#111c17', ink: '#dfe7dc', tint: '#3d6a55' },
];

export function paletteById(id: string | null | undefined): Palette | undefined {
  return PALETTES.find((palette) => palette.id === id);
}

export function applyPalette(scene: Scene, palette: Palette): Scene {
  return {
    ...scene,
    style: { ...scene.style, stroke: palette.ink, background: palette.paper, tintColor: palette.tint },
  };
}

/** The palette a scene is printed in, if its three colours are one of the set. */
export function paletteOf(scene: Scene): Palette | undefined {
  const { stroke, background, tintColor } = scene.style;
  return PALETTES.find((p) => p.ink === stroke && p.paper === background && p.tint === tintColor);
}

export interface Plate {
  id: string;
  /** I to VI for the set. Empty for a generated plate. */
  numeral: string;
  name: string;
  scene: Scene;
  /** The source a first visitor is pointed at. */
  primary: string;
  /** A frame of any shape stays centred here. */
  focus: { x: number; y: number };
  /** The widest and narrowest frame this plate can take, as width over height. */
  aspect: [number, number];
  /** Set for a generated plate. */
  seed?: number;
}

function peak(id: string, name: string, x: number, y: number, radius: number, height: number): PeakSource {
  return { id, name, kind: 'peak', enabled: true, x, y, radius, height };
}

function ridge(id: string, name: string, points: [number, number][], radius: number, height: number): RidgeSource {
  return { id, name, kind: 'ridge', enabled: true, points: points.map(([x, y]) => ({ x, y })), radius, height };
}

type Print = Partial<Scene['style']> & { palette: string };

function printed(scene: Scene, { palette, ...style }: Print): Scene {
  const colours = paletteById(palette) as Palette;
  return applyPalette({ ...scene, style: { ...scene.style, ...style } }, colours);
}

function tune(scene: Scene, id: string, change: Partial<PeakSource>): Scene {
  return { ...scene, sources: scene.sources.map((s) => (s.id === id ? ({ ...s, ...change } as Source) : s)) };
}

function caldera(): Scene {
  const base = emptyScene();
  return {
    ...base,
    name: 'Caldera',
    seed: 1883,
    domain: { width: 1400, height: 1000 },
    clip: { x: 0, y: 0, width: 1400, height: 1000 },
    sources: [
      peak('massif', 'Massif', 690, 500, 640, 0.62),
      ridge(
        'rim',
        'Crater rim',
        [[905, 560], [860, 330], [650, 262], [470, 380], [452, 590], [610, 725], [800, 700]],
        128,
        0.74,
      ),
      peak('cone', 'Inner cone', 668, 492, 96, 0.3),
      peak('breach', 'Breach', 930, 660, 190, -0.34),
      ridge('spur', 'West spur', [[430, 520], [250, 610], [60, 560]], 120, 0.2),
    ],
    noise: { amplitude: 0.03, scale: 230, octaves: 3 },
    levels: { base: 0.1, spacing: 0.066, count: 20 },
    export: { ...base.export, tolerance: 0.12, decimals: 1 },
  };
}

function archipelago(): Scene {
  const base = emptyScene();
  const islands: [number, number, number, number][] = [
    [330, 300, 250, 0.92], [560, 470, 170, 0.6], [215, 610, 150, 0.52], [820, 250, 130, 0.5],
    [1010, 560, 290, 1.02], [1265, 330, 160, 0.62], [1390, 700, 190, 0.7], [700, 770, 140, 0.48],
    [1150, 850, 110, 0.4], [480, 120, 100, 0.36], [1480, 180, 120, 0.42],
  ];
  return {
    ...base,
    name: 'Archipelago',
    seed: 4471,
    domain: { width: 1600, height: 1000 },
    clip: { x: 0, y: 0, width: 1600, height: 1000 },
    sources: [
      ...islands.map(([x, y, radius, height], i) => peak(`isle${i + 1}`, `Island ${i + 1}`, x, y, radius, height)),
      ridge('trench', 'Trench', [[-40, 880], [420, 800], [860, 930], [1300, 1040]], 200, -0.26),
    ],
    noise: { amplitude: 0.05, scale: 170, octaves: 3 },
    levels: { base: 0.07, spacing: 0.075, count: 13 },
    export: { ...base.export, tolerance: 0.12, decimals: 1 },
  };
}

function terraces(): Scene {
  const base = emptyScene();
  return {
    ...base,
    name: 'Terraces',
    seed: 808,
    domain: { width: 1600, height: 1000 },
    clip: { x: 0, y: 0, width: 1600, height: 1000 },
    sources: [
      peak('slope', 'Hillside', -300, -260, 3600, 3),
      ridge('upper', 'Upper bank', [[60, 250], [420, 330], [800, 250], [1180, 330], [1560, 240]], 150, 0.24),
      ridge('lower', 'Lower bank', [[40, 640], [380, 560], [760, 660], [1120, 570], [1570, 650]], 170, 0.22),
      ridge('river', 'River', [[1000, -40], [930, 260], [1010, 520], [900, 780], [960, 1040]], 120, -0.3),
      peak('knoll', 'Knoll', 420, 760, 180, 0.3),
    ],
    noise: { amplitude: 0.024, scale: 260, octaves: 2 },
    levels: { base: 0.8, spacing: 0.082, count: 25 },
    export: { ...base.export, tolerance: 0.12, decimals: 1 },
  };
}

function plate(
  numeral: string,
  id: string,
  name: string,
  scene: Scene,
  primary: string,
  focus: Plate['focus'],
  aspect: Plate['aspect'],
  print: Print,
): Plate {
  return { id, numeral, name, scene: printed(scene, print), primary, focus, aspect };
}

// Each starter's field is left alone apart from one source, which is placed so
// that its rings close around the handle. The page has always shown them this way.
export const PLATES: readonly Plate[] = [
  plate('I', 'quiet-ridge', 'Quiet ridge', tune(PRESETS[0].scene, 'summit', { x: 260, y: 312 }), 'summit',
    { x: 340, y: 320 }, [0.5, 3],
    { palette: 'forest', strokeWidth: 0.85, fade: 0.5, taper: 0.3, indexEvery: 5, indexWidth: 1.5, tint: 0.5 }),
  plate('II', 'asymmetric-basin', 'Tall basin', tune(PRESETS[1].scene, 'island', { radius: 96, height: 0.78 }), 'island',
    { x: 500, y: 500 }, [0.5, 0.8],
    { palette: 'indigo', strokeWidth: 0.8, fade: 0.3, taper: 0, indexEvery: 5, indexWidth: 1.5, tint: -0.62 }),
  plate('III', 'interference-study', 'Interference', tune(PRESETS[2].scene, 's6', { name: 'Centre peak', radius: 130, height: 1.32 }), 's6',
    { x: 600, y: 400 }, [0.5, 3],
    { palette: 'ink', strokeWidth: 0.7, fade: 0.35, taper: 0.4, indexEvery: 4, indexWidth: 1.3, tint: 0 }),
  plate('IV', 'caldera', 'Caldera', caldera(), 'cone', { x: 690, y: 500 }, [0.6, 1.4],
    { palette: 'terracotta', strokeWidth: 0.8, fade: 0.4, taper: 0.25, indexEvery: 5, indexWidth: 1.5, tint: 0.58 }),
  plate('V', 'archipelago', 'Archipelago', archipelago(), 'isle5', { x: 800, y: 500 }, [0.5, 1.6],
    { palette: 'night', strokeWidth: 0.8, fade: 0.45, taper: 0.2, indexEvery: 4, indexWidth: 1.4, tint: 0.7 }),
  plate('VI', 'terraces', 'Terraces', terraces(), 'knoll', { x: 800, y: 500 }, [0.5, 1.6],
    { palette: 'forest', strokeWidth: 0.75, fade: 0.55, taper: 0.35, indexEvery: 5, indexWidth: 1.45, tint: 0.42 }),
];

/* The generator */

/** Seeds are six digits, so a link stays short enough to read aloud. */
export const SEED_LIMIT = 1_000_000;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Quiet', 'Far', 'Low', 'High', 'Still', 'Long', 'Old', 'Soft', 'Narrow', 'Broad', 'Grey', 'North', 'East', 'Lost', 'Winter', 'Morning'];
const LAND = {
  range: ['ridge', 'spur', 'crest', 'saddle', 'scarp', 'fell'],
  basin: ['basin', 'tarn', 'hollow', 'cirque', 'sink', 'bowl'],
  isles: ['isles', 'skerries', 'shoals', 'keys', 'holms', 'banks'],
  massif: ['massif', 'dome', 'knoll', 'tor', 'summit', 'cone'],
} as const;

type Kind = keyof typeof LAND;
const KINDS: Kind[] = ['range', 'basin', 'isles', 'massif'];

const W = 1600;
const H = 1000;

/**
 * A composition from a seed. Positions are whole units and heights two decimals,
 * so the same seed gives the same scene on any engine.
 */
export function generatePlate(seedInput: number): Plate {
  const seed = ((Math.floor(seedInput) % SEED_LIMIT) + SEED_LIMIT) % SEED_LIMIT;
  const r = rng(seed * 2654435761);
  const between = (low: number, high: number) => low + r() * (high - low);
  const whole = (low: number, high: number) => Math.round(between(low, high));
  const cents = (low: number, high: number) => Math.round(between(low, high) * 100) / 100;
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)];

  const kind = pick(KINDS);
  const sources: Source[] = [];
  let count = 0;
  const add = (source: Source) => sources.push(source);
  const id = (word: string) => `${word}${++count}`;
  /** A wandering line of handles from one side of the sheet to the other. */
  const sweep = (y0: number, y1: number, n: number, wobble: number): [number, number][] =>
    Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      return [whole(-80, 0) + Math.round(t * (W + 160)), Math.round(y0 + (y1 - y0) * t + between(-wobble, wobble))];
    });

  let primary = '';
  let tint = cents(0.4, 0.62);
  if (kind === 'range') {
    add(ridge(id('r'), 'Main crest', sweep(between(300, 700), between(300, 700), whole(4, 6), 150), whole(170, 240), cents(0.7, 0.95)));
    if (r() < 0.6) add(ridge(id('r'), 'Second crest', sweep(between(100, 900), between(100, 900), whole(3, 5), 120), whole(120, 180), cents(0.25, 0.45)));
    primary = id('p');
    add(peak(primary, 'Summit', whole(300, 1300), whole(280, 720), whole(150, 230), cents(0.3, 0.5)));
    const extras = whole(1, 3);
    for (let i = 0; i < extras; i++) {
      const hollow = r() < 0.45;
      add(peak(id('p'), hollow ? 'Hollow' : 'Shoulder', whole(100, 1500), whole(100, 900), whole(140, 260), hollow ? cents(-0.3, -0.15) : cents(0.2, 0.4)));
    }
  } else if (kind === 'basin') {
    const cx = whole(600, 1000);
    const cy = whole(420, 580);
    add(peak(id('p'), 'Bowl', cx, cy, whole(620, 820), cents(-1.2, -0.9)));
    const n = whole(4, 6);
    const start = between(0, 1);
    const arc: [number, number][] = Array.from({ length: n }, (_, i) => {
      // A quarter turn table stands in for sine and cosine, which engines may round differently.
      const turn = start + (i / (n - 1)) * between(0.45, 0.7);
      const [ux, uy] = unit(turn);
      const reach = between(380, 520);
      return [Math.round(cx + ux * reach * 1.25), Math.round(cy + uy * reach * 0.8)];
    });
    add(ridge(id('r'), 'Rim', arc, whole(190, 260), cents(0.6, 0.85)));
    primary = id('p');
    add(peak(primary, 'Island', cx + whole(-160, 160), cy + whole(-120, 120), whole(110, 170), cents(0.4, 0.6)));
    add(peak(id('p'), 'Outlet', whole(100, 1500), whole(700, 950), whole(200, 280), cents(-0.45, -0.25)));
    tint = -cents(0.45, 0.65);
  } else if (kind === 'isles') {
    const n = whole(7, 11);
    for (let i = 0; i < n; i++) {
      const big = i < 2;
      const key = id('p');
      if (i === 0) primary = key;
      add(peak(key, `Island ${i + 1}`, whole(120, 1480), whole(120, 880), big ? whole(220, 300) : whole(90, 190), big ? cents(0.8, 1.05) : cents(0.35, 0.7)));
    }
    add(ridge(id('r'), 'Trench', sweep(between(200, 800), between(200, 800), 4, 160), whole(160, 220), cents(-0.3, -0.18)));
  } else {
    const cx = whole(560, 1040);
    const cy = whole(400, 600);
    add(peak(id('p'), 'Massif', cx, cy, whole(560, 700), cents(0.7, 0.95)));
    const arms = whole(2, 4);
    const first = between(0, 1);
    for (let i = 0; i < arms; i++) {
      const [ux, uy] = unit(first + i / arms + between(-0.06, 0.06));
      const length = between(420, 640);
      const bend = between(-90, 90);
      add(ridge(id('r'), `Arm ${i + 1}`, [
        [Math.round(cx + ux * 60), Math.round(cy + uy * 60)],
        [Math.round(cx + ux * length * 0.5 - uy * bend), Math.round(cy + uy * length * 0.5 + ux * bend)],
        [Math.round(cx + ux * length), Math.round(cy + uy * length)],
      ], whole(110, 160), cents(0.28, 0.46)));
    }
    primary = id('p');
    add(peak(primary, 'Summit', cx + whole(-70, 70), cy + whole(-60, 60), whole(110, 170), cents(0.25, 0.42)));
    if (r() < 0.7) add(peak(id('p'), 'Corrie', whole(200, 1400), whole(150, 850), whole(170, 240), cents(-0.36, -0.2)));
  }

  const base = emptyScene();
  const texture = { amplitude: cents(0.015, 0.045), scale: whole(150, 280), octaves: whole(2, 3) };
  const smooth: Scene = {
    ...base,
    seed,
    domain: { width: W, height: H },
    clip: { x: 0, y: 0, width: W, height: H },
    sources,
  };

  // The lines are spread over the heights the sheet really has.
  const f = fieldFunction(smooth);
  let low = Infinity;
  let high = -Infinity;
  for (let j = 0; j <= 20; j++) {
    for (let i = 0; i <= 32; i++) {
      const value = f((i * W) / 32, (j * H) / 20);
      if (value < low) low = value;
      if (value > high) high = value;
    }
  }
  const lines = whole(14, 22);
  const spacing = Math.max(0.02, Math.round(((high - low) / (lines + 1)) * 1000) / 1000);
  // Flat ground sits at zero, and a level there would trace the texture as scraps.
  // So zero falls halfway between two levels, and the texture stays under that gap.
  const first = (Math.ceil(low / spacing) + 0.5) * spacing;
  const noise = { ...texture, amplitude: Math.min(texture.amplitude, Math.round(spacing * 30) / 100) };
  const draft: Scene = { ...smooth, noise };
  const palette = kind === 'isles' && r() < 0.5 ? (paletteById('night') as Palette) : pick(PALETTES);
  const name = `${pick(FIRST)} ${pick(LAND[kind])}`;
  const scene = printed(
    {
      ...draft,
      name,
      levels: { base: Math.round(first * 10000) / 10000, spacing, count: lines },
      export: { ...base.export, tolerance: 0.12, decimals: 1 },
    },
    { palette: palette.id, strokeWidth: 0.8, fade: cents(0.3, 0.55), taper: cents(0.15, 0.4), indexEvery: pick([4, 5]), indexWidth: 1.45, tint },
  );
  return { id: `seed-${seed}`, numeral: '', name, scene, primary, focus: { x: W / 2, y: H / 2 }, aspect: [0.5, 1.6], seed };
}

/**
 * A unit vector for a fraction of a turn, from a rational curve through the
 * circle. It uses only arithmetic IEEE 754 fixes, like the field does.
 */
function unit(turn: number): [number, number] {
  const t = turn - Math.floor(turn);
  const quarter = Math.floor(t * 4);
  const u = t * 4 - quarter;
  // (1 - u^2, 2u) / (1 + u^2) runs a quarter circle as u goes from 0 to 1.
  const x = (1 - u * u) / (1 + u * u);
  const y = (2 * u) / (1 + u * u);
  return ([[x, y], [-y, x], [-x, -y], [y, -x]] as [number, number][])[quarter];
}

/* Frames */

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Keeps the primary source at least this far inside the frame. */
const HANDLE_MARGIN = 48;

/**
 * The largest frame of a given shape that fits the plate's sheet, around its
 * focus. The field never changes with it: a wider frame shows more of the same
 * drawing, and a narrow one crops in.
 */
export function frameFor(plate: Plate, scene: Scene, shape: number): Rect {
  const { width: sheetW, height: sheetH } = scene.domain;
  const aspect = clamp(shape, plate.aspect[0], plate.aspect[1]);
  const width = Math.min(sheetW, Math.round(sheetH * aspect));
  const height = Math.min(sheetH, Math.round(width / aspect));
  const anchor = scene.sources.find((s) => s.id === plate.primary);
  const point = anchor?.kind === 'peak' ? anchor : null;
  const along = (focus: number, at: number | null, size: number, sheet: number) => {
    if (at === null) return Math.round(clamp(focus - size / 2, 0, sheet - size));
    const low = clamp(at - size + HANDLE_MARGIN, 0, sheet - size);
    const high = clamp(at - HANDLE_MARGIN, 0, sheet - size);
    return Math.round(clamp(focus - size / 2, Math.min(low, high), Math.max(low, high)));
  };
  return {
    x: along(plate.focus.x, point ? point.x : null, width, sheetW),
    y: along(plate.focus.y, point ? point.y : null, height, sheetH),
    width,
    height,
  };
}
