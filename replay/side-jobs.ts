/**
 * Geometry for things that are not the drawing being edited: the idle drift, the
 * plate thumbnails and the fixed size prints. It has its own worker, so none of
 * it can delay or overwrite a result the editor is waiting for.
 */

import { GeometryClient, type Engine } from '../src/app/geometry-client';
import type { Quality } from '../src/app/jobs';
import type { Geometry } from '../src/core/pipeline';
import type { Scene } from '../src/core/scene';

interface Waiting {
  resolve(geometry: Geometry): void;
  reject(error: Error): void;
}

export class SideJobs {
  private client: GeometryClient;
  private waiting = new Map<number, Waiting>();
  private next = 1;

  constructor(engine: Engine) {
    this.client = new GeometryClient(
      {
        onGeometry: ({ revision, geometry }) => this.settle(revision)?.resolve(geometry),
        onReport: () => {},
        onFailure: ({ revision, message }) => this.settle(revision)?.reject(new Error(message)),
      },
      { engine },
    );
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
        this.client.submit({ revision, quality, resolution, scene, report: false });
      });
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => {});
    return result;
  }
}
