/**
 * Rules for background geometry work. There is no worker in this file, so every
 * rule can be tested on its own.
 *
 * Memory stays bounded: at most one job runs and one waits. A new job replaces
 * the one waiting, because nobody needs the older result.
 */

import type { Scene } from '../core/scene';

export type Quality = 'draft' | 'final';

export interface JobRequest {
  revision: number;
  quality: Quality;
  resolution: number;
  scene: Scene;
  /** False ends a final at its geometry. The project page has no use for the numbers. */
  report?: boolean;
}

export interface Job extends JobRequest {
  id: number;
}

export interface SubmitOutcome {
  /** A job to start now. */
  start: Job | null;
  /** The id of a running job to cancel. */
  cancel: number | null;
}

export class JobSlots {
  running: Job | null = null;
  waiting: Job | null = null;
  private nextId = 1;

  submit(request: JobRequest): SubmitOutcome {
    const job: Job = { ...request, id: this.nextId++ };
    if (!this.running) {
      this.running = job;
      return { start: job, cancel: null };
    }
    this.waiting = job;
    // A final can be long and is now stale, so stop it. A draft is short and is
    // the only feedback during a drag. If each pointer move cancelled the draft
    // before it, a fast drag would show nothing until the pointer stopped.
    const cancel = this.running.quality === 'final' ? this.running.id : null;
    return { start: null, cancel };
  }

  /** Call when a job ends for any reason. Returns the next job to start. */
  settle(id: number): Job | null {
    if (this.running?.id !== id) return null;
    this.running = this.waiting;
    this.waiting = null;
    return this.running;
  }

  get outstanding(): number {
    return (this.running ? 1 : 0) + (this.waiting ? 1 : 0);
  }
}

export interface Shown {
  revision: number;
  quality: Quality;
}

/**
 * Whether a finished result may replace what is on screen. Newer scenes win. On
 * the same scene a final beats a draft. So an old final can never overwrite a
 * newer draft, whatever order the results arrive in.
 */
export function shouldCommit(shown: Shown | null, result: Shown): boolean {
  if (!shown) return true;
  if (result.revision !== shown.revision) return result.revision > shown.revision;
  return shown.quality === 'draft' && result.quality === 'final';
}

export type PreviewState = 'draft' | 'refining' | 'final';

/** What the status line must say about the lines currently on screen. */
export function previewState(shown: Shown | null, latestRevision: number): PreviewState {
  if (!shown) return 'refining';
  if (shown.revision === latestRevision && shown.quality === 'final') return 'final';
  return shown.quality === 'draft' && shown.revision !== latestRevision ? 'draft' : 'refining';
}
