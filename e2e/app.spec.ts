import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { computeGeometry } from '../src/core/pipeline';
import { emptyScene, parseScene, type Scene } from '../src/core/scene';
import { linesOnly, toSvg } from '../src/core/svg';
import { PLATES } from '../src/core/plates';
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
    expect(text).toBe(canonicalSvg(JSON.stringify(PLATES[0].scene)));
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

test('typing key by key keeps a negative number', async ({ page }) => {
  await open(page);
  await page.locator('.source-row').first().click();
  const height = page.getByLabel('Height', { exact: true });
  await height.click();
  await height.fill('');
  // A real delay between keys, so that React's effects run between them.
  await height.pressSequentially('-0.5', { delay: 40 });
  await expect(height).toHaveValue('-0.5');
  expect(JSON.parse((await readHook(page)).sceneJson).sources[0].height).toBe(-0.5);
});

test('typing a decimal key by key survives the digits rounding', async ({ page }) => {
  await open(page);
  const gap = page.getByRole('spinbutton', { name: 'Line gap' });
  await gap.click();
  await gap.fill('');
  await gap.pressSequentially('0.05', { delay: 40 });
  await expect(gap).toHaveValue('0.05');
  expect(JSON.parse((await readHook(page)).sceneJson).levels.spacing).toBe(0.05);
});

test('no way of adding a source can pass the limit', async ({ page }) => {
  await open(page);
  const scene: Scene = {
    ...emptyScene(),
    name: 'Full',
    sources: Array.from({ length: 64 }, (_, i) => ({
      id: `p${i}`, name: `P ${i}`, kind: 'peak' as const, enabled: true,
      x: (i % 8) * 150 + 40, y: Math.floor(i / 8) * 90 + 40, radius: 60, height: 1,
    })),
  };
  await loadScene(page, scene);
  await page.keyboard.press('r');
  for (const [x, y] of [[100, 600], [300, 700]]) {
    const p = await stagePoint(page, x, y);
    await page.mouse.click(p.x, p.y);
  }
  await page.keyboard.press('Enter');
  await expect(page.locator('.source-row')).toHaveCount(64);
  const saved = await downloadText(page, () =>
    page.getByRole('button', { name: 'Save', exact: true }).click(),
  );
  expect(parseScene(saved.text).ok).toBe(true);
});

test('a duplicate during a ridge draft still cannot pass the limit', async ({ page }) => {
  await open(page);
  const scene: Scene = {
    ...emptyScene(),
    name: 'Nearly full',
    sources: Array.from({ length: 63 }, (_, i) => ({
      id: `p${i}`, name: `P ${i}`, kind: 'peak' as const, enabled: true,
      x: (i % 8) * 150 + 40, y: Math.floor(i / 8) * 90 + 40, radius: 60, height: 1,
    })),
  };
  await loadScene(page, scene);
  await page.locator('.source-row').first().click();
  await page.keyboard.press('r');
  for (const [x, y] of [[100, 600], [300, 700]]) {
    const p = await stagePoint(page, x, y);
    await page.mouse.click(p.x, p.y);
  }
  await page.keyboard.press('ControlOrMeta+d');
  await expect(page.locator('.source-row')).toHaveCount(64);
  await page.keyboard.press('Enter');
  await expect(page.locator('.source-row')).toHaveCount(64);
  expect(parseScene((await readHook(page)).sceneJson).ok).toBe(true);
});

test('a peak placed far out at the lowest zoom stays in the format', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const { store } = (window as any).__contour;
    store.set({ view: { scale: 0.02, x: -600, y: -400 }, autoFit: false });
  });
  await page.keyboard.press('p');
  await page.mouse.click(1000, 200);
  await page.waitForTimeout(600);
  const { sceneJson } = await readHook(page);
  expect(parseScene(sceneJson).ok).toBe(true);
  await page.reload();
  await waitForFinal(page);
  expect(JSON.parse((await readHook(page)).sceneJson).sources).toHaveLength(5);
});

test('a reload right after an edit keeps it', async ({ page }) => {
  await open(page);
  await page.getByRole('spinbutton', { name: 'Lines' }).fill('11');
  await page.reload();
  await waitForFinal(page);
  expect(JSON.parse((await readHook(page)).sceneJson).levels.count).toBe(11);
});

test('failed storage is stated, not hidden', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error('Quota exceeded');
    };
  });
  await page.getByRole('spinbutton', { name: 'Lines' }).fill('12');
  await expect(page.locator('.bar-saved')).toContainText('Not saved in this browser');
});

test('backspace on a focused slider leaves the source alone', async ({ page }) => {
  await open(page);
  await page.locator('.source-row').first().click();
  await page.getByLabel('Reach slider').focus();
  await page.keyboard.press('Backspace');
  await expect(page.locator('.source-row')).toHaveCount(4);
});

test('right click places nothing, and a double click adds no extra point', async ({ page }) => {
  await open(page);
  await page.keyboard.press('p');
  const p = await stagePoint(page, 600, 300);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(page.locator('.source-row')).toHaveCount(4);
  await page.keyboard.press('r');
  const a = await stagePoint(page, 300, 300);
  const b = await stagePoint(page, 700, 400);
  await page.mouse.click(a.x, a.y);
  await page.mouse.dblclick(b.x, b.y);
  await expect(page.locator('.source-row')).toHaveCount(5);
  const ridge = JSON.parse((await readHook(page)).sceneJson).sources[4];
  expect(ridge.points).toHaveLength(2);
});

test('opening a file then undoing refits the view', async ({ page }) => {
  await open(page);
  const start = (await readHook(page)).view.scale;
  await loadScene(page, { ...PRESETS[0].scene, domain: { width: 8000, height: 8000 }, clip: { x: 0, y: 0, width: 8000, height: 8000 } });
  await page.keyboard.press('ControlOrMeta+z');
  await waitForFinal(page);
  expect((await readHook(page)).view.scale).toBeCloseTo(start, 5);
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
  // The bound is about the lines. Tint passes are shapes laid under them.
  const distance = sampledHausdorff(geometry.source.flat(), parseSvgPaths(toSvg(geometry, linesOnly(scene))), 0.25);
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

test('a palette, a tint and a taper change the print and never the lines', async ({ page }) => {
  await open(page);
  const lines = async () => {
    const scene = JSON.parse((await readHook(page)).sceneJson) as Scene;
    return toSvg(computeGeometry(scene, { quality: 'final' }), linesOnly({ ...scene, style: PLATES[0].scene.style }));
  };
  const before = await lines();
  await page.getByRole('button', { name: 'Terracotta', exact: true }).click();
  await page.getByLabel('Tint', { exact: true }).fill('-0.4');
  await page.getByLabel('Taper', { exact: true }).fill('0.6');
  await waitForFinal(page);
  const scene = JSON.parse((await readHook(page)).sceneJson) as Scene;
  expect(scene.style.stroke).toBe('#58291a');
  expect(scene.style.tint).toBe(-0.4);
  expect(scene.style.taper).toBe(0.6);
  expect(await lines()).toBe(before);
});

test('the export panel says what tint adds, and a ready size downloads', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await expect(page.locator('.report')).toContainText('Tint adds to the file');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: /Phone wallpaper/ }).click();
  const file = await pending;
  expect(file.suggestedFilename()).toBe('quiet-ridge-phone.png');
  const bytes = readFileSync(await file.path());
  expect(bytes.readUInt32BE(16)).toBe(1290);
  expect(bytes.readUInt32BE(20)).toBe(2796);
  // Lines alone: the row goes away with the tint.
  await page.getByRole('tab', { name: 'Lines' }).click();
  await page.getByLabel('Tint', { exact: true }).fill('0');
  await page.getByRole('tab', { name: 'Export' }).click();
  await waitForFinal(page);
  await expect(page.locator('.report table')).not.toContainText('...');
  await expect(page.locator('.report')).not.toContainText('Tint adds to the file');
});

test('the six plates are offered as starters', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.locator('.starter')).toHaveCount(7);
  await page.locator('.starter', { hasText: 'Archipelago' }).click();
  await waitForFinal(page);
  const scene = JSON.parse((await readHook(page)).sceneJson) as Scene;
  expect(scene.name).toBe('Archipelago');
  expect(scene.style.background).toBe('#111c17');
});

test('the paper relief shows, takes a lamp and exports what the panel describes @cross', async ({ page }) => {
  await open(page);
  const before = await readHook(page);
  const state = () =>
    page.evaluate(() => {
      const s = (window as unknown as { __contour: { store: any } }).__contour.store.getState();
      return { relief: s.relief as boolean, u: s.lamp.u as number, v: s.lamp.v as number };
    });
  await page.keyboard.press('l');
  expect((await state()).relief).toBe(true);
  await expect(page.locator('.status-toggle', { hasText: 'Relief' })).toHaveAttribute('aria-pressed', 'true');
  const lamp = page.getByRole('button', { name: /Lamp over the sheet/ });
  await expect(lamp).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Paper relief' })).toBeChecked();

  // The lamp is dragged, and the scene and its history do not change.
  const start = await state();
  const box = await lamp.boundingBox();
  if (!box) throw new Error('No lamp.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 90, { steps: 6 });
  await page.mouse.up();
  const moved = await state();
  expect(moved.u).toBeGreaterThan(start.u + 0.1);
  // With the lamp focused the arrows move the light, not a source.
  await lamp.focus();
  await page.keyboard.press('ArrowDown');
  expect((await state()).v).toBeCloseTo(moved.v + 0.02, 5);
  const after = await readHook(page);
  expect(after.sceneJson).toBe(before.sceneJson);
  expect(after.past).toBe(before.past);
  expect(after.revision).toBe(before.revision);

  // The export follows the view and says what the file holds.
  await page.getByRole('tab', { name: 'Export' }).click();
  await expect(page.locator('.relief-note')).toContainText(/holds \d+ outlines and no lines/);
  const relief = await downloadText(page, () => page.getByRole('button', { name: 'Download relief SVG' }).click());
  expect(relief.name).toBe('quiet-ridge-relief.svg');
  const outlines = relief.text.match(/<path id="s\d+"/g)?.length ?? 0;
  expect(Number((await page.locator('.relief-note').textContent())?.match(/holds (\d+) outlines/)?.[1])).toBe(outlines);
  expect(relief.text.match(/<use /g)?.length).toBe(outlines * 6);
  expect(relief.text).not.toMatch(/stroke=|<filter|<image/);

  // Back in lines, the file is exactly what the core writes for the scene.
  await page.getByRole('tab', { name: 'Lines' }).click();
  await page.getByRole('radio', { name: 'Line print' }).check();
  expect((await state()).relief).toBe(false);
  await expect(lamp).toBeHidden();
  await page.getByRole('tab', { name: 'Export' }).click();
  await expect(page.locator('.relief-note')).toHaveCount(0);
  const lines = await downloadText(page, () => page.getByRole('button', { name: 'Download SVG' }).click());
  expect(lines.name).toBe('quiet-ridge.svg');
  expect(lines.text).toBe(canonicalSvg(after.sceneJson));
});

test('the studio names its tab icon and the link card', async ({ page, request }) => {
  await open(page);
  const icon = await page.locator('link[rel=icon]').getAttribute('href');
  expect(icon).toContain('favicon.svg');
  expect((await request.get(`/app/${icon}`)).ok()).toBe(true);
  expect(await page.locator('meta[property="og:image"]').getAttribute('content')).toBe('https://www.qendrimbeka.com/projects/contour/og.png');
});
