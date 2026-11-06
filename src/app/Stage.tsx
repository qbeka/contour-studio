/**
 * The canvas and the handles laid over it.
 *
 * Handles are buttons. That gives focus, keyboard, touch and accessible names
 * from the platform, and leaves one input model. The canvas only draws.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { flattenRidge } from '../core/field';
import { LIMITS, type Source } from '../core/scene';
import {
  addPeak,
  addRidge,
  clamp,
  hasRoom,
  moveSource,
  setHandle,
  snapPoint,
  updateSource,
} from './edits';
import { drawArtwork, drawNodes } from './render';
import type { EditorState, EditorStore } from './store';

const INK = '#111511';
const FOREST = '#1d3a2a';
const PAPER = '#fffdfa';
const LINE = 'rgba(17, 21, 17, 0.16)';

function useCanvasDraw(
  canvas: React.RefObject<HTMLCanvasElement | null>,
  store: EditorStore,
  state: EditorState,
) {
  const frame = useRef(0);
  const [dprTick, setDprTick] = useState(0);
  // Moving a window to another display changes the pixel ratio and fires no resize.
  useEffect(() => {
    const query = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onChange = () => setDprTick((tick) => tick + 1);
    query.addEventListener('change', onChange, { once: true });
    return () => query.removeEventListener('change', onChange);
  }, [dprTick]);
  useEffect(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const element = canvas.current;
      const ctx = element?.getContext('2d');
      if (!element || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = state.stage;
      const targetW = Math.round(width * dpr);
      const targetH = Math.round(height * dpr);
      if (element.width !== targetW || element.height !== targetH) {
        element.width = targetW;
        element.height = targetH;
      }
      const { scale, x, y } = state.view;
      const scene = store.scene;
      const transform = { scale, x, y, dpr };
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, targetW, targetH);

      // The sheet is the domain. The frame is what exports.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = PAPER;
      ctx.fillRect(x, y, scene.domain.width * scale, scene.domain.height * scale);

      if (state.geometry) {
        drawArtwork(ctx, state.geometry, scene, transform);
        if (state.showNodes) drawNodes(ctx, state.geometry, transform, FOREST);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 1;
      ctx.strokeStyle = LINE;
      ctx.strokeRect(
        Math.round(x + scene.clip.x * scale) + 0.5,
        Math.round(y + scene.clip.y * scale) + 0.5,
        Math.round(scene.clip.width * scale),
        Math.round(scene.clip.height * scale),
      );
      if (state.geometry) {
        const r = state.geometry.rect;
        if (r.width !== scene.clip.width || r.height !== scene.clip.height) {
          ctx.setLineDash([3, 4]);
          ctx.strokeRect(
            Math.round(x + r.x * scale) + 0.5,
            Math.round(y + r.y * scale) + 0.5,
            Math.round(r.width * scale),
            Math.round(r.height * scale),
          );
          ctx.setLineDash([]);
        }
      }

      const selected = scene.sources.find((s) => s.id === state.selection?.sourceId);
      if (selected) {
        ctx.strokeStyle = FOREST;
        ctx.globalAlpha = 0.55;
        ctx.setLineDash([2, 4]);
        drawReach(ctx, selected, scale, x, y);
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      // Only the selected ridge shows its spine, so that the sheet otherwise holds
      // exactly what will be exported.
      if (selected?.kind === 'ridge') {
        ctx.strokeStyle = FOREST;
        ctx.lineWidth = 1.25;
        tracePolyline(ctx, flattenRidge(selected.points), scale, x, y);
        ctx.stroke();
      }
      if (state.draftRidge.length > 0) {
        ctx.strokeStyle = INK;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        state.draftRidge.forEach((p, i) => {
          const px = x + p.x * scale;
          const py = y + p.y * scale;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        if (state.pointer) {
          ctx.lineTo(x + state.pointer.x * scale, y + state.pointer.y * scale);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
    return () => cancelAnimationFrame(frame.current);
  }, [canvas, store, state.geometry, state.view, state.stage, state.showNodes, state.selection, state.draftRidge, state.history, state.pointer, dprTick]);
}

function tracePolyline(
  ctx: CanvasRenderingContext2D,
  line: Float64Array,
  scale: number,
  x: number,
  y: number,
): void {
  ctx.beginPath();
  for (let k = 0; k < line.length; k += 2) {
    const px = x + line[k] * scale;
    const py = y + line[k + 1] * scale;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
}

/** One circle at the anchor the reach handle sits on, so a ridge stays readable. */
function drawReach(
  ctx: CanvasRenderingContext2D,
  source: Source,
  scale: number,
  x: number,
  y: number,
): void {
  const anchor = source.kind === 'peak' ? source : source.points[0];
  ctx.beginPath();
  ctx.arc(x + anchor.x * scale, y + anchor.y * scale, source.radius * scale, 0, Math.PI * 2);
  ctx.stroke();
}

function eventPoint(element: HTMLElement, event: { clientX: number; clientY: number }) {
  const box = element.getBoundingClientRect();
  return { px: event.clientX - box.left, py: event.clientY - box.top };
}

export function Stage({ store, state }: { store: EditorStore; state: EditorState }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  useCanvasDraw(canvas, store, state);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const box = element.getBoundingClientRect();
      store.set({ stage: { width: box.width, height: box.height } });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [store]);

  useEffect(() => {
    if ((state.fitPending || state.autoFit) && state.stage.width > 0) store.fit(store.scene.clip);
  }, [state.fitPending, state.autoFit, state.stage, store]);

  // Wheel needs a non-passive listener to stop the page from zooming.
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { px, py } = eventPoint(element, event);
      if (event.ctrlKey || event.metaKey) {
        store.zoomAt(px, py, Math.exp(-event.deltaY * 0.01));
      } else {
        store.panBy(-event.deltaX, -event.deltaY);
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [store]);

  const toModel = useCallback(
    (px: number, py: number) => {
      const { view } = store.getState();
      return { x: (px - view.x) / view.scale, y: (py - view.y) / view.scale };
    },
    [store],
  );

  const placed = (x: number, y: number, bypass: boolean) => {
    const { snap } = store.getState();
    return snap && !bypass ? snapPoint(store.scene, x, y) : { x, y };
  };

  /** Pointers on the bare stage: pan, pinch, place, deselect. */
  const pointers = useRef(new Map<number, { px: number; py: number }>());
  const pinch = useRef<{ distance: number } | null>(null);
  const panning = useRef(false);
  const spaceHeld = useRef(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Space') spaceHeld.current = event.type === 'keydown';
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  const onStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget && event.target !== canvas.current) return;
    const element = stage.current as HTMLDivElement;
    element.setPointerCapture(event.pointerId);
    const point = eventPoint(element, event);
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.px - b.px, a.py - b.py) };
      panning.current = false;
      return;
    }
    const { tool } = store.getState();
    const model = toModel(point.px, point.py);
    if (tool === 'pan' || event.button === 1 || spaceHeld.current) {
      panning.current = true;
      return;
    }
    // Only the main button places anything. Right click belongs to the browser.
    if (event.button !== 0) return;
    const at = placed(model.x, model.y, event.altKey);
    if (tool === 'peak' || tool === 'ridge') {
      if (!hasRoom(store.scene)) {
        store.notify({ kind: 'info', title: `A scene can hold ${LIMITS.sources} sources.` });
        return;
      }
    }
    if (tool === 'peak') {
      const { scene, id } = addPeak(store.scene, at.x, at.y);
      store.edit(scene);
      store.set({ selection: { sourceId: id, handle: null }, tool: 'select' });
      return;
    }
    if (tool === 'ridge') {
      const draft = [...store.getState().draftRidge, at];
      if (draft.length >= LIMITS.handles.max) finishRidge(store, draft);
      else store.set({ draftRidge: draft });
      return;
    }
    store.select(null);
    // A touch drag on the empty sheet pans, which is what a thumb expects.
    if (event.pointerType === 'touch') panning.current = true;
  };

  const onStagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = stage.current as HTMLDivElement;
    const point = eventPoint(element, event);
    const model = toModel(point.px, point.py);
    store.set({ pointer: model });
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, point);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.px - b.px, a.py - b.py);
      store.zoomAt((a.px + b.px) / 2, (a.py + b.py) / 2, distance / pinch.current.distance);
      pinch.current = { distance };
      return;
    }
    if (panning.current) store.panBy(point.px - previous.px, point.py - previous.py);
  };

  const onStagePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) panning.current = false;
  };

  const onDoubleClick = () => {
    const { tool, draftRidge, view } = store.getState();
    if (tool !== 'ridge') return;
    // The two clicks of a double click each placed a point at the same spot.
    const last = draftRidge[draftRidge.length - 1];
    const before = draftRidge[draftRidge.length - 2];
    const repeated =
      last && before && Math.hypot(last.x - before.x, last.y - before.y) * view.scale < 4;
    finishRidge(store, repeated ? draftRidge.slice(0, -1) : draftRidge);
  };

  const scene = store.scene;
  const { view, selection, tool } = state;
  const toX = (x: number) => view.x + x * view.scale;
  const toY = (y: number) => view.y + y * view.scale;

  return (
    <div
      ref={stage}
      className="stage"
      data-tool={tool}
      data-handles={state.showHandles ? 'on' : 'off'}
      onPointerDown={onStagePointerDown}
      onPointerMove={onStagePointerMove}
      onPointerUp={onStagePointerUp}
      onPointerCancel={onStagePointerUp}
      onPointerLeave={() => store.set({ pointer: null })}
      onDoubleClick={onDoubleClick}
    >
      <canvas
        ref={canvas}
        className="stage-canvas"
        role="img"
        aria-label={`Preview of ${scene.name || 'the scene'}. ${scene.sources.length} sources, ${state.geometry?.stats.outputPaths ?? 0} lines.`}
      />
      {scene.sources.map((source) =>
        source.kind === 'peak' ? (
          <SourceHandle
            key={source.id}
            store={store}
            source={source}
            index={null}
            label={`${source.name}, at ${Math.round(source.x)}, ${Math.round(source.y)}`}
            x={toX(source.x)}
            y={toY(source.y)}
            selected={selection?.sourceId === source.id}
            toModel={toModel}
            placed={placed}
            stage={stage}
          />
        ) : (
          source.points.map((point, index) => (
            <SourceHandle
              key={`${source.id}-${index}`}
              store={store}
              source={source}
              index={index}
              label={`${source.name}, point ${index + 1} of ${source.points.length}, at ${Math.round(point.x)}, ${Math.round(point.y)}`}
              x={toX(point.x)}
              y={toY(point.y)}
              selected={selection?.sourceId === source.id && selection.handle === index}
              inSelected={selection?.sourceId === source.id}
              toModel={toModel}
              placed={placed}
              stage={stage}
            />
          ))
        ),
      )}
      {selection && <ReachHandle store={store} sourceId={selection.sourceId} view={view} stage={stage} toModel={toModel} />}
      {scene.sources.length === 0 && state.draftRidge.length === 0 && (
        <div className="stage-empty">
          <h2>An empty sheet</h2>
          <p>Lines appear once a source lifts the field.</p>
          <div className="stage-empty-actions">
            <button type="button" className="pill primary" onClick={() => store.set({ tool: 'peak' })}>
              Place a peak
            </button>
            <button type="button" className="pill" onClick={() => store.set({ dialog: 'starters' })}>
              Open a starter
            </button>
          </div>
        </div>
      )}
      {tool === 'ridge' && (
        <div className="stage-hint" role="status">
          {state.draftRidge.length === 0
            ? 'Click to place the first point of the ridge.'
            : state.draftRidge.length === 1
              ? 'Click to place the next point.'
              : 'Keep clicking, or press Enter to finish.'}
        </div>
      )}
      {tool === 'peak' && <div className="stage-hint" role="status">Click the sheet to place a peak.</div>}
    </div>
  );
}

export function finishRidge(store: EditorStore, points: { x: number; y: number }[]): void {
  if (points.length >= 2 && hasRoom(store.scene)) {
    const { scene, id } = addRidge(store.scene, points);
    store.edit(scene);
    store.set({ selection: { sourceId: id, handle: null } });
  }
  store.set({ draftRidge: [], tool: 'select' });
}

interface HandleProps {
  store: EditorStore;
  source: Source;
  index: number | null;
  label: string;
  x: number;
  y: number;
  selected: boolean;
  inSelected?: boolean;
  toModel(px: number, py: number): { x: number; y: number };
  placed(x: number, y: number, bypass: boolean): { x: number; y: number };
  stage: React.RefObject<HTMLDivElement | null>;
}

function SourceHandle(props: HandleProps) {
  const { store, source, index, label, x, y, selected, inSelected, toModel, placed, stage } = props;
  const [dragging, setDragging] = useState(false);
  const offset = useRef({ x: 0, y: 0 });

  const position = (): { x: number; y: number } => {
    if (source.kind === 'peak') return { x: source.x, y: source.y };
    return source.points[index ?? 0];
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (store.getState().tool !== 'select' || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    store.select({ sourceId: source.id, handle: index });
    store.beginGesture();
    const element = stage.current as HTMLDivElement;
    const { px, py } = eventPoint(element, event);
    const model = toModel(px, py);
    const at = position();
    offset.current = { x: at.x - model.x, y: at.y - model.y };
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    store.markInput(event.timeStamp);
    const element = stage.current as HTMLDivElement;
    const { px, py } = eventPoint(element, event);
    const model = toModel(px, py);
    const at = placed(model.x + offset.current.x, model.y + offset.current.y, event.altKey);
    const scene = store.scene;
    if (event.shiftKey && source.kind === 'ridge') {
      // Shift drags the whole ridge by moving all its handles together.
      const current = scene.sources.find((s) => s.id === source.id);
      if (current?.kind === 'ridge') {
        const here = current.points[index ?? 0];
        store.gesture(moveSource(scene, source.id, at.x - here.x, at.y - here.y));
      }
      return;
    }
    store.gesture(setHandle(scene, source.id, index ?? 0, at.x, at.y));
  };

  const finish = () => {
    if (!dragging) return;
    setDragging(false);
    store.endGesture();
  };

  return (
    <button
      type="button"
      className="handle"
      data-kind={source.kind}
      data-selected={selected || undefined}
      data-related={inSelected || undefined}
      data-disabled={!source.enabled || undefined}
      aria-label={label}
      aria-pressed={selected}
      style={{ transform: `translate(${x}px, ${y}px)` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onFocus={() => {
        // Tabbing to a handle selects it, so that arrow keys act on what is focused.
        if (!dragging) store.select({ sourceId: source.id, handle: index });
      }}
    />
  );
}

function ReachHandle({
  store,
  sourceId,
  view,
  stage,
  toModel,
}: {
  store: EditorStore;
  sourceId: string;
  view: EditorState['view'];
  stage: React.RefObject<HTMLDivElement | null>;
  toModel(px: number, py: number): { x: number; y: number };
}) {
  const source = store.scene.sources.find((s) => s.id === sourceId);
  const [dragging, setDragging] = useState(false);
  if (!source) return null;
  const anchor = source.kind === 'peak' ? source : source.points[0];
  const x = view.x + (anchor.x + source.radius) * view.scale;
  const y = view.y + anchor.y * view.scale;
  return (
    <button
      type="button"
      className="reach-handle"
      aria-label={`Reach of ${source.name}: ${Math.round(source.radius)} units. Drag to change. Use the bracket keys from the keyboard.`}
      tabIndex={-1}
      style={{ transform: `translate(${x}px, ${y}px)` }}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        store.beginGesture();
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!dragging) return;
        const { px, py } = eventPoint(stage.current as HTMLDivElement, event);
        const model = toModel(px, py);
        const radius = clamp(
          Math.round(Math.hypot(model.x - anchor.x, model.y - anchor.y)),
          LIMITS.radius.min,
          LIMITS.radius.max,
        );
        store.gesture(updateSource(store.scene, sourceId, { radius }));
      }}
      onPointerUp={() => {
        setDragging(false);
        store.endGesture();
      }}
      onPointerCancel={() => {
        setDragging(false);
        store.endGesture();
      }}
    />
  );
}
