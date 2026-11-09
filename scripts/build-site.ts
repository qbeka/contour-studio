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
// The page uses the serif and the sans. The studio keeps its own full set under app/.
rmSync('dist-site/fonts/GeistMono-Regular.woff2');
cpSync('docs/media/walkthrough.mp4', 'dist-site/walkthrough.mp4');
// The film is of the studio, so the studio is its poster. The cover is the page
// itself, kept at the address a link card may already use.
cpSync('docs/media/studio.png', 'dist-site/studio.png');
cpSync('docs/media/cover.png', 'dist-site/cover.png');
