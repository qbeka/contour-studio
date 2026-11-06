/**
 * Builds the release artwork from the starter scenes. The output is deterministic,
 * so a rebuild from the same commit gives the same bytes.
 *
 *   pnpm exec tsx scripts/build-artwork.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { computeGeometry } from '../src/core/pipeline';
import { PRESETS } from '../src/core/presets';
import { serializeScene } from '../src/core/scene';
import { componentName, toReact, toSvg } from '../src/core/svg';

for (const preset of PRESETS) {
  const folder = join('artwork', preset.id);
  mkdirSync(folder, { recursive: true });
  const geometry = computeGeometry(preset.scene, { quality: 'final' });
  const svg = toSvg(geometry, preset.scene);
  writeFileSync(join(folder, `${preset.id}.svg`), svg);
  writeFileSync(join(folder, `${preset.id}.contour.json`), serializeScene(preset.scene));
  writeFileSync(join(folder, `${componentName(preset.scene)}.tsx`), toReact(geometry, preset.scene));
  // A transparent static fallback at twice the frame width, for places that want a raster.
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: geometry.rect.width * 2 } })
    .render()
    .asPng();
  writeFileSync(join(folder, `${preset.id}.png`), png);
  console.log(`${folder}: ${Buffer.byteLength(svg)} bytes of SVG, ${png.length} bytes of PNG`);
}
