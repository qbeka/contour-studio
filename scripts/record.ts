/**
 * Records the two demo videos from the built site. Needs ffmpeg, and `dist-site`
 * served as for scripts/capture.ts:
 *
 *   CONTOUR_URL=http://localhost:5183/ pnpm exec tsx scripts/record.ts
 *
 * The signature clip is the project page. The walkthrough is the studio.
 *
 * Headless video has no pointer, so a small marker follows the mouse. Captions in
 * the walkthrough are drawn by this script. Neither is part of the app.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';

const BASE = process.env.CONTOUR_URL ?? 'http://localhost:5183/';
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

async function start(path: string, ready: string): Promise<{ page: Page; finish(name: string, skip: number): Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'contour-video-'));
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    recordVideo: { dir, size: SIZE },
  });
  await context.addInitScript(overlay);
  const page = await context.newPage();
  await page.goto(`${BASE}${path}`);
  await page.waitForSelector(ready);
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

const PAGE_READY = '#legend-live[data-state=final]';

async function markCentre(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`No ${selector}.`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drags the lamp over a relief along a slow arc through the given places. */
async function sweepLamp(page: Page, stops: { x: number; y: number }[], ms: number): Promise<void> {
  let from = await markCentre(page, '#lamp');
  await page.mouse.move(from.x, from.y, { steps: 10 });
  await page.mouse.down();
  for (const to of stops) {
    const steps = Math.round(ms / 16);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t * t * (3 - 2 * t);
      await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e - Math.sin(t * Math.PI) * 50);
      await page.waitForTimeout(12);
    }
    from = to;
  }
  await page.mouse.up();
}

/** The project page: drag, throw, settle, the relief and its lamp, then a few plates and inks. */
async function signature(): Promise<void> {
  const { page, finish } = await start('?hook=1', PAGE_READY);
  await page.waitForTimeout(1400);
  const summit = await markCentre(page, '.mark[data-primary]');
  const away = { x: summit.x + 260, y: summit.y + 200 };
  await page.mouse.move(away.x, away.y);
  await glide(page, away, summit, 700);
  await page.mouse.down();
  await orbit(page, summit, 5200, 150, 60);
  await glide(page, summit, { x: summit.x + 330, y: summit.y + 40 }, 1300);
  await page.waitForTimeout(260);
  await page.mouse.up();
  await page.waitForSelector(PAGE_READY);
  await page.waitForTimeout(1500);
  // A throw: the mark keeps going after the pointer lets go.
  const held = await markCentre(page, '.mark[data-primary]');
  await page.mouse.move(held.x, held.y);
  await page.mouse.down();
  for (let i = 1; i <= 9; i++) {
    await page.mouse.move(held.x - i * 20, held.y + i * 5);
    await page.waitForTimeout(9);
  }
  await page.mouse.up();
  await page.waitForTimeout(600);
  await page.waitForSelector(PAGE_READY);
  await page.waitForTimeout(1500);
  // The same lines as cut card, and the lamp moved across it.
  const relief = await markCentre(page, '[data-view=relief]');
  await page.mouse.move(relief.x, relief.y, { steps: 16 });
  await page.mouse.click(relief.x, relief.y);
  await page.waitForTimeout(1500);
  await sweepLamp(page, [{ x: 760, y: 300 }, { x: 1080, y: 500 }, { x: 420, y: 260 }], 1300);
  await page.waitForTimeout(900);
  for (const name of ['Caldera', 'Archipelago', 'Terraces']) {
    const tile = await markCentre(page, `.plate:has-text("${name}")`);
    await glide(page, await page.evaluate(() => ({ x: 640, y: 420 })), tile, 450);
    await page.mouse.click(tile.x, tile.y);
    await page.waitForSelector(PAGE_READY);
    await page.waitForTimeout(1500);
  }
  for (const index of [2, 3, 0]) {
    const well = await markCentre(page, `.well:nth-child(${index + 1})`);
    await page.mouse.move(well.x, well.y, { steps: 12 });
    await page.mouse.click(well.x, well.y);
    await page.waitForTimeout(1100);
  }
  const button = await markCentre(page, '#export');
  await page.mouse.move(button.x, button.y, { steps: 14 });
  await page.mouse.click(button.x, button.y);
  await page.waitForTimeout(2200);
  await finish('signature', 0.8);
}

async function sweepStudioLamp(page: Page, from: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y, { steps: 10 });
  await page.mouse.down();
  await glide(page, from, { x: from.x + 420, y: from.y + 60 }, 1800);
  await glide(page, { x: from.x + 420, y: from.y + 60 }, { x: from.x + 250, y: from.y + 330 }, 1700);
  await glide(page, { x: from.x + 250, y: from.y + 330 }, { x: from.x + 40, y: from.y + 30 }, 1700);
  await page.mouse.up();
}

async function walkthrough(): Promise<void> {
  const { page, finish } = await start('app/?hook=1', '.status-state[data-state=final]');
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

  await caption(page, 'Ink, paper and tint are print choices. They never move a line.');
  await page.getByRole('button', { name: 'Indigo', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByLabel('Tint', { exact: true }).fill('0.55');
  await page.waitForTimeout(1400);
  await page.getByLabel('Heavier line every', { exact: true }).fill('4');
  await page.waitForTimeout(1000);
  await page.getByLabel('Taper', { exact: true }).fill('0.4');
  await page.waitForTimeout(2400);

  await caption(page, 'The same lines can be cut into card. Drag the lamp and every shadow follows it.');
  // Focus is in a number field here, where L is a letter, so the status bar is used.
  await page.getByRole('button', { name: 'Relief', exact: true }).click();
  await page.waitForTimeout(1800);
  const lamp = await markCentre(page, '.lamp-handle');
  await sweepStudioLamp(page, lamp);
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: 'Relief', exact: true }).click();
  await page.waitForTimeout(900);

  await caption(page, 'Undo steps back one whole gesture. Redo returns it.');
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(1500);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForTimeout(1800);

  await caption(page, 'Export shows the cost and the error for this composition, and what the tint adds.');
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
