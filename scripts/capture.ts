/**
 * Captures the screenshots used in the docs from the running app. Needs `pnpm dev`.
 *
 *   pnpm exec tsx scripts/capture.ts
 */

import { chromium, type Page } from '@playwright/test';
import { PRESETS } from '../src/core/presets';
import { type Scene } from '../src/core/scene';

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

await shot('cover', { width: 1280, height: 640 }, async (page) => {
  await load(page, PRESETS[2].scene);
  await page.locator('.source-row').nth(5).click();
});
await browser.close();
