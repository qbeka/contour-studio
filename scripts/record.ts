/**
 * Records the two demo videos from the running app. Needs `pnpm dev` and ffmpeg.
 *
 *   pnpm exec tsx scripts/record.ts
 *
 * Headless video has no pointer, so a small marker follows the mouse. Captions in
 * the walkthrough are drawn by this script. Neither is part of the app.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';

const URL = process.env.CONTOUR_URL ?? 'http://localhost:5173/?hook=1';
const SIZE = { width: 1280, height: 800 };

const overlay = `
window.addEventListener('DOMContentLoaded', () => {
  const dot = document.createElement('div');
  dot.style.cssText = 'position:fixed;left:0;top:0;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:#11151133;border:1.5px solid #111511;pointer-events:none;z-index:9999';
  document.documentElement.append(dot);
  addEventListener('mousemove', (e) => { dot.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
  const line = document.createElement('div');
  line.id = 'caption';
  line.style.cssText = 'position:fixed;left:50%;bottom:44px;transform:translateX(-50%);max-width:760px;padding:7px 14px;border-radius:10px;background:#111511;color:#fbf8f4;font:15px/1.35 Geist,system-ui,sans-serif;z-index:9999;display:none';
  document.documentElement.append(line);
  window.__caption = (text) => { line.textContent = text; line.style.display = text ? 'block' : 'none'; };
});
`;

async function start(): Promise<{ page: Page; finish(name: string, skip: number): Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'contour-video-'));
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    recordVideo: { dir, size: SIZE },
  });
  await context.addInitScript(overlay);
  const page = await context.newPage();
  await page.goto(URL);
  await page.waitForSelector('.status-state[data-state=final]');
  return {
    page,
    async finish(name, skip) {
      await context.close();
      await browser.close();
      const [file] = readdirSync(dir);
      const out = join('docs/media', `${name}.mp4`);
      execFileSync(
        'ffmpeg',
        ['-y', '-loglevel', 'error', '-ss', String(skip), '-i', join(dir, file), '-c:v', 'libx264',
         '-pix_fmt', 'yuv420p', '-crf', '24', '-preset', 'slow', '-movflags', '+faststart', '-an', out],
      );
      console.log(out);
    },
  };
}

const caption = (page: Page, text: string) =>
  page.evaluate((t) => (window as unknown as { __caption(t: string): void }).__caption(t), text);

async function modelPoint(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x, y }) => {
      const { store } = (window as any).__contour;
      const { view } = store.getState();
      const box = document.querySelector('.stage')!.getBoundingClientRect();
      return { x: box.left + view.x + x * view.scale, y: box.top + view.y + y * view.scale };
    },
    { x, y },
  );
}

async function glide(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, ms: number) {
  const steps = Math.round(ms / 16);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t * t * (3 - 2 * t);
    await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    await page.waitForTimeout(12);
  }
}

async function orbit(page: Page, centre: { x: number; y: number }, ms: number, rx: number, ry: number) {
  const steps = Math.round(ms / 16);
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    await page.mouse.move(centre.x + rx * Math.sin(a), centre.y + ry * (1 - Math.cos(a)));
    await page.waitForTimeout(12);
  }
}

async function signature(): Promise<void> {
  const { page, finish } = await start();
  await page.waitForTimeout(1200);
  const summit = await modelPoint(page, 262, 262);
  await page.mouse.move(summit.x - 200, summit.y + 160);
  await glide(page, { x: summit.x - 200, y: summit.y + 160 }, summit, 700);
  await page.mouse.down();
  await orbit(page, summit, 6500, 120, 70);
  const valley = await modelPoint(page, 700, 400);
  await glide(page, summit, valley, 1600);
  await glide(page, valley, await modelPoint(page, 520, 300), 1300);
  await page.mouse.up();
  await page.waitForSelector('.status-state[data-state=final]');
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Nodes' }).click();
  await page.getByRole('button', { name: 'Handles' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.waitForTimeout(1600);
  await page.getByRole('button', { name: 'Balanced', exact: true }).click();
  await page.waitForTimeout(1600);
  await finish('signature', 0.8);
}

async function walkthrough(): Promise<void> {
  const { page, finish } = await start();
  await caption(page, 'Contour opens on a real scene. Every line here comes from a few editable sources.');
  await page.waitForTimeout(4500);

  await caption(page, 'Start from an empty sheet.');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.waitForTimeout(1800);
  await page.getByRole('button', { name: /Empty sheet/ }).click();
  await page.waitForTimeout(1800);

  await caption(page, 'A peak lifts the field. Each line joins points of equal height.');
  await page.keyboard.press('p');
  await page.waitForTimeout(600);
  const a = await modelPoint(page, 480, 380);
  await page.mouse.move(a.x - 120, a.y - 120);
  await glide(page, { x: a.x - 120, y: a.y - 120 }, a, 700);
  await page.mouse.click(a.x, a.y);
  await page.waitForTimeout(2200);

  await caption(page, 'A ridge is a curve you draw point by point.');
  await page.keyboard.press('r');
  const points = [[160, 620], [460, 560], [760, 650], [1060, 420]];
  let last = a;
  for (const [x, y] of points) {
    const p = await modelPoint(page, x, y);
    await glide(page, last, p, 500);
    await page.mouse.click(p.x, p.y);
    last = p;
    await page.waitForTimeout(250);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2200);

  await caption(page, 'Drag a source. A draft follows the pointer, and the status line says so.');
  const c = await modelPoint(page, 480, 380);
  await glide(page, last, c, 700);
  await page.mouse.down();
  await orbit(page, c, 6000, 200, 110);
  await page.mouse.up();
  await caption(page, 'Release, and it refines to the exact lines that go in the file.');
  await page.waitForTimeout(3200);

  await caption(page, 'A negative height digs a hollow. Numbers are always available.');
  await page.keyboard.press('p');
  const d = await modelPoint(page, 820, 300);
  await glide(page, c, d, 700);
  await page.mouse.click(d.x, d.y);
  await page.waitForTimeout(600);
  await page.getByLabel('Height', { exact: true }).fill('-0.7');
  await page.waitForTimeout(600);
  await page.getByLabel('Reach', { exact: true }).fill('240');
  await page.waitForTimeout(2200);

  await caption(page, 'Controls say what changes in the drawing: more lines, a finer gap, some texture.');
  await page.getByRole('spinbutton', { name: 'Lines' }).fill('18');
  await page.waitForTimeout(1000);
  await page.getByLabel('Line gap', { exact: true }).fill('0.09');
  await page.waitForTimeout(1000);
  await page.getByRole('spinbutton', { name: 'Texture', exact: true }).fill('0.03');
  await page.waitForTimeout(2600);

  await caption(page, 'Undo steps back one whole gesture. Redo returns it.');
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(1500);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForTimeout(1800);

  await caption(page, 'Export shows the cost and the error for this composition, not a generic claim.');
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await page.waitForTimeout(4200);

  await caption(page, 'Show the nodes that will be written. Lighter detail means fewer nodes and a larger allowed error.');
  await page.getByRole('button', { name: 'Handles' }).click();
  await page.getByRole('button', { name: 'Nodes' }).click();
  await page.waitForTimeout(2200);
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.waitForTimeout(3200);
  await page.getByRole('button', { name: 'Fine', exact: true }).click();
  await page.waitForTimeout(3200);
  await page.getByRole('button', { name: 'Balanced', exact: true }).click();
  await page.waitForTimeout(1600);

  await caption(page, 'The SVG is plain paths. It opens anywhere, with no script and no hidden data.');
  await page.getByRole('button', { name: 'Nodes' }).click();
  await page.getByRole('button', { name: 'Handles' }).click();
  await page.waitForTimeout(3600);

  await caption(page, 'Paths are checked against the extracted lines, so nothing crosses and no loop is lost.');
  await page.waitForTimeout(4200);
  await finish('walkthrough', 0.8);
}

await signature();
await walkthrough();
