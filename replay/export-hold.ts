/**
 * Export writes the drawing on screen, so it can only run once the final geometry
 * for the newest scene has landed. Pressing Export before that holds the action.
 * The hold ends with a file, or with a failure the page can show.
 */

import type { EditorStore } from '../src/app/store';

export type HoldState = 'idle' | 'holding' | 'failed';

export class ExportHold {
  state: HoldState = 'idle';

  constructor(
    private store: EditorStore,
    private save: () => void,
    private onChange: (state: HoldState) => void,
  ) {
    store.subscribe(() => this.check());
  }

  get ready(): boolean {
    return this.store.exportReady && !this.store.inGesture;
  }

  request(): void {
    if (this.state === 'holding') return;
    if (this.ready) {
      this.set('idle');
      this.save();
    } else {
      this.set('holding');
    }
  }

  private check(): void {
    if (this.state !== 'holding') return;
    const { failedRevision, revision } = this.store.getState();
    if (this.ready) {
      this.set('idle');
      this.save();
    } else if (failedRevision === revision) {
      this.set('failed');
    }
  }

  private set(state: HoldState): void {
    if (state === this.state) return;
    this.state = state;
    this.onChange(state);
  }
}
