/**
 * Gives the event queue a turn. A MessageChannel task runs right away, where a
 * chained setTimeout is clamped to 4 ms and would add a delay per step.
 */

const SLICE_MS = 6;

const channel = new MessageChannel();
let resume: (() => void) | null = null;
channel.port1.onmessage = () => resume?.();

export function yieldToQueue(): Promise<void> {
  return new Promise((resolve) => {
    resume = resolve;
    channel.port2.postMessage(0);
  });
}

/** Yields only once a time slice has passed since the last yield. */
export function sliceTimer(): () => Promise<void> {
  let last = performance.now();
  return async () => {
    if (performance.now() - last < SLICE_MS) return;
    await yieldToQueue();
    last = performance.now();
  };
}
