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

// A throw is read from real time: the release has to come within 60 ms of the last
// move. A busy machine can stretch that, so this one test may try again.
test.describe('a throw', () => {
  test.describe.configure({ retries: 3 });
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
  // The whole drawing is one tab stop, so the next Tab leaves it for the two views.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Lines', exact: true })).toBeFocused();
});

test('an ink changes the print and leaves every line where it was', async ({ page }) => {
  await openPage(page);
  const before = await hook(page);
  await page.getByRole('button', { name: 'Night ink', exact: true }).click();
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
      await page.getByRole('button', { name: 'Night ink', exact: true }).click();
      await settled(page);
    },
  ];
  for (const enter of states) {
    await enter();
    // The page arrives over its first half second, and a scan taken while it does reads faded text as faint.
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
  }
});

/* The paper relief */

interface LookHook {
  view: string;
  u: number;
  v: number;
}

const lookOf = (page: Page): Promise<LookHook> =>
  page.evaluate(() => {
    const { look } = (window as unknown as { __contour: { look: { view: string; lamp: { u: number; v: number } } } }).__contour;
    return { view: look.view, u: look.lamp.u, v: look.lamp.v };
  });

test('relief cuts the same drawing into card and leaves the lines file as it was @cross', async ({ page }) => {
  await openPage(page);
  const lines = await hook(page);
  await page.getByRole('button', { name: 'Relief', exact: true }).click();
  await expect(page.locator('#stage')).toHaveAttribute('data-view', 'relief');
  await expect(page.locator('#lamp')).toBeVisible();
  await expect(page.locator('#legend-lines')).toHaveText('Paper relief');
  await expect(page.locator('#legend-count')).toContainText(/\d+ sheets, [\d.]+ KB as SVG/);
  await expect(page).toHaveURL(/view=relief/);
  const relief = await hook(page);
  expect(relief.revision).toBe(lines.revision);
  expect(relief.field).toBe(lines.field);
  expect(relief.past).toBe(0);
  expect(relief.file).toContain('<use xlink:href="#s1"');
  expect(relief.file).not.toMatch(/stroke=|<filter|<image/);
  // Back to lines, the file is the same bytes as before the relief was ever shown.
  await page.keyboard.press('l');
  await expect(page.locator('#stage')).toHaveAttribute('data-view', 'lines');
  await expect(page.locator('#lamp')).toBeHidden();
  await expect(page.locator('#legend-count')).toContainText('nodes');
  expect((await hook(page)).file).toBe(lines.file);
  await expect(page).not.toHaveURL(/view=/);
});

test('the lamp moves the light, stays out of undo and comes back with the link', async ({ page, context }) => {
  await openPage(page, '&view=relief');
  const before = await hook(page);
  const start = await lookOf(page);
  const from = await centre(page, '#lamp');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 300, from.y + 120, { steps: 8 });
  await page.mouse.up();
  const moved = await lookOf(page);
  expect(moved.u).toBeGreaterThan(start.u + 0.2);
  expect(moved.v).toBeGreaterThan(start.v + 0.1);
  await expect(page).toHaveURL(/lamp=\d+\.\d+/);
  const after = await hook(page);
  expect(after.revision).toBe(before.revision);
  expect(after.past).toBe(0);
  expect(after.file).not.toBe(before.file);
  // The arrow keys move it as well, and it cannot leave the sheet.
  await page.locator('#lamp').focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowUp');
  expect((await lookOf(page)).v).toBe(0);
  await expect(page).toHaveURL(/lamp=\d+\.0(&|$)/);
  const here = await lookOf(page);
  const again = await context.newPage();
  await again.goto(page.url());
  await settled(again);
  const there = await lookOf(again);
  expect(there.view).toBe('relief');
  expect(there.u).toBeCloseTo(here.u, 2);
  expect(there.v).toBeCloseTo(here.v, 2);
  expect((await hook(again)).field).toBe(before.field);
});

test('a relief exports as the file the panel describes, and a browser can draw it', async ({ page }) => {
  await openPage(page, '&view=relief&plate=caldera');
  await page.locator('#export').click();
  const note = page.locator('.row').first().locator('small');
  await expect(note).toContainText(/KB for \d+ outlines, each reused for its sheet, shadow and lit edge, which is [\d.]+ KB (more|less) than the lines alone/);
  const saved = await download(page, () => page.locator('.row').first().click());
  const text = saved.bytes.toString('utf8');
  expect(saved.name).toBe('caldera-relief.svg');
  expect(text).toBe((await hook(page)).file);
  const outlines = text.match(/<path id="s\d+"/g)?.length ?? 0;
  expect(Number((await note.textContent())?.match(/for (\d+) outlines/)?.[1])).toBe(outlines);
  expect(Number((await note.textContent())?.match(/^([\d.]+) KB/)?.[1])).toBeCloseTo(text.length / 1024, 1);
  // Six references to each outline: four shadow copies, the lit edge and the sheet.
  expect(text.match(/<use /g)?.length).toBe(outlines * 6);
  const drawn = await page.evaluate(async (svg) => {
    const image = new Image();
    image.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 140;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.drawImage(image, 0, 0, 200, 140);
    const { data } = ctx.getImageData(0, 0, 200, 140);
    const colours = new Set<number>();
    for (let k = 0; k < data.length; k += 4) colours.add((data[k] << 16) | (data[k + 1] << 8) | data[k + 2]);
    return { width: image.naturalWidth, colours: colours.size };
  }, text);
  expect(drawn.width).toBeGreaterThan(100);
  expect(drawn.colours).toBeGreaterThan(20);
  // The ready sizes follow the view.
  const print = await download(page, () => page.locator('.row', { hasText: 'Phone wallpaper' }).click());
  expect(print.name).toBe('caldera-relief-phone.png');
  expect(print.bytes.readUInt32BE(16)).toBe(1290);
});

test('a press between two close marks takes the nearer one', async ({ page }) => {
  await openPage(page);
  // On Quiet ridge a point of the long crest sits almost under the summit.
  const summit = await centre(page, '.mark[data-primary]');
  const marks = await page.locator('.mark').evaluateAll((all) =>
    all.map((el) => {
      const box = el.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, label: el.getAttribute('aria-label') ?? '' };
    }),
  );
  const near = marks
    .filter((m) => Math.hypot(m.x - summit.x, m.y - summit.y) > 1)
    .sort((a, b) => Math.hypot(a.x - summit.x, a.y - summit.y) - Math.hypot(b.x - summit.x, b.y - summit.y))[0];
  const apart = Math.hypot(near.x - summit.x, near.y - summit.y);
  expect(apart).toBeLessThan(44);
  const toward = (from: { x: number; y: number }, to: { x: number; y: number }, by: number) => ({
    x: from.x + ((to.x - from.x) / apart) * by,
    y: from.y + ((to.y - from.y) / apart) * by,
  });
  // Just on the point's side of the middle, inside both press areas.
  const onPoint = toward(near, summit, apart * 0.4);
  await page.mouse.move(onPoint.x, onPoint.y);
  await expect(page.locator('.mark[data-near]')).toHaveAttribute('aria-label', near.label);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('.mark[data-selected]')).toHaveAttribute('aria-label', near.label);
  await page.keyboard.press('Escape');
  const onSummit = toward(summit, near, apart * 0.4);
  await page.mouse.move(onSummit.x, onSummit.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('.mark[data-selected]')).toHaveAttribute('data-primary', '');
  // And the point can be dragged away without the summit coming along.
  const before = JSON.parse((await hook(page)).field)[0] as { id: string; x?: number; points?: { x: number }[] }[];
  await page.keyboard.press('Escape');
  await page.mouse.move(onPoint.x, onPoint.y);
  await page.mouse.down();
  await page.mouse.move(onPoint.x - 60, onPoint.y - 40, { steps: 6 });
  await page.waitForTimeout(160);
  await page.mouse.up();
  await settled(page);
  const after = JSON.parse((await hook(page)).field)[0] as typeof before;
  expect(after.find((s) => s.id === 'summit')?.x).toBe(before.find((s) => s.id === 'summit')?.x);
  expect(JSON.stringify(after.find((s) => s.id === 'crest'))).not.toBe(JSON.stringify(before.find((s) => s.id === 'crest')));
});

test('the question mark lists the keys, and Escape puts it away', async ({ page }) => {
  await openPage(page);
  await page.keyboard.press('?');
  const list = page.getByRole('dialog', { name: 'Keyboard' });
  await expect(list).toBeVisible();
  await expect(list.locator('.keys-list > div')).toHaveCount(10);
  // L is on the list, and it does nothing while the list is open.
  await page.keyboard.press('l');
  await expect(page.locator('#stage')).toHaveAttribute('data-view', 'lines');
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await page.locator('#keys-open').click();
  await expect(list).toBeVisible();
});

/* The page under the stage */

test('the exploded figure is drawn from the plate on the stage and follows it', async ({ page }) => {
  await openPage(page);
  await page.locator('#made').scrollIntoViewIfNeeded();
  await expect(page.locator('#made')).toHaveAttribute('data-ready', '', { timeout: 15_000 });
  const stats = () =>
    page.evaluate(() => {
      const { store } = (window as unknown as { __contour: { store: any } }).__contour;
      const s = store.getState().geometry.stats;
      return { kept: s.outputVertices as number, extracted: s.sourceVertices as number };
    });
  const group = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, ',');
  const first = await stats();
  await expect(page.locator('#made-note-2')).toContainText(`${group(first.extracted)} nodes`);
  await expect(page.locator('#made-note-3')).toContainText(`${group(first.kept)} nodes are kept`);
  // A step can be chosen with the pointer or the arrow keys.
  await page.locator('.step', { hasText: 'Field' }).click();
  await expect(page.locator('.step', { hasText: 'Field' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.step', { hasText: 'Extracted lines' })).toBeFocused();
  await expect(page.locator('.step[aria-pressed=true]')).toHaveCount(1);
  // Another plate on the stage, and the figure is of that plate.
  await page.locator('.plate', { hasText: 'Interference' }).click();
  await settled(page);
  const second = await stats();
  expect(second.kept).not.toBe(first.kept);
  // The figure waits until it is looked at again before it redraws.
  await page.locator('#made').scrollIntoViewIfNeeded();
  await expect(page.locator('#made-note-3')).toContainText(`${group(second.kept)} nodes are kept`, { timeout: 10_000 });
  await expect(page.locator('#made-note-4')).toContainText('no tint');
});

test('the line figure shows the measured scene, and its numbers are the ones quoted', async ({ page }) => {
  await openPage(page);
  await page.locator('#line').scrollIntoViewIfNeeded();
  await expect(page.locator('#line')).toHaveAttribute('data-ready', '', { timeout: 15_000 });
  await expect(page.locator('#line-bound')).toHaveText('0.221 units');
  const count = page.locator('#line-count');
  await expect(count).toContainText(/\d+ nodes? before and \d+ after in this window/);
  const read = async () => {
    const [, before, after] = (await count.textContent())?.match(/(\d+) nodes? before and (\d+) after/) ?? [];
    return { before: Number(before), after: Number(after) };
  };
  const here = await read();
  expect(here.before).toBeGreaterThan(here.after);
  const text = await count.textContent();
  await page.locator('#line-at').focus();
  for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
  await expect(count).not.toHaveText(text ?? '');
  // The figures beside it are the claims. test/replay.test.ts works them out again from the same scene.
  await expect(page.locator('.measure-figure').first()).toHaveText(/12,104\s*to\s*1,771/);
});

test('a catalogue card puts its plate on the stage', async ({ page }) => {
  await openPage(page);
  await page.locator('#catalogue').scrollIntoViewIfNeeded();
  const cards = page.locator('.card');
  await expect(cards).toHaveCount(6);
  await expect(page.locator('.card[data-ready]')).toHaveCount(6, { timeout: 15_000 });
  await expect(page.locator('.card[data-current]')).toContainText('Quiet ridge');
  await cards.filter({ hasText: 'Archipelago' }).click();
  await settled(page);
  await expect(page.locator('#legend-name')).toHaveText('Archipelago');
  await expect(page.locator('.card[data-current]')).toContainText('Archipelago');
  await expect(page.locator('#stage')).toBeInViewport();
});

test('the film waits behind a still until it is asked to play', async ({ page }) => {
  await openPage(page);
  const film = page.locator('#film');
  expect(await film.evaluate((video: HTMLVideoElement) => ({ preload: video.preload, controls: video.controls, poster: video.poster }))).toEqual({ preload: 'none', controls: false, poster: '' });
  await page.locator('#film-frame').scrollIntoViewIfNeeded();
  await expect.poll(() => film.evaluate((video: HTMLVideoElement) => video.poster)).toContain('studio.png');
  await page.getByRole('button', { name: 'Play the walkthrough' }).click();
  await expect(film).toHaveJSProperty('controls', true);
  await expect(page.locator('#film-play')).toBeHidden();
});

test('the link card and the tab icon are named, and both files are served', async ({ page, request }) => {
  await openPage(page);
  const meta = (name: string) => page.locator(`meta[property="${name}"], meta[name="${name}"]`).getAttribute('content');
  expect(await meta('og:title')).toBe('Contour');
  expect(await meta('og:description')).toBe('Move a point and the lines follow');
  expect(await meta('og:url')).toBe('https://www.qendrimbeka.com/projects/contour/');
  expect(await meta('og:image')).toBe('https://www.qendrimbeka.com/projects/contour/og.png');
  expect(await meta('twitter:card')).toBe('summary_large_image');
  expect(await meta('twitter:image')).toBe('https://www.qendrimbeka.com/projects/contour/og.png');
  const card = await request.get('og.png');
  expect(card.ok()).toBe(true);
  const bytes = await card.body();
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1200, 630]);
  const icon = await page.locator('link[rel=icon]').getAttribute('href');
  expect((await request.get(icon ?? '')).ok()).toBe(true);
});

test('the page arrives in order within 700 ms, and not at all under reduced motion', async ({ page, browser }) => {
  await page.goto(PAGE_URL);
  const timing = await page.evaluate(() =>
    document.getAnimations().flatMap((animation) => {
      const effect = animation.effect as KeyframeEffect | null;
      const t = effect?.getComputedTiming();
      return (animation as CSSAnimation).animationName === 'arrive' && t ? [Number(t.delay) + Number(t.duration)] : [];
    }),
  );
  expect(timing.length).toBeGreaterThanOrEqual(3);
  expect(Math.max(...timing)).toBeLessThanOrEqual(700);
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const still = await context.newPage();
  await still.goto(PAGE_URL);
  expect(await still.evaluate(() => document.getAnimations().length)).toBe(0);
  await still.locator('.band').nth(2).scrollIntoViewIfNeeded();
  expect(await still.evaluate(() => document.getAnimations().length)).toBe(0);
  // With motion, a section is never hidden while it waits to be reached.
  expect(await page.locator('.band').last().evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await context.close();
});

for (const width of [1440, 1280, 1024, 768, 390, 320]) {
  test(`at ${width} px the page under the stage has no sideways scroll, in lines and in relief`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${PAGE_URL}&view=relief`);
    await page.waitForSelector('#legend-live[data-state=final]', { state: 'attached', timeout: 15_000 });
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 600) await page.evaluate((to) => window.scrollTo(0, to), y);
    await expect(page.locator('#made')).toHaveAttribute('data-ready', '', { timeout: 15_000 });
    const wide = await page.evaluate(() =>
      // The plate drawer scrolls inside itself by design. Nothing else may reach past the edge.
      [...document.querySelectorAll('main *')]
        .filter((el) => !el.closest('.plates') && el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .map((el) => String(el.className || el.tagName))
        .slice(0, 5),
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(wide).toEqual([]);
    const tray = await page.locator('#tray').boundingBox();
    const stage = await page.locator('#stage').boundingBox();
    expect((tray?.x ?? 0) >= (stage?.x ?? 0)).toBe(true);
    await context.close();
  });
}

test('automated accessibility scan of the relief and the page under the stage finds nothing serious', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await openPage(page, '&view=relief');
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 600) await page.evaluate((to) => window.scrollTo(0, to), y);
  await expect(page.locator('#made')).toHaveAttribute('data-ready', '', { timeout: 15_000 });
  await expect(page.locator('.card[data-ready]')).toHaveCount(6, { timeout: 15_000 });
  for (const enter of [async () => undefined, async () => page.keyboard.press('?')]) {
    await enter();
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
  }
  await context.close();
});
