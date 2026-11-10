/**
 * Captures the images used in the README and on the project page, from the built
 * site. Build it and serve `dist-site` first, then point this at it:
 *
 *   pnpm build:site && pnpm exec vite preview --outDir dist-site --port 5183
 *   CONTOUR_URL=http://localhost:5183/ pnpm exec tsx scripts/capture.ts
 */

import { readFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from '@playwright/test';
import { computeGeometry } from '../src/core/pipeline';
import { PLATES, frameFor } from '../src/core/plates';
import { toSvg } from '../src/core/svg';

const BASE = process.env.CONTOUR_URL ?? 'http://localhost:5183/';
const OUT = 'docs/media';
const browser: Browser = await chromium.launch();

async function view(width: number, height: number): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
    acceptDownloads: true,
  });
  return context.newPage();
}

const settled = (page: Page) => page.waitForSelector('#legend-live[data-state=final]');

/** The page as it opens. Also the poster for the film on the page. */
async function cover(): Promise<void> {
  const page = await view(1280, 800);
  await page.goto(`${BASE}?hook=1`);
  await settled(page);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/cover.png` });
  await page.context().close();
}

/** The page with a plate shown as a paper relief, its lamp moved off the corner. */
async function relief(): Promise<void> {
  const page = await view(1280, 800);
  await page.goto(`${BASE}?hook=1&plate=terraces&view=relief&lamp=24.30`);
  await settled(page);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/relief.png` });
  await page.context().close();
}

/** The studio on a plate, with a source selected. */
async function studio(): Promise<void> {
  const page = await view(1280, 800);
  await page.goto(`${BASE}app/?hook=1`);
  await page.waitForSelector('.status-state[data-state=final]');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.locator('.starter', { hasText: 'Caldera' }).click();
  await page.waitForSelector('.status-state[data-state=final]');
  await page.locator('.source-row', { hasText: 'Inner cone' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/studio.png` });
  await page.context().close();
}

const sheetStyle = `
  @font-face { font-family: 'Geist Serif'; src: url('${BASE}fonts/GeistSerif-Regular.woff2') format('woff2'); }
  @font-face { font-family: 'Geist'; src: url('${BASE}fonts/Geist-Regular.woff2') format('woff2'); }
  body { margin: 0; background: #fff; color: #111511; font: 400 13px/18px 'Geist', sans-serif; -webkit-font-smoothing: antialiased; }
  figure { margin: 0; }
  figcaption { margin-top: 8px; color: #535753; }
  figcaption b { font: 400 17px/22px 'Geist Serif', serif; color: #111511; margin-right: 8px; }
  img { display: block; width: 100%; box-shadow: 0 0 0 1px #1115112e; }
`;

/** A blank page on the site's own origin, so that its fonts load. */
async function blank(page: Page, html: string): Promise<void> {
  await page.goto(`${BASE}fonts/LICENSE-GEIST.txt`);
  await page.setContent(`<!doctype html><style>${sheetStyle}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
}

/** The six plates, each written by the same SVG writer the export uses. */
async function plates(): Promise<void> {
  const figures = PLATES.map((plate) => {
    const clip = frameFor(plate, plate.scene, 1.6, true);
    // Weights are set for this size on the sheet, as the page does on its stage.
    const perPx = clip.width / 400;
    const { style } = plate.scene;
    const scene = {
      ...plate.scene,
      clip,
      style: { ...style, strokeWidth: style.strokeWidth * perPx * 0.8, indexWidth: style.indexWidth * perPx * 0.8 },
    };
    const svg = toSvg(computeGeometry(scene, { quality: 'final' }), scene);
    return `<figure><img src="data:image/svg+xml,${encodeURIComponent(svg)}" alt=""><figcaption><b>${plate.name}</b>Plate ${plate.numeral}</figcaption></figure>`;
  });
  const page = await view(1280, 720);
  await blank(page, `<main style="display:grid;grid-template-columns:repeat(3,1fr);gap:28px 20px;padding:24px">${figures.join('')}</main>`);
  await page.locator('main').screenshot({ path: `${OUT}/plates.png` });
  await page.context().close();
}

/** The three ready sizes, exported from the page and laid side by side. */
async function prints(): Promise<void> {
  const page = await view(1280, 800);
  await page.goto(`${BASE}?hook=1&plate=caldera`);
  await settled(page);
  await page.locator('#export').click();
  const files: Record<string, string> = {};
  for (const label of ['Desktop wallpaper', 'Phone wallpaper', 'Poster']) {
    const pending = page.waitForEvent('download');
    await page.locator('.row', { hasText: label }).click();
    const file = await pending;
    files[label] = `data:image/png;base64,${readFileSync(await file.path()).toString('base64')}`;
  }
  const figure = (label: string, caption: string, width: number) =>
    `<figure style="width:${width}px"><img src="${files[label]}" alt=""><figcaption>${caption}</figcaption></figure>`;
  await blank(
    page,
    `<main style="display:flex;align-items:flex-end;gap:24px;padding:24px;width:max-content">
      ${figure('Poster', 'Poster, 3000 by 4000', 330)}
      ${figure('Phone wallpaper', 'Phone, 1290 by 2796', 203)}
      ${figure('Desktop wallpaper', 'Desktop, 3840 by 2160', 640)}
    </main>`,
  );
  await page.locator('main').screenshot({ path: `${OUT}/prints.png` });
  await page.context().close();
}

await cover();
await relief();
await studio();
await plates();
await prints();
await browser.close();
