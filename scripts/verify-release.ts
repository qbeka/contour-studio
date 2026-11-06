/**
 * Builds the static demo as a tarball, unpacks it under a sub-path on a plain file
 * server, and checks that the app, its worker and its fonts all load from there.
 *
 *   pnpm exec tsx scripts/verify-release.ts
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { chromium } from '@playwright/test';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const name = `contour-studio-demo-${pkg.version}.tar.gz`;
const PORT = 5186;
const SUB_PATH = '/projects/contour/';

execFileSync('pnpm', ['exec', 'vite', 'build', '--logLevel', 'error'], { stdio: 'inherit' });
mkdirSync('release', { recursive: true });
execFileSync('tar', ['-czf', join('release', name), '-C', 'dist', '.']);

const root = mkdtempSync(join(tmpdir(), 'contour-release-'));
execFileSync('tar', ['-xzf', join('release', name), '-C', root]);

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

// A plain server with none of Vite's helpers, and only one sub-path that works.
const server = createServer((request, response) => {
  const path = decodeURIComponent((request.url ?? '/').split('?')[0]);
  if (!path.startsWith(SUB_PATH)) {
    response.writeHead(404).end();
    return;
  }
  const relative = normalize(path.slice(SUB_PATH.length) || 'index.html');
  const file = join(root, relative);
  try {
    if (!statSync(file).isFile()) throw new Error('Not a file.');
  } catch {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
});
await new Promise<void>((resolve) => server.listen(PORT, resolve));

const browser = await chromium.launch();
const page = await browser.newPage();
const failures: string[] = [];
const requests: string[] = [];
page.on('requestfailed', (r) => failures.push(r.url()));
page.on('response', (r) => {
  if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
});
page.on('pageerror', (e) => failures.push(e.message));
page.on('request', (r) => requests.push(r.url()));

await page.goto(`http://localhost:${PORT}${SUB_PATH}`);
await page.waitForSelector('.status-state[data-state=final]', { timeout: 20_000 });
const status = await page.locator('.status').innerText();
await page.evaluate(() => document.fonts.ready);
const fonts = await page.evaluate(() =>
  [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
);
await browser.close();
server.close();

const size = statSync(join('release', name)).size;
const assets = execFileSync('tar', ['-tzf', join('release', name)], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !f.endsWith('/'));
const result = {
  tarball: name,
  bytes: size,
  files: assets.length,
  subPath: SUB_PATH,
  worker: status.includes('worker'),
  fontsLoaded: fonts,
  failures,
  offOrigin: requests.filter((u) => !u.startsWith(`http://localhost:${PORT}${SUB_PATH}`)),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
};
rmSync(root, { recursive: true, force: true });
mkdirSync('results/release', { recursive: true });
writeFileSync('results/release/latest.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(result);
if (failures.length > 0 || !result.worker || result.offOrigin.length > 0 || fonts.length === 0) {
  console.error('Release check failed.');
  process.exit(1);
}
console.log('release check passed');
