/**
 * Connects the store to background geometry and autosave.
 *
 * On every scene change: a draft right away (one at a time), and a final once the
 * scene has been still for a moment. The final is what the status line calls
 * export geometry.
 */

import type { Scene } from '../core/scene';
import type { ClientEvents, Engine, GeometryClient } from './geometry-client';
import type { EditorStore } from './store';

/** Grid for a draft preview. A 256 grid takes about 5 ms and this about half that. */
export const DRAFT_RESOLUTION = 192;
export const REFINE_DELAY_MS = 90;
const AUTOSAVE_DELAY_MS = 400;

export interface SessionOptions {
  engine: Engine;
  createClient(events: ClientEvents, options: { engine: Engine }): GeometryClient;
  persist(scene: Scene): boolean;
  /** False skips the export report on every final. */
  report?: boolean;
}

export interface Session {
  client: GeometryClient;
  /** Time from input to geometry on screen, for the benchmark. */
  log: {
    revision: number;
    quality: string;
    startedAt: number;
    committedAt: number;
    frameAt: number | null;
  }[];
}

export function startSession(store: EditorStore, options: SessionOptions): Session {
  const startedAt = new Map<number, number>();
  const log: Session['log'] = [];

  const client = options.createClient(
    {
      onGeometry({ revision, geometry }) {
        const committed = store.commitGeometry(revision, geometry);
        if (committed) {
          const start = startedAt.get(revision);
          if (start !== undefined && log.length < 5000) {
            const entry: Session['log'][number] = {
              revision,
              quality: geometry.quality,
              startedAt: start,
              committedAt: performance.now(),
              frameAt: null,
            };
            log.push(entry);
            requestAnimationFrame(() => {
              entry.frameAt = performance.now();
            });
          }
        }
      },
      onReport({ revision, report }) {
        if (revision === store.getState().revision) store.set({ report: { revision, report } });
      },
      onFailure({ revision, message }) {
        store.set({ failedRevision: revision });
        // A failure for an older scene needs no message. A newer job is running.
        if (revision === store.getState().revision) {
          store.notify({
            kind: 'error',
            title: 'These lines could not be computed.',
            details: [message],
          });
        }
      },
    },
    { engine: options.engine },
  );

  let refineTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let lastRevision = 0;

  let dirty = false;
  const save = () => {
    dirty = false;
    store.set({ saveState: options.persist(store.scene) ? 'saved' : 'failed' });
  };

  const refine = () => {
    const state = store.getState();
    client.submit({
      revision: state.revision,
      quality: 'final',
      resolution: store.scene.export.resolution,
      scene: store.scene,
      report: options.report,
    });
  };

  const onScene = () => {
    const { revision } = store.getState();
    if (revision === lastRevision) return;
    const first = lastRevision === 0;
    lastRevision = revision;
    // From the input event when there is one, so that time spent queued behind a
    // busy main thread counts against that thread.
    startedAt.set(revision, store.takeInput() ?? performance.now());
    if (startedAt.size > 256) startedAt.delete(startedAt.keys().next().value as number);

    clearTimeout(refineTimer);
    if (first) {
      refine();
    } else {
      // A draft only helps if the final is noticeably larger than it.
      if (store.scene.export.resolution > DRAFT_RESOLUTION) {
        client.submit({
          revision,
          quality: 'draft',
          resolution: DRAFT_RESOLUTION,
          scene: store.scene,
        });
      }
      refineTimer = setTimeout(refine, REFINE_DELAY_MS);
    }

    clearTimeout(saveTimer);
    dirty = !first;
    saveTimer = setTimeout(save, AUTOSAVE_DELAY_MS);
  };

  store.subscribe(onScene);
  onScene();

  // A reload inside the delay would otherwise lose the last edit.
  window.addEventListener('pagehide', () => {
    clearTimeout(saveTimer);
    if (dirty) save();
  });
  return { client, log };
}
