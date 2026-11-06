# Third party notices

The MIT license in `LICENSE` covers the code written for this project. It does not cover the items below.

## In the built app

| Item | Version | License | Where |
|---|---|---|---|
| Geist Sans, Geist Serif, Geist Mono fonts | from `geist` 1.9.1 | SIL Open Font License 1.1 | `public/fonts`, license in `public/fonts/LICENSE-GEIST.txt` |
| React and React DOM | 19.3.1 | MIT | Bundled in the JavaScript build |

The font files are unmodified copies. The fonts are by Vercel with basement.studio. Using them does not imply any affiliation with Vercel.

## Used only to build, test or measure

These do not ship in the app or the exported files: TypeScript, Vite, Vitest, Playwright, axe-core, resvg-js, paper.js, pngjs and tsx. Each keeps its own license, listed in `pnpm-lock.yaml` and in its package.

## Reused code

None. No source code from another project is copied here. `docs/RESEARCH.md` lists the papers behind the methods.

## Artwork

The three starter scenes were placed by hand for this project. `src/core/presets.ts` holds their coordinates. The site line work at qendrimbeka.com inspired the mood of the quiet ridge. No path or point is traced from it or from any other artwork.

Exported artwork belongs to whoever made the scene.
