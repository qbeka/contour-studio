/**
 * Draws the tab icon with the engine itself: a small hill beside a smaller one,
 * three contour lines, on a square of the first plate's paper.
 *
 *   pnpm exec tsx scripts/mark.ts
 */

import { writeFileSync } from 'node:fs';
import { computeGeometry } from '../src/core/pipeline';
import { PALETTES } from '../src/core/plates';
import { emptyScene, type Scene } from '../src/core/scene';
import { pathData } from '../src/core/svg';

const SIZE = 64;
const INSET = 7;
const [forest] = PALETTES;

const base = emptyScene();
const scene: Scene = {
  ...base,
  name: 'Contour mark',
  domain: { width: SIZE, height: SIZE },
  clip: { x: INSET, y: INSET, width: SIZE - INSET * 2, height: SIZE - INSET * 2 },
  sources: [
    { id: 'hill', name: 'Hill', kind: 'peak', enabled: true, x: 25, y: 38, radius: 34, height: 1 },
    { id: 'knoll', name: 'Knoll', kind: 'peak', enabled: true, x: 49, y: 17, radius: 24, height: 0.62 },
  ],
  levels: { base: 0.3, spacing: 0.27, count: 3 },
  export: { ...base.export, resolution: 128, tolerance: 0.2, decimals: 1 },
};

const geometry = computeGeometry(scene, { quality: 'final' });
const lines = geometry.levels.flatMap((level) => level.paths.map((path) => `<path d="${pathData(path)}"/>`));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">
<rect width="${SIZE}" height="${SIZE}" rx="14" fill="${forest.paper}"/>
<g fill="none" stroke="${forest.ink}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
${lines.join('\n')}
</g>
</svg>
`;
writeFileSync('public/favicon.svg', svg);
console.log(`public/favicon.svg, ${svg.length} bytes, ${geometry.stats.outputVertices} nodes on ${geometry.stats.outputPaths} lines`);
