/**
 * The project page. The drawing is live: the studio's store, session and worker
 * do the geometry, and this file connects them to the print on the stage.
 */

import { GeometryClient, type Engine } from '../src/app/geometry-client';
import { addPeak, hasRoom, removeSource, setHandle, updateSource } from '../src/app/edits';
import { saveBlob } from '../src/app/files';
import { drawArtwork, drawLog } from '../src/app/render';
import { startSession } from '../src/app/session';
import { EditorStore, type EditorState } from '../src/app/store';
import type { Geometry } from '../src/core/pipeline';
import { PALETTES, PLATES, SEED_LIMIT, applyPalette, frameFor, generatePlate, paletteOf, type Palette, type Plate } from '../src/core/plates';
import type { Rect, Scene, Source } from '../src/core/scene';
import { toSvg } from '../src/core/svg';
import { ExportHold, type HoldState } from './export-hold';
import { isOriginal, readLink, writeLink } from './link';
import { PRINT_SIZES, blockText, drawPrint, keySteps, layoutPrint, printScene, type PrintSize } from '../src/app/prints';
import { SideJobs } from '../src/app/side-jobs';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const stage = $('stage');
const print = $('print');
const canvas = $<HTMLCanvasElement>('art');
const fade = $<HTMLCanvasElement>('fade');
const waveCanvas = $<HTMLCanvasElement>('wave');
const sheet = $('sheet');
const marksLayer = $('marks');
const inspector = $('inspector');
const exportsPanel = $('exports');
const exportRows = $('export-rows');
const plateStrip = $('plates');
const wells = $('wells');
const addButton = $<HTMLButtonElement>('add');
const undoButton = $<HTMLButtonElement>('undo');
const resetButton = $<HTMLButtonElement>('reset');
const removeButton = $<HTMLButtonElement>('remove');
const exportButton = $<HTMLButtonElement>('export');
const copyButton = $<HTMLButtonElement>('copy-link');
const titleBlock = $<HTMLInputElement>('title-block');
const status = $('status');
const context = canvas.getContext('2d') as CanvasRenderingContext2D;

const stillPage = matchMedia('(prefers-reduced-motion: reduce)');
const NUDGE = 10;
const NUDGE_LARGE = 50;
const DRAG_SLOP_PX = 3;
const SAVED_MS = 1800;
const CROSSFADE_MS = 240;
const DOUBLE_MS = 340;
const DOUBLE_PX = 24;

const params = new URLSearchParams(location.search);
const engines: Record<string, Engine> = { off: 'sliced', blocking: 'blocking' };
const engine = engines[params.get('worker') ?? ''] ?? 'worker';

/* Plates */

const opened = readLink(params);
/** Generated plates this visit, so that undo can find the one a scene belongs to. */
const made = new Map<string, Plate>();
const madeKey = (scene: Scene) => `${scene.name}|${scene.seed}`;
let latestMade: Plate | null = null;
if (opened.plate.seed !== undefined) {
  made.set(madeKey(opened.plate.scene), opened.plate);
  latestMade = opened.plate;
}

function plateOf(scene: Scene): Plate {
  return PLATES.find((p) => p.scene.name === scene.name) ?? made.get(madeKey(scene)) ?? PLATES[0];
}

/** The size of the print area, read once and then kept by the resize observer. */
const area = { width: print.clientWidth, height: print.clientHeight };
const stageShape = () => Math.max(1, area.width) / Math.max(1, area.height);
const framed = (scene: Scene, plate = plateOf(scene)): Scene => ({ ...scene, clip: frameFor(plate, scene, stageShape()) });

const store = new EditorStore(framed(opened.scene, opened.plate));
const session = startSession(store, {
  engine,
  createClient: (events, options) => new GeometryClient(events, options),
  persist: () => true,
  report: false,
});
const side = new SideJobs(engine);

const say = (text: string) => {
  status.textContent = text;
};

/* Stage geometry */

interface View {
  scale: number;
  x: number;
  y: number;
}

/** Fits a frame in the print area. A shape within a rounding step fills it edge to edge. */
function viewFor(rect: Rect): View {
  const { width, height } = area;
  const fits = Math.min(width / rect.width, height / rect.height);
  const fills = Math.max(width / rect.width, height / rect.height);
  const scale = fills / fits < 1.01 ? fills : fits;
  return {
    scale,
    x: (width - rect.width * scale) / 2 - rect.x * scale,
    y: (height - rect.height * scale) / 2 - rect.y * scale,
  };
}

/** Where a mark may go, in stage px. It stays on the sheet and grabbable. */
function markLimits() {
  const { clip } = store.scene;
  const view = viewFor(clip);
  const pad = 14;
  return {
    left: Math.max(0, view.x + clip.x * view.scale) + pad,
    right: Math.min(area.width, view.x + (clip.x + clip.width) * view.scale) - pad,
    top: Math.max(0, view.y + clip.y * view.scale) + pad,
    bottom: Math.min(area.height, view.y + (clip.y + clip.height) * view.scale) - pad,
  };
}

function syncSheet(): void {
  const { clip } = store.scene;
  const view = viewFor(clip);
  const left = clip.x * view.scale + view.x;
  const width = clip.width * view.scale;
  const inset = left > 2;
  sheet.hidden = !inset;
  if (inset) {
    sheet.style.left = `${left}px`;
    sheet.style.width = `${width}px`;
  }
}

/* Drawing */

let frame = 0;
let paintedLook = '';

function requestPaint(): void {
  if (!frame) frame = requestAnimationFrame(paint);
}

function sizeCanvas(): number {
  // Beyond 2x the lines look the same and the canvas costs four times as much.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.round(area.width * dpr);
  const height = Math.round(area.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return dpr;
}

/** Holds the old print over the new one for a moment when the plate or the ink changes. */
function crossfade(): void {
  if (stillPage.matches || canvas.width === 0) return;
  fade.width = canvas.width;
  fade.height = canvas.height;
  fade.getContext('2d')?.drawImage(canvas, 0, 0);
  fade.getAnimations().forEach((animation) => animation.cancel());
  fade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CROSSFADE_MS, easing: 'ease-out' });
}

/** Line weights stay in screen px here, so a phone gets the same weight as a desktop. */
const onScreen = (scene: Scene): Scene => ({ ...scene, export: { ...scene.export, strokeScaling: 'fixed' } });

function paint(): void {
  frame = 0;
  const geometry = drift.geometry ?? store.getState().geometry;
  if (!geometry) return;
  const scene = store.scene;
  const look = `${plateOf(scene).id}|${scene.style.stroke}|${scene.style.background}`;
  if (paintedLook && paintedLook !== look) crossfade();
  paintedLook = look;
  const dpr = sizeCanvas();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  drawArtwork(context, geometry, onScreen(scene), { ...viewFor(geometry.rect), dpr });
  stage.classList.add('drawn');
}

/* The idle drift: the levels rise and fall a little, and every line breathes with them. */

const DRIFT_IDLE_MS = 3200;
const DRIFT_PERIOD_MS = 15000;
/** Part of one line gap, at the widest point of the swing. */
const DRIFT_REACH = 0.32;
const DRIFT_GRID = 256;
const DRIFT_STEP_MS = 40;

const drift = {
  geometry: null as Geometry | null,
  strength: 0,
  phase: 0,
  last: 0,
  asked: 0,
  frame: 0,
  idleSince: performance.now(),
  onScreen: true,
  /** The store revision the drift is drawing. A newer one ends it at once. */
  revision: 0,
};

function driftWanted(): boolean {
  return (
    !stillPage.matches &&
    drift.onScreen &&
    !document.hidden &&
    !drag &&
    !stage.dataset.panel &&
    hold.state === 'idle' &&
    store.exportReady &&
    performance.now() - drift.idleSince > DRIFT_IDLE_MS
  );
}

function endDrift(): void {
  cancelAnimationFrame(drift.frame);
  drift.frame = 0;
  drift.strength = 0;
  drift.phase = 0;
  if (drift.geometry) {
    drift.geometry = null;
    requestPaint();
  }
}

function driftTick(now: number): void {
  drift.frame = 0;
  const dt = Math.min(64, now - drift.last);
  drift.last = now;
  if (drift.revision !== store.getState().revision) {
    endDrift();
    return;
  }
  const wanted = driftWanted();
  // It eases in over a couple of seconds and lets go in a fraction of one.
  drift.strength += ((wanted ? 1 : 0) - drift.strength) * (1 - Math.exp(-dt / (wanted ? 1600 : 110)));
  if (!wanted && drift.strength < 0.02) {
    endDrift();
    return;
  }
  if (wanted) drift.phase += dt;
  if (!side.busy && now - drift.asked >= DRIFT_STEP_MS) {
    drift.asked = now;
    const scene = store.scene;
    const revision = drift.revision;
    const swing = Math.sin((drift.phase / DRIFT_PERIOD_MS) * Math.PI * 2);
    const base = scene.levels.base + drift.strength * DRIFT_REACH * scene.levels.spacing * swing;
    side.compute({ ...scene, levels: { ...scene.levels, base } }, 'draft', DRIFT_GRID).then(
      (geometry) => {
        if (!drift.frame || revision !== store.getState().revision) return;
        drift.geometry = geometry;
        requestPaint();
      },
      () => endDrift(),
    );
  }
  drift.frame = requestAnimationFrame(driftTick);
}

function touched(): void {
  drift.idleSince = performance.now();
}

window.setInterval(() => {
  if (drift.frame || !driftWanted()) return;
  drift.revision = store.getState().revision;
  drift.last = performance.now();
  drift.frame = requestAnimationFrame(driftTick);
}, 400);

new IntersectionObserver((entries) => {
  drift.onScreen = entries[entries.length - 1].isIntersecting;
}, { threshold: 0.15 }).observe(stage);

for (const type of ['pointerdown', 'keydown', 'input', 'wheel'] as const) {
  stage.addEventListener(type, touched, { capture: true, passive: true });
}

// A mark is focused from script when it is pressed, which some browsers treat as
// keyboard focus. The ring and the key hint follow what was really used last.
document.addEventListener('keydown', () => stage.setAttribute('data-keys', ''), { capture: true });
document.addEventListener('pointerdown', () => stage.removeAttribute('data-keys'), { capture: true });

/* The settle: when export geometry lands after an edit, its nodes show for a moment. */

const WAVE_SPEED = 0.95;
const WAVE_BAND = 170;
const WAVE_REACH = 560;

let settleFrom: { x: number; y: number; key: string | null } | null = null;
let waveFrame = 0;

function startWave(origin: { x: number; y: number }, geometry: Geometry): void {
  cancelAnimationFrame(waveFrame);
  const view = viewFor(geometry.rect);
  const found: number[] = [];
  for (const level of geometry.levels) {
    for (const { points } of level.paths) {
      for (let k = 0; k < points.length; k += 2) {
        const x = points[k] * view.scale + view.x;
        const y = points[k + 1] * view.scale + view.y;
        const d = Math.hypot(x - origin.x, y - origin.y);
        if (d < WAVE_REACH) found.push(d, x, y);
      }
    }
  }
  const order = Array.from({ length: found.length / 3 }, (_, i) => i).sort((a, b) => found[a * 3] - found[b * 3]);
  const nodes = new Float32Array(found.length);
  order.forEach((from, to) => {
    nodes[to * 3] = found[from * 3];
    nodes[to * 3 + 1] = found[from * 3 + 1];
    nodes[to * 3 + 2] = found[from * 3 + 2];
  });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  waveCanvas.width = Math.round(area.width * dpr);
  waveCanvas.height = Math.round(area.height * dpr);
  const ctx = waveCanvas.getContext('2d') as CanvasRenderingContext2D;
  const ink = store.scene.style.stroke;
  const started = performance.now();
  let first = 0;
  const step = (now: number) => {
    const front = (now - started) * WAVE_SPEED;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, area.width, area.height);
    while (first < nodes.length && nodes[first] < front - WAVE_BAND) first += 3;
    ctx.fillStyle = ink;
    for (let k = first; k < nodes.length && nodes[k] <= front; k += 3) {
      const d = nodes[k];
      const age = (front - d) / WAVE_BAND;
      ctx.globalAlpha = (1 - age) * (1 - age) * (1 - d / WAVE_REACH) * 0.95;
      ctx.beginPath();
      ctx.arc(nodes[k + 1], nodes[k + 2], 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    waveFrame = first < nodes.length && front < WAVE_REACH + WAVE_BAND ? requestAnimationFrame(step) : 0;
    if (!waveFrame) ctx.clearRect(0, 0, area.width, area.height);
  };
  waveFrame = requestAnimationFrame(step);
}

function settle(): void {
  const from = settleFrom;
  settleFrom = null;
  const { geometry } = store.getState();
  if (!from || !geometry || stillPage.matches) return;
  startWave(from, geometry);
  const mark = marks.find((m) => m.key === from.key);
  if (mark) {
    mark.el.removeAttribute('data-settled');
    void mark.el.offsetWidth;
    mark.el.setAttribute('data-settled', '');
  }
}

/* Marks: a button for each peak and each point along a ridge */

interface Mark {
  key: string;
  id: string;
  index: number;
  el: HTMLButtonElement;
  x: number;
  y: number;
}

let marks: Mark[] = [];
let selected: { id: string; index: number } | null = null;
const markKey = (id: string, index: number) => `${id}:${index}`;

/** Room the hint needs on either side of a mark. */
const HINT_REACH = 150;

function placeMark(mark: Mark, px: number, py: number): void {
  mark.x = px;
  mark.y = py;
  mark.el.style.transform = `translate3d(${px}px, ${py}px, 0)`;
  mark.el.toggleAttribute('data-hint-below', py < 52);
  const edge = px < HINT_REACH ? 'start' : px > area.width - HINT_REACH ? 'end' : 'middle';
  if (mark.el.dataset.hintEdge !== edge) mark.el.dataset.hintEdge = edge;
}

function makeMark(key: string, id: string, index: number): Mark {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'mark';
  el.innerHTML =
    '<i></i><span class="hint" aria-hidden="true"><span class="mouse">Drag it, or click for settings</span><span class="keys">Arrows move it, [ and ] change point, Enter opens settings</span></span>';
  const mark: Mark = { key, id, index, el, x: 0, y: 0 };
  el.addEventListener('pointerdown', (event) => beginDrag(mark, event));
  el.addEventListener('pointermove', moveDrag);
  el.addEventListener('pointerup', (event) => {
    if (!drag || drag.glide || event.pointerId !== drag.pointer) return;
    const { moved } = drag;
    release(event);
    if (!moved) togglePanel('inspector');
  });
  el.addEventListener('pointercancel', () => endDrag());
  el.addEventListener('lostpointercapture', () => {
    if (drag && !drag.glide && drag.mark === mark) endDrag();
  });
  // A pointer press is handled above. A click with no pointer behind it is Enter or Space.
  el.addEventListener('click', (event) => {
    if (event.detail === 0) {
      select(mark);
      togglePanel('inspector');
    }
  });
  el.addEventListener('focus', () => {
    if (!drag) select(mark);
  });
  el.addEventListener('keydown', (event) => markKeys(mark, event));
  return mark;
}

function sourceOf(scene: Scene, id: string): Source | undefined {
  return scene.sources.find((s) => s.id === id);
}

function syncMarks(): void {
  const scene = store.scene;
  const plate = plateOf(scene);
  const view = viewFor(scene.clip);
  const limits = markLimits();
  const old = new Map(marks.map((mark) => [mark.key, mark]));
  const next: Mark[] = [];
  for (const source of scene.sources) {
    if (!source.enabled) continue;
    const points = source.kind === 'peak' ? [source] : source.points;
    points.forEach((point, index) => {
      const key = markKey(source.id, index);
      const mark = old.get(key) ?? makeMark(key, source.id, index);
      old.delete(key);
      const px = point.x * view.scale + view.x;
      const py = point.y * view.scale + view.y;
      const reach = 4;
      mark.el.hidden =
        px < limits.left - 14 - reach || px > limits.right + 14 + reach || py < limits.top - 14 - reach || py > limits.bottom + 14 + reach;
      mark.el.dataset.kind = source.kind === 'peak' ? 'peak' : 'point';
      mark.el.toggleAttribute('data-low', source.kind === 'peak' && source.height < 0);
      mark.el.toggleAttribute('data-primary', source.id === plate.primary);
      mark.el.toggleAttribute('data-selected', selected?.id === source.id && selected.index === index);
      mark.el.setAttribute(
        'aria-label',
        source.kind === 'peak'
          ? `${source.name}, a ${source.height < 0 ? 'hollow' : 'peak'}. Drag it or use the arrow keys. Press Enter for its settings.`
          : `${source.name}, point ${index + 1} of ${points.length}. Drag it or use the arrow keys. Press Enter for its settings.`,
      );
      placeMark(mark, px, py);
      next.push(mark);
    });
  }
  for (const mark of old.values()) mark.el.remove();
  next.forEach((mark, i) => {
    if (marksLayer.children[i] !== mark.el) marksLayer.insertBefore(mark.el, marksLayer.children[i] ?? null);
  });
  marks = next;
  if (selected && !marks.some((m) => m.id === selected?.id && m.index === selected.index)) selected = null;
  // One tab stop for the whole drawing. [ and ] move between its points.
  const shown = marks.filter((m) => !m.el.hidden);
  const stop =
    shown.find((m) => m.id === selected?.id && m.index === selected.index) ??
    shown.find((m) => m.id === plate.primary) ??
    shown[0];
  for (const mark of marks) mark.el.tabIndex = mark === stop ? 0 : -1;
}

function select(mark: Mark | null): void {
  selected = mark ? { id: mark.id, index: mark.index } : null;
  for (const m of marks) {
    m.el.toggleAttribute('data-selected', m === mark);
    if (mark) m.el.tabIndex = m === mark ? 0 : -1;
  }
  if (!mark && stage.dataset.panel === 'inspector') closePanel();
  syncFields();
}

const selectedMark = () => marks.find((m) => m.id === selected?.id && m.index === selected.index) ?? null;

function markKeys(mark: Mark, event: KeyboardEvent): void {
  if (event.key === '[' || event.key === ']') {
    const shown = marks.filter((m) => !m.el.hidden);
    const at = shown.indexOf(mark);
    const to = shown[(at + (event.key === ']' ? 1 : shown.length - 1)) % shown.length];
    event.preventDefault();
    to.el.focus({ preventScroll: true });
    return;
  }
  if (event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault();
    removeSelected();
    return;
  }
  const step = event.shiftKey ? NUDGE_LARGE : NUDGE;
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const move = moves[event.key];
  if (!move) return;
  event.preventDefault();
  endInvite();
  const scene = store.scene;
  const view = viewFor(scene.clip);
  const limits = markLimits();
  const at = { x: (mark.x - view.x) / view.scale, y: (mark.y - view.y) / view.scale };
  const x = Math.min((limits.right - view.x) / view.scale, Math.max((limits.left - view.x) / view.scale, at.x + move[0]));
  const y = Math.min((limits.bottom - view.y) / view.scale, Math.max((limits.top - view.y) / view.scale, at.y + move[1]));
  settleFrom = { x: x * view.scale + view.x, y: y * view.scale + view.y, key: mark.key };
  store.edit(setHandle(scene, mark.id, mark.index, Math.round(x), Math.round(y)), `nudge:${mark.key}`);
}

function endInvite(): void {
  stage.removeAttribute('data-invite');
}

/* Dragging, and the glide after a throw */

interface Drag {
  mark: Mark;
  pointer: number;
  /** From the pointer to the centre of the mark, in stage px. */
  grabX: number;
  grabY: number;
  startX: number;
  startY: number;
  moved: boolean;
  pending: { x: number; y: number } | null;
  frame: number;
  /** Recent pointer positions, for the speed at release. */
  trail: { t: number; x: number; y: number }[];
  glide: { vx: number; vy: number; last: number; frame: number } | null;
}

let drag: Drag | null = null;

/** The glide loses about two thirds of its speed in this long. */
const GLIDE_TAU_MS = 210;
const GLIDE_MIN = 0.28;
const GLIDE_MAX = 2.6;
const GLIDE_STOP = 0.018;

function stagePoint(event: PointerEvent | MouseEvent): { x: number; y: number } {
  const box = print.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

function sendDrag(px: number, py: number): void {
  if (!drag) return;
  const view = viewFor(store.scene.clip);
  drag.pending = { x: Math.round((px - view.x) / view.scale), y: Math.round((py - view.y) / view.scale) };
  if (!drag.frame) drag.frame = requestAnimationFrame(flushDrag);
}

function flushDrag(): void {
  if (!drag) return;
  cancelAnimationFrame(drag.frame);
  drag.frame = 0;
  if (!drag.pending) return;
  const { x, y } = drag.pending;
  drag.pending = null;
  store.gesture(setHandle(store.scene, drag.mark.id, drag.mark.index, x, y));
}

function beginDrag(mark: Mark, event: PointerEvent): void {
  if (event.button !== 0) return;
  // Catching a mark in flight carries straight on from where it is.
  if (drag) endDrag();
  endInvite();
  mark.el.focus({ preventScroll: true });
  select(mark);
  mark.el.setPointerCapture(event.pointerId);
  const at = stagePoint(event);
  drag = {
    mark,
    pointer: event.pointerId,
    grabX: mark.x - at.x,
    grabY: mark.y - at.y,
    startX: at.x,
    startY: at.y,
    moved: false,
    pending: null,
    frame: 0,
    trail: [{ t: event.timeStamp, x: at.x, y: at.y }],
    glide: null,
  };
  store.beginGesture();
  stage.setAttribute('data-dragging', '');
  mark.el.setAttribute('data-held', '');
}

function moveDrag(event: PointerEvent): void {
  if (!drag || drag.glide || event.pointerId !== drag.pointer) return;
  const at = stagePoint(event);
  if (!drag.moved && Math.hypot(at.x - drag.startX, at.y - drag.startY) < DRAG_SLOP_PX) return;
  drag.moved = true;
  drag.trail.push({ t: event.timeStamp, x: at.x, y: at.y });
  if (drag.trail.length > 8) drag.trail.shift();
  const limits = markLimits();
  const px = Math.min(limits.right, Math.max(limits.left, at.x + drag.grabX));
  const py = Math.min(limits.bottom, Math.max(limits.top, at.y + drag.grabY));
  // The mark moves now. The lines catch up on the next frame.
  placeMark(drag.mark, px, py);
  store.markInput(event.timeStamp);
  sendDrag(px, py);
}

/** The pointer let go. A fast release throws the mark, and the lines follow it out. */
function release(event: PointerEvent): void {
  if (!drag) return;
  const { trail, moved, mark } = drag;
  const last = trail[trail.length - 1];
  const from = trail.find((sample) => last.t - sample.t <= 90) ?? last;
  const span = last.t - from.t;
  const fresh = event.timeStamp - last.t < 60;
  let vx = span > 8 && fresh ? (last.x - from.x) / span : 0;
  let vy = span > 8 && fresh ? (last.y - from.y) / span : 0;
  const speed = Math.hypot(vx, vy);
  if (!moved || stillPage.matches || speed < GLIDE_MIN) {
    endDrag();
    return;
  }
  if (speed > GLIDE_MAX) {
    vx *= GLIDE_MAX / speed;
    vy *= GLIDE_MAX / speed;
  }
  if (mark.el.hasPointerCapture(drag.pointer)) mark.el.releasePointerCapture(drag.pointer);
  stage.removeAttribute('data-dragging');
  const glide = { vx, vy, last: performance.now(), frame: 0 };
  drag.glide = glide;
  const step = (now: number) => {
    if (!drag || drag.glide !== glide) return;
    const dt = Math.min(48, now - glide.last);
    glide.last = now;
    const decay = Math.exp(-dt / GLIDE_TAU_MS);
    const limits = markLimits();
    let px = mark.x + glide.vx * GLIDE_TAU_MS * (1 - decay);
    let py = mark.y + glide.vy * GLIDE_TAU_MS * (1 - decay);
    glide.vx *= decay;
    glide.vy *= decay;
    // An edge of the sheet takes the speed out of that direction only.
    if (px < limits.left || px > limits.right) glide.vx = 0;
    if (py < limits.top || py > limits.bottom) glide.vy = 0;
    px = Math.min(limits.right, Math.max(limits.left, px));
    py = Math.min(limits.bottom, Math.max(limits.top, py));
    placeMark(mark, px, py);
    sendDrag(px, py);
    if (Math.hypot(glide.vx, glide.vy) < GLIDE_STOP) {
      endDrag();
      return;
    }
    glide.frame = requestAnimationFrame(step);
  };
  glide.frame = requestAnimationFrame(step);
}

/** Ends a drag or a glide from any cause. `keep` false puts the point back where it started. */
function endDrag(keep = true): void {
  if (!drag) return;
  const { moved, pointer, mark, glide } = drag;
  if (glide) cancelAnimationFrame(glide.frame);
  flushDrag();
  drag = null;
  stage.removeAttribute('data-dragging');
  mark.el.removeAttribute('data-held');
  if (mark.el.hasPointerCapture(pointer)) mark.el.releasePointerCapture(pointer);
  if (moved && keep) settleFrom = { x: mark.x, y: mark.y, key: mark.key };
  store.endGesture();
  if (!keep && moved) store.undo();
  syncMarks();
  syncControls();
  touched();
}

// A press anywhere stops a glide where it is. A press on a mark then picks it up.
stage.addEventListener(
  'pointerdown',
  () => {
    if (drag?.glide) endDrag();
  },
  { capture: true },
);
window.addEventListener('blur', () => endDrag());

/* Adding and removing */

function addAt(x: number, y: number, hollow = false): void {
  const scene = store.scene;
  if (!hasRoom(scene)) {
    say('The sheet holds 64 sources and is full.');
    return;
  }
  endInvite();
  const added = addPeak(scene, Math.round(x), Math.round(y));
  const radius = Math.round(Math.min(scene.clip.width, scene.clip.height) * 0.2);
  const view = viewFor(scene.clip);
  const key = markKey(added.id, 0);
  settleFrom = { x: x * view.scale + view.x, y: y * view.scale + view.y, key };
  store.edit(updateSource(added.scene, added.id, { radius, height: hollow ? -0.35 : 0.45, name: hollow ? 'Added hollow' : 'Added peak' }));
  const mark = marks.find((m) => m.key === key);
  if (mark) {
    select(mark);
    mark.el.focus({ preventScroll: true });
  }
  say(`Added a ${hollow ? 'hollow' : 'peak'}. Arrow keys move it.`);
}

/** The Peak button has no pointer position, so it walks out from the middle of the sheet. */
function addFromButton(): void {
  const { clip } = store.scene;
  const n = store.scene.sources.length;
  // The golden angle keeps each new one clear of the last.
  const turn = n * 2.399963;
  const reach = Math.min(clip.width, clip.height) * (0.12 + 0.05 * (n % 4));
  addAt(clip.x + clip.width / 2 + Math.cos(turn) * reach, clip.y + clip.height / 2 + Math.sin(turn) * reach);
}

function removeSelected(): void {
  const scene = store.scene;
  if (!selected || scene.sources.filter((s) => s.enabled).length <= 1) return;
  const source = sourceOf(scene, selected.id);
  if (!source) return;
  const from = selectedMark();
  const hadPanel = stage.dataset.panel === 'inspector';
  if (from) settleFrom = { x: from.x, y: from.y, key: null };
  store.edit(removeSource(scene, source.id));
  selected = null;
  if (hadPanel) closePanel();
  syncMarks();
  const next = marks.find((m) => m.el.tabIndex === 0);
  (next?.el ?? addButton).focus({ preventScroll: true });
  say(`Removed ${source.name}.`);
}

let lastTap: { t: number; x: number; y: number } | null = null;

canvas.addEventListener('pointerup', (event) => {
  if (event.button !== 0) return;
  const at = stagePoint(event);
  const double = lastTap && event.timeStamp - lastTap.t < DOUBLE_MS && Math.hypot(at.x - lastTap.x, at.y - lastTap.y) < DOUBLE_PX;
  lastTap = double ? null : { t: event.timeStamp, x: at.x, y: at.y };
  if (!double) return;
  const limits = markLimits();
  if (at.x < limits.left - 14 || at.x > limits.right + 14 || at.y < limits.top - 14 || at.y > limits.bottom + 14) return;
  const view = viewFor(store.scene.clip);
  addAt((at.x - view.x) / view.scale, (at.y - view.y) / view.scale, event.altKey || event.shiftKey);
});

canvas.addEventListener('pointerdown', () => {
  closePanel();
  select(null);
});

addButton.addEventListener('click', addFromButton);
removeButton.addEventListener('click', () => {
  if (!isDisabled(removeButton)) removeSelected();
});

/* Panels: the point settings and the export list. One at a time. */

type Panel = 'inspector' | 'exports';

function closePanel(): void {
  if (!stage.dataset.panel) return;
  delete stage.dataset.panel;
  inspector.hidden = true;
  exportsPanel.hidden = true;
  exportButton.setAttribute('aria-expanded', 'false');
  for (const mark of marks) mark.el.removeAttribute('aria-expanded');
}

function openPanel(panel: Panel): void {
  closePanel();
  stage.dataset.panel = panel;
  if (panel === 'exports') {
    exportsPanel.hidden = false;
    exportButton.setAttribute('aria-expanded', 'true');
    return;
  }
  const mark = selectedMark();
  if (!mark) {
    delete stage.dataset.panel;
    return;
  }
  inspector.hidden = false;
  mark.el.setAttribute('aria-expanded', 'true');
  // The panel opens on the side away from the mark, so it never covers it.
  inspector.dataset.side = mark.x > area.width / 2 ? 'left' : 'right';
  inspector.dataset.edge = mark.y < area.height / 2 ? 'bottom' : 'top';
  syncFields();
}

function togglePanel(panel: Panel): void {
  if (stage.dataset.panel === panel) closePanel();
  else openPanel(panel);
}

$('close').addEventListener('click', () => {
  closePanel();
  selectedMark()?.el.focus({ preventScroll: true });
});

/* Controls */

const setDisabled = (button: HTMLElement, disabled: boolean) => button.setAttribute('aria-disabled', String(disabled));
const isDisabled = (button: HTMLElement) => button.getAttribute('aria-disabled') === 'true';

interface Field {
  input: HTMLInputElement;
  output: HTMLOutputElement;
  read(scene: Scene): number | null;
  write(scene: Scene, value: number): Scene;
  format(value: number): string;
}

const field = (id: string, rest: Omit<Field, 'input' | 'output'>): Field => ({
  input: $<HTMLInputElement>(id),
  output: $<HTMLOutputElement>(`${id}-out`),
  ...rest,
});

const selectedSource = (scene: Scene) => (selected ? sourceOf(scene, selected.id) : undefined);

const FIELDS: Field[] = [
  field('height', {
    read: (scene) => selectedSource(scene)?.height ?? null,
    write: (scene, height) => (selected ? updateSource(scene, selected.id, { height }) : scene),
    format: (value) => value.toFixed(2),
  }),
  field('radius', {
    read: (scene) => selectedSource(scene)?.radius ?? null,
    write: (scene, radius) => (selected ? updateSource(scene, selected.id, { radius }) : scene),
    format: (value) => value.toFixed(0),
  }),
  field('gap', {
    read: (scene) => scene.levels.spacing,
    write: (scene, spacing) => {
      // The lines keep covering the same heights, so a tighter gap draws more of them.
      const { count, spacing: original } = plateOf(scene).scene.levels;
      return {
        ...scene,
        levels: { ...scene.levels, spacing, count: Math.max(1, Math.min(64, Math.round((count * original) / spacing))) },
      };
    },
    format: (value) => value.toFixed(3),
  }),
  field('texture', {
    read: (scene) => scene.noise.amplitude,
    write: (scene, amplitude) => ({ ...scene, noise: { ...scene.noise, amplitude } }),
    format: (value) => value.toFixed(3),
  }),
  field('tint', {
    read: (scene) => scene.style.tint,
    // The middle of the track is off, and it holds on to a value that is nearly there.
    write: (scene, value) => ({ ...scene, style: { ...scene.style, tint: Math.abs(value) < 0.05 ? 0 : value } }),
    format: (value) => (value === 0 ? 'Off' : `${value > 0 ? 'High ground' : 'Low ground'} ${Math.abs(value).toFixed(2)}`),
  }),
];

function syncFields(): void {
  const scene = store.scene;
  const source = selectedSource(scene);
  if (!source) return;
  $('point-name').textContent = source.name;
  setDisabled(removeButton, scene.sources.filter((s) => s.enabled).length <= 1);
  for (const { input, output, read, format } of FIELDS) {
    const value = read(scene) ?? 0;
    // A value outside the track still reads true, and the thumb rests at the end.
    input.value = String(value);
    output.textContent = format(value);
    const low = Number(input.min);
    const fill = ((value - low) / (Number(input.max) - low)) * 100;
    input.style.setProperty('--fill', `${Math.min(100, Math.max(0, fill))}%`);
  }
}

for (const { input, write } of FIELDS) {
  input.addEventListener('input', () => {
    const mark = selectedMark();
    if (mark) settleFrom = { x: mark.x, y: mark.y, key: mark.key };
    store.edit(write(store.scene, Number(input.value)), input.id);
  });
}

/* The plate drawer */

interface Tile {
  plate: Plate | null;
  button: HTMLButtonElement;
  canvas: HTMLCanvasElement | null;
  label: HTMLSpanElement;
}

const THUMB_GRID = 96;

function drawThumb(tile: Tile): void {
  const { plate, canvas: thumb } = tile;
  if (!plate || !thumb) return;
  const width = thumb.clientWidth || 74;
  const height = thumb.clientHeight || 46;
  const clip = frameFor(plate, plate.scene, width / height, true);
  const scene: Scene = {
    ...plate.scene,
    clip,
    style: { ...plate.scene.style, strokeWidth: 0.35, indexWidth: 0.6, fade: Math.max(plate.scene.style.fade, 0.5) },
    export: { ...plate.scene.export, strokeScaling: 'fixed' },
  };
  side.compute(scene, 'draft', THUMB_GRID).then(
    (geometry) => {
      if (tile.plate !== plate) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      thumb.width = Math.round(width * dpr);
      thumb.height = Math.round(height * dpr);
      const ctx = thumb.getContext('2d') as CanvasRenderingContext2D;
      const scale = width / clip.width;
      drawArtwork(ctx, geometry, scene, { scale, x: -clip.x * scale, y: -clip.y * scale, dpr });
    },
    () => {},
  );
}

function makeTile(plate: Plate | null): Tile {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'plate';
  const label = document.createElement('span');
  const tile: Tile = { plate, button, canvas: null, label };
  if (plate) {
    tile.canvas = document.createElement('canvas');
    button.append(tile.canvas);
    label.textContent = plate.name;
    button.setAttribute('aria-label', `Plate ${plate.numeral}, ${plate.name}`);
    button.addEventListener('click', () => choose(plate));
  }
  button.append(label);
  plateStrip.append(button);
  return tile;
}

let tiles: Tile[] = [];
let newTile: Tile;

function buildDrawer(): void {
  tiles = PLATES.map((plate) => makeTile(plate));
  newTile = makeTile(null);
  newTile.button.insertAdjacentHTML(
    'afterbegin',
    '<i class="blank"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></i>',
  );
  newTile.label.textContent = 'New';
  newTile.button.setAttribute('aria-label', 'New composition');
  newTile.button.addEventListener('click', () => {
    // Never the same seed twice in a row.
    let seed = Math.floor(Math.random() * SEED_LIMIT);
    if (seed === latestMade?.seed) seed = (seed + 1) % SEED_LIMIT;
    const plate = generatePlate(seed);
    made.set(madeKey(plate.scene), plate);
    showMade(plate);
    choose(plate);
    say(`New composition, ${plate.name}, number ${seed}.`);
  });
}

/** The New tile shows the last composition it made, and makes another when pressed. */
function showMade(plate: Plate): void {
  latestMade = plate;
  if (!newTile.canvas) {
    newTile.button.querySelector('.blank')?.remove();
    newTile.canvas = document.createElement('canvas');
    newTile.button.prepend(newTile.canvas);
  }
  newTile.plate = plate;
  newTile.label.textContent = 'New';
  newTile.button.title = `${plate.name}, number ${plate.seed}. Press for another.`;
  drawThumb(newTile);
}

function choose(plate: Plate): void {
  endDrag();
  endInvite();
  closePanel();
  if (plateOf(store.scene) === plate && isOriginal(plate, store.scene)) return;
  selected = null;
  store.replaceScene(framed(plate.scene, plate));
}

/* Ink wells */

let wellButtons: HTMLButtonElement[] = [];

const buildWells = () => PALETTES.map((palette: Palette) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'well';
  button.title = palette.name;
  button.setAttribute('aria-label', `${palette.name} ink`);
  button.style.setProperty('--w-paper', palette.paper);
  button.style.setProperty('--w-ink', palette.ink);
  button.style.setProperty('--w-tint', palette.tint);
  button.append(document.createElement('i'));
  button.addEventListener('click', () => {
    endDrag();
    if (paletteOf(store.scene) === palette) return;
    store.edit(applyPalette(store.scene, palette), 'palette');
    say(`${palette.name} ink.`);
  });
  wells.append(button);
  return button;
});

/* The title block on the sheet */

const legendLive = $('legend-live');
const legendCount = $('legend-count');
const legendKey = $('legend-key');

/** The file for the drawing as shown, kept until the drawing changes. */
let file: { revision: number; scale: number; svg: string; tintBytes: number } | null = null;
let fileTimer = 0;

/** Line weights go into the file in drawing units, at the size they have on this stage. */
function fileScene(): Scene {
  const scene = store.scene;
  const { scale } = viewFor(scene.clip);
  const units = (px: number) => Math.max(0.05, Math.round((px / scale) * 100) / 100);
  return {
    ...scene,
    style: { ...scene.style, strokeWidth: units(scene.style.strokeWidth), indexWidth: units(scene.style.indexWidth) },
  };
}

function currentFile(): { svg: string; tintBytes: number } {
  const { revision, geometry } = store.getState();
  const { scale } = viewFor(store.scene.clip);
  if (file && file.revision === revision && file.scale === scale) return file;
  const svg = toSvg(geometry as Geometry, fileScene());
  // The tint is one group in the file, so its cost is that group's length.
  const from = svg.indexOf('<g fill=');
  const tintBytes = from < 0 ? 0 : svg.indexOf('</g>', from) + 5 - from;
  file = { revision, scale, svg, tintBytes };
  return file;
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
/** 12,104 from 12104. Spelled out because the first call into Intl costs a few ms. */
const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, ',');

function syncLive(): void {
  const state = store.previewState;
  const ready = store.exportReady && !store.inGesture;
  legendLive.dataset.state = ready ? 'final' : state === 'final' ? 'draft' : state;
  window.clearTimeout(fileTimer);
  if (!ready) {
    legendCount.textContent = state === 'refining' && !store.inGesture ? 'Finishing the lines' : 'Draft while it moves';
    return;
  }
  const { geometry } = store.getState();
  const nodes = grouped((geometry as Geometry).stats.outputVertices);
  legendCount.textContent = `${nodes} nodes`;
  // Writing the file takes a few ms, so it waits until nothing else is going on.
  fileTimer = window.setTimeout(() => {
    if (!store.exportReady || store.inGesture) return;
    const { svg, tintBytes } = currentFile();
    legendCount.textContent = `${nodes} nodes, ${kb(svg.length)} as SVG`;
    svgNote.textContent = tintBytes > 0 ? `${kb(svg.length)}, ${nodes} nodes, tint is ${kb(tintBytes)} of it` : `${kb(svg.length)}, ${nodes} nodes, lines only`;
  }, 140);
}

function syncLegend(): void {
  const scene = store.scene;
  const plate = plateOf(scene);
  const text = blockText(plate, scene);
  $('legend-name').textContent = text.name;
  $('legend-mark').textContent = text.mark;
  $('legend-lines').textContent = text.lines;
  const steps = keySteps(scene);
  const ordered = scene.style.tint < 0 ? [...steps].reverse() : steps;
  legendKey.replaceChildren(
    ...ordered.map((alpha) => {
      const cell = document.createElement('i');
      cell.style.opacity = alpha.toFixed(3);
      return cell;
    }),
  );
  stage.style.setProperty('--p-paper', scene.style.background ?? '#ffffff');
  stage.style.setProperty('--p-ink', scene.style.stroke);
  stage.style.setProperty('--p-tint', scene.style.tintColor);
}

function syncControls(): void {
  const scene = store.scene;
  const plate = plateOf(scene);
  const palette = paletteOf(scene);
  tiles.forEach((tile) => tile.button.setAttribute('aria-pressed', String(tile.plate === plate)));
  newTile.button.setAttribute('aria-pressed', String(plate.seed !== undefined));
  if (plate.seed !== undefined && newTile.plate !== plate) showMade(plate);
  wellButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(PALETTES[index] === palette)));
  setDisabled(undoButton, store.getState().history.past.length === 0);
  setDisabled(resetButton, isOriginal(plate, scene));
  canvas.setAttribute('aria-label', `Contour lines of ${plate.name}`);
  syncLegend();
  syncFields();
}

/* The address always holds the drawing */

let linkTimer = 0;

function syncLink(): void {
  const scene = store.scene;
  const query = writeLink(plateOf(scene), scene, new URLSearchParams(location.search)).toString();
  const next = `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
  if (next !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(history.state, '', next);
}

/** The store changes often. Only what changed is written to the page. */
let lastHistory: EditorState['history'] | null = null;
let lastGeometry: Geometry | null = null;
let wasReady = false;

function onStore(): void {
  const { geometry, history } = store.getState();
  // Ending a drag changes the history and leaves the scene as it is.
  if (history !== lastHistory) {
    lastHistory = history;
    if (!drag) {
      syncMarks();
      syncControls();
    }
    syncSheet();
    window.clearTimeout(linkTimer);
    linkTimer = window.setTimeout(() => {
      if (!store.inGesture) syncLink();
    }, 260);
  }
  if (geometry !== lastGeometry) {
    lastGeometry = geometry;
    if (drift.geometry) endDrift();
    requestPaint();
  }
  const ready = store.exportReady && !store.inGesture;
  if (ready && !wasReady && settleFrom) settle();
  if (ready !== wasReady || !ready) syncLive();
  wasReady = ready;
  stage.dataset.state = store.previewState;
  stage.dataset.revision = String(store.getState().revision);
}


/* Actions */

/** A frame in the history can be a step behind the stage. This brings it level. */
function reframeHistory(): void {
  const state = store.getState();
  const refit = (scene: Scene): Scene => {
    const clip = frameFor(plateOf(scene), scene, stageShape());
    const same = (Object.keys(clip) as (keyof Rect)[]).every((key) => clip[key] === scene.clip[key]);
    return same ? scene : { ...scene, clip };
  };
  const present = refit(state.history.present);
  if (present === state.history.present) return;
  store.set({
    history: { past: state.history.past.map(refit), present, future: state.history.future.map(refit) },
    revision: state.revision + 1,
  });
}

function undo(): void {
  endDrag();
  store.undo();
  reframeHistory();
}

function redo(): void {
  endDrag();
  store.redo();
  reframeHistory();
}

function reset(): void {
  endDrag();
  const scene = store.scene;
  const plate = plateOf(scene);
  // The ink is a choice about the print, not the drawing, so it stays.
  const palette = paletteOf(scene);
  store.edit(framed(palette ? applyPalette(plate.scene, palette) : plate.scene, plate));
}

undoButton.addEventListener('click', () => {
  if (!isDisabled(undoButton)) undo();
});
resetButton.addEventListener('click', () => {
  if (!isDisabled(resetButton)) reset();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (drag) {
      endDrag(false);
    } else if (stage.dataset.panel === 'exports') {
      closePanel();
      exportButton.focus({ preventScroll: true });
    } else if (stage.dataset.panel === 'inspector') {
      closePanel();
      selectedMark()?.el.focus({ preventScroll: true });
    }
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  }
});

/* Export */

type Wanted = 'svg' | PrintSize;
type RowState = 'idle' | 'holding' | 'drawing' | 'saved' | 'failed';

interface Row {
  wanted: Wanted;
  button: HTMLButtonElement;
  timer: number;
}

let svgNote: HTMLElement;

let rows: Row[] = [];

const buildRows = (): Row[] => (['svg', ...PRINT_SIZES] as Wanted[]).map((wanted) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'row';
  const title = wanted === 'svg' ? 'SVG, as drawn' : wanted.label;
  const note = wanted === 'svg' ? '' : `${wanted.width} by ${wanted.height} px, PNG`;
  button.innerHTML = `<span><b>${title}</b><small>${note}</small></span><em><span class="on" data-label="idle">Save</span><span data-label="holding">Finishing</span><span data-label="drawing">Drawing</span><span data-label="saved">Saved</span><span data-label="failed">Try again</span></em>`;
  if (wanted === 'svg') svgNote = button.querySelector('small') as HTMLElement;
  const row: Row = { wanted, button, timer: 0 };
  button.addEventListener('click', () => {
    if (button.getAttribute('aria-busy') === 'true') return;
    pending = row;
    hold.request();
  });
  exportRows.append(button);
  return row;
});

let pending: Row | null = null;

function showRow(row: Row, state: RowState): void {
  window.clearTimeout(row.timer);
  for (const span of row.button.querySelectorAll<HTMLElement>('[data-label]')) {
    span.classList.toggle('on', span.dataset.label === state);
  }
  row.button.dataset.state = state;
  if (state === 'holding' || state === 'drawing') row.button.setAttribute('aria-busy', 'true');
  else row.button.removeAttribute('aria-busy');
  if (state === 'saved') row.timer = window.setTimeout(() => showRow(row, 'idle'), SAVED_MS);
}

function saveSvg(row: Row): void {
  const { svg, tintBytes } = currentFile();
  const name = `${plateOf(store.scene).id}.svg`;
  saveBlob(name, new Blob([svg], { type: 'image/svg+xml' }));
  say(`Saved ${name}, ${kb(svg.length)}${tintBytes > 0 ? `, of which tint is ${kb(tintBytes)}` : ''}.`);
  showRow(row, 'saved');
}

/** Grid cells on the long side of a print. Finer than the stage, for the larger sheet. */
const PRINT_GRID = 1024;

async function savePrint(row: Row, size: PrintSize): Promise<void> {
  const scene = store.scene;
  const plate = plateOf(scene);
  const layout = layoutPrint(size, titleBlock.checked);
  const sized = printScene(plate, scene, size, layout);
  showRow(row, 'drawing');
  say(`Drawing the ${size.label.toLowerCase()}.`);
  try {
    const [geometry] = await Promise.all([
      side.compute(sized, 'final', PRINT_GRID),
      document.fonts.load("400 48px 'Geist Serif'"),
      document.fonts.load("400 24px 'Geist'"),
    ]);
    const sheetCanvas = document.createElement('canvas');
    sheetCanvas.width = layout.width;
    sheetCanvas.height = layout.height;
    const ctx = sheetCanvas.getContext('2d');
    if (!ctx) throw new Error('No canvas.');
    drawPrint(ctx, geometry, sized, layout, blockText(plate, scene));
    const blob = await new Promise<Blob | null>((resolve) => sheetCanvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('No image.');
    const name = `${plate.id}-${size.id}.png`;
    saveBlob(name, blob);
    say(`Saved ${name}, ${(blob.size / 1048576).toFixed(1)} MB.`);
    showRow(row, 'saved');
  } catch {
    say('That print could not be drawn. Press Try again.');
    showRow(row, 'failed');
  }
}

function deliver(): void {
  const row = pending;
  pending = null;
  if (!row) return;
  if (row.wanted === 'svg') saveSvg(row);
  else void savePrint(row, row.wanted);
}

const hold = new ExportHold(store, deliver, (state: HoldState) => {
  const row = pending;
  if (!row) return;
  if (state === 'holding') {
    showRow(row, 'holding');
    say('Finishing the lines.');
  } else if (state === 'failed') {
    showRow(row, 'failed');
    say('The lines could not be finished. Press Try again.');
  }
});

exportButton.addEventListener('click', () => {
  endDrag();
  togglePanel('exports');
  if (stage.dataset.panel === 'exports') rows[0].button.focus({ preventScroll: true });
});

function showCopy(label: 'idle' | 'done' | 'failed'): void {
  for (const span of copyButton.querySelectorAll<HTMLElement>('[data-label]')) {
    span.classList.toggle('on', span.dataset.label === label);
  }
}

let copyTimer = 0;
copyButton.addEventListener('click', async () => {
  window.clearTimeout(linkTimer);
  syncLink();
  window.clearTimeout(copyTimer);
  try {
    await navigator.clipboard.writeText(location.href);
    showCopy('done');
    say('Link copied.');
  } catch {
    showCopy('failed');
    say('The link is in the address bar.');
  }
  copyTimer = window.setTimeout(() => showCopy('idle'), SAVED_MS + 600);
});

/* Stage size */

new ResizeObserver(([entry]) => {
  const { width, height } = entry.contentRect;
  if (width === area.width && height === area.height) return;
  area.width = width;
  area.height = height;
  if (!built) return;
  reframeHistory();
  if (!drag) syncMarks();
  syncSheet();
  if (stage.dataset.panel === 'inspector') openPanel('inspector');
  cancelAnimationFrame(frame);
  paint();
}).observe(print);

function watchPixelRatio(): void {
  // Moving a window to another display changes the ratio and fires no resize.
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
    'change',
    () => {
      requestPaint();
      watchPixelRatio();
    },
    { once: true },
  );
}
watchPixelRatio();

/* The film loads its poster only once someone reaches it. */
const film = $<HTMLVideoElement>('film');
new IntersectionObserver((entries, observer) => {
  if (!entries.some((entry) => entry.isIntersecting)) return;
  film.poster = film.dataset.poster ?? '';
  observer.disconnect();
}, { rootMargin: '400px' }).observe(film);

// The worker already has the first scene. The controls are built and filled in a
// task of their own, so that neither holds up the other.
let built = false;
window.setTimeout(() => {
  buildDrawer();
  wellButtons = buildWells();
  rows = buildRows();
  built = true;
  // Anything that landed before this point is picked up here.
  reframeHistory();
  store.subscribe(onStore);
  onStore();
  drawThumbs();
  if (latestMade) showMade(latestMade);
}, 0);
// The thumbnails wait for the first print, so the drawing is never behind them.
let thumbsDrawn = false;
function drawThumbs(): void {
  if (thumbsDrawn || tiles.length === 0 || !store.getState().geometry) return;
  thumbsDrawn = true;
  tiles.forEach(drawThumb);
}
store.subscribe(drawThumbs);

// Read by the page's browser checks. It gives access to state only, and only when
// the URL asks for it.
if (params.has('hook')) {
  (window as unknown as { __contour: unknown }).__contour = { store, session, hold, drawLog, drift, side, plateOf, currentFile };
}
