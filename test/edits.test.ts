import { describe, expect, it } from 'vitest';
import {
  addHandle,
  addPeak,
  addRidge,
  duplicateSource,
  hasRoom,
  moveSource,
  removeHandle,
  removeSource,
  setHandle,
  snapPoint,
} from '../src/app/edits';
import { record, redo, undo } from '../src/app/history';
import { emptyScene, parseScene, serializeScene } from '../src/core/scene';

describe('edits', () => {
  it('adds a peak with a unique id and name', () => {
    const a = addPeak(emptyScene(), 100, 100);
    const b = addPeak(a.scene, 200, 200);
    expect(a.id).not.toBe(b.id);
    expect(b.scene.sources.map((s) => s.name)).toEqual(['Peak 1', 'Peak 2']);
  });

  it('does not change the scene it was given', () => {
    const start = addPeak(emptyScene(), 100, 100).scene;
    const before = JSON.stringify(start);
    moveSource(start, start.sources[0].id, 10, 10);
    expect(JSON.stringify(start)).toBe(before);
  });

  it('moves a ridge by all its handles', () => {
    const { scene, id } = addRidge(emptyScene(), [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    const moved = moveSource(scene, id, 5, 7).sources[0];
    expect(moved.kind === 'ridge' && moved.points).toEqual([{ x: 5, y: 7 }, { x: 105, y: 7 }]);
  });

  it('keeps positions inside the format limits', () => {
    const { scene, id } = addPeak(emptyScene(), 0, 0);
    const moved = moveSource(scene, id, 1e9, -1e9);
    expect(parseScene(serializeScene(moved)).ok).toBe(true);
  });

  it('keeps a new source inside the format limits', () => {
    const far = addPeak(emptyScene(), 1e7, -1e7);
    expect(parseScene(serializeScene(far.scene)).ok).toBe(true);
    const ridge = addRidge(emptyScene(), [{ x: 1e7, y: 0 }, { x: 0, y: -1e7 }]);
    expect(parseScene(serializeScene(ridge.scene)).ok).toBe(true);
    const edge = addPeak(emptyScene(), 24570, 24570);
    const copy = duplicateSource(edge.scene, edge.id);
    expect(parseScene(serializeScene(copy!.scene)).ok).toBe(true);
  });

  it('reports when a scene has no room for another source', () => {
    let s = emptyScene();
    for (let i = 0; i < 64; i++) s = addPeak(s, i, i).scene;
    expect(hasRoom(s)).toBe(false);
    expect(duplicateSource(s, s.sources[0].id)).toBeNull();
  });

  it('a ridge cannot go below two handles', () => {
    const { scene, id } = addRidge(emptyScene(), [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(removeHandle(scene, id, 0).sources[0]).toEqual(scene.sources[0]);
  });

  it('adds a handle between two others', () => {
    const { scene, id } = addRidge(emptyScene(), [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    const out = addHandle(scene, id, 0).sources[0];
    expect(out.kind === 'ridge' && out.points[1]).toEqual({ x: 50, y: 0 });
  });

  it('sets one handle', () => {
    const { scene, id } = addRidge(emptyScene(), [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    const out = setHandle(scene, id, 1, 3, 4).sources[0];
    expect(out.kind === 'ridge' && out.points[1]).toEqual({ x: 3, y: 4 });
  });

  it('duplicates next to the original with a new id', () => {
    const { scene, id } = addPeak(emptyScene(), 100, 100);
    const copy = duplicateSource(scene, id);
    expect(copy?.scene.sources).toHaveLength(2);
    expect(copy?.id).not.toBe(id);
    expect(parseScene(serializeScene(copy!.scene)).ok).toBe(true);
  });

  it('after a removal, a new id does not collide', () => {
    let s = addPeak(emptyScene(), 1, 1).scene;
    s = addPeak(s, 2, 2).scene;
    s = removeSource(s, s.sources[0].id);
    const out = addPeak(s, 3, 3);
    expect(new Set(out.scene.sources.map((x) => x.id)).size).toBe(2);
  });

  it('snaps to the grid and to the frame centre', () => {
    const s = emptyScene();
    expect(snapPoint(s, 123, 47)).toEqual({ x: 120, y: 50 });
    const framed = { ...s, clip: { x: 0, y: 0, width: 1203, height: 800 } };
    expect(snapPoint(framed, 601, 400).x).toBe(601.5);
  });
});

describe('history', () => {
  it('undo and redo walk through states and a new edit clears redo', () => {
    let h = { past: [] as number[], present: 0, future: [] as number[] };
    h = record(h, 1);
    h = record(h, 2);
    h = undo(h);
    expect(h.present).toBe(1);
    h = redo(h);
    expect(h.present).toBe(2);
    h = undo(h);
    h = record(h, 9);
    expect(h.future).toEqual([]);
    expect(h.past).toEqual([0, 1]);
  });

  it('does nothing at either end', () => {
    const h = { past: [], present: 0, future: [] };
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it('holds a fixed number of steps', () => {
    let h = { past: [] as number[], present: 0, future: [] as number[] };
    for (let i = 1; i < 500; i++) h = record(h, i);
    expect(h.past.length).toBe(200);
  });
});
