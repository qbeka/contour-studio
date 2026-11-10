/**
 * Draws the link card: the name, the one sentence, and the first plate as a paper
 * relief, written by the same relief writer the export uses.
 *
 *   pnpm exec tsx scripts/og.ts
 */

import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { computeGeometry } from '../src/core/pipeline';
import { PLATES, frameFor } from '../src/core/plates';
import { reliefFile } from '../src/core/relief';

const WIDTH = 1200;
const HEIGHT = 630;
const ART = { width: WIDTH, height: 356 };

const plate = PLATES[0];
const clip = frameFor(plate, plate.scene, ART.width / ART.height, true);
const scene = { ...plate.scene, clip, export: { ...plate.scene.export, outputWidth: ART.width } };
const art = reliefFile(computeGeometry(scene, { quality: 'final', resolution: 1024 }), scene, { u: 0.16, v: 0.1 });
const paper = scene.style.background ?? '#ffffff';

const font = (file: string) => readFileSync(`public/fonts/${file}`).toString('base64');
const html = `<!doctype html>
<style>
  @font-face { font-family: 'Geist Serif'; src: url(data:font/woff2;base64,${font('GeistSerif-Regular.woff2')}) format('woff2'); }
  html, body { margin: 0; }
  body { position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: ${paper}; color: #111511; font-family: 'Geist Serif', serif; -webkit-font-smoothing: antialiased; }
  h1 { position: absolute; left: 72px; top: 44px; margin: 0; font-weight: 400; font-size: 148px; line-height: 150px; letter-spacing: -0.035em; }
  p { position: absolute; left: 78px; top: 200px; margin: 0; font-size: 50px; line-height: 60px; letter-spacing: -0.015em; color: #2f352f; }
  .art { position: absolute; left: 0; bottom: 0; width: ${ART.width}px; height: ${ART.height}px; }
  .art svg { display: block; }
</style>
<div class="art">${art.svg}</div>
<h1>Contour</h1>
<p>Move a point and the lines follow</p>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: 'docs/media/og.png' });
await browser.close();
console.log(`docs/media/og.png, ${WIDTH} by ${HEIGHT}, ${art.sheets} sheets of card`);
