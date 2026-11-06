import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { computeGeometry } from '../src/core/pipeline';
import { emptyScene, parseScene, type Scene } from '../src/core/scene';
import { toSvg } from '../src/core/svg';
import { PRESETS } from '../src/core/presets';
import { parseSvgPaths, sampledHausdorff } from '../src/core/verify';
import { HOOK_URL, loadScene, open, readHook, stagePoint, waitForFinal } from './support';

/** What the app exported must equal a direct run of the core on the same scene. */
function canonicalSvg(sceneJson: string): string {
  const scene = JSON.parse(sceneJson) as Scene;
  return toSvg(computeGeometry(scene, { quality: 'final' }), scene);
}

async function downloadText(page: import('@playwright/test').Page, click: () => Promise<void>) {
  const pending = page.waitForEvent('download');
  await click();
  const download = await pending;
  return { name: download.suggestedFilename(), text: readFileSync(await download.path(), 'utf8') };
}

test('the whole workflow from an empty sheet @cross', async ({ page }) => {
  await open(page);

  // Start from nothing.
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('button', { name: /Empty sheet/ }).click();
  await expect(page.getByRole('heading', { name: 'An empty sheet' })).toBeVisible();

  // Place a peak with the pointer.
  await page.getByRole('button', { name: 'Place a peak', exact: true }).click();
  await expect(page.locator('.stage-hint')).toContainText('Click the sheet');
  const place = await stagePoint(page, 500, 400);
  await page.mouse.click(place.x, place.y);
  await expect(page.locator('.source-row')).toHaveCount(1);
  await waitForFinal(page);

  // Shape it with the keyboard and the inspector.
  await page.keyboard.press('Shift+ArrowRight');
  await page.getByLabel('Height', { exact: true }).fill('0.9');
  await page.getByLabel('Reach', { exact: true }).fill('320');
  await waitForFinal(page);

  // Drag it with the pointer.
  const before = JSON.parse((await readHook(page)).sceneJson).sources[0];
  const from = await stagePoint(page, before.x, before.y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 90, from.y + 30, { steps: 6 });
  await page.mouse.up();
  await waitForFinal(page);
  const moved = JSON.parse((await readHook(page)).sceneJson).sources[0];
  expect(moved.x).toBeGreaterThan(before.x + 10);

  // Add a ridge with clicks and Enter.
  await page.keyboard.press('r');
  for (const [x, y] of [[200, 600], [500, 500], [900, 640]]) {
    const p = await stagePoint(page, x, y);
    await page.mouse.click(p.x, p.y);
  }
  await page.keyboard.press('Enter');
  await expect(page.locator('.source-row')).toHaveCount(2);
  await waitForFinal(page);

  // Save, then change the scene, then reopen the file.
  const saved = await downloadText(page, () =>
    page.getByRole('button', { name: 'Save', exact: true }).click(),
  );
  expect(saved.name).toMatch(/\.contour\.json$/);
  const parsed = parseScene(saved.text);
  expect(parsed.ok).toBe(true);
  await page.getByRole('spinbutton', { name: 'Lines' }).fill('3');
  await waitForFinal(page);
  await page.locator('input[type=file]').setInputFiles({
    name: 'saved.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(saved.text),
  });
  await expect(page.locator('.notice')).toContainText('Opened saved.contour.json');
  await waitForFinal(page);

  // Export, and check the file against the core.
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  const svg = await downloadText(page, () =>
    page.getByRole('button', { name: 'Download SVG' }).click(),
  );
  expect(svg.name).toMatch(/\.svg$/);
  const { sceneJson } = await readHook(page);
  expect(svg.text).toBe(canonicalSvg(sceneJson));
  expect(parseSvgPaths(svg.text).length).toBeGreaterThan(0);

  // A clean page, with none of the app loaded, renders the file.
  await page.goto('about:blank');
  await page.setContent(svg.text);
  const box = await page.locator('svg').boundingBox();
  expect(box?.width).toBe(1200);
  expect(await page.locator('svg path').count()).toBeGreaterThan(0);
});

test('list and canvas share one selection', async ({ page }) => {
  await open(page);
  await page.locator('.source-row', { hasText: 'Left summit' }).click();
  await expect(page.getByRole('button', { name: /^Left summit, at/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: /^Valley floor, at/ }).click({ force: true });
  await expect(page.locator('.source-row', { hasText: 'Valley floor' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('#source-title')).toHaveText('Peak');
});

test('a drag is one undo step, and undo returns the exact scene', async ({ page }) => {
  await open(page);
  const start = await readHook(page);
  const source = JSON.parse(start.sceneJson).sources[1];
  const from = await stagePoint(page, source.x, source.y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(from.x + i * 5, from.y - i * 2);
  await page.mouse.up();
  await waitForFinal(page);
  const after = await readHook(page);
  expect(after.past).toBe(start.past + 1);
  expect(after.sceneJson).not.toBe(start.sceneJson);
  await page.keyboard.press('ControlOrMeta+z');
  await waitForFinal(page);
  expect((await readHook(page)).sceneJson).toBe(start.sceneJson);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await waitForFinal(page);
  expect((await readHook(page)).sceneJson).toBe(after.sceneJson);
});

test('rapid undo and redo end on geometry for the current scene', async ({ page }) => {
  await open(page);
  const reach = page.getByLabel('Reach', { exact: true });
  await page.locator('.source-row').first().click();
  for (const value of ['150', '170', '190']) {
    await reach.fill(value);
    await page.waitForTimeout(800); // Past the merge window, so each is a step.
  }
  await page.locator('.stage').click({ position: { x: 4, y: 4 } });
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press(i % 3 === 2 ? 'ControlOrMeta+Shift+z' : 'ControlOrMeta+z');
  }
  await waitForFinal(page);
  const hook = await readHook(page);
  expect(hook.shownRevision).toBe(hook.revision);
  expect(hook.quality).toBe('final');
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  const svg = await downloadText(page, () =>
    page.getByRole('button', { name: 'Download SVG' }).click(),
  );
  expect(svg.text).toBe(canonicalSvg(hook.sceneJson));
});

test('a heavy final is superseded by a newer edit', async ({ page }) => {
  await open(page);
  // Make final work slow enough to overlap with the next edits.
  const heavy: Scene = {
    ...PRESETS[2].scene,
    levels: { base: -1.2, spacing: 0.02, count: 120 },
    export: { ...PRESETS[2].scene.export, resolution: 2048 },
  };
  await loadScene(page, heavy);
  const lines = page.getByRole('spinbutton', { name: 'Lines' });
  for (const count of [110, 100, 90, 80]) {
    await lines.fill(String(count));
    // Past the refine delay, so a final is running when the next edit lands.
    await page.waitForTimeout(250);
  }
  await waitForFinal(page);
  const hook = await readHook(page);
  expect(JSON.parse(hook.sceneJson).levels.count).toBe(80);
  expect(hook.shownRevision).toBe(hook.revision);
  const client = await page.evaluate(() => {
    const c = (window as any).__contour.session.client;
    return { outstanding: c.outstanding, cancelled: c.cancelledJobs };
  });
  expect(client.outstanding).toBeLessThanOrEqual(1);
  // Without this, the test could pass with cancellation broken, if each job
  // happened to finish before the next edit.
  expect(client.cancelled).toBeGreaterThan(0);
});

test('a worker that cannot load falls back to the main thread', async ({ page }) => {
  await page.route('**/geometry.worker*', (route) => route.abort());
  await open(page);
  await expect(page.locator('.status')).toContainText('main thread');
  await page.locator('.source-row').first().click();
  await page.getByRole('spinbutton', { name: 'Lines' }).fill('8');
  await waitForFinal(page);
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  const { text } = await downloadText(page, () =>
    page.getByRole('button', { name: 'Download SVG' }).click(),
  );
  expect(text).toBe(canonicalSvg((await readHook(page)).sceneJson));
});

test('a scene too dense to compute stops clearly and recovers with undo', async ({ page }) => {
  await open(page);
  const start = (await readHook(page)).sceneJson;
  // Fine texture, every level, finest grid: more lines than the limit allows.
  const dense: Scene = {
    ...PRESETS[2].scene,
    domain: { width: 8192, height: 8192 },
    clip: { x: 0, y: 0, width: 8192, height: 8192 },
    noise: { amplitude: 10, scale: 4, octaves: 4 },
    levels: { base: -6, spacing: 0.1, count: 128 },
    export: { ...PRESETS[2].scene.export, resolution: 2048 },
  };
  await page.locator('input[type=file]').setInputFiles({
    name: 'dense.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(dense)),
  });
  await expect(page.locator('.status-state')).toHaveAttribute('data-state', 'stopped', {
    timeout: 40_000,
  });
  await expect(page.locator('.notice[data-kind=error]')).toContainText('too many lines');
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Nothing to export' })).toBeDisabled();
  await page.keyboard.press('ControlOrMeta+z');
  await waitForFinal(page);
  expect((await readHook(page)).sceneJson).toBe(start);
});

test('automated accessibility scan finds nothing serious', async ({ page }) => {
  await open(page);
  const states = [
    async () => undefined,
    async () => {
      await page.locator('.source-row').first().click();
    },
    async () => {
      await page.getByRole('button', { name: 'Export', exact: true }).first().click();
      await expect(page.locator('.report dl')).toBeVisible();
    },
    async () => {
      await page.keyboard.press('?');
    },
  ];
  for (const enter of states) {
    await enter();
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
  }
});

test('a broken file leaves the project untouched', async ({ page }) => {
  await open(page);
  const before = await readHook(page);
  const cases: [string, string][] = [
    ['broken.json', '{ not json'],
    ['other.json', '{"format":"something-else"}'],
    ['huge.json', JSON.stringify({ ...PRESETS[0].scene, export: { ...PRESETS[0].scene.export, resolution: 999999 } })],
    ['nan.json', serializeWith({ levels: { base: 0, spacing: 0, count: 8 } })],
  ];
  for (const [name, text] of cases) {
    await page.locator('input[type=file]').setInputFiles({
      name,
      mimeType: 'application/json',
      buffer: Buffer.from(text),
    });
    await expect(page.locator('.notice[data-kind=error]')).toContainText(name);
    await page.getByRole('button', { name: 'Dismiss' }).click();
    expect((await readHook(page)).sceneJson).toBe(before.sceneJson);
  }
});

function serializeWith(change: Partial<Scene>): string {
  return JSON.stringify({ ...PRESETS[0].scene, ...change });
}

test('autosave restores work, and corrupt storage is reported', async ({ page }) => {
  await open(page);
  await page.getByRole('spinbutton', { name: 'Lines' }).fill('9');
  await expect(page.locator('.bar-saved')).toContainText('Saved in this browser');
  await waitForFinal(page);
  await page.reload();
  await waitForFinal(page);
  expect(JSON.parse((await readHook(page)).sceneJson).levels.count).toBe(9);

  await page.evaluate(() => localStorage.setItem('contour.scene.v1', '{bad'));
  await page.reload();
  await waitForFinal(page);
  await expect(page.locator('.notice')).toContainText('could not be read');
  expect(JSON.parse((await readHook(page)).sceneJson).name).toBe('Quiet ridge');
});

test('a clean browser session opens the starter', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await open(page);
  expect(JSON.parse((await readHook(page)).sceneJson).name).toBe('Quiet ridge');
  await context.close();
});

test('the main thread path gives the same file as the worker', async ({ page }) => {
  await open(page, `${HOOK_URL}&worker=off`);
  await expect(page.locator('.status')).toContainText('main thread');
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  const { text } = await downloadText(page, () =>
    page.getByRole('button', { name: 'Download SVG' }).click(),
  );
  expect(text).toBe(canonicalSvg((await readHook(page)).sceneJson));
});

for (const deviceScaleFactor of [1, 2, 3]) {
  test(`display scale ${deviceScaleFactor} changes the raster, not the geometry`, async ({ browser }) => {
    const context = await browser.newContext({
      deviceScaleFactor,
      viewport: { width: 1200, height: 800 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    await open(page);
    const canvas = await page.locator('canvas').evaluate((c: HTMLCanvasElement) => ({
      width: c.width,
      css: c.getBoundingClientRect().width,
    }));
    expect(canvas.width).toBe(Math.round(canvas.css * deviceScaleFactor));
    await page.getByRole('button', { name: 'Export', exact: true }).first().click();
    const { text } = await downloadText(page, () =>
      page.getByRole('button', { name: 'Download SVG' }).click(),
    );
    expect(text).toBe(canonicalSvg(JSON.stringify(PRESETS[0].scene)));
    await context.close();
  });
}

test('keyboard only: tab to a handle, move it, delete it, undo', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /^Left summit, at/ }).focus();
  const before = JSON.parse((await readHook(page)).sceneJson).sources[1];
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await waitForFinal(page);
  const after = JSON.parse((await readHook(page)).sceneJson).sources[1];
  expect(after.x).toBe(before.x + 1);
  expect(after.y).toBe(before.y + 10);
  await page.keyboard.press(']');
  await waitForFinal(page);
  expect(JSON.parse((await readHook(page)).sceneJson).sources[1].radius).toBeGreaterThan(before.radius);
  await page.keyboard.press('Backspace');
  await expect(page.locator('.source-row')).toHaveCount(3);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.source-row')).toHaveCount(4);
});

test('duplicate and snapping work', async ({ page }) => {
  await open(page);
  await page.locator('.source-row', { hasText: 'Left summit' }).click();
  await page.keyboard.press('ControlOrMeta+d');
  await expect(page.locator('.source-row')).toHaveCount(5);
  await page.keyboard.press('s');
  await expect(page.getByRole('button', { name: 'Snap' })).toHaveAttribute('aria-pressed', 'true');
  const hook = await readHook(page);
  const copy = JSON.parse(hook.sceneJson).sources.find((s: { name: string }) => s.name.endsWith('copy'));
  const from = await stagePoint(page, copy.x, copy.y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 53, from.y + 37, { steps: 3 });
  await page.mouse.up();
  await waitForFinal(page);
  const moved = JSON.parse((await readHook(page)).sceneJson).sources.find(
    (s: { name: string }) => s.name.endsWith('copy'),
  );
  expect(moved.x % 10).toBe(0);
  expect(moved.y % 10).toBe(0);
});

test('hotkeys are discoverable', async ({ page }) => {
  await open(page);
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog')).toContainText('Keyboard shortcuts');
  await expect(page.getByRole('dialog')).toContainText('Duplicate the source');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('an invalid number is refused and explained', async ({ page }) => {
  await open(page);
  const lines = page.getByRole('spinbutton', { name: 'Lines' });
  await lines.fill('5000');
  await expect(page.locator('.field-error')).toContainText('from 1 to 128');
  await expect(lines).toHaveAttribute('aria-invalid', 'true');
  expect(JSON.parse((await readHook(page)).sceneJson).levels.count).toBe(14);
  await lines.blur();
  await expect(lines).toHaveValue('14');
});

test('export numbers follow the composition and hold their bound', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await expect(page.locator('.report')).toContainText('No lines cross');
  await expect(page.locator('.report table')).not.toContainText('...');
  const coarse = await page.locator('.report tbody tr').first().locator('td').last().textContent();
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await waitForFinal(page);
  await expect(page.locator('.report table')).not.toContainText('...');
  const light = await page.locator('.report tbody tr').first().locator('td').last().textContent();
  expect(Number(light?.replace(/,/g, ''))).toBeLessThan(Number(coarse?.replace(/,/g, '')));

  const hook = await readHook(page);
  const scene = JSON.parse(hook.sceneJson) as Scene;
  const geometry = computeGeometry(scene, { quality: 'final' });
  const distance = sampledHausdorff(geometry.source.flat(), parseSvgPaths(toSvg(geometry, scene)), 0.25);
  expect(distance.sampled).toBeLessThanOrEqual(geometry.stats.maxBound);
});

test('a long name stays inside its row', async ({ page }) => {
  await open(page);
  await page.locator('.source-row').first().click();
  await page.getByLabel('Name', { exact: true }).fill('A very long source name that goes on and on and on past any row width');
  const overflow = await page.locator('.side').evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(overflow).toBe(false);
});

test('a full source list stays usable', async ({ page }) => {
  await open(page);
  const scene: Scene = {
    ...emptyScene(),
    name: 'Dense list',
    sources: Array.from({ length: 64 }, (_, i) => ({
      id: `p${i}`,
      name: `Source number ${i + 1}`,
      kind: 'peak' as const,
      enabled: true,
      x: 40 + (i % 8) * 150,
      y: 40 + Math.floor(i / 8) * 90,
      radius: 90,
      height: i % 2 ? 1 : -1,
    })),
  };
  await loadScene(page, scene);
  await expect(page.locator('.source-row')).toHaveCount(64);
  const listHeight = await page.locator('.source-list').evaluate((el) => el.clientHeight);
  expect(listHeight).toBeLessThanOrEqual(200);
  await page.keyboard.press('p');
  const p = await stagePoint(page, 300, 300);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.notice')).toContainText('64 sources');
});

test('reduced motion removes transitions', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await open(page);
  const duration = await page
    .locator('.status-dot')
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(duration).toBe('0s');
  await context.close();
});

for (const width of [320, 390, 768, 1440]) {
  test(`no sideways scroll at ${width} px, and export is reachable`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await context.newPage();
    await open(page);
    const scroll = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    expect(scroll.doc).toBeLessThanOrEqual(scroll.win);
    await page.getByRole('button', { name: 'Export', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Download SVG' })).toBeVisible();
    await page.getByRole('button', { name: 'Download SVG' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Download SVG' })).toBeInViewport();
    await context.close();
  });
}

test('200 percent zoom keeps every control reachable', async ({ browser }) => {
  // A 1440 by 900 window at 200 percent has 720 by 450 CSS pixels.
  const context = await browser.newContext({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await open(page);
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(scroll).toBe(true);
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await page.getByRole('button', { name: 'Download SVG' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Download SVG' })).toBeInViewport();
  await context.close();
});

test('touch can drag a source and pan the sheet', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 800 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await open(page);
  const before = await readHook(page);
  const source = JSON.parse(before.sceneJson).sources[1];
  const from = await stagePoint(page, source.x, source.y);
  const client = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    client.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    });
  await touch('touchStart', from.x, from.y);
  for (let i = 1; i <= 8; i++) await touch('touchMove', from.x + i * 4, from.y + i * 2);
  await touch('touchEnd', 0, 0);
  await waitForFinal(page);
  const after = JSON.parse((await readHook(page)).sceneJson).sources[1];
  expect(after.x).toBeGreaterThan(source.x);
  await context.close();
});
