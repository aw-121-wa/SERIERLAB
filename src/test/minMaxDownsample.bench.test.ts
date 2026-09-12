import { describe, it } from 'vitest';
import { minMaxDownsample } from '../store/minMaxDownsample';

/**
 * Non-CI timing helper for Min/Max envelope.
 * Logs wall time only — no pass/fail threshold.
 */
describe('minMaxDownsample bench (informational)', () => {
  it('reports downsample cost at scale', () => {
    const n = 200_000;
    const channels = 8;
    const maxPoints = 2000;
    const series = Array.from({ length: channels }, (_, c) => {
      const xs = new Float64Array(n);
      const ys = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        xs[i] = i;
        ys[i] = Math.sin(i / 50) + (i % 1000 === 0 ? 50 : 0);
      }
      return { xs, ys, c };
    });

    const t0 = performance.now();
    for (const s of series) {
      const r = minMaxDownsample(s.xs, s.ys, maxPoints);
      if (r.xs.length > maxPoints) throw new Error('budget exceeded');
    }
    const ms = performance.now() - t0;
    console.info(
      `[bench] minmax ${channels}ch × ${n} pts → ≤${maxPoints} | ${ms.toFixed(1)}ms total, ${(ms / channels).toFixed(1)}ms/ch`
    );
  });
});
