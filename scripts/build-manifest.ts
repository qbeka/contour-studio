/**
 * Lists every released file with its hash. It hashes finished files and leaves
 * itself out, so run it last.
 *
 *   pnpm exec tsx scripts/build-manifest.ts
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function walk(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const paths = ['artwork', 'docs/media', 'release'].flatMap(walk).filter((p) => !p.endsWith('.DS_Store'));
const files = paths.sort().map((path) => ({
  path,
  bytes: statSync(path).size,
  sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
}));

writeFileSync(
  'docs/ARTIFACTS.json',
  `${JSON.stringify(
    {
      note: 'release/ is built by scripts/verify-release.ts and is not committed.',
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      files,
    },
    null,
    2,
  )}\n`,
);
console.log(`${files.length} files`);
