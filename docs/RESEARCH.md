# Research

What I read, what I took from it, and where this project differs. Pinned tool versions are in `package.json` and `pnpm-lock.yaml`. Each measurement manifest records them too.

## Existing tools

**Paper Shaders** ([repository](https://github.com/paper-design/shaders), [examples](https://shaders.paper.design/)). A library of zero-dependency canvas shaders, under Apache-2.0. Its examples are real-time effects: image filters, logo animations, mesh gradients, metaballs. The examples page does not mention vector or SVG export. I took one lesson: a good effect can be set up in seconds, so this tool should not compete on effects. It competes on authored geometry and a measured file. No code or shader from it is used.

**Rauno Freiberg, [Novelty](https://rauno.me/craft/novelty).** Repetition dulls an effect, and novelty works best as contrast against a familiar interface. Contour has one memorable interaction, dragging a source, and everything around it stays quiet.

## Field

**Bloomenthal and Shirley, Convolution Surfaces, SIGGRAPH 1991.** The source of the ridge model: integrate a kernel along a skeleton. The original work builds implicit surfaces in 3D. Here it is 2D, with a compact polynomial kernel, integrated in closed form. Changes: the kernel is `(1 - q)^3` and the normalisation sets a long crest to 1.

I chose polynomial kernels and `sqrt` over Gaussians on purpose. `Math.exp` is not required to give the same bits on every engine. See "Repeatability" in `docs/GEOMETRY.md`.

## Extraction

**Lorensen and Cline, Marching Cubes, SIGGRAPH 1987.** The cell-by-cell case table, used here in 2D.

**Nielson and Hamann, The Asymptotic Decider, Visualization 1991.** Resolves the ambiguous cell using the saddle of the bilinear interpolant. Assumption: the data is bilinear within a cell. Marching squares draws straight segments, so this picks the topology of the interpolant and does not claim to recover the true field. Change: the sign is computed from the numerator alone, because in an ambiguous cell the sign of the denominator is known.

I did not use the midpoint test (average of four corners), which is simpler but can give a different topology from the interpolant.

## Simplification

**Douglas and Peucker, The Canadian Cartographer 10(2), 1973.** The base algorithm. Their criterion uses a distance to a line. This version measures distance to the segment, because a point past the end of a chord matters, and that is needed for the bound in `docs/GEOMETRY.md`.

**Saalfeld, Topologically consistent line simplification with the Douglas-Peucker algorithm, CaGIS 26(1), 1999.** Shows that plain Douglas-Peucker can move a feature to the wrong side of a line with no crossing. His fix keeps refining using convex hulls. Mine is simpler and cruder: test each swept region against original vertices, then tighten the whole path. It costs more bytes on a failing path and is easier to read and to test. A scene in `test/regressions` shows the failure happening.

**Liang and Barsky, ACM TOG 3(1), 1984.** The clipping method, unchanged.

## SVG

Read from [SVG 2 paths](https://www.w3.org/TR/SVG2/paths.html) and [SVG 2 coordinate systems](https://www.w3.org/TR/SVG2/coords.html):

- Pairs after a moveto are implicit linetos. The writer leans on this for `l`, with no repeated letters.
- Superfluous white space may go, and a minus sign can follow a number with no separator. The writer does both. It keeps `L` and `l` as distinct letters, so that the file stays easy to read in a diff.
- `z` sets the current point to the start of the subpath. The writer does not rely on this, because each path has a single subpath.
- `vector-effect` is not inherited, so fixed stroke mode must mark each path. That is why it is an option. It adds bytes.
- The default `preserveAspectRatio` is `xMidYMid meet`. The writer leaves it, so that a resized file keeps its shape.

## Browser

[Pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events): `setPointerCapture` keeps a drag on its handle, and `touch-action: none` stops the browser taking over a touch and firing `pointercancel`.

[OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas): widely available. Not used. Canvas draw calls take about 0.2 ms of main thread time, so moving them off the thread has nothing measurable to win yet. That figure covers only recording commands, since the browser rasterises later, and raster cost was not measured separately. WebGL is not used, for the same reason and because the preview must show exact paths. There is one CPU path, so the only fallback to maintain is the worker's.
