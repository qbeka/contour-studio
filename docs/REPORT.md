# Report

What Contour measures, what the evidence shows, and where it stops. The plan was committed before the final run: [BENCH_PLAN.md](BENCH_PLAN.md). Tables between markers are generated from the raw results by `scripts/report-tables.ts`.

## Summary

PENDING

## Environment

<!-- results:environment -->
<!-- /results -->

## Pass criteria

<!-- results:criteria -->
<!-- /results -->

## Correctness

These are tests, separate from the performance numbers below.

PENDING-CORRECTNESS

## Performance

All values are milliseconds. One value per run is the median of 5 measured iterations after 3 warmup iterations. Each cell is the mean of the runs, and ranges are the run minimum and maximum.

### Stage times in Node, target workloads

<!-- results:stages-target -->
<!-- /results -->

### Realistic default, as authored

<!-- results:stages-default -->
<!-- /results -->

### Largest stress case

Do not read this as a typical result. It exists to find the upper end.

<!-- results:stages-stress -->
<!-- /results -->

### Stage times in Chromium, interference study with 16 levels

<!-- results:chromium-stages -->
<!-- /results -->

### Editing in Chromium

The same scene and drag for every row. 4x is Chrome's synthetic CPU throttle. "Final" includes the 90 ms wait for the scene to go still. "First frame" is the first animation frame after commit. Animation frame callbacks do not prove what the display showed, and none of this is field INP.

<!-- results:browser -->
<!-- /results -->

PENDING-WORKER

## Size and error

Each row compares a composition with itself. "Allowed" is the tolerance. "Bound" adds rounding. "Sampled" is measured from the parsed SVG to the extracted lines every 0.25 units, and it is an estimate. "Guard" is sampled plus half the spacing, which is a true upper bound on the measured quantity. "Grid" is a first-order estimate of distance to the true isoline, sampled every 2 units. It is a separate error, and simplification does not reduce it.

<!-- results:size -->
<!-- /results -->

PENDING-SIZE

## Export compatibility

PENDING-COMPAT

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

PENDING-LIMITS

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
