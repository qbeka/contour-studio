import { describe, expect, it } from 'vitest';
import { emptyScene } from '../src/core/scene';
import { JobSlots, previewState, shouldCommit, type JobRequest, type Quality } from '../src/app/jobs';

const request = (revision: number, quality: Quality): JobRequest => ({
  revision,
  quality,
  resolution: 64,
  scene: emptyScene(),
});

describe('job slots', () => {
  it('starts a job when idle', () => {
    const slots = new JobSlots();
    const { start, cancel } = slots.submit(request(1, 'draft'));
    expect(start?.revision).toBe(1);
    expect(cancel).toBeNull();
  });

  it('keeps only the newest waiting job, so outstanding work stays at two', () => {
    const slots = new JobSlots();
    slots.submit(request(1, 'draft'));
    for (let r = 2; r < 200; r++) {
      slots.submit(request(r, 'draft'));
      expect(slots.outstanding).toBe(2);
    }
    expect(slots.waiting?.revision).toBe(199);
  });

  it('cancels a running final when a newer job arrives', () => {
    const slots = new JobSlots();
    const { start } = slots.submit(request(1, 'final'));
    const { cancel } = slots.submit(request(2, 'draft'));
    expect(cancel).toBe(start?.id);
  });

  it('never cancels a running draft, so a long drag still paints', () => {
    const slots = new JobSlots();
    slots.submit(request(1, 'draft'));
    expect(slots.submit(request(2, 'draft')).cancel).toBeNull();
    expect(slots.submit(request(3, 'final')).cancel).toBeNull();
  });

  it('starts the waiting job when the running one settles', () => {
    const slots = new JobSlots();
    const first = slots.submit(request(1, 'draft')).start;
    slots.submit(request(2, 'final'));
    const next = slots.settle(first?.id ?? -1);
    expect(next?.revision).toBe(2);
    expect(slots.waiting).toBeNull();
  });

  it('ignores a settle for a job that is not running', () => {
    const slots = new JobSlots();
    slots.submit(request(1, 'draft'));
    expect(slots.settle(999)).toBeNull();
    expect(slots.running?.revision).toBe(1);
  });
});

describe('commit rule', () => {
  it('shows the first result', () => {
    expect(shouldCommit(null, { revision: 1, quality: 'draft' })).toBe(true);
  });

  it('an old final never overwrites a newer draft', () => {
    expect(
      shouldCommit({ revision: 9, quality: 'draft' }, { revision: 8, quality: 'final' }),
    ).toBe(false);
  });

  it('a final replaces a draft of the same scene, and not the other way', () => {
    const draft = { revision: 4, quality: 'draft' as const };
    const final = { revision: 4, quality: 'final' as const };
    expect(shouldCommit(draft, final)).toBe(true);
    expect(shouldCommit(final, draft)).toBe(false);
  });

  it('a newer draft replaces an older final', () => {
    expect(
      shouldCommit({ revision: 4, quality: 'final' }, { revision: 5, quality: 'draft' }),
    ).toBe(true);
  });
});

describe('status wording', () => {
  it('claims export geometry only for a final of the current scene', () => {
    expect(previewState({ revision: 3, quality: 'final' }, 3)).toBe('final');
    expect(previewState({ revision: 3, quality: 'final' }, 4)).toBe('refining');
    expect(previewState({ revision: 3, quality: 'draft' }, 3)).toBe('refining');
    expect(previewState({ revision: 3, quality: 'draft' }, 5)).toBe('draft');
    expect(previewState(null, 1)).toBe('refining');
  });
});
