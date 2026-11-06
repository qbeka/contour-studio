/**
 * Proves the exports work outside this repository. It makes a new folder with its
 * own install, adds only the exported files, builds it, and checks the page.
 *
 *   pnpm exec tsx scripts/verify-consumer.ts
 */

import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const PORT = 5185;
const root = mkdtempSync(join(tmpdir(), 'contour-consumer-'));
const repo = process.cwd();
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

mkdirSync(join(root, 'src'));
mkdirSync(join(root, 'public'));
copyFileSync('artwork/quiet-ridge/QuietRidgeArtwork.tsx', join(root, 'src/QuietRidgeArtwork.tsx'));
copyFileSync('artwork/quiet-ridge/quiet-ridge.svg', join(root, 'public/quiet-ridge.svg'));

writeFileSync(
  join(root, 'package.json'),
  JSON.stringify({
    name: 'contour-consumer',
    private: true,
    type: 'module',
    dependencies: { react: pkg.dependencies.react, 'react-dom': pkg.dependencies['react-dom'] },
    devDependencies: {
      vite: pkg.devDependencies.vite,
      '@vitejs/plugin-react': pkg.devDependencies['@vitejs/plugin-react'],
      typescript: pkg.devDependencies.typescript,
      '@types/react': pkg.devDependencies['@types/react'],
      '@types/react-dom': pkg.devDependencies['@types/react-dom'],
    },
  }),
);
writeFileSync(
  join(root, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      jsx: 'react-jsx',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    include: ['src'],
  }),
);
writeFileSync(
  join(root, 'index.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Consumer</title></head>
<body><div id="root"></div><img id="file" src="/quiet-ridge.svg" alt="" width="720">
<script type="module" src="/src/main.tsx"></script></body></html>`,
);
writeFileSync(
  join(root, 'src/main.tsx'),
  `import { createRoot } from 'react-dom/client';
import { QuietRidgeArtwork } from './QuietRidgeArtwork';
createRoot(document.getElementById('root') as HTMLElement).render(
  <QuietRidgeArtwork id="component" width={720} height={240} aria-hidden="true" />,
);
`,
);

const run = (cmd: string, args: string[]) =>
  execFileSync(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });

run('pnpm', ['install', '--ignore-workspace']);
run('pnpm', ['exec', 'tsc']);
run('pnpm', ['exec', 'vite', 'build', '--logLevel', 'error']);

const server = spawn(
  'pnpm',
  ['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort', '--logLevel', 'error'],
  { cwd: root, stdio: 'ignore', detached: true },
);

const result: Record<string, unknown> = {};
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#component path');
  await page.waitForFunction(() => (document.getElementById('file') as HTMLImageElement).complete);
  const measured = await page.evaluate(async () => {
    const image = document.getElementById('file') as HTMLImageElement;
    const text = await (await fetch(image.src)).text();
    const file = [...text.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
    const inPage = [...document.querySelectorAll('#component path')].map(
      (p) => p.getAttribute('d') as string,
    );
    return {
      fileLoaded: image.naturalWidth > 0,
      paths: inPage.length,
      samePathData: file.length === inPage.length && file.every((d, i) => d === inPage[i]),
      viewBox: document.getElementById('component')?.getAttribute('viewBox'),
      ariaHidden: document.getElementById('component')?.getAttribute('aria-hidden'),
      opacities: [...document.querySelectorAll('#component g')].length,
    };
  });
  await browser.close();
  Object.assign(result, measured, {
    consoleErrors: errors,
    offOrigin: requests.filter((u) => !u.startsWith(`http://localhost:${PORT}`)),
    react: pkg.dependencies.react,
    typeChecked: true,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  });
} finally {
  process.kill(-(server.pid as number), 'SIGKILL');
  rmSync(root, { recursive: true, force: true });
}

mkdirSync('results/consumer', { recursive: true });
writeFileSync('results/consumer/latest.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(result);
if (!result.samePathData || !result.fileLoaded || (result.consoleErrors as string[]).length > 0) {
  console.error('Consumer check failed.');
  process.exit(1);
}
console.log('consumer check passed');
