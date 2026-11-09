/**
 * The scene format: what a composition is, and how a file becomes one.
 *
 * A scene is plain data. Validation builds a fresh object from known fields, so
 * anything unknown in a file is dropped, and every number is range checked
 * before any array is allocated from it.
 */

export const SCENE_FORMAT = 'contour-scene';
export const SCENE_VERSION = 1;

export const LIMITS = {
  fileBytes: 1_000_000,
  name: 80,
  domain: { min: 16, max: 8192 },
  sources: 64,
  handles: { min: 2, max: 16 },
  /** Sources may sit outside the domain, but not without limit. */
  position: { min: -16384, max: 24576 },
  radius: { min: 1, max: 16384 },
  height: { min: -100, max: 100 },
  levels: { min: 1, max: 128 },
  levelValue: { min: -1000, max: 1000 },
  spacing: { min: 1e-3, max: 1000 },
  noiseAmplitude: { min: 0, max: 10 },
  noiseScale: { min: 4, max: 8192 },
  octaves: { min: 1, max: 4 },
  /** Cells along the long side. 2048 squared is 33.6 MB of doubles. */
  resolution: { min: 16, max: 2048 },
  tolerance: { min: 0, max: 16 },
  decimals: { min: 0, max: 4 },
  strokeWidth: { min: 0.05, max: 32 },
  margin: { min: 0, max: 2048 },
  outputSize: { min: 16, max: 16384 },
} as const;

export interface PeakSource {
  id: string;
  name: string;
  kind: 'peak';
  enabled: boolean;
  x: number;
  y: number;
  radius: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface RidgeSource {
  id: string;
  name: string;
  kind: 'ridge';
  enabled: boolean;
  points: Point[];
  radius: number;
  height: number;
}

export type Source = PeakSource | RidgeSource;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Scene {
  format: typeof SCENE_FORMAT;
  version: typeof SCENE_VERSION;
  name: string;
  seed: number;
  domain: { width: number; height: number };
  clip: Rect;
  sources: Source[];
  noise: { amplitude: number; scale: number; octaves: number };
  levels: { base: number; spacing: number; count: number };
  style: {
    stroke: string;
    strokeWidth: number;
    /** 0 draws every line at full strength. 1 fades the lowest line to nothing. */
    fade: number;
    /** A hex colour, or null for a transparent export. */
    background: string | null;
    /** Every Nth line is heavier. 0 turns this off. */
    indexEvery: number;
    indexWidth: number;
    /** 0 draws every line at its weight. 1 thins the lowest line to nothing. */
    taper: number;
    /**
     * One flat pass of tint for each level, laid over the ground above its line.
     * Below 0 the passes go over the ground under each line instead. 0 is off.
     */
    tint: number;
    tintColor: string;
  };
  export: {
    /** Grid cells along the long side of the domain. */
    resolution: number;
    /** Largest allowed distance between exported and extracted paths, in units. */
    tolerance: number;
    decimals: number;
    bounds: 'frame' | 'expanded';
    margin: number;
    /** Output width in px. Height follows the frame. 0 means one unit is one px. */
    outputWidth: number;
    strokeScaling: 'scale' | 'fixed';
  };
}

export function emptyScene(): Scene {
  return {
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    name: 'Untitled',
    seed: 1,
    domain: { width: 1200, height: 800 },
    clip: { x: 0, y: 0, width: 1200, height: 800 },
    sources: [],
    noise: { amplitude: 0, scale: 240, octaves: 2 },
    levels: { base: 0.1, spacing: 0.1, count: 10 },
    style: {
      stroke: '#1d3a2a',
      strokeWidth: 1,
      fade: 0,
      background: null,
      indexEvery: 0,
      indexWidth: 1.6,
      taper: 0,
      tint: 0,
      tintColor: '#1d3a2a',
    },
    export: {
      resolution: 512,
      tolerance: 0.15,
      decimals: 2,
      bounds: 'frame',
      margin: 40,
      outputWidth: 0,
      strokeScaling: 'scale',
    },
  };
}

export type ParseResult = { ok: true; scene: Scene } | { ok: false; errors: string[] };

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

type Bag = Record<string, unknown>;

/** Collects every problem in a file, so the message can list them together. */
class Reader {
  errors: string[] = [];

  object(value: unknown, path: string): Bag {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.errors.push(`${path} must be an object.`);
      return {};
    }
    return value as Bag;
  }

  number(value: unknown, path: string, range: { min: number; max: number }): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.errors.push(`${path} must be a finite number.`);
      return range.min;
    }
    if (value < range.min || value > range.max) {
      this.errors.push(`${path} must be between ${range.min} and ${range.max}.`);
      return range.min;
    }
    return value;
  }

  integer(value: unknown, path: string, range: { min: number; max: number }): number {
    const n = this.number(value, path, range);
    if (!Number.isInteger(n)) {
      this.errors.push(`${path} must be a whole number.`);
      return range.min;
    }
    return n;
  }

  string(value: unknown, path: string, maxLength: number): string {
    if (typeof value !== 'string') {
      this.errors.push(`${path} must be text.`);
      return '';
    }
    if (value.length > maxLength) {
      this.errors.push(`${path} is longer than ${maxLength} characters.`);
      return value.slice(0, maxLength);
    }
    return value;
  }

  color(value: unknown, path: string): string {
    if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
      this.errors.push(`${path} must be a colour like #1d3a2a.`);
      return '#000000';
    }
    return value.toLowerCase();
  }

  oneOf<T extends string>(value: unknown, path: string, options: readonly T[]): T {
    if (!options.includes(value as T)) {
      this.errors.push(`${path} must be one of: ${options.join(', ')}.`);
      return options[0];
    }
    return value as T;
  }

  boolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') {
      this.errors.push(`${path} must be true or false.`);
      return false;
    }
    return value;
  }
}

function readSource(r: Reader, raw: unknown, path: string, seen: Set<string>): Source | null {
  const s = r.object(raw, path);
  const id = r.string(s.id, `${path}.id`, 40);
  if (id === '' || seen.has(id)) r.errors.push(`${path}.id must be unique and not empty.`);
  seen.add(id);
  const common = {
    id,
    name: r.string(s.name, `${path}.name`, LIMITS.name),
    enabled: r.boolean(s.enabled, `${path}.enabled`),
    radius: r.number(s.radius, `${path}.radius`, LIMITS.radius),
    height: r.number(s.height, `${path}.height`, LIMITS.height),
  };
  if (s.kind === 'peak') {
    return {
      ...common,
      kind: 'peak',
      x: r.number(s.x, `${path}.x`, LIMITS.position),
      y: r.number(s.y, `${path}.y`, LIMITS.position),
    };
  }
  if (s.kind === 'ridge') {
    if (
      !Array.isArray(s.points) ||
      s.points.length < LIMITS.handles.min ||
      s.points.length > LIMITS.handles.max
    ) {
      r.errors.push(
        `${path}.points must list ${LIMITS.handles.min} to ${LIMITS.handles.max} handles.`,
      );
      return null;
    }
    const points = s.points.map((raw_, i) => {
      const p = r.object(raw_, `${path}.points[${i}]`);
      return {
        x: r.number(p.x, `${path}.points[${i}].x`, LIMITS.position),
        y: r.number(p.y, `${path}.points[${i}].y`, LIMITS.position),
      };
    });
    return { ...common, kind: 'ridge', points };
  }
  r.errors.push(`${path}.kind must be peak or ridge.`);
  return null;
}

/** Checks a parsed value. Unknown fields are dropped, not copied. */
export function validateScene(value: unknown): ParseResult {
  const r = new Reader();
  const root = r.object(value, 'scene');

  if (root.format !== SCENE_FORMAT) {
    return { ok: false, errors: [`This is not a Contour scene file.`] };
  }
  if (root.version !== SCENE_VERSION) {
    return {
      ok: false,
      errors: [
        typeof root.version === 'number'
          ? `Scene version ${root.version} is not supported. This build reads version ${SCENE_VERSION}.`
          : 'The scene version is missing or not a number.',
      ],
    };
  }

  const domainRaw = r.object(root.domain, 'domain');
  const domain = {
    width: r.number(domainRaw.width, 'domain.width', LIMITS.domain),
    height: r.number(domainRaw.height, 'domain.height', LIMITS.domain),
  };

  const clipRaw = r.object(root.clip, 'clip');
  const clip = {
    x: r.number(clipRaw.x, 'clip.x', { min: 0, max: domain.width }),
    y: r.number(clipRaw.y, 'clip.y', { min: 0, max: domain.height }),
    width: r.number(clipRaw.width, 'clip.width', { min: 1, max: domain.width }),
    height: r.number(clipRaw.height, 'clip.height', { min: 1, max: domain.height }),
  };
  if (clip.x + clip.width > domain.width || clip.y + clip.height > domain.height) {
    r.errors.push('clip must fit inside the domain.');
  }

  const sourcesRaw = root.sources;
  const sources: Source[] = [];
  if (!Array.isArray(sourcesRaw)) {
    r.errors.push('sources must be a list.');
  } else if (sourcesRaw.length > LIMITS.sources) {
    r.errors.push(`A scene can have at most ${LIMITS.sources} sources.`);
  } else {
    const seen = new Set<string>();
    sourcesRaw.forEach((raw, i) => {
      const source = readSource(r, raw, `sources[${i}]`, seen);
      if (source) sources.push(source);
    });
  }

  const noiseRaw = r.object(root.noise, 'noise');
  const levelsRaw = r.object(root.levels, 'levels');
  const styleRaw = r.object(root.style, 'style');
  const exportRaw = r.object(root.export, 'export');

  const scene: Scene = {
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    name: r.string(root.name, 'name', LIMITS.name),
    seed: r.integer(root.seed, 'seed', { min: 0, max: 0xffffffff }),
    domain,
    clip,
    sources,
    noise: {
      amplitude: r.number(noiseRaw.amplitude, 'noise.amplitude', LIMITS.noiseAmplitude),
      scale: r.number(noiseRaw.scale, 'noise.scale', LIMITS.noiseScale),
      octaves: r.integer(noiseRaw.octaves, 'noise.octaves', LIMITS.octaves),
    },
    levels: {
      base: r.number(levelsRaw.base, 'levels.base', LIMITS.levelValue),
      spacing: r.number(levelsRaw.spacing, 'levels.spacing', LIMITS.spacing),
      count: r.integer(levelsRaw.count, 'levels.count', LIMITS.levels),
    },
    style: {
      stroke: r.color(styleRaw.stroke, 'style.stroke'),
      strokeWidth: r.number(styleRaw.strokeWidth, 'style.strokeWidth', LIMITS.strokeWidth),
      fade: r.number(styleRaw.fade, 'style.fade', { min: 0, max: 1 }),
      background:
        styleRaw.background === null ? null : r.color(styleRaw.background, 'style.background'),
      indexEvery: r.integer(styleRaw.indexEvery, 'style.indexEvery', { min: 0, max: 32 }),
      indexWidth: r.number(styleRaw.indexWidth, 'style.indexWidth', LIMITS.strokeWidth),
      // Added after the first release. A file written before them reads as plain lines.
      taper:
        styleRaw.taper === undefined ? 0 : r.number(styleRaw.taper, 'style.taper', { min: 0, max: 1 }),
      tint:
        styleRaw.tint === undefined ? 0 : r.number(styleRaw.tint, 'style.tint', { min: -1, max: 1 }),
      tintColor:
        styleRaw.tintColor === undefined ? '#1d3a2a' : r.color(styleRaw.tintColor, 'style.tintColor'),
    },
    export: {
      resolution: r.integer(exportRaw.resolution, 'export.resolution', LIMITS.resolution),
      tolerance: r.number(exportRaw.tolerance, 'export.tolerance', LIMITS.tolerance),
      decimals: r.integer(exportRaw.decimals, 'export.decimals', LIMITS.decimals),
      bounds: r.oneOf(exportRaw.bounds, 'export.bounds', ['frame', 'expanded'] as const),
      margin: r.number(exportRaw.margin, 'export.margin', LIMITS.margin),
      outputWidth:
        exportRaw.outputWidth === 0
          ? 0
          : r.number(exportRaw.outputWidth, 'export.outputWidth', LIMITS.outputSize),
      strokeScaling: r.oneOf(exportRaw.strokeScaling, 'export.strokeScaling', [
        'scale',
        'fixed',
      ] as const),
    },
  };

  return r.errors.length > 0 ? { ok: false, errors: r.errors } : { ok: true, scene };
}

/** Reads a scene file. The size check comes first, before any parsing. */
export function parseScene(text: string): ParseResult {
  if (text.length > LIMITS.fileBytes) {
    return { ok: false, errors: [`The file is larger than ${LIMITS.fileBytes} bytes.`] };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['The file is not valid JSON.'] };
  }
  return validateScene(value);
}

export function serializeScene(scene: Scene): string {
  return `${JSON.stringify(scene, null, 2)}\n`;
}

/** Cell counts for a domain. The long side gets `resolution` cells. */
export function gridSize(
  domain: { width: number; height: number },
  resolution: number,
): { nx: number; ny: number } {
  const long = Math.max(domain.width, domain.height);
  const nx = Math.max(1, Math.round((resolution * domain.width) / long));
  const ny = Math.max(1, Math.round((resolution * domain.height) / long));
  return { nx, ny };
}

export function levelValues(levels: Scene['levels']): number[] {
  const out: number[] = [];
  for (let k = 0; k < levels.count; k++) out.push(levels.base + k * levels.spacing);
  return out;
}
