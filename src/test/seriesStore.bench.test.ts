import { describe, it } from 'vitest';
import { SeriesStore } from '../store/seriesStore';

/** Legacy shift-based store kept only as a bench fixture (not production). */
class ShiftSeriesStore {
  private xs = new Map<string, number[]>();
  private ys = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly maxPointsPerChannel = 20_000
  ) {}

  append(tMs: number, values: number[], channelIds: string[]): void {
    for (let i = 0; i < channelIds.length; i++) {
      const id = channelIds[i]!;
      const v = values[i];
      if (v === undefined || !Number.isFinite(v)) continue;
      if (!this.xs.has(id)) {
        this.xs.set(id, []);
        this.ys.set(id, []);
      }
      const xs = this.xs.get(id)!;
      const ys = this.ys.get(id)!;
      xs.push(tMs);
      ys.push(v);
      while (xs.length > this.maxPointsPerChannel) {
        xs.shift();
        ys.shift();
      }
      const cutoff = tMs - this.windowMs;
      while (xs.length && xs[0]! < cutoff) {
        xs.shift();
        ys.shift();
      }
    }
  }
}

/**
 * Non-CI timing helper: 8 channels × 50k samples (capacity + time eviction).
 * Logs wall time only — no pass/fail threshold (machines differ).
 */
describe('SeriesStore bench (informational)', () => {
  it('reports append cost for ring vs shift fixture', () => {
    const channels = Array.from({ length: 8 }, (_, i) => `ch${i}`);
    const samplesPerCh = 50_000;
    const capacity = 20_000;
    const windowMs = 25_000;
    const values = channels.map((_, i) => i + 0.5);

    const ring = new SeriesStore(windowMs, capacity);
    let t = performance.now();
    for (let i = 0; i < samplesPerCh; i++) {
      ring.append(i, values, channels);
    }
    const ringMs = performance.now() - t;

    const shift = new ShiftSeriesStore(windowMs, capacity);
    t = performance.now();
    for (let i = 0; i < samplesPerCh; i++) {
      shift.append(i, values, channels);
    }
    const shiftMs = performance.now() - t;

    console.info(
      `[bench] 8ch × ${samplesPerCh} samples (cap=${capacity}, win=${windowMs}ms) | ring=${ringMs.toFixed(1)}ms shift=${shiftMs.toFixed(1)}ms ratio=${(shiftMs / Math.max(ringMs, 0.001)).toFixed(2)}x`
    );
  });
});
