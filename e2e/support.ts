import { expect, type Page } from '@playwright/test';
import type { Scene } from '../src/core/scene';

export const HOOK_URL = '/?hook=1';

/** The state the test hook exposes, with just the parts tests read. */
export interface Hook {
  sceneJson: string;
  revision: number;
  quality: string | null;
  shownRevision: number | null;
  selection: { sourceId: string; handle: number | null } | null;
  past: number;
  future: number;
  outputPaths: number;
  view: { scale: number; x: number; y: number };
}

export async function readHook(page: Page): Promise<Hook> {
  return page.evaluate(() => {
    const { store } = (window as unknown as { __contour: { store: any } }).__contour;
    const s = store.getState();
    return {
      sceneJson: JSON.stringify(store.scene),
      revision: s.revision,
      quality: s.shown?.quality ?? null,
      shownRevision: s.shown?.revision ?? null,
      selection: s.selection,
      past: s.history.past.length,
      future: s.history.future.length,
      outputPaths: s.geometry?.stats.outputPaths ?? 0,
      view: s.view,
    };
  });
}

/** Waits for the status line to claim export geometry for the current scene. */
export async function waitForFinal(page: Page): Promise<void> {
  await expect(page.locator('.status-state')).toHaveAttribute('data-state', 'final', {
    timeout: 15_000,
  });
}

export async function open(page: Page, url = HOOK_URL): Promise<void> {
  await page.goto(url);
  await waitForFinal(page);
}

/** Puts the app on a specific scene through the normal file open path. */
export async function loadScene(page: Page, scene: Scene): Promise<void> {
  await page.locator('input[type=file]').setInputFiles({
    name: 'scene.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(scene)),
  });
  await expect(page.locator('.notice')).toContainText('Opened');
  await waitForFinal(page);
}

/** Stage position of a model point. */
export async function stagePoint(
  page: Page,
  x: number,
  y: number,
): Promise<{ x: number; y: number }> {
  const hook = await readHook(page);
  const box = await page.locator('.stage').boundingBox();
  if (!box) throw new Error('No stage.');
  return { x: box.x + hook.view.x + x * hook.view.scale, y: box.y + hook.view.y + y * hook.view.scale };
}
