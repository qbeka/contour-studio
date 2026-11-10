/**
 * The figures under the stage. They load when a reader comes near them, so that
 * none of this is in the way of the first screen.
 *
 * Each figure draws from the engine itself: the exploded stack from the scene on
 * the stage, the line from the repo's measured scene, the catalogue from the plates.
 */

import { flattenRidge, sampleField } from '../src/core/field';
import type { Geometry, OutputPath } from '../src/core/pipeline';
import { PLATES, frameFor, paletteOf, type Plate } from '../src/core/plates';
import { PRESETS } from '../src/core/presets';
import type { Rect, Scene } from '../src/core/scene';
import { drawArtwork, drawRelief } from '../src/app/render';
import type { SideJobs } from '../src/app/side-jobs';
import type { EditorStore } from '../src/app/store';
import { levelRegions } from '../src/core/tint';
import type { Look } from './link';

export interface Host {
  store: EditorStore;
  side: SideJobs;
  look: Look;
  still: MediaQueryList;
  plateOf(scene: Scene): Plate;
  choose(plate: Plate): void;
  /** Calls back when the view or the lamp changes. */
  onLook(listener: () => void): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, ',');
const ratio = () => Math.min(2, window.devicePixelRatio || 1);
const ordinal = (n: number) => (n === 1 ? 'single' : n === 2 ? 'second' : n === 3 ? 'third' : `${n}th`);
const fixedWeights = (scene: Scene): Scene => ({ ...scene, export: { ...scene.export, strokeScaling: 'fixed' } });

/** Sizes a canvas to its box and returns a context scaled to CSS px. */
function fit(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; width: number; height: number; dpr: number } {
  const dpr = ratio();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const w = Math.round(width * dpr);
  const h = Math.round(height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height, dpr };
}

/** Runs `draw` when the element is on screen, now and whenever `changed` is called. */
function whenSeen(element: Element, draw: () => void): { changed(): void; seen(): boolean } {
  let seen = false;
  let stale = true;
  new IntersectionObserver(
    (entries) => {
      seen = entries[entries.length - 1].isIntersecting;
      if (seen && stale) {
        stale = false;
        draw();
      }
    },
    { rootMargin: '160px' },
  ).observe(element);
  return {
    changed() {
      if (seen) draw();
      else stale = true;
    },
    seen: () => seen,
  };
}

function tracePaths(paths: readonly { points: Float64Array; closed: boolean }[]): Path2D {
  const path = new Path2D();
  for (const { points, closed } of paths) {
    path.moveTo(points[0], points[1]);
    for (let k = 2; k < points.length; k += 2) path.lineTo(points[k], points[k + 1]);
    if (closed) path.closePath();
  }
  return path;
}

/* How a drawing is made: the scene on the stage, pulled apart into five sheets */

const SHEETS = 5;
const SKEW = -0.44;
const SQUASH = 0.42;

interface Made {
  revision: number;
  scene: Scene;
  final: Geometry;
  extracted: Geometry;
  /** Grid corners shown on the field sheet: one in `every` each way. */
  lattice: { xs: Float64Array; ys: Float64Array; sizes: Float32Array; every: number };
  lines: { extracted: Path2D; kept: Path2D };
  /** The finished print, drawn flat and then laid on its sheet. */
  print: HTMLCanvasElement | null;
  printScale: number;
}

function startMade(host: Host): void {
  const { store, side } = host;
  const figure = $('made');
  const canvas = $<HTMLCanvasElement>('made-canvas');
  const steps = [...figure.querySelectorAll<HTMLButtonElement>('.step')];
  const spreadInput = $<HTMLInputElement>('made-spread');
  let made: Made | null = null;
  let asked = 0;
  let active = SHEETS - 1;
  /** What is drawn, which eases toward what is asked for. */
  const shown = { spread: host.still.matches ? 1 : 0, weight: steps.map((_, i): number => (i === active ? 1 : 0)) };
  let spread = 1;
  let frame = 0;
  let last = 0;
  let opened = false;

  const layout = (width: number, height: number, clip: Rect) => {
    const pad = width < 520 ? 14 : 28;
    const gutter = 26;
    const least = 34;
    const s = Math.min(
      (width - pad * 2 - gutter) / (clip.width - SKEW * clip.height),
      (height - pad * 2 - least * (SHEETS - 1)) / (SQUASH * clip.height),
    );
    const sheetHeight = s * SQUASH * clip.height;
    const gap = Math.min(132, (height - pad * 2 - sheetHeight) / (SHEETS - 1)) * shown.spread;
    const stack = sheetHeight + gap * (SHEETS - 1);
    const total = s * (clip.width - SKEW * clip.height);
    const ox = (width - total + gutter) / 2 - s * SKEW * clip.height;
    const top = (height - stack) / 2 + gap * (SHEETS - 1);
    return { s, ox, gap, top, sheetHeight };
  };

  function draw(): void {
    if (!made) return;
    const { ctx, width, height, dpr } = fit(canvas);
    const { scene, final } = made;
    const clip = final.rect;
    const { s, ox, gap, top, sheetHeight } = layout(width, height, clip);
    const paper = scene.style.background ?? '#ffffff';
    const ink = scene.style.stroke;
    const px = (n: number) => n / s;
    const onSheet = (i: number) =>
      ctx.setTransform(dpr * s, 0, dpr * s * SKEW, dpr * s * SQUASH, dpr * (ox - s * clip.x - s * SKEW * clip.y), dpr * (top - i * gap - s * SQUASH * clip.y));

    if (!made.print || made.printScale !== s * dpr) {
      const flat = document.createElement('canvas');
      flat.width = Math.max(1, Math.round(clip.width * s * dpr));
      flat.height = Math.max(1, Math.round(clip.height * s * dpr));
      const scale = flat.width / clip.width;
      drawArtwork(flat.getContext('2d') as CanvasRenderingContext2D, final, fixedWeights(scene), { scale, x: -clip.x * scale, y: -clip.y * scale, dpr: 1 });
      made.print = flat;
      made.printScale = s * dpr;
    }

    for (let i = 0; i < SHEETS; i++) {
      const weight = shown.weight[i];
      // The sheet, with the shade it throws on the one below.
      onSheet(i);
      ctx.translate(0, px(7) / SQUASH);
      ctx.fillStyle = '#111511';
      ctx.globalAlpha = 0.05 * Math.min(1, shown.spread * 3);
      ctx.fillRect(clip.x, clip.y, clip.width, clip.height);
      onSheet(i);
      ctx.globalAlpha = 1;
      ctx.fillStyle = paper;
      ctx.fillRect(clip.x, clip.y, clip.width, clip.height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(clip.x, clip.y, clip.width, clip.height);
      ctx.clip();
      ctx.globalAlpha = 0.46 + 0.54 * weight;
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (i === 0) drawSources(ctx, scene, px);
      else if (i === 1) drawLattice(ctx, made, px);
      else if (i === 2) drawNodes(ctx, made.extracted, made.lines.extracted, px, 0.6, 1.5);
      else if (i === 3) drawNodes(ctx, final, made.lines.kept, px, 0.9, 1.9);
      else {
        ctx.globalAlpha = 0.45 + 0.55 * weight;
        ctx.drawImage(made.print, clip.x, clip.y, clip.width, clip.height);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.lineWidth = px(1);
      ctx.strokeStyle = `rgba(17, 21, 17, ${0.16 + 0.3 * weight})`;
      ctx.strokeRect(clip.x, clip.y, clip.width, clip.height);
      // Its number, beside the near corner.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cornerX = ox + s * SKEW * clip.height;
      const cornerY = top - i * gap + sheetHeight;
      ctx.globalAlpha = Math.min(1, shown.spread * 2.2);
      ctx.fillStyle = weight > 0.5 ? '#111511' : '#8d918e';
      ctx.font = `${weight > 0.5 ? 500 : 400} 12px Geist, system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(i + 1), cornerX - 9, cornerY + 1);
      ctx.globalAlpha = 1;
    }
  }

  function tick(now: number): void {
    frame = 0;
    const dt = Math.min(48, now - last);
    last = now;
    const ease = 1 - Math.exp(-dt / 130);
    let moving = false;
    const step = (from: number, to: number) => {
      const next = from + (to - from) * ease;
      if (Math.abs(to - next) < 0.002) return to;
      moving = true;
      return next;
    };
    shown.spread = step(shown.spread, spread);
    shown.weight = shown.weight.map((value, i) => step(value, i === active ? 1 : 0));
    draw();
    if (moving) frame = requestAnimationFrame(tick);
  }

  function go(): void {
    if (host.still.matches) {
      shown.spread = spread;
      shown.weight = shown.weight.map((_, i) => (i === active ? 1 : 0));
      draw();
      return;
    }
    if (frame) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }

  function setActive(index: number): void {
    active = Math.max(0, Math.min(SHEETS - 1, index));
    steps.forEach((button, i) => button.setAttribute('aria-pressed', String(i === active)));
    go();
  }

  function describe(): void {
    if (!made) return;
    const { scene, final } = made;
    const enabled = scene.sources.filter((source) => source.enabled);
    const peaks = enabled.filter((source) => source.kind === 'peak').length;
    const ridges = enabled.length - peaks;
    const parts = [peaks > 0 ? `${peaks} ${peaks === 1 ? 'peak' : 'peaks'}` : '', ridges > 0 ? `${ridges} ${ridges === 1 ? 'ridge' : 'ridges'}` : ''].filter(Boolean);
    const passes = levelRegions(final).filter((region) => region && region.loops.length > 0).length;
    const notes = [
      `${parts.join(' and ')}, each a smooth rise or dip that ends at its reach`,
      `Their sum, sampled at ${grouped((final.nx + 1) * (final.ny + 1))} grid corners, drawn here at every ${ordinal(made.lattice.every)} one each way`,
      `${final.levels.length} heights traced through the grid give ${grouped(final.stats.sourceVertices)} nodes on ${final.stats.sourcePaths} paths`,
      `${grouped(final.stats.outputVertices)} nodes are kept, and no path moved more than ${final.stats.maxBound.toFixed(3)} units`,
      scene.style.tint === 0
        ? 'This plate prints no tint, so the lines are the whole file'
        : `${passes} flat passes of colour, closed along the frame from the same paths`,
    ];
    notes.forEach((text, i) => {
      $(`made-note-${i}`).textContent = text;
    });
    canvas.setAttribute('aria-label', `${host.plateOf(scene).name} pulled apart into five sheets: sources, field, extracted lines, simplified lines and tint`);
  }

  async function refresh(): Promise<void> {
    const state = store.getState();
    if (!store.exportReady || store.inGesture || !state.geometry) return;
    if (made?.revision === state.revision || asked === state.revision) return;
    const revision = state.revision;
    asked = revision;
    const scene = store.scene;
    const final = state.geometry;
    let extracted: Geometry;
    try {
      // A draft at the same grid is the lines as extracted, before anything is removed.
      extracted = await side.compute(scene, 'draft', final.resolution);
    } catch {
      asked = 0;
      return;
    }
    if (store.getState().revision !== revision) {
      asked = 0;
      watch.changed();
      return;
    }
    made = {
      revision,
      scene,
      final,
      extracted,
      lattice: lattice(scene, final),
      lines: {
        extracted: tracePaths(extracted.levels.flatMap((level) => level.paths)),
        kept: tracePaths(final.levels.flatMap((level) => level.paths)),
      },
      print: null,
      printScale: 0,
    };
    describe();
    figure.dataset.ready = '';
    if (!opened) {
      opened = true;
      go();
    } else draw();
  }

  const watch = whenSeen(figure, () => void refresh());
  let timer = 0;
  store.subscribe(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => watch.changed(), 220);
  });
  new ResizeObserver(() => {
    if (made && watch.seen()) draw();
  }).observe(canvas);

  steps.forEach((button, i) => {
    button.addEventListener('click', () => setActive(i));
    button.addEventListener('keydown', (event) => {
      const move = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
      if (!move) return;
      event.preventDefault();
      const to = Math.max(0, Math.min(SHEETS - 1, i + move));
      setActive(to);
      steps[to].focus({ preventScroll: true });
    });
  });
  spreadInput.addEventListener('input', () => {
    spread = Number(spreadInput.value);
    spreadInput.style.setProperty('--fill', `${spread * 100}%`);
    go();
  });

  /** The sheet under a place on the canvas, topmost first. */
  const sheetAt = (event: PointerEvent): number => {
    if (!made) return -1;
    const box = canvas.getBoundingClientRect();
    const clip = made.final.rect;
    const { s, ox, gap, top } = layout(box.width, box.height, clip);
    for (let i = SHEETS - 1; i >= 0; i--) {
      const v = (event.clientY - box.top - (top - i * gap)) / (s * SQUASH);
      const u = (event.clientX - box.left - ox - s * SKEW * v) / s;
      if (u >= 0 && u <= clip.width && v >= 0 && v <= clip.height) return i;
    }
    return -1;
  };
  canvas.addEventListener('pointermove', (event) => {
    canvas.style.cursor = sheetAt(event) >= 0 ? 'pointer' : '';
  });
  canvas.addEventListener('click', (event) => {
    const hit = sheetAt(event as PointerEvent);
    if (hit >= 0) setActive(hit);
  });
}

function lattice(scene: Scene, final: Geometry): Made['lattice'] {
  // About 56 dots across, on corners the real grid also has.
  const every = Math.max(1, Math.round(final.nx / 56));
  const grid = sampleField(scene, final.nx, final.ny);
  const { rect } = final;
  const xs: number[] = [];
  const ys: number[] = [];
  const values: number[] = [];
  let low = Infinity;
  let high = -Infinity;
  for (let j = 0; j <= final.ny; j += every) {
    const y = (j * scene.domain.height) / final.ny;
    if (y < rect.y || y > rect.y + rect.height) continue;
    for (let i = 0; i <= final.nx; i += every) {
      const x = (i * scene.domain.width) / final.nx;
      if (x < rect.x || x > rect.x + rect.width) continue;
      const value = grid.values[j * (final.nx + 1) + i];
      xs.push(x);
      ys.push(y);
      values.push(value);
      if (value < low) low = value;
      if (value > high) high = value;
    }
  }
  const span = high - low || 1;
  return { xs: Float64Array.from(xs), ys: Float64Array.from(ys), sizes: Float32Array.from(values, (value) => (value - low) / span), every };
}

function drawSources(ctx: CanvasRenderingContext2D, scene: Scene, px: (n: number) => number): void {
  const paper = scene.style.background ?? '#ffffff';
  const base = ctx.globalAlpha;
  for (const source of scene.sources) {
    if (!source.enabled) continue;
    const spine = source.kind === 'peak' ? Float64Array.from([source.x, source.y]) : flattenRidge(source.points);
    const line = new Path2D();
    line.moveTo(spine[0], spine[1]);
    for (let k = 2; k < spine.length; k += 2) line.lineTo(spine[k], spine[k + 1]);
    if (source.kind === 'peak') line.lineTo(spine[0], spine[1]);
    // Its reach: everything within one radius of the point or the spine.
    ctx.globalAlpha = base * 0.09;
    ctx.lineWidth = source.radius * 2;
    ctx.stroke(line);
    ctx.globalAlpha = base;
    ctx.setLineDash(source.height < 0 ? [px(3), px(4)] : []);
    ctx.lineWidth = px(1.1);
    if (source.kind === 'ridge') ctx.stroke(line);
    ctx.setLineDash([]);
    const points = source.kind === 'peak' ? [source] : source.points;
    for (const point of points) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, px(source.kind === 'peak' ? 4.4 : 3.2), 0, Math.PI * 2);
      ctx.fillStyle = source.height < 0 ? scene.style.stroke : paper;
      ctx.fill();
      ctx.lineWidth = px(1.4);
      ctx.stroke();
    }
    ctx.fillStyle = scene.style.stroke;
  }
}

function drawLattice(ctx: CanvasRenderingContext2D, made: Made, px: (n: number) => number): void {
  const { xs, ys, sizes } = made.lattice;
  ctx.beginPath();
  for (let k = 0; k < xs.length; k++) {
    const r = px(0.45 + sizes[k] * 3.1);
    ctx.moveTo(xs[k] + r, ys[k]);
    ctx.arc(xs[k], ys[k], r, 0, Math.PI * 2);
  }
  ctx.fill();
}

function drawNodes(ctx: CanvasRenderingContext2D, geometry: Geometry, lines: Path2D, px: (n: number) => number, weight: number, node: number): void {
  const base = ctx.globalAlpha;
  ctx.globalAlpha = base * 0.7;
  ctx.lineWidth = px(weight);
  ctx.stroke(lines);
  ctx.globalAlpha = base;
  // A disc lying on the sheet, so it is seen at the same slant as the sheet.
  const r = px(node);
  ctx.beginPath();
  for (const level of geometry.levels) {
    for (const { points } of level.paths) {
      for (let k = 0; k < points.length; k += 2) {
        ctx.moveTo(points[k] + r, points[k + 1]);
        ctx.arc(points[k], points[k + 1], r, 0, Math.PI * 2);
      }
    }
  }
  ctx.fill();
}

/* The same line, before and after, with its bound drawn to scale */

/** The scene the repo's size and error table was measured on. */
export const MEASURED: Scene = { ...PRESETS[0].scene, export: { ...PRESETS[0].scene.export, tolerance: 0.15 } };

interface Walk {
  path: OutputPath;
  /** Length along the path at each of its vertices. */
  along: Float64Array;
  total: number;
}

function walk(path: OutputPath): Walk {
  const n = path.points.length / 2;
  const along = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    along[i] = along[i - 1] + Math.hypot(path.points[i * 2] - path.points[i * 2 - 2], path.points[i * 2 + 1] - path.points[i * 2 - 1]);
  }
  return { path, along, total: along[n - 1] };
}

function pointAt(w: Walk, distance: number): { x: number; y: number } {
  const { points } = w.path;
  let i = 1;
  while (i < w.along.length - 1 && w.along[i] < distance) i++;
  const span = w.along[i] - w.along[i - 1] || 1;
  const t = Math.min(1, Math.max(0, (distance - w.along[i - 1]) / span));
  return {
    x: points[i * 2 - 2] + (points[i * 2] - points[i * 2 - 2]) * t,
    y: points[i * 2 - 1] + (points[i * 2 + 1] - points[i * 2 - 1]) * t,
  };
}

function startLine(host: Host): void {
  const figure = $('line');
  const over = $<HTMLCanvasElement>('line-over');
  const loupe = $<HTMLCanvasElement>('line-loupe');
  const slider = $<HTMLInputElement>('line-at');
  const readout = $('line-count');
  let data: { final: Geometry; extracted: Geometry; kept: Walk; before: OutputPath[]; all: Path2D } | null = null;
  let loading = false;

  const zoom = () => (loupe.clientWidth < 520 ? 22 : 30);
  const at = () => (data ? (Number(slider.value) / Number(slider.max)) * data.kept.total : 0);

  function draw(): void {
    if (!data) return;
    const centre = pointAt(data.kept, at());
    drawOverview(centre);
    drawLoupe(centre);
  }

  function drawOverview(centre: { x: number; y: number }): void {
    if (!data) return;
    const { ctx, width, height, dpr } = fit(over);
    const { rect } = data.final;
    const s = Math.min(width / rect.width, height / rect.height);
    const ox = (width - rect.width * s) / 2 - rect.x * s;
    const oy = (height - rect.height * s) / 2 - rect.y * s;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(17, 21, 17, 0.2)';
    ctx.lineWidth = 0.8 / s;
    ctx.stroke(data.all);
    ctx.strokeStyle = '#1d3a2a';
    ctx.lineWidth = 1.6 / s;
    ctx.stroke(tracePaths([data.kept.path]));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x = centre.x * s + ox;
    const y = centre.y * s + oy;
    // The window, at its true size on this drawing, inside a ring that can be seen.
    const half = { w: (loupe.clientWidth / zoom() / 2) * s, h: (loupe.clientHeight / zoom() / 2) * s };
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1d3a2a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(9, half.w + 4), 0, Math.PI * 2);
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
    ctx.fillStyle = '#1d3a2a';
    ctx.fillRect(x - half.w, y - Math.max(0.75, half.h), half.w * 2, Math.max(1.5, half.h * 2));
  }

  function drawLoupe(centre: { x: number; y: number }): void {
    if (!data) return;
    const { ctx, width, height, dpr } = fit(loupe);
    const z = zoom();
    const ox = width / 2 - centre.x * z;
    const oy = height / 2 - centre.y * z;
    const left = centre.x - width / 2 / z;
    const right = centre.x + width / 2 / z;
    const top = centre.y - height / 2 / z;
    const bottom = centre.y + height / 2 / z;
    const { final } = data;
    const scene = MEASURED;

    // The sampling grid. Every extracted node sits on one of these lines.
    const cellX = scene.domain.width / final.nx;
    const cellY = scene.domain.height / final.ny;
    ctx.strokeStyle = 'rgba(17, 21, 17, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = Math.ceil(left / cellX); i * cellX <= right; i++) {
      const x = Math.round(i * cellX * z + ox) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let j = Math.ceil(top / cellY); j * cellY <= bottom; j++) {
      const y = Math.round(j * cellY * z + oy) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const kept = tracePaths([data.kept.path]);
    // The proved bound, as the band every extracted point must lie in.
    ctx.strokeStyle = 'rgba(29, 58, 42, 0.13)';
    ctx.lineWidth = data.kept.path.bound * 2;
    ctx.stroke(kept);
    ctx.strokeStyle = 'rgba(17, 21, 17, 0.42)';
    ctx.lineWidth = 1 / z;
    ctx.stroke(tracePaths(data.before));
    ctx.strokeStyle = '#1d3a2a';
    ctx.lineWidth = 1.6 / z;
    ctx.stroke(kept);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let seenBefore = 0;
    let seenKept = 0;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(17, 21, 17, 0.62)';
    ctx.lineWidth = 1.1;
    for (const { points } of data.before) {
      for (let k = 0; k < points.length; k += 2) {
        const x = points[k];
        const y = points[k + 1];
        if (x < left || x > right || y < top || y > bottom) continue;
        seenBefore++;
        ctx.beginPath();
        ctx.arc(x * z + ox, y * z + oy, 3.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#1d3a2a';
    const { points } = data.kept.path;
    for (let k = 0; k < points.length; k += 2) {
      const x = points[k];
      const y = points[k + 1];
      if (x < left || x > right || y < top || y > bottom) continue;
      seenKept++;
      ctx.fillRect(x * z + ox - 3.5, y * z + oy - 3.5, 7, 7);
    }

    // One unit, and the bound beside it, at this scale.
    const bx = 16;
    const by = height - 18;
    ctx.strokeStyle = '#111511';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx + 0.5, by - 4);
    ctx.lineTo(bx + 0.5, by + 0.5);
    ctx.lineTo(bx + z + 0.5, by + 0.5);
    ctx.lineTo(bx + z + 0.5, by - 4);
    ctx.stroke();
    ctx.fillStyle = '#111511';
    ctx.font = '400 12px Geist, system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText('1 unit', bx + z + 8, by + 1);
    readout.textContent = `${seenBefore} ${seenBefore === 1 ? 'node' : 'nodes'} before and ${seenKept} after in this window`;
  }

  async function load(): Promise<void> {
    if (data || loading) return;
    loading = true;
    try {
      const [extracted, final] = await Promise.all([
        host.side.compute(MEASURED, 'draft', MEASURED.export.resolution),
        host.side.compute(MEASURED, 'final', MEASURED.export.resolution),
      ]);
      // The line with the most nodes among those that cross the sheet from side to side.
      let best: OutputPath | null = null;
      let level = 0;
      const { rect } = final;
      final.levels.forEach((entry, index) => {
        for (const path of entry.paths) {
          const n = path.points.length;
          const ends = [path.points[0], path.points[n - 2]];
          const across = Math.min(...ends) < rect.x + 1 && Math.max(...ends) > rect.x + rect.width - 1;
          if (!path.closed && across && (!best || n > best.points.length)) {
            best = path;
            level = index;
          }
        }
      });
      if (!best) return;
      const kept = walk(best);
      data = { final, extracted, kept, before: extracted.levels[level].paths, all: tracePaths(final.levels.flatMap((entry) => entry.paths)) };
      figure.dataset.ready = '';
      $('line-bound').textContent = `${kept.path.bound.toFixed(3)} units`;
      draw();
    } catch {
      loading = false;
    }
  }

  const watch = whenSeen(figure, () => {
    if (data) draw();
    else void load();
  });
  slider.addEventListener('input', () => {
    slider.style.setProperty('--fill', `${(Number(slider.value) / Number(slider.max)) * 100}%`);
    draw();
  });
  new ResizeObserver(() => watch.changed()).observe(loupe);

  // Dragging the window itself moves along the line, the way the slider does.
  let grab: { pointer: number; x: number; value: number } | null = null;
  loupe.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !data) return;
    loupe.setPointerCapture(event.pointerId);
    grab = { pointer: event.pointerId, x: event.clientX, value: Number(slider.value) };
    loupe.dataset.held = '';
  });
  loupe.addEventListener('pointermove', (event) => {
    if (!grab || !data || event.pointerId !== grab.pointer) return;
    const units = (grab.x - event.clientX) / zoom();
    slider.value = String(Math.round(grab.value + (units / data.kept.total) * Number(slider.max)));
    slider.dispatchEvent(new Event('input'));
  });
  const drop = () => {
    grab = null;
    delete loupe.dataset.held;
  };
  loupe.addEventListener('pointerup', drop);
  loupe.addEventListener('pointercancel', drop);
  // A press on the small drawing jumps to the nearest place on the line.
  const jump = (event: PointerEvent) => {
    if (!data) return;
    const box = over.getBoundingClientRect();
    const { rect } = data.final;
    const s = Math.min(box.width / rect.width, box.height / rect.height);
    const x = (event.clientX - box.left - (box.width - rect.width * s) / 2) / s + rect.x;
    const y = (event.clientY - box.top - (box.height - rect.height * s) / 2) / s + rect.y;
    const { points } = data.kept.path;
    let nearest = 0;
    let least = Infinity;
    for (let i = 0; i < points.length / 2; i++) {
      const d = Math.hypot(points[i * 2] - x, points[i * 2 + 1] - y);
      if (d < least) {
        least = d;
        nearest = i;
      }
    }
    slider.value = String(Math.round((data.kept.along[nearest] / data.kept.total) * Number(slider.max)));
    slider.dispatchEvent(new Event('input'));
  };
  over.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    over.setPointerCapture(event.pointerId);
    jump(event);
  });
  over.addEventListener('pointermove', (event) => {
    if (over.hasPointerCapture(event.pointerId)) jump(event);
  });
}

/* The plates, as a small catalogue of prints */

function startCatalogue(host: Host): void {
  const list = $('catalogue');
  const cards = PLATES.map((plate) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card';
    const palette = paletteOf(plate.scene);
    button.innerHTML = `<canvas width="2" height="2" aria-hidden="true"></canvas><span class="card-head"><i>${plate.numeral}</i><b>${plate.name}</b></span><span class="card-note">${plate.summary.replace(/\.$/, '')}</span><span class="card-meta"><span>${plate.scene.levels.count} lines</span><span>${palette?.name ?? ''} ink</span><em>Put it on the stage</em></span>`;
    button.setAttribute('aria-label', `Plate ${plate.numeral}, ${plate.name}. ${plate.summary} Put it on the stage.`);
    button.addEventListener('click', () => {
      host.choose(plate);
      $('stage').scrollIntoView({ block: 'center', behavior: host.still.matches ? 'auto' : 'smooth' });
    });
    item.append(button);
    list.append(item);
    return { plate, button, canvas: button.querySelector('canvas') as HTMLCanvasElement, geometry: null as Geometry | null, scene: plate.scene };
  });

  const paint = (card: (typeof cards)[number]) => {
    if (!card.geometry) return;
    const { ctx, width, dpr } = fit(card.canvas);
    const { rect } = card.geometry;
    const scale = width / rect.width;
    const transform = { scale, x: -rect.x * scale, y: -rect.y * scale, dpr };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (host.look.view === 'relief') drawRelief(ctx, card.geometry, card.scene, transform, host.look.lamp);
    else drawArtwork(ctx, card.geometry, card.scene, transform);
    card.button.dataset.ready = '';
  };
  const mark = () => {
    const current = host.plateOf(host.store.scene);
    for (const card of cards) {
      const on = card.plate === current;
      card.button.toggleAttribute('data-current', on);
      (card.button.querySelector('em') as HTMLElement).textContent = on ? 'On the stage' : 'Put it on the stage';
    }
  };

  let asked = false;
  const watch = whenSeen(list, () => {
    mark();
    if (asked) {
      cards.forEach(paint);
      return;
    }
    asked = true;
    for (const card of cards) {
      const clip = frameFor(card.plate, card.plate.scene, 1.5, true);
      const { style } = card.plate.scene;
      card.scene = fixedWeights({ ...card.plate.scene, clip, style: { ...style, strokeWidth: style.strokeWidth * 0.62, indexWidth: style.indexWidth * 0.62 } });
      host.side.compute(card.scene, 'draft', 192).then(
        (geometry) => {
          card.geometry = geometry;
          paint(card);
        },
        () => {},
      );
    }
  });
  host.onLook(() => watch.changed());
  let timer = 0;
  host.store.subscribe(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(mark, 200);
  });
  new ResizeObserver(() => {
    if (asked) watch.changed();
  }).observe(list);
}

/* The film: a still of the studio until someone asks for it to play */

function startFilm(): void {
  const frame = $('film-frame');
  const film = $<HTMLVideoElement>('film');
  const play = $<HTMLButtonElement>('film-play');
  new IntersectionObserver(
    (entries, observer) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      film.poster = film.dataset.poster ?? '';
      observer.disconnect();
    },
    { rootMargin: '400px' },
  ).observe(frame);
  play.addEventListener('click', () => {
    frame.dataset.playing = '';
    film.controls = true;
    film.focus({ preventScroll: true });
    void film.play().catch(() => {
      delete frame.dataset.playing;
      film.controls = false;
    });
  });
  film.addEventListener('ended', () => {
    delete frame.dataset.playing;
    film.controls = false;
    play.focus({ preventScroll: true });
  });
}

export function startEditorial(host: Host): void {
  startMade(host);
  startLine(host);
  startCatalogue(host);
  startFilm();
}
