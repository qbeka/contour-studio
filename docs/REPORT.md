# Report

What Contour measures, what the evidence shows, and where it stops. The plan was committed before the final run: [BENCH_PLAN.md](BENCH_PLAN.md). Tables between markers are generated from the raw results by `scripts/report-tables.ts`.

## Summary

All four pass criteria passed on the reference laptop. A refined 512 by 512 scene with 16 levels takes 14 to 25 ms in Node and about 15 ms in Chromium, against a 500 ms target. That target was written for a slower machine, so this margin says little about other hardware.

Simplifying the same composition removes 83 to 87 percent of its nodes and 72 to 80 percent of its gzipped size at the Balanced setting, with no crossing and no lost path in any row.

The worker does not make drafts faster. It limits the worst stall. On the stress scene the largest frame gap is 40 ms with the worker, against 157 ms with blocking work on the main thread.

## Environment

<!-- results:environment -->
- Commit `49e2fb10cbb7b6199e0a91e35395ae7ae01efe45`, 2026-11-06T07:50:32.340Z
- Apple M5 Pro, model Mac17,9, 48 GB, 18 logical cores
- macOS 26.6.2, Node v22.16.0, Chromium 148.0.7778.96
- Power: Now drawing from 'AC Power'
- Load average at the end of the run: 7.7, 8.7, 8.9
- Raw samples: `results/bench-2026-11-06T07-44-05-187Z/raw`. Manifest: `results/bench-2026-11-06T07-44-05-187Z/manifest.json`.
<!-- /results -->

## Pass criteria

<!-- results:criteria -->
| Criterion | Result |
|---|---|
| Refined 512 by 512, 16 levels, within 500 ms in Chromium on every target scene | Passed |
| Edit to draft at p95 within 33 ms, worker at 1x | Passed |
| No long task during the drag, worker at 1x | Passed |
| No crossings, no lost paths, sampled distance within the bound | Passed |
<!-- /results -->

## Correctness

These are tests, separate from the performance numbers below.

| Check | Result | Where |
|---|---|---|
| Unit, property and regression tests | 165 passed | `pnpm test` |
| Browser tests | 31 passed in three runs in a row, the core workflow in three engines | `pnpm test:e2e` |
| Random scenes through every rule | 120 scenes, plus 300 crowded scenes with lines packed tighter than the rounding lattice | `test/properties.test.ts` |
| Same SVG bytes in Chromium, Firefox, WebKit and Node | Identical for the workflow's scene | `e2e/app.spec.ts` |
| Same SVG bytes with and without the worker | Identical | `e2e/app.spec.ts` |
| Same SVG bytes at display scales 1, 2 and 3 | Identical | `e2e/app.spec.ts` |
| Source mutations | 56 of 57 killed by a named test. 1 timed out, and its targeted test fails on it when run alone | `results/mutations/latest.json` |
| Seeded negative controls | All detected | `test/negative-controls.test.ts` |
| Automated accessibility scan | No serious or critical finding in 4 states | `e2e/app.spec.ts` |

The test oracles in `test/support/oracle.ts` share no code with the path builder or the topology checks. Scenes that once failed are kept in `test/regressions`.

Automated accessibility checks do not establish accessibility. See [USABILITY.md](USABILITY.md).

## Performance

All values are milliseconds. One value per run is the median of 5 measured iterations after 3 warmup iterations. Each cell is the mean of the runs, and ranges are the run minimum and maximum.

### Stage times in Node, target workloads

<!-- results:stages-target -->
| Workload | Field | Extract | Join | Clip | Simplify | Topology | Serialize | Pipeline total | Export total |
|---|---|---|---|---|---|---|---|---|---|
| quiet-ridge/16-levels/256 | 1.5 | 1.1 | 0.3 | 0.2 | 0.3 | 1.7 | 0.7 | 5.2 (4.1 to 6.4) | 6.0 |
| quiet-ridge/16-levels/512 | 5.5 | 4.5 | 0.6 | 0.4 | 0.4 | 2.1 | 0.8 | 14.2 (13.2 to 16.2) | 15.0 |
| quiet-ridge/16-levels/1024 | 21.9 | 18.0 | 1.6 | 0.9 | 0.6 | 3.2 | 0.8 | 47.4 (43.6 to 52.4) | 48.2 |
| asymmetric-basin/16-levels/256 | 2.8 | 2.9 | 0.4 | 0.0 | 0.3 | 1.4 | 0.9 | 8.0 (7.2 to 8.8) | 8.9 |
| asymmetric-basin/16-levels/512 | 10.4 | 11.5 | 1.0 | 0.1 | 0.5 | 1.8 | 0.9 | 25.4 (23.0 to 27.6) | 26.3 |
| asymmetric-basin/16-levels/1024 | 38.0 | 44.0 | 2.1 | 0.1 | 0.7 | 2.8 | 0.8 | 88.7 (81.7 to 94.8) | 89.6 |
| interference-study/16-levels/256 | 1.0 | 1.9 | 0.3 | 0.0 | 0.4 | 1.9 | 1.3 | 5.7 (5.3 to 6.3) | 7.1 |
| interference-study/16-levels/512 | 4.3 | 7.3 | 0.9 | 0.0 | 0.6 | 2.9 | 1.4 | 16.4 (14.5 to 18.6) | 17.9 |
| interference-study/16-levels/1024 | 17.4 | 29.7 | 3.0 | 0.1 | 1.0 | 4.3 | 1.6 | 55.4 (51.1 to 57.1) | 57.0 |
<!-- /results -->

### Realistic default, as authored

<!-- results:stages-default -->
| Workload | Field | Extract | Join | Clip | Simplify | Topology | Serialize | Pipeline total | Export total |
|---|---|---|---|---|---|---|---|---|---|
| quiet-ridge/default/512 | 5.9 | 4.1 | 0.6 | 0.5 | 0.4 | 1.9 | 0.8 | 13.6 (11.9 to 14.4) | 14.4 |
| asymmetric-basin/default/512 | 9.6 | 13.6 | 1.0 | 0.1 | 0.5 | 2.0 | 1.0 | 27.1 (25.7 to 30.6) | 28.2 |
| interference-study/default/512 | 4.2 | 11.0 | 1.4 | 0.1 | 1.0 | 4.4 | 2.4 | 22.4 (19.5 to 25.1) | 24.7 |
<!-- /results -->

### Largest stress case

Do not read this as a typical result. It exists to find the upper end.

<!-- results:stages-stress -->
| Workload | Field | Extract | Join | Clip | Simplify | Topology | Serialize | Pipeline total | Export total |
|---|---|---|---|---|---|---|---|---|---|
| interference-study/stress-64-levels/1024 | 19.1 | 117.6 | 10.1 | 0.4 | 4.8 | 26.4 | 10.1 | 178.4 (168.6 to 188.4) | 188.3 |
<!-- /results -->

### Stage times in Chromium, interference study with 16 levels

<!-- results:chromium-stages -->
| Grid | Field | Extract | Join | Clip | Simplify | Topology | Serialize | Pipeline total |
|---|---|---|---|---|---|---|---|---|
| 256 | 0.8 | 1.3 | 0.3 | 0.0 | 0.4 | 1.8 | 1.2 | 4.8 (4.4 to 5.0) |
| 512 | 4.1 | 5.4 | 0.7 | 0.0 | 0.6 | 2.9 | 1.2 | 14.6 (14.2 to 14.9) |
| 1024 | 16.5 | 21.5 | 2.8 | 0.1 | 0.9 | 6.6 | 1.3 | 49.4 (46.8 to 51.1) |

Canvas draw calls took 0.20 ms at the 95th percentile. That covers recording commands in JavaScript. The browser rasterises later, so it is a lower bound on render cost.
<!-- /results -->

### Editing in Chromium

The same scene and drag for every row. 4x is Chrome's synthetic CPU throttle. "Final" includes the 90 ms wait for the scene to go still. "First frame" is the first animation frame after commit. Animation frame callbacks do not prove what the display showed, and none of this is field INP.

<!-- results:browser -->
| Scene | Mode | CPU | Drafts per run | Input to draft, p50 | Input to draft, p95 | To next frame, p95 | Input to final | Long tasks | Largest frame gap |
|---|---|---|---|---|---|---|---|---|---|
| Target, 512, 16 levels | Worker | 1x | 150 | 9.7 (9.2 to 11.0) | 17.0 (16.9 to 17.2) | 18.1 | 119 (116 to 123) | 0.0 | 25 (24 to 27) |
| Target, 512, 16 levels | Main thread, time sliced | 1x | 150 | 8.1 (7.8 to 8.3) | 9.4 (9.1 to 9.6) | 9.7 | 116 (115 to 118) | 0.0 | 38 (34 to 42) |
| Target, 512, 16 levels | Main thread, blocking | 1x | 150 | 7.6 (7.5 to 7.8) | 9.0 (8.7 to 9.5) | 9.5 | 118 (114 to 123) | 0.0 | 42 (33 to 52) |
| Target, 512, 16 levels | Worker | 4x | 150 | 37.9 (35.6 to 39.8) | 49.3 (41.5 to 65.2) | 53.5 | 125 (117 to 135) | 1.0 | 50 (49 to 50) |
| Target, 512, 16 levels | Main thread, time sliced | 4x | 150 | 47.8 (46.4 to 48.4) | 60.7 (51.7 to 73.6) | 65.1 | 209 (188 to 244) | 1.0 | 65 (58 to 83) |
| Target, 512, 16 levels | Main thread, blocking | 4x | 150 | 10.4 (9.6 to 11.0) | 15.4 (15.0 to 15.8) | 17.9 | 179 (177 to 182) | 2.2 | 104 (100 to 108) |
| Stress, 1024, 64 levels | Worker | 1x | 150 | 25.6 (24.0 to 27.5) | 29.0 (26.8 to 31.0) | 31.8 | 260 (256 to 270) | 0.0 | 40 (35 to 43) |
| Stress, 1024, 64 levels | Main thread, time sliced | 1x | 150 | 10.8 (10.6 to 10.9) | 27.7 (13.1 to 32.7) | 36.3 | 237 (234 to 240) | 1.0 | 65 (59 to 68) |
| Stress, 1024, 64 levels | Main thread, blocking | 1x | 150 | 10.4 (10.3 to 10.6) | 12.1 (11.9 to 12.4) | 12.6 | 244 (237 to 249) | 2.0 | 157 (150 to 160) |
<!-- /results -->

**What the worker buys.** I expected the worker to win on draft latency, and it does not. Drafts take a few milliseconds, and a trip to the worker and back costs more than that. At 1x on the target scene, input to draft at the 95th percentile is 17 ms through the worker and about 9 ms on the main thread.

What the worker limits is the worst stall on the main thread. The largest frame gap is 25 ms against 42 ms on the target scene, and 40 ms against 157 ms on the stress scene, with 0 long tasks against 2. Time slicing on the main thread gets part of the way, at 65 ms on the stress scene. So the worker is justified, by less than I first thought, and mainly for heavy scenes and slow machines.

The first measurement said otherwise. It showed the worker ahead by a factor of 18, because my main thread baseline waited on a clamped timer after every step. A bracketing control and a closer look exposed that, as [BENCH_PLAN.md](BENCH_PLAN.md) records. Do not quote the earlier runs' main thread numbers.

Under the 4x throttle, input to draft at p95 is 49 ms with the worker, which is above 33 ms. That is not a pass criterion, because the throttle is synthetic. It suggests a slower machine needs a lower draft grid.

## Size and error

Each row compares a composition with itself. "Allowed" is the tolerance. "Bound" adds rounding. "Sampled" is measured from the parsed SVG to the extracted lines every 0.25 units, and it is an estimate. "Guard" is sampled plus half the spacing, which is a true upper bound on the measured quantity. "Grid" is a first-order estimate of distance to the true isoline, sampled every 2 units. It is a separate error, and simplification does not reduce it.

<!-- results:size -->
| Scene | Allowed | Nodes | Paths | Bytes | Gzip | Time ms | Bound | Sampled | Guard | Grid max | Grid RMS | Crossings | Fallbacks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| quiet-ridge | 0.05 | 12,104 to 3,090 | 27 to 27 | 83.3 KB to 24.8 KB | 18.9 KB to 8.0 KB | 49 | 0.121 | 0.103 | 0.228 | 0.767 | 0.0199 | 0 | 0 |
| quiet-ridge | 0.15 | 12,104 to 1,771 | 27 to 27 | 83.3 KB to 15.4 KB | 18.9 KB to 5.4 KB | 23 | 0.221 | 0.190 | 0.315 | 0.767 | 0.0199 | 0 | 0 |
| quiet-ridge | 0.5 | 12,104 to 967 | 27 to 27 | 83.3 KB to 9.2 KB | 18.9 KB to 3.5 KB | 14 | 0.571 | 0.520 | 0.645 | 0.767 | 0.0199 | 0 | 0 |
| asymmetric-basin | 0.05 | 20,460 to 4,618 | 27 to 27 | 176.5 KB to 44.2 KB | 50.9 KB to 15.3 KB | 29 | 0.057 | 0.054 | 0.179 | 0.095 | 0.0053 | 0 | 0 |
| asymmetric-basin | 0.15 | 20,460 to 2,720 | 27 to 27 | 176.5 KB to 27.6 KB | 50.9 KB to 10.2 KB | 32 | 0.157 | 0.153 | 0.278 | 0.095 | 0.0053 | 0 | 0 |
| asymmetric-basin | 0.5 | 20,460 to 1,511 | 27 to 27 | 176.5 KB to 16.7 KB | 50.9 KB to 6.5 KB | 31 | 0.507 | 0.504 | 0.629 | 0.095 | 0.0053 | 0 | 0 |
| interference-study | 0.05 | 29,554 to 9,034 | 75 to 75 | 258.3 KB to 86.7 KB | 82.2 KB to 28.8 KB | 28 | 0.057 | 0.054 | 0.179 | 0.362 | 0.0100 | 0 | 0 |
| interference-study | 0.15 | 29,554 to 5,169 | 75 to 75 | 258.3 KB to 52.1 KB | 82.2 KB to 18.7 KB | 21 | 0.157 | 0.153 | 0.278 | 0.362 | 0.0100 | 0 | 0 |
| interference-study | 0.5 | 29,554 to 2,795 | 75 to 75 | 258.3 KB to 30.5 KB | 82.2 KB to 11.6 KB | 26 | 0.507 | 0.501 | 0.626 | 0.362 | 0.0100 | 0 | 0 |
<!-- /results -->

Simplification removes nodes from the composition and does nothing for grid error. Quiet ridge has the largest grid estimate, 0.767 units at worst, with an RMS of a small fraction of that. The worst points are near saddles, where the slope is nearly flat and a first-order estimate inflates. So the worst value is an estimate, and it is the number to treat with most care.

A coarser setting saves less each time. Going from Balanced to Light at 0.5 units almost halves the nodes, for three times the allowed error.

Fallback did not occur in any row here. It occurs at far coarser tolerances, or where lines sit closer than the tolerance, and `test/regressions` has examples.

## Export compatibility

**Render compatibility.** The three starter exports were rendered at 1200 px wide in Chromium 148, Firefox 157, WebKit 27.2 and resvg 2.6.2. The check compares where ink lies, as distance to the nearest ink in the other render. Every pair stayed within 1 px. A seeded control that moves one path by 4 units reads 4 to 5 px, so the check can see a real shift. This check resolves whole pixels, so it cannot see the 32-bit drift bound in `docs/GEOMETRY.md`. Raw data: `results/compat/latest.json`.

**Well-formedness.** All three files pass `xmllint`.

**Path editing compatibility.** This is a separate claim from rendering. All three files were loaded into paper.js 0.17, a vector library with its own path model. Path counts, node counts and closed path counts match the file exactly. Moving one node and writing the file back worked. paper.js is not a desktop editor.

**External editors.** None verified. Inkscape and Illustrator are not installed here, and the Figma connection needs a sign-in that was not available. Opening a file in one of these is the next check.

**Clean consumer.** A new folder with its own install built the React component and loaded the SVG file. Both produced the same path data, with type checking on and no console errors. Raw data: `results/consumer/latest.json`.

**Static release.** The 305 KB tarball, unpacked under `/projects/contour/` on a plain file server, loads its worker and fonts and makes no request outside that path. Raw data: `results/release/latest.json`.

## Browser inspection

I inspected real renders in three passes. Screenshots are in `docs/media`.

**Typography and layout.** Panels, numbers and the status line at 1440, 768, 390 and 320 CSS pixels and at 200 percent zoom. Fixed in this pass: Download fell below the fold, the Empty sheet card overflowed, and quiet text had low contrast.

**Interaction and motion.** A drag keeps up with the pointer and the status line changes state. Fixed in this pass: unselected ridge spines read as part of the artwork, and a selected ridge stacked many reach circles. Motion is limited to short colour and scale transitions, and they are removed under reduced motion.

**Empty, error and interrupted states.** An empty sheet offers a next step. A bad file lists what is wrong and keeps the scene. A scene too dense to compute stops with a clear status, and undo recovers it. A running final is cancelled by the next edit.

Touch was driven through Chrome's touch emulation on a phone-sized viewport. I have not tested on a physical phone.

## What failed

Real failures, kept here because they changed the design. Details are in [RESEARCH.md](RESEARCH.md).

- **Topology claim.** My first proof left out rounding. An independent review found rounded paths crossing through a vertex and swapping sides, with the crossing check reporting 0. That is fixed with a separation rule.
- **The superseded job test.** It passed for a long time with no job ever being cancelled. Counting real cancellations exposed a bug in which the export report blocked every draft.
- **The render metric.** Comparing ink amount could not tell WebKit's antialiasing from a moved path. The seeded control caught this.
- **The mutation harness.** After a timeout it read the previous mutant's report as its own, so one kill was recorded for the wrong reason. I found this by reading kill reasons.

## Limits

- **One machine.** All timings come from one fast laptop. Other sessions were running on it, with a load average near 8 during the runs, so these are not quiet machine numbers. The manifest records this.
- **Synthetic throttle.** 4x is an emulation, and it is not a slower laptop.
- **No users.** Nobody outside this project has used it. There is a task script and a self review only.
- **Lab numbers.** These are lab timings from scripted input. They are not field INP. Animation frame callbacks show when the main thread was free, and they do not prove what was displayed.
- **Polylines only.** There is no curve fitting, so a smooth line needs many nodes. Editing nearly 2,000 nodes by hand is possible but tedious.
- **Whole path fallback.** One conflict tightens a whole path, which can cost more nodes than needed.
- **Topology in doubles.** Rule 1 runs on doubles without exact arithmetic. `docs/GEOMETRY.md` states what happens at the finest lattice.
- **Grid error is an estimate.** It is first-order and sampled, and it is not a bound.
- **Portability evidence.** The cross-engine byte comparison covers one workflow's scene on one operating system. The argument for all scenes is the use of IEEE exact operations, which is reasoning and not a measurement.
- **Touch and screen readers.** Touch was emulated. No real phone or screen reader was used.
- **Undo.** History lives in memory and does not survive a reload. The scene does.

## Reproduce

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm test:e2e
pnpm bench
pnpm exec tsx scripts/mutate.ts
pnpm exec tsx scripts/render-compat.ts
pnpm exec tsx scripts/verify-consumer.ts
pnpm exec tsx scripts/verify-release.ts
sh scripts/verify-clean.sh
```
