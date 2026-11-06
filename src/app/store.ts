/**
 * Editor state. A small store with no framework, so that it can be read in one
 * sitting. React subscribes with useSyncExternalStore.
 *
 * Scene edits increase `revision`. Every geometry result names the revision it
 * was computed from, which is how stale results are recognised.
 */

import type { Geometry } from '../core/pipeline';
import { PRESETS } from '../core/presets';
import type { Rect, Scene } from '../core/scene';
import { record, redo, undo, type History } from './history';
import type { ExportReport } from './report';
import { previewState, shouldCommit, type PreviewState, type Shown } from './jobs';

export type Tool = 'select' | 'peak' | 'ridge' | 'pan';
export type Panel = 'lines' | 'export';

export interface Selection {
  sourceId: string;
  /** A ridge handle index. Null selects the whole source. */
  handle: number | null;
}

export interface View {
  /** CSS px per model unit. */
  scale: number;
  /** CSS px from the stage's top left to model (0, 0). */
  x: number;
  y: number;
}

export interface Notice {
  kind: 'info' | 'error';
  title: string;
  details?: string[];
}

export interface EditorState {
  history: History<Scene>;
  revision: number;
  selection: Selection | null;
  tool: Tool;
  /** Handles placed so far while drawing a ridge. */
  draftRidge: { x: number; y: number }[];
  view: View;
  stage: { width: number; height: number };
  /** Keeps the frame fitted as the stage resizes, until the user moves the view. */
  autoFit: boolean;
  fitPending: boolean;
  panel: Panel;
  snap: boolean;
  showNodes: boolean;
  showHandles: boolean;
  /** Geometry on screen, with what it was computed from. */
  geometry: Geometry | null;
  shown: Shown | null;
  report: { revision: number; report: ExportReport } | null;
  /** The scene revision that geometry could not be computed for. */
  failedRevision: number | null;
  notice: Notice | null;
  dialog: 'starters' | 'shortcuts' | null;
  /** Where the scene stands in this browser's storage. */
  saveState: 'idle' | 'saved' | 'failed';
  pointer: { x: number; y: number } | null;
}

/** Same field edited within this window is one undo step. */
const COALESCE_MS = 700;

type Listener = () => void;

export class EditorStore {
  private state: EditorState;
  private listeners = new Set<Listener>();
  private gestureBase: Scene | null = null;
  private lastCoalesce: { key: string; at: number } | null = null;
  /** The time of the input behind the next scene change, on the performance clock. */
  private inputAt: number | null = null;

  constructor(scene: Scene) {
    this.state = {
      history: { past: [], present: scene, future: [] },
      revision: 1,
      selection: null,
      tool: 'select',
      draftRidge: [],
      view: { scale: 1, x: 0, y: 0 },
      stage: { width: 0, height: 0 },
      autoFit: true,
      fitPending: true,
      panel: 'lines',
      snap: false,
      showNodes: false,
      showHandles: true,
      geometry: null,
      shown: null,
      report: null,
      failedRevision: null,
      notice: null,
      dialog: null,
      saveState: 'idle',
      pointer: null,
    };
  }

  getState = (): EditorState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(change: Partial<EditorState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }

  get scene(): Scene {
    return this.state.history.present;
  }

  get inGesture(): boolean {
    return this.gestureBase !== null;
  }

  get previewState(): PreviewState {
    return previewState(this.state.shown, this.state.revision);
  }

  /** Notes when a pointer event happened, which can be before it was handled. */
  markInput(timeStamp: number): void {
    this.inputAt = timeStamp;
  }

  takeInput(): number | null {
    const at = this.inputAt;
    this.inputAt = null;
    return at;
  }

  /** Export only ever writes final geometry computed from the scene on screen. */
  get exportReady(): boolean {
    const { shown, revision, geometry } = this.state;
    return previewState(shown, revision) === 'final' && geometry?.quality === 'final';
  }

  /** A complete edit. Calls with the same key in quick succession merge. */
  edit(next: Scene, coalesceKey?: string): void {
    if (next === this.scene) return;
    const at = Date.now();
    const merging =
      coalesceKey !== undefined &&
      this.lastCoalesce?.key === coalesceKey &&
      at - this.lastCoalesce.at < COALESCE_MS;
    const history = merging
      ? { ...this.state.history, present: next, future: [] }
      : record(this.state.history, next);
    this.lastCoalesce = coalesceKey ? { key: coalesceKey, at } : null;
    this.set({ history, revision: this.state.revision + 1 });
  }

  /** Starts a drag. Everything until endGesture is one undo step. */
  beginGesture(): void {
    this.gestureBase = this.scene;
  }

  /** Changes the scene during a drag without adding to history. */
  gesture(next: Scene): void {
    this.set({
      history: { ...this.state.history, present: next },
      revision: this.state.revision + 1,
    });
  }

  endGesture(): void {
    const base = this.gestureBase;
    this.gestureBase = null;
    if (!base || base === this.scene) return;
    const present = this.scene;
    this.set({
      history: record({ ...this.state.history, present: base }, present),
    });
  }

  undo(): void {
    if (this.state.history.past.length === 0) return;
    this.applyHistory(undo(this.state.history));
  }

  redo(): void {
    if (this.state.history.future.length === 0) return;
    this.applyHistory(redo(this.state.history));
  }

  private applyHistory(history: History<Scene>): void {
    // A later edit to the same field must start a new undo step here.
    this.lastCoalesce = null;
    const before = this.scene;
    const after = history.present;
    const sheetChanged =
      before.clip !== after.clip &&
      JSON.stringify([before.clip, before.domain]) !== JSON.stringify([after.clip, after.domain]);
    this.set({
      history,
      revision: this.state.revision + 1,
      selection: repairSelection(this.state.selection, after),
      fitPending: sheetChanged || this.state.fitPending,
    });
  }

  /** Replaces the composition. It is undoable, so a mistaken load loses nothing. */
  replaceScene(scene: Scene): void {
    this.edit(scene);
    this.set({ selection: null, fitPending: true, draftRidge: [], tool: 'select' });
  }

  select(selection: Selection | null): void {
    this.set({ selection });
  }

  commitGeometry(revision: number, geometry: Geometry): boolean {
    const result = { revision, quality: geometry.quality };
    if (!shouldCommit(this.state.shown, result)) return false;
    this.set({ geometry, shown: result });
    return true;
  }

  fit(rect: Rect): void {
    const { width, height } = this.state.stage;
    if (width === 0 || height === 0) return;
    const pad = Math.min(48, Math.min(width, height) * 0.08);
    const scale = Math.min((width - pad * 2) / rect.width, (height - pad * 2) / rect.height);
    this.set({
      view: {
        scale,
        x: (width - rect.width * scale) / 2 - rect.x * scale,
        y: (height - rect.height * scale) / 2 - rect.y * scale,
      },
      autoFit: true,
      fitPending: false,
    });
  }

  /** Zooms about a point in stage coordinates, so that point stays still. */
  zoomAt(px: number, py: number, factor: number): void {
    const { view } = this.state;
    const scale = Math.min(32, Math.max(0.02, view.scale * factor));
    const applied = scale / view.scale;
    this.set({
      view: { scale, x: px - (px - view.x) * applied, y: py - (py - view.y) * applied },
      autoFit: false,
    });
  }

  panBy(dx: number, dy: number): void {
    const { view } = this.state;
    this.set({ view: { ...view, x: view.x + dx, y: view.y + dy }, autoFit: false });
  }

  notify(notice: Notice | null): void {
    this.set({ notice });
  }
}

/** Keeps a selection only if what it points at still exists. */
function repairSelection(selection: Selection | null, scene: Scene): Selection | null {
  if (!selection) return null;
  const source = scene.sources.find((s) => s.id === selection.sourceId);
  if (!source) return null;
  const { handle } = selection;
  if (handle === null) return selection;
  const valid = source.kind === 'ridge' && handle < source.points.length;
  return valid ? selection : { sourceId: selection.sourceId, handle: null };
}

export function firstScene(): Scene {
  return PRESETS[0].scene;
}
