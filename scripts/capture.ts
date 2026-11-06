/**
 * Captures the screenshots used in the docs from the running app. Needs `pnpm dev`.
 *
 *   pnpm exec tsx scripts/capture.ts
 */

import { chromium, type Page } from '@playwright/test';
import { PRESETS } from '../src/core/presets';
import { emptyScene, type Scene } from '../src/core/scene';

const URL = process.env.CONTOUR_URL ?? 'http://localhost:5173/?hook=1';
const OUT = 'docs/media';
const browser = await chromium.launch();

async function shot(
  name: string,
  size: { width: number; height: number; scale?: number },
  act?: (page: Page) => Promise<void>,
  options: { settle: number } = { settle: 250 },
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.scale ?? 2,
  });
  const page = await context.newPage();
  await page.goto(URL);
  await page.waitForSelector('.status-state[data-state=final]');
  if (act) await act(page);
  await page.waitForTimeout(options.settle);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await context.close();
}

async function load(page: Page, scene: Scene): Promise<void> {
  await page.locator('input[type=file]').setInputFiles({
    name: 'scene.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(scene)),
  });
  await page.waitForFunction(() => document.querySelector('.notice')?.textContent?.includes('Opened'));
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await page.waitForSelector('.status-state[data-state=final]');
}

const desk = { width: 1440, height: 900 };
const exportPanel = async (page: Page) => {
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await page.waitForSelector('.report dl');
  await page.waitForTimeout(400);
};

await shot('editor', desk, async (page) => {
  await load(page, PRESETS[1].scene);
  await page.locator('.source-row').nth(1).click();
});
await shot('export', desk, exportPanel);
await shot('nodes', desk, async (page) => {
  await page.keyboard.press('n');
  await page.keyboard.press('g');
});
await shot('empty', desk, async (page) => {
  await load(page, emptyScene());
});
await shot('error', desk, async (page) => {
  await page.locator('input[type=file]').setInputFiles({
    name: 'broken.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{ "format": "contour-scene", "version": 1, "seed": -4 }'),
  });
  await page.waitForSelector('.notice[data-kind=error]');
});
await shot('refining', desk, async (page) => {
  await load(page, {
    ...PRESETS[2].scene,
    levels: { base: -1.2, spacing: 0.02, count: 120 },
    export: { ...PRESETS[2].scene.export, resolution: 2048 },
  });
  await page.getByRole('spinbutton', { name: 'Lines' }).fill('100');
}, { settle: 60 });
await shot('phone', { width: 390, height: 800 });
await shot('phone-export', { width: 390, height: 800 }, exportPanel);
await shot('narrow-320', { width: 320, height: 640 });
await shot('tablet-768', { width: 768, height: 1024 }, exportPanel);
await browser.close();
