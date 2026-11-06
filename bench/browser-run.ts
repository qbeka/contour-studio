/**
 * One independent browser run: a new Chromium, a new page, one mode.
 *
 * It drags a source through the fixed scene with real pointer events, then lets
 * it refine. Times come from the app's session log. rAF gaps are recorded as well,
 * and they measure main thread availability. They do not prove displayed frames.
 */

import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { PRESETS } from '../src/core/presets';
import { serializeScene, type Scene } from '../src/core/scene';
import { stressScene, withLevels } from './workload';

const [url, mode, throttleText, sceneName, out] = process.argv.slice(2);
const throttle = Number(throttleText);
const DRAG_STEPS = 150;
const PACE_MS = 16;

const browser = await chromium.launch();
const version = browser.version();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const client = await context.newCDPSession(page);
// tsx wraps named functions with this helper, and evaluated code needs it as well.
await page.addInitScript('window.__name = (f) => f');
const engines: Record<string, string> = { main: '&worker=off', blocking: '&worker=blocking' };
await page.goto(`${url}/?hook=1${engines[mode] ?? ''}`);
await page.waitForSelector('.status-state[data-state=final]', { timeout: 30_000 });

const scene: Scene =
  sceneName === 'stress'
    ? { ...stressScene(), export: { ...stressScene().export, resolution: 1024 } }
    : withLevels(PRESETS[2].scene, 16);
await page.locator('input[type=file]').setInputFiles({
  name: 'bench.contour.json',
  mimeType: 'application/json',
  buffer: Buffer.from(serializeScene(scene)),
});
await page.waitForFunction(() => document.querySelector('.notice')?.textContent?.includes('Opened'));
await page.waitForSelector('.status-state[data-state=final]', { timeout: 30_000 });
if (throttle > 1) await client.send('Emulation.setCPUThrottlingRate', { rate: throttle });
await page.waitForTimeout(300);

await page.evaluate(() => {
  const w = window as any;
  w.__contour.session.log.length = 0;
  w.__contour.drawLog.length = 0;
  w.__gaps = [];
  w.__longTasks = [];
  w.__sampling = true;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) w.__longTasks.push(entry.duration);
  }).observe({ entryTypes: ['longtask'] });
  let last = performance.now();
  const tick = (now: number) => {
    w.__gaps.push(now - last);
    last = now;
    if (w.__sampling) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const source = scene.sources[5];
if (source.kind !== 'peak') throw new Error('Workload changed.');
const position = await page.evaluate(
  ({ x, y }) => {
    const { store } = (window as any).__contour;
    const { view } = store.getState();
    const box = document.querySelector('.stage')!.getBoundingClientRect();
    return { x: box.left + view.x + x * view.scale, y: box.top + view.y + y * view.scale };
  },
  { x: source.x, y: source.y },
);
await page.mouse.move(position.x, position.y);
await page.mouse.down();
const started = performance.now();
for (let i = 1; i <= DRAG_STEPS; i++) {
  const angle = (i / DRAG_STEPS) * Math.PI * 4;
  await page.mouse.move(
    position.x + 120 * Math.sin(angle),
    position.y + 70 * (1 - Math.cos(angle)),
  );
  const wait = started + i * PACE_MS - performance.now();
  if (wait > 0) await page.waitForTimeout(wait);
}
await page.mouse.up();
await page.waitForSelector('.status-state[data-state=final]', { timeout: 30_000 });
await page.waitForTimeout(100);

const data = await page.evaluate(() => {
  const w = window as any;
  w.__sampling = false;
  return {
    log: w.__contour.session.log,
    mode: w.__contour.session.client.mode,
    gaps: w.__gaps,
    longTasks: w.__longTasks,
    draws: w.__contour.drawLog,
    finalResolution: w.__contour.store.getState().geometry.resolution,
    revision: w.__contour.store.getState().revision,
  };
});

// Geometry stages in this engine, on the main thread, for all three grids.
if (throttle > 1) await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
const stages = sceneName === 'stress' ? {} : await page.evaluate(
  ({ text }) => {
    const { computeGeometry, toSvg } = (window as any).__contour.core;
    const parsed = JSON.parse(text);
    const out: Record<string, unknown> = {};
    for (const resolution of [256, 512, 1024]) {
      for (let i = 0; i < 3; i++) computeGeometry(parsed, { quality: 'final', resolution });
      const samples = [];
      for (let i = 0; i < 5; i++) {
        const geometry = computeGeometry(parsed, { quality: 'final', resolution });
        const t0 = performance.now();
        toSvg(geometry, parsed);
        samples.push({ ...geometry.stats.times, serialize: performance.now() - t0 });
      }
      out[resolution] = samples;
    }
    return out;
  },
  { text: serializeScene(scene) },
);

await browser.close();
writeFileSync(out, JSON.stringify({ ...data, browser: version, mode, throttle, scene: sceneName, stages }));
