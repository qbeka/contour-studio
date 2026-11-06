/**
 * Sends jobs to the worker and hands back results.
 *
 * If a worker cannot start, the same pipeline runs on the main thread, giving the
 * queue a turn in the same time slices as the worker. That path is the benchmark
 * baseline (?worker=off). `blocking` runs a job to the end with no turns at all
 * (?worker=blocking). It exists only as the other extreme for the benchmark.
 */

import { geometrySteps, type Geometry } from '../core/pipeline';
import { JobSlots, type Job, type JobRequest } from './jobs';
import { buildReport, type ExportReport } from './report';
import { sliceTimer, yieldToQueue } from './yield';
import type { WorkerRequest, WorkerResponse } from './geometry.worker';

export interface ClientEvents {
  onGeometry(result: { revision: number; geometry: Geometry }): void;
  onReport(result: { revision: number; report: ExportReport }): void;
  onFailure(result: { revision: number; message: string }): void;
}

export type Engine = 'worker' | 'sliced' | 'blocking';

export class GeometryClient {
  private slots = new JobSlots();
  private worker: Worker | null = null;
  private cancelledInline = new Set<number>();
  private blocking = false;
  mode: 'worker' | 'main-thread';
  /** Jobs that really stopped early, as opposed to finishing before a cancel. */
  cancelledJobs = 0;

  constructor(
    private events: ClientEvents,
    options: { engine: Engine },
  ) {
    this.blocking = options.engine === 'blocking';
    if (options.engine === 'worker') {
      try {
        this.worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.receive(event.data);
        this.worker.onerror = (event) => {
          event.preventDefault();
          this.fallBack();
        };
      } catch {
        this.worker = null;
      }
    }
    this.mode = this.worker ? 'worker' : 'main-thread';
  }

  get outstanding(): number {
    return this.slots.outstanding;
  }

  submit(request: JobRequest): void {
    const { start, cancel } = this.slots.submit(request);
    if (cancel !== null) {
      if (this.worker) this.post({ type: 'cancel', id: cancel });
      else this.cancelledInline.add(cancel);
    }
    if (start) this.launch(start);
  }

  private post(message: WorkerRequest): void {
    this.worker?.postMessage(message);
  }

  private launch(job: Job): void {
    if (this.worker) this.post({ type: 'run', job });
    else void this.runInline(job);
  }

  /** The worker died. Later jobs run here, and the current one restarts here. */
  private fallBack(): void {
    this.worker?.terminate();
    this.worker = null;
    this.mode = 'main-thread';
    const running = this.slots.running;
    if (running) void this.runInline(running);
  }

  private next(id: number): void {
    const job = this.slots.settle(id);
    if (job) this.launch(job);
  }

  private receive(message: WorkerResponse): void {
    switch (message.type) {
      case 'done':
        this.events.onGeometry({ revision: message.revision, geometry: message.geometry });
        // A draft ends here. A final still has its report to build, but the next
        // job should not wait behind numbers for an older scene.
        if (message.geometry.quality === 'draft') this.next(message.id);
        break;
      case 'report':
        this.events.onReport({ revision: message.revision, report: message.report });
        this.next(message.id);
        break;
      case 'cancelled':
        this.cancelledJobs++;
        this.next(message.id);
        break;
      case 'failed':
        this.events.onFailure({
          revision: this.slots.running?.revision ?? 0,
          message: message.message,
        });
        this.next(message.id);
        break;
    }
  }

  private async runInline(job: Job): Promise<void> {
    const slice = sliceTimer();
    const pause = async () => {
      await yieldToQueue();
      return this.cancelledInline.delete(job.id);
    };
    try {
      const steps = geometrySteps(job.scene, { quality: job.quality, resolution: job.resolution });
      for (;;) {
        const step = steps.next();
        if (step.done) {
          const geometry = step.value;
          this.events.onGeometry({ revision: job.revision, geometry });
          if (job.quality === 'final') {
            const report = (await pause()) ? null : await buildReport(geometry, job.scene, pause);
            if (report) this.events.onReport({ revision: job.revision, report });
            else this.cancelledJobs++;
          }
          this.next(job.id);
          return;
        }
        if (this.blocking) continue;
        await slice();
        if (this.cancelledInline.delete(job.id)) {
          this.cancelledJobs++;
          this.next(job.id);
          return;
        }
      }
    } catch (error) {
      this.events.onFailure({
        revision: job.revision,
        message: error instanceof Error ? error.message : 'Geometry failed.',
      });
      this.next(job.id);
    }
  }
}
