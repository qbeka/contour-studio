import { describe, expect, it } from 'vitest';
import { ExportHold, type HoldState } from '../replay/export-hold';
import { computeGeometry, type Geometry } from '../src/core/pipeline';
import { PLATES } from '../src/core/plates';
import type { PeakSource, Scene } from '../src/core/scene';
import { EditorStore } from '../src/app/store';

const moved = (scene: Scene, x: number, y: number): Scene => ({
  ...scene,
  sources: scene.sources.map((s) => (s.id === PLATES[0].primary ? { ...(s as PeakSource), x, y } : s)),
});

describe('export hold', () => {
  const setup = () => {
    const store = new EditorStore(PLATES[0].scene);
    const saved: Geometry[] = [];
    const states: HoldState[] = [];
    const hold = new ExportHold(
      store,
      () => saved.push(store.getState().geometry as Geometry),
      (state) => states.push(state),
    );
    const land = (quality: 'draft' | 'final', revision = store.getState().revision) =>
      store.commitGeometry(revision, computeGeometry(store.scene, { quality, resolution: 64 }));
    return { store, hold, saved, states, land };
  };

  it('exports at once when the final for this scene is on screen', () => {
    const { hold, saved, land } = setup();
    land('final');
    hold.request();
    expect(saved).toHaveLength(1);
    expect(hold.state).toBe('idle');
  });

  it('holds over a draft and saves when the final lands', () => {
    const { store, hold, saved, states, land } = setup();
    land('final');
    store.edit(moved(store.scene, 300, 300));
    land('draft');
    hold.request();
    expect(saved).toHaveLength(0);
    expect(hold.state).toBe('holding');
    land('final');
    expect(saved).toHaveLength(1);
    expect(saved[0].quality).toBe('final');
    expect(states).toEqual(['holding', 'idle']);
  });

  it('an older final never ends the hold', () => {
    const { store, hold, saved, land } = setup();
    land('final');
    const old = store.getState().revision;
    store.edit(moved(store.scene, 300, 300));
    hold.request();
    store.edit(moved(store.scene, 320, 300));
    land('final', old);
    expect(saved).toHaveLength(0);
    land('final');
    expect(saved).toHaveLength(1);
  });

  it('waits for the end of a drag, even over a final', () => {
    const { store, hold, saved, land } = setup();
    land('final');
    store.beginGesture();
    store.gesture(moved(store.scene, 300, 300));
    hold.request();
    land('final');
    expect(saved).toHaveLength(0);
    store.endGesture();
    expect(saved).toHaveLength(1);
  });

  it('a second press during a hold saves one file', () => {
    const { store, hold, saved, land } = setup();
    land('final');
    store.edit(moved(store.scene, 300, 300));
    hold.request();
    hold.request();
    land('final');
    expect(saved).toHaveLength(1);
  });

  it('reports a failure for the newest scene and can be tried again', () => {
    const { store, hold, saved, land } = setup();
    land('final');
    store.edit(moved(store.scene, 300, 300));
    hold.request();
    store.set({ failedRevision: store.getState().revision });
    expect(hold.state).toBe('failed');
    land('final');
    hold.request();
    expect(saved).toHaveLength(1);
  });
});
