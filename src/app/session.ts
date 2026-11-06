/**
 * Connects the store to background geometry and autosave.
 *
 * On every scene change: a draft right away (one at a time), and a final once the
 * scene has been still for a moment. The final is what the status line calls
 * export geometry.
 */

import type { Scene } from '../core/scene';
import type { GeometryClient, ClientEvents } from './geometry-client';
import type { EditorStore } from './store';

/** Grid for a draft preview. Set from the baseline profile in docs/REPORT.md. */
export const DRAFT_RESOLUTION = 192;
export const REFINE_DELAY_MS = 90;
const AUTOSAVE_DELAY_MS = 400;

export interface SessionOptions {
  useWorker: boolean;
  createClient(events: ClientEvents, options: { useWorker: boolean }): GeometryClient;
  persist(scene: Scene): boolean;
}

export interface Session {
  client: GeometryClient;
  /** Time from scene edit to geometry on screen, for the benchmark. */
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
      onFailure(message) {
        store.set({ failedRevision: store.getState().revision });
        store.notify({ kind: 'error', title: 'These lines could not be computed.', details: [message] });
      },
    },
    { useWorker: options.useWorker },
  );

  let refineTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let lastRevision = 0;

  const refine = () => {
    const state = store.getState();
    client.submit({
      revision: state.revision,
      quality: 'final',
      resolution: store.scene.export.resolution,
      scene: store.scene,
    });
  };

  const onScene = () => {
    const { revision } = store.getState();
    if (revision === lastRevision) return;
    const first = lastRevision === 0;
    lastRevision = revision;
    startedAt.set(revision, performance.now());
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
    saveTimer = setTimeout(() => {
      if (options.persist(store.scene)) store.set({ savedAt: Date.now() });
    }, AUTOSAVE_DELAY_MS);
  };

  store.subscribe(onScene);
  onScene();
  return { client, log };
}
