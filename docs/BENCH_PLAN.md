# Benchmark plan

This plan was committed before the final measurement. The workload lives in `bench/workload.ts`. Changing either one means earlier results no longer compare.

## Reference machine

MacBook Pro, Apple M5 Pro, model Mac17,9, 48 GB of memory, on AC power, macOS. The exact versions go in each run's `manifest.json`.

This is a fast laptop. The brief's first target, 500 ms, was written for a named reference laptop, and this is the one available. To show what a slower machine might see, each browser run is repeated with Chrome's CPU throttle at 4x. That throttle is synthetic. It is not a measurement of a real slower laptop.

## Workloads

| Group | Scenes | Grid | Levels |
|---|---|---|---|
| Target | Quiet ridge, asymmetric basin, interference study | 256, 512, 1024 | 16 |
| Realistic default | The same three, as authored | 512 | 14, 20, 24 |
| Stress | Interference study, 4 octaves, tolerance 0.05, 3 decimals | 1024 | 64 |

"16 levels" keeps each scene's height range and divides it into 16 lines.

The browser workload is the interference study at 512 with 16 levels, the densest target. One source is dragged with real pointer events along a fixed loop of 150 steps at a 16 ms pace, then released to refine.

## Metrics

- **Stage times**: field, extract, join, clip, simplify, topology, serialize, and their total.
- **Input to draft**: pointer event to draft geometry committed, and to the next animation frame after that.
- **Input to final**: pointer event to final geometry committed. This includes the 90 ms wait for the scene to go still.
- **Main thread availability**: long tasks, and the largest gap between animation frames. These do not prove displayed frame rate.
- **Size**: nodes, paths, bytes, gzip bytes (level 9), against the unsimplified file for the same composition at the same decimals.
- **Error**: declared bound, sampled distance from the parsed SVG to the extracted lines at 0.25 unit spacing, its guard, and a sampled grid error estimate.

## Protocol

- 7 independent stage runs, each in a new Node process.
- 5 independent browser runs per configuration, each in a new Chromium.
- 3 warmup iterations are discarded per workload. 5 measured iterations follow.
- One number per run: the median of its iterations. Reported values are the mean, minimum, maximum and standard deviation across runs.
- No run or iteration is excluded. A failure stops the benchmark.

## Baselines

- **Worker**: the same app on the main thread, with the same scene, the same drag and the same grids. Two forms bracket it: time sliced (`?worker=off`), and blocking with no yields (`?worker=blocking`).
- **Size**: the same composition with nothing removed. Unrelated scenes are never compared.

## Pass criteria

1. A refined 512 by 512 scene with 16 levels takes at most 500 ms in Chromium on every target scene.
2. Edit to draft at the 95th percentile is at most 33 ms with the worker at 1x.
3. With the worker at 1x, the drag produces no long task.
4. Every row of the size table has 0 crossings, keeps every path, and has a sampled distance within its declared bound.

A missed target is reported as missed, with the next bounded improvement.

## Amendment after the first run

The first full run, kept in `results/bench-2026-11-06T07-27-37-828Z`, showed a main thread draft of 142 ms against a pipeline of about 15 ms. That gap came from the baseline and not from the work. It yielded through `setTimeout` after each step, and browsers clamp chained timers to 4 ms, which stacked up across levels. Comparing the worker with it would have overstated the worker's value.

So I changed the baseline after seeing a result, and I am stating that here. The main thread path now yields in the same time slices and by the same method as the worker. I added a blocking form as the other extreme. The criteria, workloads and metrics did not change. The first run's worker numbers stand, and its main thread numbers must not be quoted.

## Amendment after the second run

With a fair baseline, the worker lost on draft latency, 8 ms against 2 ms. Two things in the measurement needed correcting before drawing a conclusion. Both changes were made after seeing that result, and the second run is kept in `results/bench-2026-11-06T07-32-09-549Z`.

1. **The clock.** Edit to draft started when the handler ran, so input queued behind a busy main thread cost nothing. That favoured blocking work. The clock now starts at the pointer event's own timestamp, and the metric is called input to draft.
2. **The workload.** The target drag scene finishes within a frame on this machine, so it cannot show when a worker matters. The declared stress scene now also runs the same drag at 1x.

Pass criteria did not change.
