/**
 * The project page. The drawing is live: the studio's store, session and worker
 * do the geometry, and this file only connects them to the stage.
 */

import { GeometryClient, type Engine } from '../src/app/geometry-client';
import { setHandle, updateSource } from '../src/app/edits';
import { drawArtwork, drawLog } from '../src/app/render';
import { startSession } from '../src/app/session';
import { EditorStore, type EditorState } from '../src/app/store';
import type { Geometry } from '../src/core/pipeline';
import type { Rect, Scene } from '../src/core/scene';
import { toSvg } from '../src/core/svg';
import { COMPOSITIONS, compositionOf, frameFor, handleOf, type Composition } from './compositions';
import { ExportHold, type HoldState } from './export-hold';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const stage = $('stage');
const canvas = $<HTMLCanvasElement>('art');
const fade = $<HTMLCanvasElement>('fade');
const sheet = $('sheet');
const handle = $<HTMLButtonElement>('handle');
const inspector = $('inspector');
const toolbar = $('toolbar');
const presets = $('presets');
const undoButton = $<HTMLButtonElement>('undo');
const resetButton = $<HTMLButtonElement>('reset');
const exportButton = $<HTMLButtonElement>('export');
const status = $('status');
const context = canvas.getContext('2d') as CanvasRenderingContext2D;

const stillPage = matchMedia('(prefers-reduced-motion: reduce)');
const NUDGE = 10;
const NUDGE_LARGE = 50;
const DRAG_SLOP_PX = 3;
const SAVED_MS = 1600;
const CROSSFADE_MS = 220;

const stageShape = () => Math.max(1, stage.clientWidth) / Math.max(1, stage.clientHeight);
const framed = (scene: Scene): Scene => ({ ...scene, clip: frameFor(scene, stageShape()) });

const params = new URLSearchParams(location.search);
const engines: Record<string, Engine> = { off: 'sliced', blocking: 'blocking' };
const store = new EditorStore(framed(COMPOSITIONS[0].scene));
const session = startSession(store, {
  engine: engines[params.get('worker') ?? ''] ?? 'worker',
  createClient: (events, options) => new GeometryClient(events, options),
  persist: () => true,
  report: false,
});

/* Stage geometry */

interface View {
  scale: number;
  x: number;
  y: number;
}

/** Fits a frame in the stage. A shape within a rounding step fills it edge to edge. */
function viewFor(rect: Rect): View {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const fits = Math.min(width / rect.width, height / rect.height);
  const fills = Math.max(width / rect.width, height / rect.height);
  const scale = fills / fits < 1.01 ? fills : fits;
  return {
    scale,
    x: (width - rect.width * scale) / 2 - rect.x * scale,
    y: (height - rect.height * scale) / 2 - rect.y * scale,
  };
}

/** Where the handle may go, in stage px. It stays grabbable and clear of the toolbar. */
function handleLimits() {
  const { clip } = store.scene;
  const view = viewFor(clip);
  const pad = 22;
  const bottom = Math.min(view.y + (clip.y + clip.height) * view.scale, toolbar.offsetTop);
  return {
    left: view.x + clip.x * view.scale + pad,
    right: view.x + (clip.x + clip.width) * view.scale - pad,
    top: view.y + clip.y * view.scale + pad,
    bottom: bottom - pad - 6,
  };
}

/** Room the hint needs on either side of the handle. */
const HINT_REACH = 130;

function placeHandle(px: number, py: number): void {
  handle.style.transform = `translate3d(${px}px, ${py}px, 0)`;
  stage.toggleAttribute('data-hint-below', py < 48);
  const edge = px < HINT_REACH ? 'start' : px > stage.clientWidth - HINT_REACH ? 'end' : 'middle';
  if (stage.dataset.hintEdge !== edge) stage.dataset.hintEdge = edge;
}

function syncHandle(): void {
  const view = viewFor(store.scene.clip);
  const point = handleOf(store.scene);
  placeHandle(point.x * view.scale + view.x, point.y * view.scale + view.y);
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
let painted: Composition | null = null;

function requestPaint(): void {
  if (!frame) frame = requestAnimationFrame(paint);
}

function sizeCanvas(): number {
  // Beyond 2x the lines look the same and the canvas costs four times as much.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.round(stage.clientWidth * dpr);
  const height = Math.round(stage.clientHeight * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return dpr;
}

/** Holds the old drawing over the new one for a moment when the composition changes. */
function crossfade(): void {
  if (stillPage.matches) return;
  fade.width = canvas.width;
  fade.height = canvas.height;
  fade.getContext('2d')?.drawImage(canvas, 0, 0);
  fade.getAnimations().forEach((animation) => animation.cancel());
  fade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CROSSFADE_MS, easing: 'ease-out' });
}

function paint(): void {
  frame = 0;
  const { geometry } = store.getState();
  if (!geometry) return;
  const scene = store.scene;
  const composition = compositionOf(scene);
  if (painted && painted !== composition) crossfade();
  painted = composition;
  const dpr = sizeCanvas();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  // Line widths stay in screen px here, so a phone gets the same weight as a desktop.
  const fixedWeight = { ...scene, export: { ...scene.export, strokeScaling: 'fixed' as const } };
  drawArtwork(context, geometry, fixedWeight, { ...viewFor(geometry.rect), dpr });
  stage.classList.add('drawn');
}

/* Controls */

const presetButtons = COMPOSITIONS.map((composition, index) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'control';
  button.textContent = composition.label;
  button.setAttribute('aria-pressed', String(index === 0));
  button.addEventListener('click', () => choose(composition));
  presets.append(button);
  return button;
});

const setDisabled = (button: HTMLElement, disabled: boolean) =>
  button.setAttribute('aria-disabled', String(disabled));
const isDisabled = (button: HTMLElement) => button.getAttribute('aria-disabled') === 'true';

function isOriginal(scene: Scene): boolean {
  const base = compositionOf(scene).scene;
  const parts = ({ sources, levels, noise }: Scene) => JSON.stringify([sources, levels, noise]);
  return parts(scene) === parts(base);
}

interface Field {
  input: HTMLInputElement;
  output: HTMLOutputElement;
  read(scene: Scene): number;
  write(scene: Scene, value: number): Scene;
  format(value: number): string;
}

const field = (id: string, rest: Omit<Field, 'input' | 'output'>): Field => ({
  input: $<HTMLInputElement>(id),
  output: $<HTMLOutputElement>(`${id}-out`),
  ...rest,
});

const FIELDS: Field[] = [
  field('height', {
    read: (scene) => handleOf(scene).height,
    write: (scene, height) => updateSource(scene, handleOf(scene).id, { height }),
    format: (value) => value.toFixed(2),
  }),
  field('radius', {
    read: (scene) => handleOf(scene).radius,
    write: (scene, radius) => updateSource(scene, handleOf(scene).id, { radius }),
    format: (value) => value.toFixed(0),
  }),
  field('gap', {
    read: (scene) => scene.levels.spacing,
    write: (scene, spacing) => {
      // The lines keep covering the same heights, so a tighter gap draws more of them.
      const { count, spacing: original } = compositionOf(scene).scene.levels;
      return {
        ...scene,
        levels: { ...scene.levels, spacing, count: Math.min(64, Math.round((count * original) / spacing)) },
      };
    },
    format: (value) => value.toFixed(3),
  }),
  field('texture', {
    read: (scene) => scene.noise.amplitude,
    write: (scene, amplitude) => ({ ...scene, noise: { ...scene.noise, amplitude } }),
    format: (value) => value.toFixed(3),
  }),
];

function syncFields(): void {
  $('point-name').textContent = handleOf(store.scene).name;
  for (const { input, output, read, format } of FIELDS) {
    const value = read(store.scene);
    input.value = String(value);
    output.textContent = format(value);
    const low = Number(input.min);
    const fill = ((value - low) / (Number(input.max) - low)) * 100;
    input.style.setProperty('--fill', `${Math.min(100, Math.max(0, fill))}%`);
  }
}

function syncControls(): void {
  const scene = store.scene;
  const composition = compositionOf(scene);
  presetButtons.forEach((button, index) => {
    button.setAttribute('aria-pressed', String(COMPOSITIONS[index] === composition));
  });
  setDisabled(undoButton, store.getState().history.past.length === 0);
  setDisabled(resetButton, isOriginal(scene));
  canvas.setAttribute('aria-label', `Contour lines of ${scene.name}`);
  handle.setAttribute(
    'aria-label',
    `Move ${handleOf(scene).name}. Drag it or use the arrow keys. Press Enter for its settings.`,
  );
  syncFields();
}

/** The store changes often. Only what changed is written to the page. */
let lastHistory: EditorState['history'] | null = null;
let lastGeometry: Geometry | null = null;

function onStore(): void {
  const { geometry, history } = store.getState();
  // Ending a drag changes the history and leaves the scene as it is.
  if (history !== lastHistory) {
    lastHistory = history;
    if (!drag) {
      syncHandle();
      syncControls();
    }
    syncSheet();
  }
  if (geometry !== lastGeometry) {
    lastGeometry = geometry;
    requestPaint();
  }
  stage.dataset.state = store.previewState;
  stage.dataset.revision = String(store.getState().revision);
}

store.subscribe(onStore);

/* Selection */

function setSelected(on: boolean): void {
  handle.setAttribute('aria-expanded', String(on));
  inspector.hidden = !on;
  if (!on) return;
  // The panel opens on the side away from the handle, so it never covers it.
  const view = viewFor(store.scene.clip);
  const point = handleOf(store.scene);
  const px = point.x * view.scale + view.x;
  const py = point.y * view.scale + view.y;
  inspector.dataset.side = px > stage.clientWidth / 2 ? 'left' : 'right';
  inspector.dataset.edge = py < stage.clientHeight / 2 ? 'bottom' : 'top';
  stage.style.setProperty('--panel-bottom', `${stage.clientHeight - toolbar.offsetTop + 6}px`);
}

const isSelected = () => handle.getAttribute('aria-expanded') === 'true';

function endInvite(): void {
  stage.removeAttribute('data-invite');
}

/* Dragging */

interface Drag {
  id: number;
  /** From the pointer to the centre of the handle, in stage px. */
  grabX: number;
  grabY: number;
  startX: number;
  startY: number;
  moved: boolean;
  pending: { x: number; y: number } | null;
  frame: number;
}

let drag: Drag | null = null;

function stagePoint(event: PointerEvent): { x: number; y: number } {
  const box = stage.getBoundingClientRect();
  return { x: event.clientX - box.left - stage.clientLeft, y: event.clientY - box.top - stage.clientTop };
}

function flushDrag(): void {
  if (!drag) return;
  cancelAnimationFrame(drag.frame);
  drag.frame = 0;
  if (!drag.pending) return;
  const { x, y } = drag.pending;
  drag.pending = null;
  store.gesture(setHandle(store.scene, handleOf(store.scene).id, 0, x, y));
}

function moveDrag(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.id) return;
  const at = stagePoint(event);
  if (!drag.moved && Math.hypot(at.x - drag.startX, at.y - drag.startY) < DRAG_SLOP_PX) return;
  drag.moved = true;
  const limits = handleLimits();
  const px = Math.min(limits.right, Math.max(limits.left, at.x + drag.grabX));
  const py = Math.min(limits.bottom, Math.max(limits.top, at.y + drag.grabY));
  // The handle moves now. The lines catch up on the next frame.
  placeHandle(px, py);
  const view = viewFor(store.scene.clip);
  drag.pending = { x: Math.round((px - view.x) / view.scale), y: Math.round((py - view.y) / view.scale) };
  store.markInput(event.timeStamp);
  if (!drag.frame) drag.frame = requestAnimationFrame(flushDrag);
}

/** Ends a drag from any cause. `keep` false puts the point back where it started. */
function endDrag(keep = true): void {
  if (!drag) return;
  const { moved, id } = drag;
  flushDrag();
  drag = null;
  stage.removeAttribute('data-dragging');
  if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
  store.endGesture();
  if (!keep && moved) store.undo();
  syncHandle();
}

handle.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || drag) return;
  endInvite();
  handle.focus({ preventScroll: true });
  handle.setPointerCapture(event.pointerId);
  const at = stagePoint(event);
  const view = viewFor(store.scene.clip);
  const point = handleOf(store.scene);
  drag = {
    id: event.pointerId,
    grabX: point.x * view.scale + view.x - at.x,
    grabY: point.y * view.scale + view.y - at.y,
    startX: at.x,
    startY: at.y,
    moved: false,
    pending: null,
    frame: 0,
  };
  store.beginGesture();
  stage.setAttribute('data-dragging', '');
});
handle.addEventListener('pointermove', moveDrag);
handle.addEventListener('pointerup', (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  const { moved } = drag;
  endDrag();
  if (!moved) setSelected(!isSelected());
});
handle.addEventListener('pointercancel', () => endDrag());
handle.addEventListener('lostpointercapture', () => endDrag());
window.addEventListener('blur', () => endDrag());

// A pointer press is handled above. A click with no pointer behind it is Enter or Space.
handle.addEventListener('click', (event) => {
  if (event.detail === 0) setSelected(!isSelected());
});

handle.addEventListener('keydown', (event) => {
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
  const view = viewFor(store.scene.clip);
  const limits = handleLimits();
  const point = handleOf(store.scene);
  const x = Math.min((limits.right - view.x) / view.scale, Math.max((limits.left - view.x) / view.scale, point.x + move[0]));
  const y = Math.min((limits.bottom - view.y) / view.scale, Math.max((limits.top - view.y) / view.scale, point.y + move[1]));
  store.edit(setHandle(store.scene, point.id, 0, Math.round(x), Math.round(y)), 'nudge');
});

stage.addEventListener('pointerdown', (event) => {
  if (event.target === canvas || event.target === stage) setSelected(false);
});

$('close').addEventListener('click', () => {
  setSelected(false);
  handle.focus({ preventScroll: true });
});

/* Actions */

function choose(composition: Composition): void {
  endDrag();
  endInvite();
  if (compositionOf(store.scene) === composition) return;
  store.replaceScene(framed(composition.scene));
  if (isSelected()) setSelected(true);
}

/** A frame in the history can be a step behind the stage. This brings it level. */
function reframeHistory(): void {
  const state = store.getState();
  const refit = (scene: Scene): Scene => {
    const clip = frameFor(scene, stageShape());
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
  store.edit(framed(compositionOf(store.scene).scene));
}

undoButton.addEventListener('click', () => {
  if (!isDisabled(undoButton)) undo();
});
resetButton.addEventListener('click', () => {
  if (!isDisabled(resetButton)) reset();
});

for (const { input, write } of FIELDS) {
  input.addEventListener('input', () => {
    store.edit(write(store.scene, Number(input.value)), input.id);
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (drag) {
      endDrag(false);
    } else if (isSelected()) {
      setSelected(false);
      handle.focus({ preventScroll: true });
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

let savedTimer = 0;

function showExport(label: 'idle' | 'holding' | 'saved' | 'failed'): void {
  for (const span of exportButton.querySelectorAll<HTMLElement>('[data-label]')) {
    span.classList.toggle('on', span.dataset.label === label);
  }
  exportButton.toggleAttribute('data-saved', label === 'saved');
  if (label === 'holding') exportButton.setAttribute('aria-busy', 'true');
  else exportButton.removeAttribute('aria-busy');
  setDisabled(exportButton, label === 'holding');
}

function save(): void {
  const scene = store.scene;
  const svg = toSvg(store.getState().geometry as Geometry, scene);
  const name = `${compositionOf(scene).id}.svg`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = `Saved ${name}, ${(svg.length / 1024).toFixed(0)} KB.`;
  showExport('saved');
  window.clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => showExport('idle'), SAVED_MS);
}

const hold = new ExportHold(store, save, (state: HoldState) => {
  if (state === 'holding') {
    window.clearTimeout(savedTimer);
    showExport('holding');
    status.textContent = 'Finishing the lines.';
  } else if (state === 'failed') {
    showExport('failed');
    status.textContent = 'The lines could not be finished. Press Try again.';
  }
});

exportButton.addEventListener('click', () => hold.request());

/* Stage size */

new ResizeObserver(() => {
  reframeHistory();
  syncHandle();
  syncSheet();
  if (isSelected()) setSelected(true);
  cancelAnimationFrame(frame);
  paint();
}).observe(stage);

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

onStore();

// Read by the page's browser checks. It gives access to state only, and only when
// the URL asks for it.
if (params.has('hook')) {
  (window as unknown as { __contour: unknown }).__contour = { store, session, hold, drawLog };
}
