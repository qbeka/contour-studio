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
rmSync('dist-site/fonts/LICENSE-GEIST.txt', { force: true });
cpSync('public/fonts/LICENSE-GEIST.txt', 'dist-site/app/fonts/LICENSE-GEIST.txt');
cpSync('docs/media/walkthrough.mp4', 'dist-site/walkthrough.mp4');
cpSync('docs/media/cover.png', 'dist-site/cover.png');
