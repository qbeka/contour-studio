/** Saving, opening and autosaving. Storage can always fail, so all of it is guarded. */

import { parseScene, serializeScene, type ParseResult, type Scene } from '../core/scene';

const AUTOSAVE_KEY = 'contour.scene.v1';

export function saveDownload(name: string, text: string, type: string): void {
  saveBlob(name, new Blob([text], { type }));
}

export function saveBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function fileStem(scene: Scene): string {
  const stem = scene.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return stem || 'contour';
}

export function autosave(scene: Scene): boolean {
  try {
    localStorage.setItem(AUTOSAVE_KEY, serializeScene(scene));
    return true;
  } catch {
    return false;
  }
}

export type AutosaveResult =
  | { status: 'none' }
  | { status: 'ok'; scene: Scene }
  | { status: 'corrupt' };

export function readAutosave(): AutosaveResult {
  let text: string | null = null;
  try {
    text = localStorage.getItem(AUTOSAVE_KEY);
  } catch {
    return { status: 'none' };
  }
  if (text === null) return { status: 'none' };
  const parsed = parseScene(text);
  return parsed.ok ? { status: 'ok', scene: parsed.scene } : { status: 'corrupt' };
}

export async function readSceneFile(file: File): Promise<ParseResult> {
  // Checked before reading, so a huge file is never held in memory.
  if (file.size > 1_000_000) {
    return { ok: false, errors: [`${file.name} is larger than the 1 MB limit for scene files.`] };
  }
  return parseScene(await file.text());
}
