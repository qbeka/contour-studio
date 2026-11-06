import { describe, expect, it } from 'vitest';
import { addRidge, removeHandle, updateSource } from '../src/app/edits';
import { EditorStore } from '../src/app/store';
import { emptyScene } from '../src/core/scene';

function storeWithRidge() {
  const { scene, id } = addRidge(emptyScene(), [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }]);
  return { store: new EditorStore(scene), id };
}

describe('editor store', () => {
  it('merges quick edits to one field into one undo step', () => {
    const { store, id } = storeWithRidge();
    for (const radius of [10, 20, 30]) {
      store.edit(updateSource(store.scene, id, { radius }), 'reach');
    }
    expect(store.getState().history.past).toHaveLength(1);
  });

  it('an edit right after undo starts a new step and keeps the old one', () => {
    const { store, id } = storeWithRidge();
    const start = store.scene;
    store.edit(updateSource(store.scene, id, { radius: 150 }), 'reach');
    store.undo();
    expect(store.scene).toBe(start);
    store.edit(updateSource(store.scene, id, { radius: 170 }), 'reach');
    expect(store.getState().history.past).toHaveLength(1);
    store.undo();
    expect(store.scene).toBe(start);
  });

  it('a drag is one undo step, however many moves it has', () => {
    const { store, id } = storeWithRidge();
    store.beginGesture();
    for (const radius of [10, 20, 30]) store.gesture(updateSource(store.scene, id, { radius }));
    store.endGesture();
    expect(store.getState().history.past).toHaveLength(1);
  });

  it('undo drops a selected handle that no longer exists', () => {
    const { store, id } = storeWithRidge();
    store.edit(removeHandle(store.scene, id, 2));
    store.undo();
    store.select({ sourceId: id, handle: 2 });
    store.redo();
    expect(store.getState().selection).toEqual({ sourceId: id, handle: null });
  });

  it('undo drops a selected source that no longer exists', () => {
    const { store, id } = storeWithRidge();
    store.edit({ ...store.scene, sources: [] });
    store.undo();
    store.select({ sourceId: id, handle: null });
    store.redo();
    expect(store.getState().selection).toBeNull();
  });

  it('undo across a change of sheet asks for a refit', () => {
    const { store } = storeWithRidge();
    store.set({ fitPending: false });
    store.edit({ ...store.scene, clip: { x: 0, y: 0, width: 300, height: 200 } });
    store.undo();
    expect(store.getState().fitPending).toBe(true);
  });

  it('undo with the same sheet leaves the view alone', () => {
    const { store, id } = storeWithRidge();
    store.set({ fitPending: false });
    store.edit(updateSource(store.scene, id, { radius: 77 }));
    store.undo();
    expect(store.getState().fitPending).toBe(false);
  });

  it('an old result never replaces a newer one', () => {
    const { store } = storeWithRidge();
    const draft = { quality: 'draft' } as Parameters<EditorStore['commitGeometry']>[1];
    const final = { quality: 'final' } as Parameters<EditorStore['commitGeometry']>[1];
    expect(store.commitGeometry(5, draft)).toBe(true);
    expect(store.commitGeometry(4, final)).toBe(false);
    expect(store.getState().geometry).toBe(draft);
  });

  it('export waits for a final of the scene on screen', () => {
    const { store, id } = storeWithRidge();
    const final = { quality: 'final' } as Parameters<EditorStore['commitGeometry']>[1];
    expect(store.exportReady).toBe(false);
    store.commitGeometry(store.getState().revision, final);
    expect(store.exportReady).toBe(true);
    store.edit(updateSource(store.scene, id, { radius: 9 }));
    expect(store.exportReady).toBe(false);
  });

  it('a pointer time is used once', () => {
    const { store } = storeWithRidge();
    store.markInput(123);
    expect(store.takeInput()).toBe(123);
    expect(store.takeInput()).toBeNull();
  });
});
