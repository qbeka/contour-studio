/** The right column: sources, the selected source, and the Lines and Export tabs. */

import { useMemo, useState } from 'react';
import { LIMITS, type Scene, type Source } from '../core/scene';
import { outputRect } from '../core/pipeline';
import { PALETTES, applyPalette, paletteOf } from '../core/plates';
import { reliefFile } from '../core/relief';
import { componentName, linesOnly, toReact, toSvg } from '../core/svg';
import { addHandle, duplicateSource, removeHandle, removeSource, setHandle, updateSource } from './edits';
import { Advanced, CheckField, Choice, ColorField, Icon, NumberField, TextField } from './controls';
import { fileStem, saveBlob, saveDownload } from './files';
import { previewState } from './jobs';
import { PRINT_SIZES, blockText, drawPrint, layoutPrint, plateFor, printScene, reliefText, type PrintSize } from './prints';
import { drawArtwork, drawRelief } from './render';
import { SideJobs } from './side-jobs';
import { SAMPLE_SPACING, GRID_SAMPLE_SPACING } from './report';
import type { EditorState, EditorStore } from './store';

interface PanelProps {
  store: EditorStore;
  state: EditorState;
}

export function SourceList({ store, state }: PanelProps) {
  const scene = store.scene;
  return (
    <section className="panel" aria-labelledby="sources-title">
      <div className="panel-head">
        <h2 id="sources-title">Sources</h2>
        <span className="count">{scene.sources.length}</span>
      </div>
      {scene.sources.length === 0 ? (
        <p className="panel-empty">No sources yet, so choose Peak or Ridge in the tool rail and click the sheet</p>
      ) : (
        <ul className="source-list">
          {scene.sources.map((source) => {
            const selected = state.selection?.sourceId === source.id;
            return (
              <li key={source.id} data-selected={selected || undefined}>
                <button
                  type="button"
                  className="source-row"
                  aria-pressed={selected}
                  title={source.name}
                  onClick={() => store.select({ sourceId: source.id, handle: null })}
                >
                  <span className="source-mark" data-kind={source.kind} aria-hidden="true" />
                  <span className="source-name" data-off={!source.enabled || undefined}>
                    {source.name || 'Unnamed'}
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-button quiet"
                  aria-label={`${source.enabled ? 'Hide' : 'Show'} ${source.name}`}
                  aria-pressed={!source.enabled}
                  title={source.enabled ? 'Hide' : 'Show'}
                  onClick={() =>
                    store.edit(updateSource(scene, source.id, { enabled: !source.enabled }))
                  }
                >
                  <Icon name={source.enabled ? 'eye' : 'eyeOff'} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function SourceInspector({ store, state }: PanelProps) {
  const scene = store.scene;
  const source = scene.sources.find((s) => s.id === state.selection?.sourceId);
  if (!source) return null;
  const change = (patch: Partial<Source>, key: string) =>
    store.edit(updateSource(scene, source.id, patch), `${source.id}.${key}`);
  const handle = state.selection?.handle ?? null;
  const position =
    source.kind === 'peak'
      ? { x: source.x, y: source.y }
      : handle !== null
        ? source.points[handle]
        : null;
  const setPosition = (x: number, y: number) =>
    store.edit(setHandle(scene, source.id, handle ?? 0, x, y), `${source.id}.position`);

  return (
    <section className="panel" aria-labelledby="source-title">
      <div className="panel-head">
        <h2 id="source-title">{source.kind === 'peak' ? 'Peak' : 'Ridge'}</h2>
        <div className="panel-actions">
          <button
            type="button"
            className="icon-button quiet"
            aria-label="Duplicate source"
            title="Duplicate (Cmd or Ctrl D)"
            onClick={() => {
              const copy = duplicateSource(scene, source.id);
              if (copy) {
                store.edit(copy.scene);
                store.select({ sourceId: copy.id, handle: null });
              }
            }}
          >
            <Icon name="copy" />
          </button>
          <button
            type="button"
            className="icon-button quiet"
            aria-label="Delete source"
            title="Delete (Backspace)"
            onClick={() => {
              store.edit(removeSource(scene, source.id));
              store.select(null);
            }}
          >
            <Icon name="trash" />
          </button>
        </div>
      </div>
      <TextField
        label="Name"
        value={source.name}
        maxLength={LIMITS.name}
        onChange={(name) => change({ name }, 'name')}
      />
      <NumberField
        label="Height"
        value={source.height}
        min={-5}
        max={5}
        step={0.01}
        digits={3}
        slider
        hint={source.height < 0 ? 'Negative height digs a hollow.' : undefined}
        onChange={(height) => change({ height }, 'height')}
      />
      <NumberField
        label="Reach"
        value={source.radius}
        min={LIMITS.radius.min}
        max={Math.max(2000, source.radius)}
        step={1}
        digits={0}
        unit="units"
        slider
        logarithmic
        onChange={(radius) => change({ radius }, 'radius')}
      />
      {position && (
        <div className="field-pair">
          <NumberField
            label="X"
            value={position.x}
            min={LIMITS.position.min}
            max={LIMITS.position.max}
            step={1}
            digits={1}
            onChange={(x) => setPosition(x, position.y)}
          />
          <NumberField
            label="Y"
            value={position.y}
            min={LIMITS.position.min}
            max={LIMITS.position.max}
            step={1}
            digits={1}
            onChange={(y) => setPosition(position.x, y)}
          />
        </div>
      )}
      {source.kind === 'ridge' && (
        <div className="ridge-points">
          <p className="field-hint">
            {handle === null
              ? `${source.points.length} points. Select one on the sheet to place it exactly.`
              : `Point ${handle + 1} of ${source.points.length}.`}
          </p>
          <div className="row">
            <button
              type="button"
              className="pill small"
              disabled={source.points.length >= LIMITS.handles.max}
              onClick={() => store.edit(addHandle(scene, source.id, handle ?? source.points.length - 2))}
            >
              Add point
            </button>
            <button
              type="button"
              className="pill small"
              disabled={handle === null || source.points.length <= LIMITS.handles.min}
              onClick={() => {
                if (handle === null) return;
                store.edit(removeHandle(scene, source.id, handle));
                store.select({ sourceId: source.id, handle: null });
              }}
            >
              Remove point
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function LinesPanel({ store, state }: PanelProps) {
  const scene = store.scene;
  const patch = <K extends 'levels' | 'style' | 'noise'>(
    group: K,
    change: Partial<Scene[K]>,
    key: string,
  ) => store.edit({ ...scene, [group]: { ...scene[group], ...change } }, `${group}.${key}`);
  const { levels, style, noise } = scene;
  return (
    <div className="tab-body">
      <Choice
        label="Show as"
        value={state.relief ? 'relief' : 'lines'}
        options={[
          { value: 'lines', label: 'Line print' },
          { value: 'relief', label: 'Paper relief' },
        ]}
        onChange={(view) => store.set({ relief: view === 'relief' })}
      />
      {state.relief && (
        <p className="field-hint">One sheet of card for each line, cut along it, under a lamp you can drag on the sheet</p>
      )}
      <NumberField
        label="Lines"
        value={levels.count}
        min={LIMITS.levels.min}
        max={LIMITS.levels.max}
        step={1}
        slider
        onChange={(count) => patch('levels', { count: Math.round(count) }, 'count')}
      />
      <NumberField
        label="Line gap"
        value={levels.spacing}
        min={0.01}
        max={1}
        step={0.005}
        digits={3}
        slider
        logarithmic
        hint="Height between neighbouring lines, where a smaller gap packs them closer"
        onChange={(spacing) => patch('levels', { spacing }, 'spacing')}
      />
      <NumberField
        label="First line"
        value={levels.base}
        min={-5}
        max={5}
        step={0.01}
        digits={3}
        slider
        onChange={(base) => patch('levels', { base }, 'base')}
      />

      <h3>Ink and paper</h3>
      <div className="inks" role="group" aria-label="Palette">
        {PALETTES.map((palette) => (
          <button
            key={palette.id}
            type="button"
            className="ink"
            aria-pressed={paletteOf(scene) === palette}
            title={palette.name}
            onClick={() => store.edit(applyPalette(scene, palette), 'style.palette')}
          >
            <span
              className="ink-chip"
              aria-hidden="true"
              style={{ background: palette.paper, color: palette.ink, borderColor: palette.tint }}
            />
            {palette.name}
          </button>
        ))}
      </div>
      <ColorField
        label="Line colour"
        value={style.stroke}
        onChange={(stroke) => patch('style', { stroke }, 'stroke')}
      />
      <CheckField
        label="Print the paper"
        checked={style.background !== null}
        onChange={(on) => patch('style', { background: on ? '#f7f4ec' : null }, 'background')}
      />
      {style.background !== null && (
        <ColorField
          label="Paper"
          value={style.background}
          onChange={(background) => patch('style', { background }, 'backgroundColor')}
        />
      )}

      <h3>Weight</h3>
      <NumberField
        label="Line weight"
        value={style.strokeWidth}
        min={LIMITS.strokeWidth.min}
        max={8}
        step={0.05}
        digits={2}
        unit="units"
        slider
        onChange={(strokeWidth) => patch('style', { strokeWidth }, 'strokeWidth')}
      />
      <NumberField
        label="Heavier line every"
        value={style.indexEvery}
        min={0}
        max={32}
        step={1}
        hint="An index line, as on a survey map, which 0 turns off"
        onChange={(indexEvery) => patch('style', { indexEvery: Math.round(indexEvery) }, 'indexEvery')}
      />
      {style.indexEvery > 0 && (
        <NumberField
          label="Heavier weight"
          value={style.indexWidth}
          min={LIMITS.strokeWidth.min}
          max={8}
          step={0.05}
          digits={2}
          unit="units"
          onChange={(indexWidth) => patch('style', { indexWidth }, 'indexWidth')}
        />
      )}
      <NumberField
        label="Taper"
        value={style.taper}
        min={0}
        max={1}
        step={0.01}
        digits={2}
        slider
        hint="Thins the lowest lines, and 0 draws every line at its weight"
        onChange={(taper) => patch('style', { taper }, 'taper')}
      />
      <NumberField
        label="Fade"
        value={style.fade}
        min={0}
        max={1}
        step={0.01}
        digits={2}
        slider
        hint="Fades the lowest lines, and 0 draws all lines at full strength"
        onChange={(fade) => patch('style', { fade }, 'fade')}
      />

      <h3>Tint</h3>
      <NumberField
        label="Tint"
        value={style.tint}
        min={-1}
        max={1}
        step={0.01}
        digits={2}
        slider
        hint={
          style.tint === 0
            ? 'One flat pass of colour for each line, deepening with height above 0 and with depth below 0'
            : style.tint > 0
              ? 'Deepens with height, and the file grows because each pass repeats its line as a shape'
              : 'Deepens with depth, and the file grows because each pass repeats its line as a shape'
        }
        onChange={(tint) => patch('style', { tint }, 'tint')}
      />
      {style.tint !== 0 && (
        <ColorField
          label="Tint colour"
          value={style.tintColor}
          onChange={(tintColor) => patch('style', { tintColor }, 'tintColor')}
        />
      )}

      <h3>Texture</h3>
      <NumberField
        label="Texture"
        value={noise.amplitude}
        min={0}
        max={0.5}
        step={0.001}
        digits={3}
        slider
        hint="How far the lines can wander, which never moves the field by more than this"
        onChange={(amplitude) => patch('noise', { amplitude }, 'amplitude')}
      />
      <NumberField
        label="Texture size"
        value={noise.scale}
        min={LIMITS.noiseScale.min}
        max={1000}
        step={1}
        digits={0}
        unit="units"
        slider
        logarithmic
        onChange={(scale) => patch('noise', { scale }, 'scale')}
      />
      <div className="seed-row">
        <NumberField
          label="Seed"
          value={scene.seed}
          min={0}
          max={4294967295}
          step={1}
          onChange={(seed) => store.edit({ ...scene, seed: Math.round(seed) }, 'seed')}
        />
        <button
          type="button"
          className="pill small"
          onClick={() =>
            store.edit({ ...scene, seed: Math.floor(Math.random() * 0xffffffff) })
          }
        >
          New seed
        </button>
      </div>

      <Advanced title="Frame and fine detail">
        <NumberField
          label="Texture layers"
          value={noise.octaves}
          min={1}
          max={4}
          step={1}
          onChange={(octaves) => patch('noise', { octaves: Math.round(octaves) }, 'octaves')}
        />
        <FrameFields store={store} />
      </Advanced>
    </div>
  );
}

function FrameFields({ store }: { store: EditorStore }) {
  const scene = store.scene;
  const { clip, domain } = scene;
  const set = (change: Partial<Scene['clip']>) => {
    const next = { ...clip, ...change };
    const fits =
      next.x >= 0 &&
      next.y >= 0 &&
      next.width >= 1 &&
      next.height >= 1 &&
      next.x + next.width <= domain.width &&
      next.y + next.height <= domain.height;
    if (fits) store.edit({ ...scene, clip: next }, 'clip');
    else store.notify({ kind: 'info', title: 'The frame has to stay inside the sheet.' });
  };
  return (
    <>
      <h3>Frame</h3>
      <div className="field-pair">
        <NumberField label="Frame left" value={clip.x} min={0} max={domain.width} step={1} onChange={(x) => set({ x })} />
        <NumberField label="Frame top" value={clip.y} min={0} max={domain.height} step={1} onChange={(y) => set({ y })} />
      </div>
      <div className="field-pair">
        <NumberField label="Frame width" value={clip.width} min={1} max={domain.width} step={1} onChange={(width) => set({ width })} />
        <NumberField label="Frame height" value={clip.height} min={1} max={domain.height} step={1} onChange={(height) => set({ height })} />
      </div>
      <button
        type="button"
        className="pill small"
        onClick={() => store.fit(clip)}
      >
        Zoom to frame
      </button>
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function ExportReportTable({ state }: { state: EditorState }) {
  const { geometry, report, shown, revision } = state;
  const current = previewState(shown, revision) === 'final';
  if (state.failedRevision === revision) {
    return <p className="report-wait" role="status">These lines could not be computed, so there is nothing to export yet.</p>;
  }
  if (!geometry || !current || geometry.quality !== 'final') {
    return <p className="report-wait" role="status">Refining. The numbers will follow.</p>;
  }
  const stats = geometry.stats;
  const fresh = report && report.revision === revision ? report.report : null;
  const keptLoops = stats.closedPaths;
  return (
    <div className="report">
      <table>
        <thead>
          <tr>
            <th scope="col"><span className="visually-hidden">Measure</span></th>
            <th scope="col">Full</th>
            <th scope="col">Export</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Nodes</th>
            <td>{stats.sourceVertices.toLocaleString('en-US')}</td>
            <td>{stats.outputVertices.toLocaleString('en-US')}</td>
          </tr>
          <tr>
            <th scope="row">Paths</th>
            <td>{stats.sourcePaths.toLocaleString('en-US')}</td>
            <td>{stats.outputPaths.toLocaleString('en-US')}</td>
          </tr>
          <tr>
            <th scope="row">File</th>
            <td>{fresh ? formatBytes(fresh.unsimplified.bytes) : '...'}</td>
            <td>{fresh ? formatBytes(fresh.simplified.bytes) : '...'}</td>
          </tr>
          <tr>
            <th scope="row">Gzipped</th>
            <td>{fresh ? formatBytes(fresh.unsimplified.gzipBytes) : '...'}</td>
            <td>{fresh ? formatBytes(fresh.simplified.gzipBytes) : '...'}</td>
          </tr>
        </tbody>
      </table>
      <dl>
        <div>
          <dt>Largest possible move</dt>
          <dd>{stats.maxBound.toFixed(3)} units</dd>
        </div>
        <div>
          <dt title={`Sampled estimate against the full lines, every ${(fresh?.distance.spacing ?? SAMPLE_SPACING).toFixed(2)} units`}>Measured in the file</dt>
          <dd>{fresh ? `${fresh.distance.sampled.toFixed(3)} units` : '...'}</dd>
        </div>
        {fresh && fresh.tint.bytes > 0 && (
          <div>
            <dt title="Each tint pass repeats its line as a filled shape, and the sizes above are for the lines alone">Tint adds to the file</dt>
            <dd>{formatBytes(fresh.tint.bytes)}, {formatBytes(fresh.tint.gzipBytes)} gzipped</dd>
          </div>
        )}
        <div>
          <dt title={`How far the full lines may sit from the true field. A finer grid reduces this. First-order estimate, every ${(fresh?.grid.spacing ?? GRID_SAMPLE_SPACING).toFixed(1)} units`}>Grid error, worst estimate</dt>
          <dd>{fresh ? `${fresh.grid.max.toFixed(3)} units` : '...'}</dd>
        </div>
      </dl>
      <p className="report-note">
        {stats.crossings === 0
          ? `No lines cross. All ${keptLoops.toLocaleString('en-US')} closed loops are kept.`
          : `${stats.crossings} crossings remain. Raise the detail before exporting.`}
        {stats.degeneratePaths > 0 && ` ${stats.degeneratePaths} zero-size paths were dropped.`}
        {stats.fallbackPaths > 0 &&
          ` ${stats.fallbackPaths} paths needed finer settings to keep their shape, ${stats.retainedPaths} of them at full detail.`}
      </p>
      {geometry.marginLimited && (
        <p className="report-note">The sheet edge limits the margin, so the export is smaller than requested.</p>
      )}
    </div>
  );
}

async function renderPng(store: EditorStore): Promise<Blob | null> {
  const { geometry } = store.getState();
  if (!geometry) return null;
  const scene = store.scene;
  const { rect } = geometry;
  const width = Math.round(scene.export.outputWidth || rect.width);
  const height = Math.round((width * rect.height) / rect.width);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const scale = width / rect.width;
  const transform = { scale, x: -rect.x * scale, y: -rect.y * scale, dpr: 1 };
  const { relief, lamp } = store.getState();
  if (relief) drawRelief(ctx, geometry, scene, transform, lamp);
  else drawArtwork(ctx, geometry, scene, transform);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Prints are computed apart from the editor, on a worker made the first time one is asked for. */
let printJobs: SideJobs | null = null;

/** Grid cells on the long side of a print. Finer than the default, for the larger sheet. */
const PRINT_GRID = 1024;

async function renderPrint(store: EditorStore, size: PrintSize, titleBlock: boolean): Promise<Blob | null> {
  const scene = store.scene;
  const plate = plateFor(scene);
  const layout = layoutPrint(size, titleBlock);
  const sized = printScene(plate, scene, size, layout, 'scene');
  const { relief, lamp } = store.getState();
  printJobs ??= new SideJobs('worker');
  const [geometry] = await Promise.all([
    printJobs.compute(sized, 'final', Math.max(PRINT_GRID, scene.export.resolution)),
    document.fonts.load("400 48px 'Geist Serif'"),
    document.fonts.load("400 24px 'Geist'"),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // A print is a sheet, so it always has paper, even when the SVG is transparent.
  const onPaper = sized.style.background ? sized : { ...sized, style: { ...sized.style, background: '#f7f4ec' } };
  const text = blockText(plate, scene);
  if (relief) drawPrint(ctx, geometry, onPaper, layout, reliefText(text, reliefFile(geometry, onPaper, lamp).sheets, scene), lamp);
  else drawPrint(ctx, geometry, onPaper, layout, text);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export function ExportPanel({ store, state }: PanelProps) {
  const scene = store.scene;
  const ex = scene.export;
  const set = (change: Partial<Scene['export']>, key: string) =>
    store.edit({ ...scene, export: { ...ex, ...change } }, `export.${key}`);
  const ready = store.exportReady;
  const [feedback, setFeedback] = useState('');
  const [titleBlock, setTitleBlock] = useState(true);
  const [drawing, setDrawing] = useState<string | null>(null);
  const { rect } = outputRect(scene);
  const stem = fileStem(scene);

  const say = (text: string) => {
    setFeedback(text);
    setTimeout(() => setFeedback(''), 3000);
  };

  const geometry = state.geometry;
  // The relief as a file, and the lines alone to set its size against.
  const relief = useMemo(() => {
    if (!state.relief || !ready || !geometry) return null;
    return { ...reliefFile(geometry, scene, state.lamp), linesBytes: toSvg(geometry, linesOnly(scene)).length };
  }, [state.relief, state.lamp, ready, geometry, scene]);
  const inRelief = state.relief ? '-relief' : '';
  return (
    <div className="tab-body">
      <NumberField
        label="Line detail"
        value={ex.tolerance}
        min={0}
        max={LIMITS.tolerance.max}
        step={0.01}
        digits={3}
        unit="units"
        hint="How far simplifying may move a line before rounding, where 0 keeps every node"
        onChange={(tolerance) => set({ tolerance }, 'tolerance')}
      />
      <div className="presets" role="group" aria-label="Line detail presets">
        {[
          ['Full', 0],
          ['Fine', 0.05],
          ['Balanced', 0.15],
          ['Light', 0.5],
        ].map(([name, value]) => (
          <button
            key={name}
            type="button"
            className="pill small"
            aria-pressed={ex.tolerance === value}
            onClick={() => set({ tolerance: value as number }, 'tolerance')}
          >
            {name}
          </button>
        ))}
      </div>

      <ExportReportTable state={state} />

      <Choice
        label="Bounds"
        value={ex.bounds}
        options={[
          { value: 'frame', label: 'Frame' },
          { value: 'expanded', label: 'Frame plus margin' },
        ]}
        onChange={(bounds) => set({ bounds }, 'bounds')}
      />
      {ex.bounds === 'expanded' && (
        <NumberField
          label="Margin"
          value={ex.margin}
          min={LIMITS.margin.min}
          max={LIMITS.margin.max}
          step={1}
          unit="units"
          onChange={(margin) => set({ margin }, 'margin')}
        />
      )}
      <NumberField
        label="Output width"
        value={ex.outputWidth || Math.round(rect.width)}
        min={LIMITS.outputSize.min}
        max={LIMITS.outputSize.max}
        step={1}
        unit="px"
        hint={`Height follows the frame: ${Math.round(((ex.outputWidth || rect.width) * rect.height) / rect.width)} px.`}
        onChange={(outputWidth) => set({ outputWidth: Math.round(outputWidth) }, 'outputWidth')}
      />
      <Choice
        label="Line weight when resized"
        value={ex.strokeScaling}
        options={[
          { value: 'scale', label: 'Scales with the art' },
          { value: 'fixed', label: 'Stays the same' },
        ]}
        onChange={(strokeScaling) => set({ strokeScaling }, 'strokeScaling')}
      />

      <Advanced title="Grid and precision">
        <Choice
          label="Grid cells on the long side"
          value={String(ex.resolution)}
          options={[256, 512, 1024].map((n) => ({ value: String(n), label: String(n) }))}
          onChange={(value) => set({ resolution: Number(value) }, 'resolution')}
        />
        <NumberField
          label="Decimals in the file"
          value={ex.decimals}
          min={LIMITS.decimals.min}
          max={LIMITS.decimals.max}
          step={1}
          onChange={(decimals) => set({ decimals: Math.round(decimals) }, 'decimals')}
        />
      </Advanced>

      <div className="sizes" role="group" aria-label="Ready sizes">
        <p className="sizes-title">Ready sizes, from the same field</p>
        {PRINT_SIZES.map((size) => (
          <button
            key={size.id}
            type="button"
            className="size"
            disabled={!ready || drawing !== null}
            aria-busy={drawing === size.id || undefined}
            onClick={async () => {
              setDrawing(size.id);
              try {
                const blob = await renderPrint(store, size, titleBlock);
                if (blob) {
                  saveBlob(`${stem}${inRelief}-${size.id}.png`, blob);
                  say(`Saved ${stem}${inRelief}-${size.id}.png`);
                } else {
                  say('That size could not be drawn.');
                }
              } catch {
                say('That size could not be drawn.');
              }
              setDrawing(null);
            }}
          >
            <span>{size.label}</span>
            <span className="size-px">{drawing === size.id ? 'Drawing' : `${size.width} by ${size.height} PNG`}</span>
          </button>
        ))}
        <CheckField label="Title block" checked={titleBlock} onChange={setTitleBlock} />
      </div>

      <div className="export-actions">
        {relief && (
          <p className="report-note relief-note">
            The relief file holds {relief.sheets} outlines and no lines, each written once and reused for its sheet, its shadow and
            its lit edge, and at {formatBytes(relief.svg.length)} it is{' '}
            {formatBytes(Math.abs(relief.svg.length - relief.linesBytes))} {relief.svg.length < relief.linesBytes ? 'smaller' : 'larger'} than
            the lines alone
          </p>
        )}
        <button
          type="button"
          className="pill primary wide"
          disabled={!ready}
          onClick={() => {
            if (!geometry) return;
            if (relief) {
              saveDownload(`${stem}-relief.svg`, relief.svg, 'image/svg+xml');
              say(`Saved ${stem}-relief.svg`);
              return;
            }
            saveDownload(`${stem}.svg`, toSvg(geometry, scene), 'image/svg+xml');
            say(`Saved ${stem}.svg`);
          }}
        >
          {ready ? (state.relief ? 'Download relief SVG' : 'Download SVG') : state.failedRevision === state.revision ? 'Nothing to export' : 'Refining...'}
        </button>
        <div className="row">
          <button
            type="button"
            className="pill small"
            disabled={!ready}
            onClick={() => {
              if (!geometry) return;
              saveDownload(`${componentName(scene)}.tsx`, toReact(geometry, scene), 'text/plain');
              say(`Saved ${componentName(scene)}.tsx`);
            }}
          >
            {state.relief ? 'React component, lines' : 'React component'}
          </button>
          <button
            type="button"
            className="pill small"
            disabled={!ready}
            onClick={async () => {
              const blob = await renderPng(store);
              if (blob) {
                saveBlob(`${stem}${inRelief}.png`, blob);
                say(`Saved ${stem}${inRelief}.png`);
              }
            }}
          >
            PNG
          </button>
        </div>
        <p className="export-feedback" role="status">{feedback}</p>
      </div>
    </div>
  );
}
