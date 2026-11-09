/**
 * Geometry for things that are not the drawing being edited: the page's idle drift
 * and plate thumbnails, and fixed size prints. It has its own worker, so none of
 * it can delay or overwrite a result the editor is waiting for.
 */

import type { Geometry } from '../core/pipeline';
import type { Scene } from '../core/scene';
import { GeometryClient, type Engine } from './geometry-client';
import type { Quality } from './jobs';

interface Waiting {
  resolve(geometry: Geometry): void;
  reject(error: Error): void;
}

export class SideJobs {
  /** Made on first use, so that starting the page starts one worker and not two. */
  private client: GeometryClient | null = null;
  private waiting = new Map<number, Waiting>();
  private next = 1;

  constructor(private engine: Engine) {}

  private get worker(): GeometryClient {
    this.client ??= new GeometryClient(
      {
        onGeometry: ({ revision, geometry }) => this.settle(revision)?.resolve(geometry),
        onReport: () => {},
        onFailure: ({ revision, message }) => this.settle(revision)?.reject(new Error(message)),
      },
      { engine: this.engine },
    );
    return this.client;
  }

  /** True while a job is out. The drift only asks when this is false. */
  get busy(): boolean {
    return this.waiting.size > 0;
  }

  private settle(revision: number): Waiting | undefined {
    const entry = this.waiting.get(revision);
    this.waiting.delete(revision);
    return entry;
  }

  /** Jobs run one after another, in the order they were asked for. */
  private tail: Promise<unknown> = Promise.resolve();

  compute(scene: Scene, quality: Quality, resolution: number): Promise<Geometry> {
    const run = () =>
      new Promise<Geometry>((resolve, reject) => {
        const revision = this.next++;
        this.waiting.set(revision, { resolve, reject });
        this.worker.submit({ revision, quality, resolution, scene, report: false });
      });
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => {});
    return result;
  }
}
