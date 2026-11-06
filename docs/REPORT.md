# Report

What Contour measures, what the evidence shows, and where it stops. The plan was committed before the final run: [BENCH_PLAN.md](BENCH_PLAN.md). Tables between markers are generated from the raw results by `scripts/report-tables.ts`.

## Summary

<!-- results:summary -->
All four pass criteria passed on the reference laptop. A refined scene with 512 cells on its long side and 16 levels takes 12 to 20 ms in Chromium across the three scenes, against a 500 ms target. That target was written for a slower machine, so this margin says little about other hardware.

Simplifying the same composition removes 83 to 87 percent of its nodes and 71 to 80 percent of its gzipped size at the Balanced setting, with no crossing and no lost path in any row.

The worker does not make drafts faster. It keeps the page from freezing. On the stress scene the largest frame gap is 25 ms with the worker, against 204 ms with blocking work on the main thread.
<!-- /results -->

## Environment

<!-- results:environment -->
- Commit `8427d38491bca70747f3a78fe8f2a810a0f10fa5`, 2026-11-06T08:37:07.148Z
- Apple M5 Pro, model Mac17,9, 48 GB, 18 logical cores
- macOS 26.6.2, Node v22.16.0, Chromium 148.0.7778.96
- Power: Now drawing from 'AC Power'
- Load average at the end of the run: 6.0, 6.7, 7.3
- Raw samples: `results/bench-2026-11-06T08-34-14-463Z/raw`. Manifest: `results/bench-2026-11-06T08-34-14-463Z/manifest.json`.
<!-- /results -->

## Pass criteria

<!-- results:criteria -->
| Criterion | Result |
|---|---|
| Refined at a 512 cell long side, 16 levels, within 500 ms in Chromium on all three target scenes | Passed |
| Input to draft at p95 within 33 ms, worker | Passed |
| No long task from mouse down to the end of the report, worker | Passed |
| No crossings, no lost paths, sampled distance within the bound | Passed |
<!-- /results -->

## Correctness

These are tests, separate from the performance numbers below.

| Check | Result | Where |
|---|---|---|
| Unit, property and regression tests | 178 passed | `pnpm test` |
| Browser tests | 41 passed, the core workflow in three engines | `pnpm test:e2e` |
| Random scenes through every rule | 120 scenes, plus 300 crowded scenes with lines packed tighter than the rounding lattice | `test/properties.test.ts` |
| Same SVG bytes in Chromium, Firefox, WebKit and Node | Identical for the workflow's scene | `e2e/app.spec.ts` |
| Same SVG bytes with and without the worker | Identical | `e2e/app.spec.ts` |
| Same SVG bytes at display scales 1, 2 and 3 | Identical | `e2e/app.spec.ts` |
| Source mutations | 69 of 70 killed by a named test, in the unit and browser suites. 1 timed out, and its targeted test fails on it when run alone | `results/mutations/latest.json` |
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
| quiet-ridge/16-levels/256 | 1.4 | 1.1 | 0.2 | 0.2 | 0.3 | 1.5 | 0.7 | 4.8 (4.2 to 5.3) | 5.5 |
| quiet-ridge/16-levels/512 | 5.1 | 4.4 | 0.4 | 0.4 | 0.4 | 2.0 | 0.7 | 12.8 (11.4 to 14.1) | 13.6 |
| quiet-ridge/16-levels/1024 | 20.5 | 17.1 | 1.2 | 0.9 | 0.6 | 3.0 | 0.7 | 43.9 (38.3 to 52.3) | 44.6 |
| asymmetric-basin/16-levels/256 | 2.5 | 2.8 | 0.3 | 0.0 | 0.3 | 1.2 | 0.8 | 7.2 (6.6 to 8.0) | 8.0 |
| asymmetric-basin/16-levels/512 | 9.7 | 11.2 | 0.7 | 0.0 | 0.4 | 1.7 | 0.7 | 23.7 (22.3 to 25.5) | 24.5 |
| asymmetric-basin/16-levels/1024 | 36.7 | 42.1 | 1.6 | 0.1 | 0.7 | 2.5 | 0.7 | 84.3 (76.5 to 93.9) | 85.1 |
| interference-study/16-levels/256 | 1.0 | 1.8 | 0.3 | 0.0 | 0.4 | 1.9 | 1.2 | 5.5 (4.8 to 6.9) | 6.7 |
| interference-study/16-levels/512 | 4.1 | 7.3 | 0.8 | 0.0 | 0.6 | 2.7 | 1.4 | 16.1 (14.6 to 18.2) | 17.5 |
| interference-study/16-levels/1024 | 16.9 | 30.0 | 2.3 | 0.1 | 0.9 | 3.8 | 1.4 | 54.9 (48.9 to 61.6) | 56.3 |
<!-- /results -->

### Realistic default, as authored

<!-- results:stages-default -->
| Workload | Field | Extract | Join | Clip | Simplify | Topology | Serialize | Pipeline total | Export total |
|---|---|---|---|---|---|---|---|---|---|
| quiet-ridge/default/512 | 5.2 | 3.9 | 0.4 | 0.4 | 0.4 | 1.7 | 0.7 | 12.1 (10.8 to 13.6) | 12.8 |
| asymmetric-basin/default/512 | 9.1 | 13.0 | 0.8 | 0.0 | 0.5 | 1.9 | 0.9 | 25.6 (23.7 to 29.0) | 26.5 |
| interference-study/default/512 | 3.9 | 11.0 | 1.1 | 0.1 | 0.9 | 4.0 | 2.0 | 21.2 (19.1 to 22.9) | 23.3 |
<!-- /results -->

### Largest stress case

Do not read this as a typical result. It exists to find the upper end.

<!-- results:stages-stress -->
| Workload | Field | Extract | Join | Clip | Simplify | Topology | Serialize | Pipeline total | Export total |
|---|---|---|---|---|---|---|---|---|---|
| interference-study/stress-64-levels/1024 | 18.9 | 118.2 | 7.6 | 0.3 | 4.7 | 24.1 | 9.2 | 174.6 (158.8 to 191.3) | 183.4 |
<!-- /results -->

### Stage times in Chromium, 16 levels

<!-- results:chromium-stages -->
| Scene | Grid | Field | Extract | Join | Clip | Simplify | Topology | Serialize | Pipeline total |
|---|---|---|---|---|---|---|---|---|---|
| quiet-ridge | 256 by 102 | 1.2 | 0.8 | 0.3 | 0.3 | 0.3 | 1.5 | 0.6 | 4.5 (4.3 to 4.7) |
| quiet-ridge | 512 by 205 | 5.6 | 3.3 | 0.5 | 0.3 | 0.4 | 2.2 | 0.6 | 12.7 (11.6 to 13.7) |
| quiet-ridge | 1024 by 410 | 19.0 | 12.7 | 1.3 | 0.6 | 0.6 | 4.6 | 0.6 | 39.4 (36.3 to 42.0) |
| asymmetric-basin | 256 by 256 | 2.3 | 2.0 | 0.2 | 0.0 | 0.3 | 1.0 | 0.6 | 5.9 (5.6 to 6.3) |
| asymmetric-basin | 512 by 512 | 9.0 | 7.6 | 0.6 | 0.0 | 0.4 | 1.5 | 0.6 | 19.6 (18.5 to 20.4) |
| asymmetric-basin | 1024 by 1024 | 34.5 | 29.7 | 2.5 | 0.0 | 0.6 | 4.0 | 0.5 | 72.6 (69.2 to 75.8) |
| interference-study | 256 by 171 | 0.9 | 1.3 | 0.3 | 0.0 | 0.4 | 1.6 | 0.9 | 4.5 (4.3 to 4.9) |
| interference-study | 512 by 341 | 3.7 | 5.0 | 0.5 | 0.0 | 0.5 | 2.1 | 1.0 | 12.2 (11.7 to 12.9) |
| interference-study | 1024 by 683 | 15.7 | 20.6 | 2.8 | 0.1 | 0.9 | 7.2 | 1.2 | 48.6 (46.3 to 51.6) |

Canvas draw calls took 0.20 ms at the 95th percentile. That covers recording commands in JavaScript. The browser rasterises later, so it is a lower bound on render cost.
<!-- /results -->

### Editing in Chromium

Times are in milliseconds. Each row runs the same drag. The drag is open loop, so a busy main thread cannot slow its own input, and drafts per run can fall below 150. "Input to final" includes the 90 ms wait for the scene to go still. "To next frame" is the first animation frame after commit. Long tasks and the frame gap cover mouse down until 300 ms after the export report. Animation frame callbacks do not prove what the display showed, and none of this is field INP.

<!-- results:browser -->
| Scene | Mode | Drafts per run | Input to draft, p50 | Input to draft, p95 | To next frame, p95 | Input to final | Long tasks | Largest frame gap |
|---|---|---|---|---|---|---|---|---|
| Target, 512, 16 levels | Worker | 150 | 13.5 (9.3 to 14.9) | 17.0 (16.8 to 17.2) | 18.1 | 124 (122 to 126) | 0.0 | 10 (10 to 10) |
| Target, 512, 16 levels | Main thread, time sliced | 150 | 8.6 (8.2 to 9.1) | 10.4 (10.2 to 10.8) | 10.7 | 117 (114 to 120) | 0.0 | 33 (31 to 35) |
| Target, 512, 16 levels | Main thread, blocking | 150 | 8.5 (8.0 to 8.8) | 10.1 (10.0 to 10.3) | 10.7 | 119 (117 to 122) | 0.0 | 38 (33 to 42) |
| Stress, 1024, 64 levels | Worker | 116 | 35.9 (25.7 to 39.8) | 50.9 (48.5 to 58.1) | 55.6 | 251 (237 to 259) | 0.0 | 25 (18 to 27) |
| Stress, 1024, 64 levels | Main thread, time sliced | 137 | 8.0 (7.2 to 8.5) | 12.9 (10.9 to 14.2) | 16.0 | 231 (226 to 238) | 3.0 | 201 (198 to 208) |
| Stress, 1024, 64 levels | Main thread, blocking | 113 | 9.8 (6.3 to 23.3) | 15.2 (10.9 to 29.3) | 17.5 | 236 (227 to 248) | 4.0 | 204 (200 to 209) |
<!-- /results -->

<!-- results:worker-findings -->
**What the worker buys.** I expected the worker to win on draft latency, and it does not. A trip to the worker and back costs more than a small draft does. Input to draft at the 95th percentile is 17 ms through the worker against 10 ms time sliced and 10 ms blocking on the target scene, and 51 ms against 13 and 15 on the stress scene. On the stress scene the worker misses the 33 ms target. That target applies to the target scene, but a user on a heavy scene will feel it.

What the worker prevents is a frozen page. The largest frame gap, from mouse down to the end of the export report, is 10 ms against 33 and 38 on the target scene, and 25 ms against 201 and 204 on the stress scene. Long tasks per run are 0.0 against 3.0 and 4.0. Time slicing does not help much here, because the largest stalls come from the export report and the final geometry, which run in long synchronous steps.

So the worker is justified. It trades a few milliseconds of latency for a page that stays responsive after a heavy edit.

Getting here took four runs, and only this one should be quoted. The first showed the worker 18 times faster, because of a flawed baseline. The second and third fixed that, but an independent review showed that the window closed before the main thread's report ran, the drag slowed itself down, and the CPU throttle missed the worker. [BENCH_PLAN.md](BENCH_PLAN.md) records each change, and the earlier runs stay in the results folder.
<!-- /results -->

## Size and error

Each row compares a composition with itself. "Tolerance" is the Line detail setting. "Bound" adds rounding, and the proof covers it. "Sampled" is measured from the parsed SVG to the extracted lines every 0.25 units, and it is an estimate. "Guard" is sampled plus half the spacing, which is a true upper bound on the distance to the sampled set. "Grid" is a first-order estimate of distance to the true isoline, sampled every 2 units. "Against 2048 grid" is a sampled distance from the extracted lines at the scene's grid to the same scene at 2048 cells. Grid error is separate, and simplification does not reduce it.

<!-- results:size -->
| Scene | Tolerance | Nodes | Paths | Bytes | Gzip | Time ms | Bound | Sampled | Guard | Grid max | Grid RMS | Against 2048 grid | Crossings | Fallbacks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| quiet-ridge | 0.05 | 12,104 to 3,090 | 27 to 27 | 83.3 KB to 24.8 KB | 18.9 KB to 8.0 KB | 25 | 0.121 | 0.103 | 0.228 | 0.767 | 0.0199 | 0.787 | 0 | 0 |
| quiet-ridge | 0.15 | 12,104 to 1,771 | 27 to 27 | 83.3 KB to 15.4 KB | 18.9 KB to 5.4 KB | 14 | 0.221 | 0.190 | 0.315 | 0.767 | 0.0199 | 0.787 | 0 | 0 |
| quiet-ridge | 0.5 | 12,104 to 967 | 27 to 27 | 83.3 KB to 9.2 KB | 18.9 KB to 3.5 KB | 11 | 0.571 | 0.520 | 0.645 | 0.767 | 0.0199 | 0.787 | 0 | 0 |
| asymmetric-basin | 0.05 | 20,460 to 4,618 | 27 to 27 | 176.5 KB to 44.2 KB | 50.9 KB to 15.3 KB | 27 | 0.057 | 0.054 | 0.179 | 0.095 | 0.0053 | 0.101 | 0 | 0 |
| asymmetric-basin | 0.15 | 20,460 to 2,720 | 27 to 27 | 176.5 KB to 27.6 KB | 50.9 KB to 10.2 KB | 25 | 0.157 | 0.153 | 0.278 | 0.095 | 0.0053 | 0.101 | 0 | 0 |
| asymmetric-basin | 0.5 | 20,460 to 1,511 | 27 to 27 | 176.5 KB to 16.7 KB | 50.9 KB to 6.5 KB | 26 | 0.507 | 0.504 | 0.629 | 0.095 | 0.0053 | 0.101 | 0 | 0 |
| interference-study | 0.05 | 29,554 to 9,034 | 75 to 75 | 258.3 KB to 86.7 KB | 82.2 KB to 28.8 KB | 23 | 0.057 | 0.054 | 0.179 | 0.362 | 0.0100 | 0.340 | 0 | 0 |
| interference-study | 0.15 | 29,554 to 5,169 | 75 to 75 | 258.3 KB to 52.1 KB | 82.2 KB to 18.7 KB | 21 | 0.157 | 0.153 | 0.278 | 0.362 | 0.0100 | 0.340 | 0 | 0 |
| interference-study | 0.5 | 29,554 to 2,795 | 75 to 75 | 258.3 KB to 30.5 KB | 82.2 KB to 11.6 KB | 19 | 0.507 | 0.501 | 0.626 | 0.362 | 0.0100 | 0.340 | 0 | 0 |
<!-- /results -->

<!-- results:grid-findings -->
**Grid error is real, and simplification does not touch it.** The final lines are extracted at a grid, so they are close to the true isolines and not on them. The first-order estimate and an independent reference agree. The reference compares each scene's lines with the same scene at 2048 cells. For quiet-ridge, the estimate is 0.77 units and the reference is 0.79 units. That is at a near-flat saddle, and it is several times the Balanced bound there. The RMS is 0.020 units, so this is a small place in the drawing. A finer grid reduces it, and the error bound in the Export panel does not include it.
<!-- /results -->

A coarser setting saves less each time. Going from Balanced to Light at 0.5 units almost halves the nodes, for three times the allowed error.

Fallback did not occur in any row here. It occurs at far coarser tolerances, or where lines sit closer than the tolerance, and `test/regressions` has examples.

## Export compatibility

**Render compatibility.** The three starter exports, in the default stroke mode, were rendered at 1200 px wide in Chromium 148, Firefox 157, WebKit 27.2 and resvg 2.6.2. The check compares where ink lies, as distance to the nearest ink in the other render. Every pair stayed within 1 px. A seeded control that moves one path by 4 units reads 4 to 5 px, so the check can see a real shift. This check resolves whole pixels, so it cannot see the 32-bit drift bound in `docs/GEOMETRY.md`. Raw data: `results/compat/latest.json`.

**Fixed line weight.** The "Stays the same" option uses `vector-effect`. At twice the size, Chromium, Firefox and WebKit keep the line weight, within 0.1 percent. resvg ignores `vector-effect` and scales the lines, so a fixed stroke file will not hold its weight there. The option is safe in browsers and not in every renderer.

**Well-formedness.** All three files pass `xmllint`.

**Path editing compatibility.** This is a separate claim from rendering. All three files were loaded into paper.js 0.17, a vector library with its own path model. The check asserts that path, node and closed path counts match the file, and that moving one node changes the written output. paper.js is not a desktop editor.

**External editors.** None verified. Inkscape and Illustrator are not installed here, and the Figma connection needs a sign-in that was not available. Opening a file in one of these is the next check.

**Clean consumer.** A new folder with its own install built the React component and loaded the SVG file. Both produced the same path data, with type checking on and no console errors. Raw data: `results/consumer/latest.json`.

**Static release.** The 305 KB tarball, unpacked under `/projects/contour/` on a plain file server, loads its worker and fonts and makes no request outside that path. Raw data: `results/release/latest.json`.

## Browser inspection

I inspected real renders in three passes. Screenshots are in `docs/media`.

**Typography and layout.** Panels, numbers and the status line at 1440, 768, 390 and 320 CSS pixels and at 200 percent zoom. Fixed in this pass: Download fell below the fold, the Empty sheet card overflowed, and quiet text had low contrast.

**Interaction and motion.** A drag follows the pointer and the status line changes state. Fixed in this pass: unselected ridge spines read as part of the artwork, and a selected ridge stacked many reach circles. Motion is limited to short colour and scale transitions, and they are removed under reduced motion.

**Empty, error and interrupted states.** An empty sheet offers a next step. A bad file lists what is wrong and keeps the scene. A scene too dense to compute stops with a clear status, and undo recovers it. A running final is cancelled by the next edit.

Touch was driven through Chrome's touch emulation on a phone-sized viewport. I have not tested on a physical phone.

## What failed

Real failures, kept here because they changed the design. Details are in [RESEARCH.md](RESEARCH.md).

- **Topology claim.** My first proof left out rounding. An independent review found rounded paths crossing through a vertex and swapping sides, with the crossing check reporting 0. That is fixed with a separation rule.
- **The superseded job test.** It passed for a long time with no job ever being cancelled. Counting real cancellations exposed a bug in which the export report blocked every draft.
- **The worker comparison.** It took four runs. See the performance section.
- **Data loss.** A ridge at the source limit, or a peak placed far out at low zoom, made a scene the app could not read back. On reload, autosave then replaced it with a starter. Scenes now stay inside the format, an unreadable save is kept aside, and autosave refuses to store a scene that fails validation.
- **Tests that could not fail.** A typing test passed against the very bug it was written for, because it typed too fast for React's effects to run. Browser mutants exposed this.
- **The render metric.** Comparing ink amount could not tell WebKit's antialiasing from a moved path. The seeded control caught this.
- **The mutation harness.** After a timeout it read the previous mutant's report as its own, so one kill was recorded for the wrong reason. I found this by reading kill reasons.

## Limits

- **One machine.** All timings come from one fast laptop. Other work was running on it during the runs, so these are not quiet machine numbers. The manifest records this.
- **No slower machine.** Chrome's CPU throttle does not reach the worker, so it cannot compare the two fairly, and no slower laptop was available. Latency on one is unknown.
- **No users.** Nobody outside this project has used it. There is a task script and a self review only.
- **Lab numbers.** These are lab timings from scripted input. They are not field INP. Animation frame callbacks show when the main thread was free, and they do not prove what was displayed.
- **Polylines only.** There is no curve fitting, so a smooth line needs many nodes. Editing nearly 2,000 nodes by hand is possible but tedious.
- **Whole path fallback.** One conflict tightens a whole path, which can cost more nodes than needed.
- **Topology in doubles.** Rule 1 runs on doubles without exact arithmetic. `docs/GEOMETRY.md` states what happens at the finest lattice.
- **Grid error has no bound.** The estimate and the reference are sampled, and they agree, but neither is a guarantee. Export bounds do not include grid error.
- **Portability evidence.** The cross-engine byte comparison covers one workflow's scene on one operating system. The argument for all scenes is the use of IEEE exact operations, which is reasoning and not a measurement.
- **Fixed stroke.** It depends on `vector-effect`, which resvg ignores.
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
