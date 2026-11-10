import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MEASURED } from '../replay/editorial';
import { ExportHold, type HoldState } from '../replay/export-hold';
import { linesOnly, toSvg } from '../src/core/svg';
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

describe('the figures under the stage', () => {
  const html = readFileSync('replay/index.html', 'utf8');
  const measured = computeGeometry(MEASURED, { quality: 'final' });

  it('the line figure runs the scene the size table was measured on', () => {
    expect(MEASURED.name).toBe('Quiet ridge');
    expect(MEASURED.export.tolerance).toBe(0.15);
    expect(MEASURED.style.tint).toBe(0);
    expect(measured.stats.sourceVertices).toBe(12_104);
    expect(measured.stats.outputVertices).toBe(1_771);
    expect(measured.stats.maxBound.toFixed(3)).toBe('0.221');
  });

  it('the page quotes those numbers, and draws its bars to their scale', () => {
    expect(html).toContain('<b>12,104</b><span>to</span><b>1,771</b>');
    expect(html).toContain('<b>19,312</b><span>to</span><b>5,506</b>');
    const widths = [...html.matchAll(/class="bar-now" style="width: ([\d.]+)%"/g)].map((m) => Number(m[1]));
    expect(widths[0]).toBeCloseTo((1_771 / 12_104) * 100, 2);
    expect(widths[1]).toBeCloseTo((5_506 / 19_312) * 100, 2);
    expect(html).toContain(`<span id="line-bound">${measured.stats.maxBound.toFixed(3)} units</span>`);
  });

  it('the lines file of that scene still gzips to the size quoted', () => {
    const svg = toSvg(measured, linesOnly(MEASURED));
    expect(gzipSync(svg, { level: 9 }).length).toBe(5_506);
  });

  it('has seventy squares for the seeded bugs, one of them the timeout', () => {
    const bugs = html.slice(html.indexOf('class="bugs"'), html.indexOf('</div>', html.indexOf('class="bugs"')));
    expect(bugs.match(/<i/g)).toHaveLength(70);
    expect(bugs.match(/data-timeout/g)).toHaveLength(1);
  });

  it('keeps interface text free of dashes', () => {
    expect(html).not.toMatch(/[–—]/);
  });
});
