/**
 * Runs the pipeline off the main thread.
 *
 * Between pipeline steps the loop gives the event queue a turn, so that a cancel
 * message can land. A cancelled job posts `cancelled` and nothing else.
 */

import { geometrySteps, type Geometry } from '../core/pipeline';
import type { Scene } from '../core/scene';
import { buildReport, type ExportReport } from './report';
import type { Job } from './jobs';
import { sliceTimer, yieldToQueue } from './yield';

export type WorkerRequest = { type: 'run'; job: Job } | { type: 'cancel'; id: number };

export type WorkerResponse =
  | { type: 'done'; id: number; revision: number; geometry: Geometry }
  | { type: 'report'; id: number; revision: number; report: ExportReport }
  | { type: 'cancelled'; id: number }
  | { type: 'failed'; id: number; message: string };

const cancelled = new Set<number>();
function transferables(geometry: Geometry): Transferable[] {
  const buffers: Transferable[] = [];
  for (const level of geometry.levels) {
    for (const path of level.paths) buffers.push(path.points.buffer as ArrayBuffer);
  }
  return buffers;
}

async function run(job: Job): Promise<void> {
  const scene: Scene = job.scene;
  const steps = geometrySteps(scene, { quality: job.quality, resolution: job.resolution });
  const slice = sliceTimer();
  for (;;) {
    const step = steps.next();
    if (step.done) {
      const geometry = step.value;
      if (job.quality === 'draft' || job.report === false) {
        const light: Geometry = { ...geometry, source: [] };
        const reply: WorkerResponse = { type: 'done', id: job.id, revision: job.revision, geometry: light };
        self.postMessage(reply, { transfer: transferables(light) });
        return;
      }
      // The report needs the extracted lines and must run before the transfer
      // empties the output arrays, so it is built from a private copy.
      const reportInput: Geometry = {
        ...geometry,
        levels: geometry.levels.map((level) => ({
          ...level,
          paths: level.paths.map((p) => ({ ...p, points: p.points.slice() })),
        })),
      };
      const light: Geometry = { ...geometry, source: [] };
      const reply: WorkerResponse = { type: 'done', id: job.id, revision: job.revision, geometry: light };
      self.postMessage(reply, { transfer: transferables(light) });
      const pause = async () => {
        await yieldToQueue();
        return cancelled.delete(job.id);
      };
      const report = (await pause()) ? null : await buildReport(reportInput, scene, pause);
      const out: WorkerResponse = report
        ? { type: 'report', id: job.id, revision: job.revision, report }
        : { type: 'cancelled', id: job.id };
      self.postMessage(out);
      return;
    }
    await slice();
    if (cancelled.delete(job.id)) {
      const end: WorkerResponse = { type: 'cancelled', id: job.id };
      self.postMessage(end);
      return;
    }
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    cancelled.add(message.id);
    return;
  }
  run(message.job).catch((error: unknown) => {
    const reply: WorkerResponse = {
      type: 'failed',
      id: message.job.id,
      message: error instanceof Error ? error.message : 'Geometry failed.',
    };
    self.postMessage(reply);
  });
};
