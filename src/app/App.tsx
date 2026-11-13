import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type DragEvent } from 'react';
import { LIMITS, serializeScene, type Scene } from '../core/scene';
import { Icon, type IconName } from './controls';
import { Dialogs } from './dialogs';
import { clamp, duplicateSource, moveSource, removeHandle, removeSource, updateSource } from './edits';
import { fileStem, readSceneFile, saveDownload } from './files';
import { ExportPanel, LinesPanel, SourceInspector, SourceList } from './Panels';
import { previewState } from './jobs';
import type { Session } from './session';
import { finishRidge, Stage } from './Stage';
import type { EditorStore, Tool } from './store';

const TOOLS: { tool: Tool; icon: IconName; label: string; key: string }[] = [
  { tool: 'select', icon: 'select', label: 'Select and move', key: 'V' },
  { tool: 'peak', icon: 'peak', label: 'Place a peak', key: 'P' },
  { tool: 'ridge', icon: 'ridge', label: 'Draw a ridge', key: 'R' },
  { tool: 'pan', icon: 'pan', label: 'Pan', key: 'H' },
];

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (element.tagName === 'TEXTAREA' || element.isContentEditable) return true;
  if (element.tagName !== 'INPUT') return false;
  const type = (element as HTMLInputElement).type;
  return type !== 'range' && type !== 'checkbox' && type !== 'radio' && type !== 'color';
}

function useShortcuts(store: EditorStore, save: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = store.getState();
      if (state.dialog) return;
      const command = event.metaKey || event.ctrlKey;
      const key = event.key;
      if (command && key.toLowerCase() === 'z') {
        event.preventDefault();
        // History cannot move under a drag that has not finished.
        if (store.inGesture) return;
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (command && key.toLowerCase() === 's') {
        event.preventDefault();
        save();
        return;
      }
      if (isTyping(event.target)) return;

      const selection = state.selection;
      const scene = store.scene;
      const source = scene.sources.find((s) => s.id === selection?.sourceId);

      if (command && key.toLowerCase() === 'd') {
        event.preventDefault();
        if (source) {
          const copy = duplicateSource(scene, source.id);
          if (copy) {
            store.edit(copy.scene);
            store.select({ sourceId: copy.id, handle: null });
          }
        }
        return;
      }
      if (command || event.altKey) return;

      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (arrows[key]) {
        // Range inputs own their arrows.
        if ((event.target as HTMLElement | null)?.tagName === 'INPUT') return;
        if (!source) return;
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const [dx, dy] = arrows[key];
        if (source.kind === 'ridge' && selection?.handle !== null && selection?.handle !== undefined) {
          const handle = selection.handle;
          store.edit(
            {
              ...scene,
              sources: scene.sources.map((s) =>
                s.id === source.id && s.kind === 'ridge'
                  ? {
                      ...s,
                      points: s.points.map((p, i) =>
                        i === handle
                          ? {
                              x: clamp(p.x + dx * step, LIMITS.position.min, LIMITS.position.max),
                              y: clamp(p.y + dy * step, LIMITS.position.min, LIMITS.position.max),
                            }
                          : p,
                      ),
                    }
                  : s,
              ),
            },
            `${source.id}.keyboard`,
          );
        } else {
          store.edit(moveSource(scene, source.id, dx * step, dy * step), `${source.id}.keyboard`);
        }
        return;
      }

      switch (key) {
        case 'v':
        case 'V':
          store.set({ tool: 'select', draftRidge: [] });
          break;
        case 'p':
        case 'P':
          store.set({ tool: 'peak', draftRidge: [] });
          break;
        case 'r':
        case 'R':
          store.set({ tool: 'ridge', draftRidge: [] });
          break;
        case 'h':
        case 'H':
          store.set({ tool: 'pan', draftRidge: [] });
          break;
        case 's':
        case 'S':
          store.set({ snap: !state.snap });
          break;
        case 'n':
        case 'N':
          store.set({ showNodes: !state.showNodes });
          break;
        case 'g':
        case 'G':
          store.set({ showHandles: !state.showHandles });
          break;
        case 'l':
        case 'L':
          store.set({ relief: !state.relief });
          break;
        case '1':
          store.fit(scene.clip);
          break;
        case '+':
        case '=':
          store.zoomAt(state.stage.width / 2, state.stage.height / 2, 1.25);
          break;
        case '-':
          store.zoomAt(state.stage.width / 2, state.stage.height / 2, 0.8);
          break;
        case '?':
          store.set({ dialog: 'shortcuts' });
          break;
        case '[':
        case ']':
          if (source) {
            const factor = key === ']' ? 1.1 : 1 / 1.1;
            const radius = clamp(
              Math.round(source.radius * factor),
              LIMITS.radius.min,
              LIMITS.radius.max,
            );
            store.edit(updateSource(scene, source.id, { radius }), `${source.id}.radius`);
          }
          break;
        case 'Enter':
          if (state.tool === 'ridge') finishRidge(store, state.draftRidge);
          break;
        case 'Escape':
          if (state.tool !== 'select') store.set({ tool: 'select', draftRidge: [] });
          else store.select(null);
          break;
        case 'Backspace':
        case 'Delete':
          // A focused slider or checkbox is not an instruction to delete.
          if (!source || (event.target as HTMLElement | null)?.tagName === 'INPUT') return;
          event.preventDefault();
          if (
            source.kind === 'ridge' &&
            selection?.handle !== null &&
            selection?.handle !== undefined &&
            source.points.length > LIMITS.handles.min
          ) {
            store.edit(removeHandle(scene, source.id, selection.handle));
            store.select({ sourceId: source.id, handle: null });
          } else {
            store.edit(removeSource(scene, source.id));
            store.select(null);
          }
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, save]);
}

function StatusLine({ store, session }: { store: EditorStore; session: Session }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const preview = previewState(state.shown, state.revision);
  const stopped = state.failedRevision === state.revision;
  const label = stopped
    ? 'Stopped. Undo, or draw fewer lines'
    : preview === 'final'
      ? `Export geometry, ${state.geometry?.resolution ?? ''} grid`
      : preview === 'draft'
        ? `Draft, ${state.geometry?.resolution ?? ''} grid`
        : 'Refining';
  const time = state.geometry && preview === 'final' ? `${Math.round(state.geometry.stats.times.total)} ms` : '';
  return (
    <div className="status">
      <span className="status-state" data-state={stopped ? 'stopped' : preview} role="status" aria-live="polite">
        <span className="status-dot" aria-hidden="true" />
        {label}
      </span>
      {time && <span className="status-item hide-narrow">{time}, {session.client.mode === 'worker' ? 'worker' : 'main thread'}</span>}
      <span className="status-spacer" />
      <span className="status-item coordinates hide-narrow">
        {state.pointer ? `${Math.round(state.pointer.x)}, ${Math.round(state.pointer.y)}` : ''}
      </span>
      <button type="button" className="status-toggle" aria-pressed={state.snap} onClick={() => store.set({ snap: !state.snap })}>
        Snap
      </button>
      <button type="button" className="status-toggle" aria-pressed={state.showHandles} onClick={() => store.set({ showHandles: !state.showHandles })}>
        Handles
      </button>
      <button type="button" className="status-toggle" aria-pressed={state.showNodes} onClick={() => store.set({ showNodes: !state.showNodes })}>
        Nodes
      </button>
      <button type="button" className="status-toggle" aria-pressed={state.relief} title="Show the drawing as cut card under a lamp (L)" onClick={() => store.set({ relief: !state.relief })}>
        Relief
      </button>
      <span className="status-item">{Math.round(state.view.scale * 100)}%</span>
    </div>
  );
}

export function App({ store, session }: { store: EditorStore; session: Session }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const scene = store.scene;
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [mobileTab, setMobileTab] = useState<'sources' | 'tools'>('tools');

  const save = useCallback(() => {
    saveDownload(`${fileStem(store.scene)}.contour.json`, serializeScene(store.scene), 'application/json');
    store.notify({ kind: 'info', title: `Saved ${fileStem(store.scene)}.contour.json` });
  }, [store]);
  useShortcuts(store, save);

  const open = async (file: File) => {
    const result = await readSceneFile(file);
    if (result.ok) {
      store.replaceScene(result.scene);
      store.notify({ kind: 'info', title: `Opened ${file.name}.` });
    } else {
      // The project on screen stays exactly as it was.
      store.notify({
        kind: 'error',
        title: `${file.name} could not be opened. Your current scene has not changed.`,
        details: result.errors.slice(0, 6),
      });
    }
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void open(file);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) void open(file);
  };

  useEffect(() => {
    if (!state.notice || state.notice.kind !== 'info') return;
    const timer = setTimeout(() => store.notify(null), 4000);
    return () => clearTimeout(timer);
  }, [state.notice, store]);

  const rename = (name: string) => store.edit({ ...scene, name } as Scene, 'name');

  return (
    <div
      className="app"
      data-mobile-tab={mobileTab}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (event.relatedTarget === null) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      <header className="bar">
        <h1 className="brand">
          <a href="../">Contour</a>
        </h1>
        <label className="scene-name">
          <span className="visually-hidden">Scene name</span>
          <input
            type="text"
            value={scene.name}
            maxLength={LIMITS.name}
            placeholder="Untitled"
            onChange={(event) => rename(event.target.value)}
          />
        </label>
        <span className="bar-saved hide-narrow" aria-live="polite">
          {state.saveState === 'saved' && 'Saved in this browser'}
          {state.saveState === 'failed' && 'Not saved in this browser, so use Save to keep your work'}
        </span>
        <div className="bar-actions">
          <button type="button" className="pill" onClick={() => store.set({ dialog: 'starters' })}>
            New
          </button>
          <button type="button" className="pill" onClick={() => fileInput.current?.click()}>
            Open
          </button>
          <button type="button" className="pill" onClick={save}>
            Save
          </button>
          <button
            type="button"
            className="pill primary"
            aria-pressed={state.panel === 'export'}
            onClick={() => {
              store.set({ panel: 'export' });
              setMobileTab('tools');
            }}
          >
            Export
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="visually-hidden"
          tabIndex={-1}
          aria-label="Open a scene file"
          onChange={onFile}
        />
      </header>

      <nav className="rail" aria-label="Tools">
        {TOOLS.map(({ tool, icon, label, key }) => (
          <button
            key={tool}
            type="button"
            className="icon-button"
            aria-label={`${label} (${key})`}
            title={`${label} (${key})`}
            aria-pressed={state.tool === tool}
            onClick={() => store.set({ tool, draftRidge: [] })}
          >
            <Icon name={icon} />
          </button>
        ))}
        <span className="rail-rule" aria-hidden="true" />
        <button
          type="button"
          className="icon-button"
          aria-label="Undo"
          title="Undo (Cmd or Ctrl Z)"
          disabled={state.history.past.length === 0}
          onClick={() => store.undo()}
        >
          <Icon name="undo" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Redo"
          title="Redo (Shift Cmd or Ctrl Z)"
          disabled={state.history.future.length === 0}
          onClick={() => store.redo()}
        >
          <Icon name="redo" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Zoom to the frame (1)"
          title="Zoom to the frame (1)"
          onClick={() => store.fit(scene.clip)}
        >
          <Icon name="fit" />
        </button>
        <span className="rail-spacer" />
        <button
          type="button"
          className="icon-button"
          aria-label="Keyboard shortcuts (?)"
          title="Keyboard shortcuts (?)"
          onClick={() => store.set({ dialog: 'shortcuts' })}
        >
          <Icon name="help" />
        </button>
      </nav>

      <main className="work">
        <Stage store={store} state={state} />
        <StatusLine store={store} session={session} />
      </main>

      <aside className="side" aria-label="Sources and settings">
        <div className="mobile-tabs" role="group" aria-label="Panel">
          <button type="button" className="pill small" aria-pressed={mobileTab === 'sources'} onClick={() => setMobileTab('sources')}>
            Sources
          </button>
          <button type="button" className="pill small" aria-pressed={mobileTab === 'tools' && state.panel === 'lines'} onClick={() => { setMobileTab('tools'); store.set({ panel: 'lines' }); }}>
            Lines
          </button>
          <button type="button" className="pill small" aria-pressed={mobileTab === 'tools' && state.panel === 'export'} onClick={() => { setMobileTab('tools'); store.set({ panel: 'export' }); }}>
            Export
          </button>
        </div>
        <div className="side-sources">
          <SourceList store={store} state={state} />
          <SourceInspector store={store} state={state} />
        </div>
        <div className="side-tabs">
          <div className="tabs" role="tablist" aria-label="Settings">
            <button
              type="button"
              role="tab"
              id="tab-lines"
              aria-controls="pane-tab"
              aria-selected={state.panel === 'lines'}
              onClick={() => store.set({ panel: 'lines' })}
            >
              Lines
            </button>
            <button
              type="button"
              role="tab"
              id="tab-export"
              aria-controls="pane-tab"
              aria-selected={state.panel === 'export'}
              onClick={() => store.set({ panel: 'export' })}
            >
              Export
            </button>
          </div>
          <div id="pane-tab" role="tabpanel" aria-labelledby={state.panel === 'lines' ? 'tab-lines' : 'tab-export'}>
            {state.panel === 'lines' ? (
              <LinesPanel store={store} state={state} />
            ) : (
              <ExportPanel store={store} state={state} />
            )}
          </div>
        </div>
      </aside>

      {state.notice && (
        <div className="notice" data-kind={state.notice.kind} role={state.notice.kind === 'error' ? 'alert' : 'status'}>
          <p>{state.notice.title}</p>
          {state.notice.details && (
            <ul>
              {state.notice.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
          <button type="button" className="pill small" onClick={() => store.notify(null)}>
            Dismiss
          </button>
        </div>
      )}
      {dragOver && <div className="drop" aria-hidden="true">Drop a scene file to open it</div>}
      <Dialogs store={store} state={state} />
    </div>
  );
}
