/**
 * Sends jobs to the worker and hands back results.
 *
 * If a worker cannot start, the same pipeline runs on the main thread, one step
 * per macrotask. That path is also the baseline in the benchmark (?worker=off).
 */

import { geometrySteps, type Geometry } from '../core/pipeline';
import { JobSlots, type Job, type JobRequest } from './jobs';
import { buildReport, type ExportReport } from './report';
import type { WorkerRequest, WorkerResponse } from './geometry.worker';

export interface ClientEvents {
  onGeometry(result: { revision: number; geometry: Geometry }): void;
  onReport(result: { revision: number; report: ExportReport }): void;
  onFailure(message: string): void;
}

export class GeometryClient {
  private slots = new JobSlots();
  private worker: Worker | null = null;
  private cancelledInline = new Set<number>();
  mode: 'worker' | 'main-thread';
  /** Jobs that really stopped early, as opposed to finishing before a cancel. */
  cancelledJobs = 0;

  constructor(
    private events: ClientEvents,
    options: { useWorker: boolean },
  ) {
    if (options.useWorker) {
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
        this.events.onFailure(message.message);
        this.next(message.id);
        break;
    }
  }

  private async runInline(job: Job): Promise<void> {
    try {
      const steps = geometrySteps(job.scene, { quality: job.quality, resolution: job.resolution });
      for (;;) {
        const step = steps.next();
        if (this.cancelledInline.delete(job.id)) {
          this.cancelledJobs++;
          this.next(job.id);
          return;
        }
        if (step.done) {
          const geometry = step.value;
          this.events.onGeometry({
            revision: job.revision,
            geometry: { ...geometry, source: job.quality === 'final' ? geometry.source : [] },
          });
          if (job.quality === 'final') {
            const pause = async () => {
              await new Promise((resolve) => setTimeout(resolve));
              return this.cancelledInline.delete(job.id);
            };
            const report = (await pause()) ? null : await buildReport(geometry, job.scene, pause);
            if (report) this.events.onReport({ revision: job.revision, report });
            else this.cancelledJobs++;
          }
          this.next(job.id);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve));
      }
    } catch (error) {
      this.events.onFailure(error instanceof Error ? error.message : 'Geometry failed.');
      this.next(job.id);
    }
  }
}
