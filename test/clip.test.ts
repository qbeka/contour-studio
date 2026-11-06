import { describe, expect, it } from 'vitest';
import { clipPath } from '../src/core/clip';
import type { Polyline } from '../src/core/contour';
import { pointsOf } from './support/oracle';

const rect = { x: 10, y: 10, width: 80, height: 80 };
const line = (...values: number[]): Polyline => ({
  points: new Float64Array(values),
  closed: false,
});
const loop = (...values: number[]): Polyline => ({
  points: new Float64Array(values),
  closed: true,
});

describe('clipping', () => {
  it('leaves an inside path alone, including a closed one', () => {
    const path = loop(20, 20, 40, 20, 30, 40);
    expect(clipPath(path, rect)).toEqual([path]);
  });

  it('removes a path entirely outside', () => {
    expect(clipPath(line(0, 0, 5, 5, 0, 8), rect)).toEqual([]);
  });

  it('cuts a line that crosses the rectangle at the exact edge', () => {
    const parts = clipPath(line(0, 50, 100, 50), rect);
    expect(parts).toHaveLength(1);
    expect(pointsOf(parts[0])).toEqual([
      [10, 50],
      [90, 50],
    ]);
  });

  it('splits a line that leaves and returns into two parts', () => {
    const parts = clipPath(line(20, 50, 120, 50, 120, 70, 20, 70), rect);
    expect(parts).toHaveLength(2);
  });

  it('turns a closed loop crossing the edge into one open fragment', () => {
    const parts = clipPath(loop(50, 0, 80, 50, 50, 80, 20, 50), rect);
    expect(parts).toHaveLength(1);
    expect(parts[0].closed).toBe(false);
    const pts = pointsOf(parts[0]);
    expect(pts[0][1]).toBe(10);
    expect(pts[pts.length - 1][1]).toBe(10);
  });

  it('keeps a fragment whole when the loop starts inside', () => {
    // The same loop with its start vertex rotated into the inside.
    const parts = clipPath(loop(50, 80, 20, 50, 50, 0, 80, 50), rect);
    expect(parts).toHaveLength(1);
    expect(pointsOf(parts[0])).toHaveLength(5);
  });

  it('counts a point on the edge as inside', () => {
    const path = line(10, 10, 90, 90);
    expect(clipPath(path, rect)).toEqual([path]);
  });

  it('a closed loop touching the edge from inside stays closed', () => {
    const path = loop(10, 50, 50, 20, 80, 50, 50, 80);
    const parts = clipPath(path, rect);
    expect(parts).toHaveLength(1);
    expect(parts[0].closed).toBe(true);
  });

  it('a vertical line exactly on the edge stays', () => {
    const parts = clipPath(line(10, 0, 10, 100), rect);
    expect(parts).toHaveLength(1);
    expect(pointsOf(parts[0])).toEqual([
      [10, 10],
      [10, 90],
    ]);
  });
});
