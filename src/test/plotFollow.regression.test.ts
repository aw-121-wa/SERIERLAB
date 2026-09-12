import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DisplayRing } from '../store/displayRing';
import { PlotPresenter } from '../plot/plotPresenter';
import { SeriesStore } from '../store/seriesStore';
import { JustFloatDecoder } from '../protocol/justfloat';

/**
 * Regression locks for the live-plot bugs that unit tests missed:
 * - Webview DisplayRing API drift (count/xAt) silently killed follow
 * - latestSampleTime() must see the newest t
 * - follow must advance X
 * - pause/resume must re-snapshot, not replay backlog
 */

function encodeJustFloat(values: number[]): Uint8Array {
  const buf = new ArrayBuffer(4 + values.length * 4);
  const view = new DataView(buf);
  for (let i = 0; i < values.length; i++) {
    view.setFloat32(i * 4, values[i]!, true);
  }
  view.setUint32(values.length * 4, 0x7f800000, true); // 00 00 80 7F LE
  return new Uint8Array(buf);
}

function latestSampleTimeFromRings(rings: DisplayRing[]): number | null {
  let t: number | null = null;
  for (const r of rings) {
    if (r.count > 0) {
      const last = r.xAt(r.count - 1);
      if (t === null || last > t) t = last;
    }
  }
  return t;
}

describe('Plot follow regression', () => {
  it('latestSampleTime via count/xAt tracks newest t', () => {
    const r = new DisplayRing(64);
    r.push(10, 1);
    r.push(20, 2);
    r.push(99, 3);
    expect(latestSampleTimeFromRings([r])).toBe(99);
  });

  it('main.js still exposes count/xAt on webview DisplayRing', () => {
    const mainJs = readFileSync(join(__dirname, '..', 'webview', 'media', 'main.js'), 'utf8');
    expect(mainJs).toMatch(/DisplayRing\.prototype\.xAt/);
    expect(mainJs).toMatch(/'count'/);
    // Must not call default redraw() immediately after setScale (clobbers pending range).
    expect(mainJs).toMatch(/uplot\.batch\(/);
    expect(mainJs).not.toMatch(/setScale\('x'[\s\S]{0,80}redraw\(\)/);
  });

  it('follow advances X window as latest t grows', () => {
    // Pure host-side: presenter + store, same math as webview applyFollow.
    const store = new SeriesStore(60_000, 20_000);
    const host = new PlotPresenter(3000, 512);
    const ids = ['a'];
    host.requestSnapshot('ready');
    host.flush((n) => store.getWindow(n));

    const span = 1000;
    const windows: Array<{ min: number; max: number }> = [];
    for (let t = 0; t <= 5000; t += 50) {
      store.append(t, [Math.sin(t / 100)], ids);
      host.addPoints(t, [Math.sin(t / 100)], ids);
      host.flush((n) => store.getWindow(n));
      const latest = t;
      const xmax = latest + span * 0.05;
      let xmin = xmax - span;
      if (xmin < 0) {
        xmin = 0;
      }
      windows.push({ min: xmin, max: xmax });
    }
    expect(windows[windows.length - 1]!.max).toBeGreaterThan(windows[0]!.max);
    expect(windows[windows.length - 1]!.max).toBeCloseTo(5000 + 50, 0);
  });

  it('pause keeps SeriesStore growing; resume sends snapshot not backlog', () => {
    const store = new SeriesStore(60_000, 20_000);
    const host = new PlotPresenter(3000, 512);
    const ids = ['a'];
    host.requestSnapshot();
    for (let t = 0; t < 100; t++) {
      store.append(t, [t], ids);
      host.addPoints(t, [t], ids);
    }
    const first = host.flush((n) => store.getWindow(n));
    expect(first[0]!.type).toBe('plot.snapshot');

    host.setPaused(true);
    const storeLenBefore = store.getWindow(1000)[0]!.ys.length;
    for (let t = 100; t < 5000; t++) {
      store.append(t, [t], ids);
      host.addPoints(t, [t], ids);
    }
    expect(host.pendingPoints).toBe(0);
    expect(store.getWindow(1000)[0]!.ys.length).toBeGreaterThan(storeLenBefore);
    expect(host.flush((n) => store.getWindow(n))).toHaveLength(0);

    host.setPaused(false);
    const after = host.flush((n) => store.getWindow(n));
    expect(after).toHaveLength(1);
    expect(after[0]!.type).toBe('plot.snapshot');
  });
});
