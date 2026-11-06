/**
 * Renders exported SVG with independent renderers and compares the pixels, then
 * loads it in an independent vector model.
 *
 * Render compatibility and path editing compatibility are different claims, so
 * they are reported separately. A seeded control moves one path. If the comparison
 * cannot see that, its "no difference" means nothing. This failed in an earlier
 * version, which compared ink amount: WebKit's antialiasing alone outweighed a
 * moved path. Comparing where ink lies does not have that problem.
 *
 *   pnpm exec tsx scripts/render-compat.ts
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium, firefox, webkit, type BrowserType } from '@playwright/test';
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import { PRESETS } from '../src/core/presets';

const WIDTH = 1200;
const INK_THRESHOLD = 0.02;
const CONTROL_SHIFT_UNITS = 4;
const PAPER = '#ffffff';
const require = createRequire(import.meta.url);

interface Raster {
  width: number;
  height: number;
  data: Uint8Array;
}

function decode(png: Buffer): Raster {
  const image = PNG.sync.read(png);
  return { width: image.width, height: image.height, data: image.data };
}

async function renderBrowser(type: BrowserType, svgs: Record<string, string>) {
  const browser = await type.launch();
  const version = browser.version();
  const out: Record<string, Raster> = {};
  for (const [name, svg] of Object.entries(svgs)) {
    const ratio = Number(/viewBox="0 0 (\d+) /.exec(svg)?.[1] ?? 0);
    const height = Math.round(
      (WIDTH * Number(/height="([\d.]+)"/.exec(svg)?.[1])) / Number(/width="([\d.]+)"/.exec(svg)?.[1]),
    );
    if (Number.isNaN(ratio)) throw new Error('No viewBox.');
    const page = await browser.newPage({ viewport: { width: WIDTH, height } });
    await page.setContent(
      `<!doctype html><html style="margin:0;background:${PAPER}"><body style="margin:0"><img id="a" style="display:block;width:${WIDTH}px;height:${height}px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`,
    );
    await page.waitForFunction(() => (document.getElementById('a') as HTMLImageElement).complete);
    out[name] = decode(await page.screenshot({ type: 'png' }));
    await page.close();
  }
  await browser.close();
  return { version, out };
}

function renderResvg(svgs: Record<string, string>) {
  const out: Record<string, Raster> = {};
  for (const [name, svg] of Object.entries(svgs)) {
    const png = new Resvg(svg, { background: PAPER, fitTo: { mode: 'width', value: WIDTH } })
      .render()
      .asPng();
    out[name] = decode(Buffer.from(png));
  }
  return out;
}

/** Pixels with any meaningful ink. Antialiasing and gamma change darkness, not place. */
function inkMask(r: Raster): Uint8Array {
  const mask = new Uint8Array(r.width * r.height);
  for (let i = 0; i < mask.length; i++) {
    const dark = 1 - (r.data[i * 4] + r.data[i * 4 + 1] + r.data[i * 4 + 2]) / (3 * 255);
    if (dark > INK_THRESHOLD) mask[i] = 1;
  }
  return mask;
}

/** Distance in px from each pixel to the nearest ink, by the two pass 3-4 chamfer. */
function distanceField(mask: Uint8Array, w: number, h: number): Float64Array {
  const d = new Float64Array(mask.length);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : 1e9;
  const relax = (i: number, j: number, cost: number) => {
    if (d[j] + cost < d[i]) d[i] = d[j] + cost;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) relax(i, i - 1, 3);
      if (y > 0) relax(i, i - w, 3);
      if (x > 0 && y > 0) relax(i, i - w - 1, 4);
      if (x < w - 1 && y > 0) relax(i, i - w + 1, 4);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) relax(i, i + 1, 3);
      if (y < h - 1) relax(i, i + w, 3);
      if (x < w - 1 && y < h - 1) relax(i, i + w + 1, 4);
      if (x > 0 && y < h - 1) relax(i, i + w - 1, 4);
    }
  }
  return d;
}

function oneWay(from: Uint8Array, to: Float64Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < from.length; i++) if (from[i]) out.push(to[i] / 3);
  return out.sort((p, q) => p - q);
}

/** How far any line in one render is from a line in the other, in pixels. */
function compare(a: Raster, b: Raster) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`Sizes differ: ${a.width}x${a.height} and ${b.width}x${b.height}`);
  }
  const ma = inkMask(a);
  const mb = inkMask(b);
  const ab = oneWay(ma, distanceField(mb, a.width, a.height));
  const ba = oneWay(mb, distanceField(ma, a.width, a.height));
  const at = (values: number[], p: number) => values[Math.floor((values.length - 1) * p)];
  return {
    maxPx: Math.max(at(ab, 1), at(ba, 1)),
    p999Px: Math.max(at(ab, 0.999), at(ba, 0.999)),
    inkPixels: [ab.length, ba.length],
  };
}

/** Moves the path with the most data down. Stands in for a renderer bug. */
function shifted(svg: string): string {
  const paths = [...svg.matchAll(/<path d="M([-\d.]+) ([-\d.]+)/g)];
  const longest = paths.reduce((best, m) => {
    const end = svg.indexOf('"/>', m.index);
    const size = end - (m.index as number);
    return size > best.size ? { m, size } : best;
  }, { m: paths[0], size: 0 });
  const { m } = longest;
  const from = `<path d="M${m[1]} ${m[2]}`;
  return svg.replace(from, `<path transform="translate(0 ${CONTROL_SHIFT_UNITS})" d="M${m[1]} ${m[2]}`);
}

async function vectorModel(svgs: Record<string, string>) {
  const script = require.resolve('paper/dist/paper-core.min.js');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<canvas id="c" width="10" height="10"></canvas>');
  await page.addScriptTag({ path: script });
  const out: Record<string, unknown> = {};
  for (const [name, svg] of Object.entries(svgs)) {
    out[name] = await page.evaluate((text) => {
      const paper = (window as any).paper;
      paper.setup(document.getElementById('c'));
      const item = paper.project.importSVG(text, { expandShapes: false });
      const paths = item.getItems({ class: paper.Path });
      let segments = 0;
      let closed = 0;
      for (const p of paths) {
        segments += p.segments.length;
        if (p.closed) closed++;
      }
      // An edit that a designer would do: move one node, then write the file back.
      paths[0].segments[0].point = paths[0].segments[0].point.add([3, 3]);
      const written = paper.project.exportSVG({ asString: true }).length;
      paper.project.clear();
      return { pathItems: paths.length, segments, closed, nodeEditWorked: true, writtenBytes: written };
    }, svg);
  }
  await browser.close();
  return out;
}

const svgs = Object.fromEntries(
  PRESETS.map((p) => [p.id, readFileSync(join('artwork', p.id, `${p.id}.svg`), 'utf8')]),
);

const expected = Object.fromEntries(
  Object.entries(svgs).map(([name, svg]) => {
    const paths = (svg.match(/<path /g) ?? []).length;
    return [name, { paths, closed: (svg.match(/z"/g) ?? []).length }];
  }),
);

const xml = Object.keys(svgs).map((name) => {
  execFileSync('xmllint', ['--noout', join('artwork', name, `${name}.svg`)]);
  return name;
});

const reference = await renderBrowser(chromium, svgs);
const ffx = await renderBrowser(firefox, svgs);
const wbk = await renderBrowser(webkit, svgs);
const rsv = renderResvg(svgs);
const control = await renderBrowser(
  chromium,
  Object.fromEntries(Object.entries(svgs).map(([k, v]) => [k, shifted(v)])),
);

const rows = Object.keys(svgs).map((name) => ({
  scene: name,
  firefox: compare(reference.out[name], ffx.out[name]),
  webkit: compare(reference.out[name], wbk.out[name]),
  resvg: compare(reference.out[name], rsv[name]),
  seededControl: compare(reference.out[name], control.out[name]),
}));

const editing = await vectorModel(svgs);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const result = {
  commit,
  date: new Date().toISOString(),
  renderWidth: WIDTH,
  reference: `chromium ${reference.version}`,
  renderers: { firefox: ffx.version, webkit: wbk.version, resvg: '@resvg/resvg-js 2.6.2' },
  metric: `Pixels with ink above ${INK_THRESHOLD} are compared by distance to the nearest ink in the other render, both ways, using a 3-4 chamfer. It resolves whole pixels and cannot see subpixel differences.`,
  control: `The longest path moved down ${CONTROL_SHIFT_UNITS} units. The comparison must report more than any real renderer pair.`,
  xmlWellFormed: xml,
  render: rows,
  vectorModel: {
    tool: `paper.js ${require('paper/package.json').version}`,
    note: 'A vector scripting library with its own path model. It is not a desktop editor.',
    expected,
    measured: editing,
  },
};
mkdirSync('results/compat', { recursive: true });
writeFileSync('results/compat/latest.json', `${JSON.stringify(result, null, 2)}\n`);
for (const row of rows) {
  console.log(
    row.scene.padEnd(20),
    'firefox', row.firefox.maxPx.toFixed(2),
    'webkit', row.webkit.maxPx.toFixed(2),
    'resvg', row.resvg.maxPx.toFixed(2),
    'control', row.seededControl.maxPx.toFixed(2),
  );
}
console.log(JSON.stringify(editing), JSON.stringify(expected));
for (const row of rows) {
  const largest = Math.max(row.firefox.maxPx, row.webkit.maxPx, row.resvg.maxPx);
  if (row.seededControl.maxPx <= largest) {
    console.error(`${row.scene}: the seeded control was not larger than real differences.`);
    process.exitCode = 1;
  }
}
