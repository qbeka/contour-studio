/**
 * Builds the static site for hosting: the project page at the root, and the full
 * studio under app/. The output is dist-site/, which can be copied to any folder.
 *
 *   pnpm build:site
 */

import { execFileSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';

const run = (...args: string[]) => execFileSync('pnpm', ['exec', ...args], { stdio: 'inherit' });

run('vite', 'build', '--config', 'vite.replay.config.ts');
run('vite', 'build', '--outDir', 'dist-site/app', '--emptyOutDir');
// The page only uses the serif. The studio keeps its own full set under app/.
for (const font of ['Geist-Medium', 'Geist-Regular', 'GeistMono-Regular']) {
  rmSync(`dist-site/fonts/${font}.woff2`);
}
cpSync('docs/media/walkthrough.mp4', 'dist-site/walkthrough.mp4');
cpSync('docs/media/cover.png', 'dist-site/cover.png');
