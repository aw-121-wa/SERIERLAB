import { describe, it } from 'vitest';
import { PlotPresenter } from '../plot/plotPresenter';
import { SeriesStore } from '../store/seriesStore';

/**
 * Non-CI metrics: legacy full-window vs snapshot+delta transfer.
 * Logs counts/bytes only — no machine-dependent pass/fail threshold.
 */
describe('plot sync bench (informational)', () => {
  it('compares legacy full snapshot vs snapshot+delta transfer', () => {
    const channels = 8;
    const hz = 1000;
    const seconds = 10;
    const totalSamples = hz * seconds; // per channel
    const flushMs = 50;
    const flushes = (seconds * 1000) / flushMs;
    const ids = Array.from({ length: channels }, (_, i) => `ch${i}`);
    const values = ids.map((_, i) => i + 0.5);

    const store = new SeriesStore(seconds * 1000, 20_000);
    const snapshotPoints = 3000;

    // --- legacy: full getWindow every flush ---
    let legacyPoints = 0;
    let legacyMsgs = 0;
    for (let f = 0; f < flushes; f++) {
      const tEnd = (f + 1) * flushMs;
      // append this flush's samples
      const tStart = f * flushMs;
      for (let t = tStart; t < tEnd; t++) {
        store.append(t, values, ids);
      }
      const win = store.getWindow(snapshotPoints);
      let pts = 0;
      for (const s of win) pts += s.xs.length;
      if (pts > 0) {
        legacyMsgs += 1;
        legacyPoints += pts;
      }
    }

    // --- new: snapshot once + per-flush delta ---
    const store2 = new SeriesStore(seconds * 1000, 20_000);
    const host = new PlotPresenter(snapshotPoints, 512);
    host.requestSnapshot('ready');
    let newPoints = 0;
    let newMsgs = 0;
    let snapshotCount = 0;
    let deltaCount = 0;
    for (let f = 0; f < flushes; f++) {
      const tEnd = (f + 1) * flushMs;
      const tStart = f * flushMs;
      for (let t = tStart; t < tEnd; t++) {
        store2.append(t, values, ids);
        host.addPoints(t, values, ids);
      }
      const msgs = host.flush((n) => store2.getWindow(n));
      for (const m of msgs) {
        newMsgs += 1;
        if (m.type === 'plot.snapshot') {
          snapshotCount += 1;
          for (const s of m.series) newPoints += s.xs.length;
        } else {
          deltaCount += 1;
          for (const s of m.series) newPoints += s.xs.length;
        }
      }
    }

    // rough payload: 2 floats (16B) + id overhead ~16B per point
    const approxBytes = (pts: number) => pts * 32;

    console.info(
      `[bench] plot ${channels}ch @ ${hz}Hz × ${seconds}s flush=${flushMs}ms\n` +
        `  legacy full-window: msgs=${legacyMsgs} points=${legacyPoints} ~bytes=${approxBytes(legacyPoints)}\n` +
        `  snapshot+delta:     msgs=${newMsgs} (snap=${snapshotCount} delta=${deltaCount}) points=${newPoints} ~bytes=${approxBytes(newPoints)}\n` +
        `  transfer ratio points: ${(newPoints / Math.max(legacyPoints, 1)).toFixed(4)}x`
    );

    // pressure: 100k samples/s total for 2s
    const pressStore = new SeriesStore(10_000, 50_000);
    const pressHost = new PlotPresenter(3000, 1024);
    pressHost.requestSnapshot();
    const pressCh = 10;
    const pressIds = Array.from({ length: pressCh }, (_, i) => `p${i}`);
    const pressVals = pressIds.map((_, i) => i);
    // 100k/s → 50k per 50ms flush across 10ch = 5k samples/ch/flush
    let pressPoints = 0;
    let pressMsgs = 0;
    const t0 = performance.now();
    for (let f = 0; f < 40; f++) {
      for (let i = 0; i < 5000; i++) {
        pressStore.append(f * 50 + i * 0.01, pressVals, pressIds);
        pressHost.addPoints(f * 50 + i * 0.01, pressVals, pressIds);
      }
      for (const m of pressHost.flush((n) => pressStore.getWindow(n))) {
        pressMsgs += 1;
        if (m.type === 'plot.delta') {
          for (const s of m.series) pressPoints += s.xs.length;
        } else if (m.type === 'plot.snapshot') {
          for (const s of m.series) pressPoints += s.xs.length;
        }
      }
    }
    const pressMs = performance.now() - t0;
    console.info(
      `[bench] pressure ~100k samples/s × 2s: msgs=${pressMsgs} points=${pressPoints} hostFlushMs=${pressMs.toFixed(1)}`
    );
  });
});
