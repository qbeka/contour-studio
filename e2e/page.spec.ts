/** The project page. It runs the studio's store, session and worker under a print. */

import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { PLATES, generatePlate } from '../src/core/plates';
import { PAGE_URL } from './support';

interface PageHook {
  revision: number;
  ready: boolean;
  quality: string | null;
  past: number;
  sources: number;
  field: string;
  style: string;
  file: string;
}

async function hook(page: Page): Promise<PageHook> {
  return page.evaluate(() => {
    const { store, currentFile } = (window as unknown as { __contour: { store: any; currentFile(): { svg: string } } }).__contour;
    const s = store.getState();
    const scene = store.scene;
    return {
      revision: s.revision,
      ready: store.exportReady,
      quality: s.geometry?.quality ?? null,
      past: s.history.past.length,
      sources: scene.sources.length,
      field: JSON.stringify([scene.sources.map((x: object) => ({ ...x, name: '' })), scene.levels, scene.noise, scene.seed]),
      style: JSON.stringify(scene.style),
      file: store.exportReady ? currentFile().svg : '',
    };
  });
}

async function settled(page: Page): Promise<void> {
  await expect(page.locator('#legend-live')).toHaveAttribute('data-state', 'final', { timeout: 15_000 });
}

async function openPage(page: Page, query = ''): Promise<void> {
  await page.goto(`${PAGE_URL}${query}`);
  await settled(page);
}

async function download(page: Page, click: () => Promise<void>) {
  const pending = page.waitForEvent('download');
  await click();
  const file = await pending;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

async function centre(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`No ${selector}.`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('opens on the first plate with its drawer, inks and title block @cross', async ({ page }) => {
  await openPage(page);
  await expect(page.locator('.plate')).toHaveCount(7);
  await expect(page.locator('.plate[aria-pressed=true]')).toContainText('Quiet ridge');
  await expect(page.locator('.well')).toHaveCount(5);
  await expect(page.locator('#legend-name')).toHaveText('Quiet ridge');
  await expect(page.locator('#legend-mark')).toHaveText('Plate I');
  await expect(page.locator('#legend-count')).toContainText(/nodes, [\d.]+ KB as SVG/);
  expect(new URL(page.url()).search).toBe('?hook=1');
});

test('dragging a mark moves its source in one undo step @cross', async ({ page }) => {
  await openPage(page);
  const before = await hook(page);
  const from = await centre(page, '.mark[data-primary]');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + i * 12, from.y - i * 4);
  // Holding still before letting go leaves no speed to throw with.
  await page.waitForTimeout(160);
  await page.mouse.up();
  await settled(page);
  const after = await hook(page);
  expect(after.field).not.toBe(before.field);
  expect(after.past).toBe(1);
  expect(after.quality).toBe('final');
  await page.locator('#undo').click();
  await settled(page);
  expect((await hook(page)).field).toBe(before.field);
});

test('a thrown mark glides on and still makes one undo step', async ({ page }) => {
  await openPage(page);
  const from = await centre(page, '.mark[data-primary]');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(from.x + i * 20, from.y);
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
  const released = await centre(page, '.mark[data-primary]');
  await settled(page);
  const rested = await centre(page, '.mark[data-primary]');
  expect(rested.x).toBeGreaterThan(released.x + 10);
  expect((await hook(page)).past).toBe(1);
});

test('export straight after an edit saves the final for that edit @cross', async ({ page }) => {
  await openPage(page);
  await page.locator('.mark[data-primary]').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  // No wait here: the lines for the second nudge have not been finished yet.
  await page.locator('#export').click();
  const saved = await download(page, () => page.locator('.row').first().click());
  await settled(page);
  const now = await hook(page);
  expect(saved.name).toBe('quiet-ridge.svg');
  expect(now.ready).toBe(true);
  expect(saved.bytes.toString('utf8')).toBe(now.file);
  expect(now.file).toContain('fill-rule="evenodd"');
});

test('the export list reports the size of the file and what tint adds to it', async ({ page }) => {
  await openPage(page);
  await page.locator('#export').click();
  const note = page.locator('.row').first().locator('small');
  await expect(note).toContainText(/KB, [\d,]+ nodes, tint is [\d.]+ KB of it/);
  const { file } = await hook(page);
  const stated = Number((await note.textContent())?.match(/^([\d.]+) KB/)?.[1]);
  expect(stated).toBeCloseTo(file.length / 1024, 1);
  // With the tint off, the same row says so and the file loses its filled group.
  await page.locator('#export').click();
  await page.locator('.mark[data-primary]').focus();
  await page.keyboard.press('Enter');
  await page.locator('#tint').fill('0');
  await settled(page);
  await page.locator('#export').click();
  await expect(note).toContainText('lines only');
  expect((await hook(page)).file).not.toContain('fill-rule');
});

test('a plate, an ink and edits survive in the address', async ({ page, context }) => {
  await openPage(page);
  await page.locator('.plate', { hasText: 'Caldera' }).click();
  await settled(page);
  await expect(page).toHaveURL(/plate=caldera/);
  await page.locator('.well').nth(2).click();
  await page.locator('.mark[data-primary]').focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await settled(page);
  await expect(page).toHaveURL(/ink=indigo.*e=v1\./);
  const here = await hook(page);
  const again = await context.newPage();
  await again.goto(page.url());
  await settled(again);
  const there = await hook(again);
  expect(there.field).toBe(here.field);
  expect(there.style).toBe(here.style);
  await expect(again.locator('#legend-name')).toHaveText('Caldera');
});

test('a new composition puts its seed in the address, and the seed restores it', async ({ page, context }) => {
  await openPage(page);
  await page.getByRole('button', { name: 'New composition' }).click();
  await settled(page);
  await expect(page).toHaveURL(/seed=\d+/);
  const seed = Number(new URL(page.url()).searchParams.get('seed'));
  const here = await hook(page);
  const made = generatePlate(seed).scene;
  expect(JSON.parse(here.field)[0]).toEqual(made.sources.map((s) => ({ ...s, name: '' })));
  await expect(page.locator('#legend-mark')).toHaveText(`No. ${String(seed).padStart(6, '0')}`);
  const again = await context.newPage();
  await again.goto(page.url());
  await settled(again);
  expect((await hook(again)).field).toBe(here.field);
});

test('a double click adds a peak, and Backspace takes it away', async ({ page }) => {
  await openPage(page);
  const start = await hook(page);
  const box = await page.locator('#art').boundingBox();
  if (!box) throw new Error('No canvas.');
  await page.mouse.dblclick(box.x + box.width * 0.62, box.y + box.height * 0.3);
  await settled(page);
  expect((await hook(page)).sources).toBe(start.sources + 1);
  await expect(page.locator('.mark[data-selected]')).toBeFocused();
  await page.keyboard.press('Backspace');
  await settled(page);
  const end = await hook(page);
  expect(end.sources).toBe(start.sources);
  expect(end.field).toBe(start.field);
});

test('keyboard only: reach a mark, change point, open settings, close them', async ({ page }) => {
  await openPage(page);
  for (let i = 0; i < 5; i++) await page.keyboard.press('Tab');
  await expect(page.locator('.mark[data-primary]')).toBeFocused();
  const before = await hook(page);
  await page.keyboard.press('ArrowDown');
  await settled(page);
  expect((await hook(page)).field).not.toBe(before.field);
  await page.keyboard.press(']');
  await expect(page.locator('.mark[data-primary]')).not.toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#inspector')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#inspector')).toBeHidden();
  await expect(page.locator('.mark[data-selected]')).toBeFocused();
  // The whole drawing is one tab stop, so the next Tab leaves it.
  await page.keyboard.press('Tab');
  await expect(page.locator('.well').first()).toBeFocused();
});

test('an ink changes the print and leaves every line where it was', async ({ page }) => {
  await openPage(page);
  const before = await hook(page);
  await page.getByRole('button', { name: 'Night ink' }).click();
  await settled(page);
  const after = await hook(page);
  expect(after.field).toBe(before.field);
  expect(after.style).not.toBe(before.style);
  const lines = (svg: string) => svg.split('\n').filter((line) => line.startsWith('<path d=')).length;
  expect(lines(after.file)).toBe(lines(before.file));
  await expect(page.locator('#reset')).toHaveAttribute('aria-disabled', 'true');
});

test('a desktop wallpaper comes out at its size, as a PNG', async ({ page }) => {
  await openPage(page, '&plate=archipelago');
  await page.locator('#export').click();
  const saved = await download(page, () => page.locator('.row', { hasText: 'Desktop wallpaper' }).click());
  expect(saved.name).toBe('archipelago-desktop.png');
  expect(saved.bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  expect(saved.bytes.readUInt32BE(16)).toBe(3840);
  expect(saved.bytes.readUInt32BE(20)).toBe(2160);
  await expect(page.locator('.row', { hasText: 'Desktop wallpaper' })).toHaveAttribute('data-state', 'saved');
});

test('the idle drift moves the lines and never the drawing', async ({ page }) => {
  await openPage(page);
  const before = await hook(page);
  const drifting = () =>
    page.evaluate(() => (window as unknown as { __contour: { drift: { geometry: unknown } } }).__contour.drift.geometry !== null);
  await expect.poll(drifting, { timeout: 12_000 }).toBe(true);
  const during = await hook(page);
  expect(during.revision).toBe(before.revision);
  expect(during.field).toBe(before.field);
  expect(new URL(page.url()).search).toBe('?hook=1');
  // A press on the paper ends it within a moment.
  const box = await page.locator('#art').boundingBox();
  if (!box) throw new Error('No canvas.');
  await page.mouse.click(box.x + box.width * 0.5, box.y + 30);
  await expect.poll(drifting, { timeout: 3000 }).toBe(false);
  expect((await hook(page)).revision).toBe(before.revision);
});

test('reduced motion gives a still page that works', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await openPage(page);
  await page.waitForTimeout(4500);
  const still = await page.evaluate(() => ({
    animations: document.getAnimations().length,
    drifting: (window as unknown as { __contour: { drift: { frame: number } } }).__contour.drift.frame !== 0,
  }));
  expect(still).toEqual({ animations: 0, drifting: false });
  await page.locator('.plate', { hasText: 'Terraces' }).click();
  await settled(page);
  await expect(page.locator('#legend-name')).toHaveText('Terraces');
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await context.close();
});

for (const [width, height] of [[1440, 900], [1280, 720], [1024, 768], [768, 1024], [390, 844], [320, 568]]) {
  test(`at ${width} px the print and its tools fit one screen with no sideways scroll`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await openPage(page);
    const fit = await page.evaluate(() => {
      const stage = (document.getElementById('stage') as HTMLElement).getBoundingClientRect();
      const exportButton = (document.getElementById('export') as HTMLElement).getBoundingClientRect();
      return {
        sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        bottom: stage.bottom,
        exportRight: exportButton.right,
        stageRight: stage.right,
      };
    });
    expect(fit.sideways).toBe(false);
    expect(fit.bottom).toBeLessThanOrEqual(height);
    expect(fit.exportRight).toBeLessThanOrEqual(fit.stageRight);
    await context.close();
  });
}

test('touch can drag a mark, and a double tap adds a peak', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  await openPage(page);
  const start = await hook(page);
  const box = await page.locator('#art').boundingBox();
  if (!box) throw new Error('No canvas.');
  const at = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.25 };
  await page.touchscreen.tap(at.x, at.y);
  await page.touchscreen.tap(at.x, at.y);
  await settled(page);
  expect((await hook(page)).sources).toBe(start.sources + 1);
  await context.close();
});

test('every plate draws, and each has a tint region for every level', async ({ page }) => {
  await openPage(page);
  for (const plate of PLATES) {
    await page.locator('.plate', { hasText: plate.name }).click();
    await settled(page);
    await expect(page.locator('#legend-name')).toHaveText(plate.name);
    const { file } = await hook(page);
    expect(file.includes('fill-rule="evenodd"')).toBe(plate.scene.style.tint !== 0);
  }
});

test('automated accessibility scan of the page finds nothing serious', async ({ page }) => {
  await openPage(page);
  const states = [
    async () => undefined,
    async () => {
      await page.locator('.mark[data-primary]').focus();
      await page.keyboard.press('Enter');
    },
    async () => {
      await page.locator('#export').click();
      // The list fades in, and a scan taken mid-fade reads the text as low contrast.
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    },
    async () => {
      await page.getByRole('button', { name: 'Night ink' }).click();
      await settled(page);
    },
  ];
  for (const enter of states) {
    await enter();
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
  }
});
