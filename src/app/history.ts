/** Undo history as plain data. Entries share structure, so they cost very little. */

const LIMIT = 200;

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export function record<T>(history: History<T>, next: T): History<T> {
  if (next === history.present) return history;
  const past = [...history.past, history.present];
  if (past.length > LIMIT) past.shift();
  return { past, present: next, future: [] };
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;
  const past = history.past.slice();
  const present = past.pop() as T;
  return { past, present, future: [history.present, ...history.future] };
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;
  const [present, ...future] = history.future;
  return { past: [...history.past, history.present], present, future };
}
