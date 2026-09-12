import { describe, expect, it } from 'vitest';
import { minMaxDownsample, minMaxDownsampleFrom } from '../store/minMaxDownsample';

/** Legacy stride fixture — test-only, never production. */
function legacyStride(xs: number[], ys: number[], maxPoints: number): { xs: number[]; ys: number[] } {
  const n = xs.length;
  const stride = Math.max(1, Math.ceil(n / maxPoints));
  const oxs: number[] = [];
  const oys: number[] = [];
  for (let i = 0; i < n; i += stride) {
    oxs.push(xs[i]!);
    oys.push(ys[i]!);
  }
  return { xs: oxs, ys: oys };
}

function assertMonotonic(xs: number[]): void {
  for (let i = 1; i < xs.length; i++) {
    expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]!);
  }
}

describe('minMaxDownsample', () => {
  it('A: returns exact copy when n <= maxPoints', () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = [10, 20, 30, 40, 50];
    const r = minMaxDownsample(xs, ys, 5);
    expect(r.xs).toEqual(xs);
    expect(r.ys).toEqual(ys);
    const r2 = minMaxDownsample(xs, ys, 100);
    expect(r2.ys).toEqual(ys);
  });

  it('B: preserves a single positive spike', () => {
    const n = 1000;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      xs.push(i);
      ys.push(0);
    }
    ys[377] = 100;
    const r = minMaxDownsample(xs, ys, 100);
    expect(r.ys).toContain(100);
    expect(r.xs).toContain(377);
    expect(r.xs.length).toBeLessThanOrEqual(100);
  });

  it('C: preserves a single negative spike', () => {
    const n = 1000;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      xs.push(i);
      ys.push(0);
    }
    ys[200] = -100;
    const r = minMaxDownsample(xs, ys, 100);
    expect(r.ys).toContain(-100);
    expect(r.xs).toContain(200);
  });

  it('D: emits min before max when min is earlier in the bucket', () => {
    // One middle bucket (maxPoints=4 → middleBudget=2 → bucketCount=1)
    const xs = [0, 1, 2, 3, 4, 5];
    const ys = [0, -5, 10, 3, 0, 0]; // min at t=1, max at t=2
    const r = minMaxDownsample(xs, ys, 4);
    expect(r.xs[0]).toBe(0);
    expect(r.xs[r.xs.length - 1]).toBe(5);
    const midX = r.xs.slice(1, -1);
    const midY = r.ys.slice(1, -1);
    expect(midX).toEqual([1, 2]);
    expect(midY).toEqual([-5, 10]);
  });

  it('E: emits max before min when max is earlier in the bucket', () => {
    const xs = [0, 1, 2, 3, 4, 5];
    const ys = [0, 10, -5, 3, 0, 0]; // max at t=1, min at t=2
    const r = minMaxDownsample(xs, ys, 4);
    const midX = r.xs.slice(1, -1);
    const midY = r.ys.slice(1, -1);
    expect(midX).toEqual([1, 2]);
    expect(midY).toEqual([10, -5]);
  });

  it('F: does not duplicate when minIndex === maxIndex', () => {
    // Flat middle except first/last differ so downsampling kicks in
    const n = 50;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      xs.push(i);
      ys.push(7);
    }
    ys[0] = 0;
    ys[n - 1] = 1;
    const r = minMaxDownsample(xs, ys, 10);
    // no repeated identical (x,y) adjacent pairs from single-point buckets
    for (let i = 1; i < r.xs.length; i++) {
      expect(r.xs[i] === r.xs[i - 1] && r.ys[i] === r.ys[i - 1]).toBe(false);
    }
    expect(r.xs.length).toBeLessThanOrEqual(10);
  });

  it('G: tiny maxPoints budgets do not crash or exceed', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i);
    const ys = Array.from({ length: 100 }, (_, i) => (i === 50 ? 999 : i));
    for (const maxPoints of [1, 2, 3, 4, 5]) {
      const r = minMaxDownsample(xs, ys, maxPoints);
      expect(r.xs.length).toBeLessThanOrEqual(maxPoints);
      expect(r.xs.length).toBeGreaterThan(0);
      assertMonotonic(r.xs);
    }
    expect(minMaxDownsample(xs, ys, 1).ys).toEqual([99]);
    expect(minMaxDownsample(xs, ys, 2).xs).toEqual([0, 99]);
  });

  it('H: non-divisible bucket keeps tail (first and last)', () => {
    const n = 1003;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = Array.from({ length: n }, (_, i) => i * 0.01);
    ys[n - 2] = 50; // near-end spike
    const r = minMaxDownsample(xs, ys, 100);
    expect(r.xs[0]).toBe(0);
    expect(r.xs[r.xs.length - 1]).toBe(n - 1);
    expect(r.ys).toContain(50);
    expect(r.xs.length).toBeLessThanOrEqual(100);
    assertMonotonic(r.xs);
  });

  it('deterministic comparison: stride misses spike, minmax keeps it', () => {
    const n = 10_000;
    const maxPoints = 100;
    const stride = Math.max(1, Math.ceil(n / maxPoints)); // 100
    const spikeIndex = stride + 1; // not divisible by stride
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      xs.push(i);
      ys.push(0);
    }
    ys[spikeIndex] = 1234;

    const legacy = legacyStride(xs, ys, maxPoints);
    expect(legacy.ys).not.toContain(1234);

    const mm = minMaxDownsample(xs, ys, maxPoints);
    expect(mm.ys).toContain(1234);
    expect(mm.xs).toContain(spikeIndex);
    expect(mm.xs.length).toBeLessThanOrEqual(maxPoints);
  });

  it('handles empty / zero budget', () => {
    expect(minMaxDownsample([], [], 10)).toEqual({ xs: [], ys: [] });
    expect(minMaxDownsample([1, 2], [3, 4], 0)).toEqual({ xs: [], ys: [] });
  });

  it('from-readers matches array API', () => {
    const xs = Array.from({ length: 200 }, (_, i) => i);
    const ys = Array.from({ length: 200 }, (_, i) => (i === 99 ? 42 : 0));
    const a = minMaxDownsample(xs, ys, 50);
    const b = minMaxDownsampleFrom(200, (i) => xs[i]!, (i) => ys[i]!, 50);
    expect(b).toEqual(a);
  });
});
