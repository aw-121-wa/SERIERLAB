import { describe, expect, it } from 'vitest';
import { DisplayRing } from '../store/displayRing';
import { PlotPresenter } from '../plot/plotPresenter';
import { SeriesStore } from '../store/seriesStore';

/** Simulate the webview sync state machine against a host PlotPresenter. */
class FakeWebview {
  generation = -1;
  expectedSeq = -1;
  rings = new Map<string, DisplayRing>();
  needSnapshotRequests = 0;
  ignoredStale = 0;
  applied = 0;

  constructor(private readonly cap = 64) {}

  onMessage(msg: { type: string; generation: number; seq: number; series?: unknown[]; reason?: string }): void {
    if (msg.type === 'plot.snapshot') {
      if (msg.generation < this.generation) {
        this.ignoredStale += 1;
        return;
      }
      this.generation = msg.generation;
      this.expectedSeq = msg.seq + 1;
      this.rings.clear();
      for (const s of msg.series as { id: string; xs: number[]; ys: number[] }[]) {
        const r = new DisplayRing(this.cap);
        for (let i = 0; i < s.xs.length; i++) r.push(s.xs[i]!, s.ys[i]!);
        this.rings.set(s.id, r);
      }
      this.applied += 1;
      return;
    }
    if (msg.type === 'plot.delta') {
      if (msg.generation !== this.generation) return;
      if (msg.seq !== this.expectedSeq) {
        this.needSnapshotRequests += 1;
        return;
      }
      this.expectedSeq = msg.seq + 1;
      for (const s of msg.series as { id: string; xs: number[]; ys: number[] }[]) {
        let r = this.rings.get(s.id);
        if (!r) {
          r = new DisplayRing(this.cap);
          this.rings.set(s.id, r);
        }
        for (let i = 0; i < s.xs.length; i++) r.push(s.xs[i]!, s.ys[i]!);
      }
      this.applied += 1;
      return;
    }
    if (msg.type === 'plot.reset') {
      this.generation = msg.generation;
      this.expectedSeq = msg.seq + 1;
      this.rings.clear();
    }
  }

  materialize(id: string) {
    return this.rings.get(id)?.materialize() ?? { xs: [], ys: [] };
  }
}

describe('DisplayRing', () => {
  it('12: capacity eviction drops oldest', () => {
    const r = new DisplayRing(3);
    for (let i = 0; i < 10; i++) r.push(i, i * 2);
    expect(r.count).toBe(3);
    expect(r.materialize()).toEqual({ xs: [7, 8, 9], ys: [14, 16, 18] });
  });

  it('13: wrap keeps logical order', () => {
    const r = new DisplayRing(4);
    for (let i = 0; i < 9; i++) r.push(i, -i);
    const m = r.materialize();
    expect(m.xs).toEqual([5, 6, 7, 8]);
    expect(m.ys).toEqual([-5, -6, -7, -8]);
  });

  it('resetFrom replaces contents', () => {
    const r = new DisplayRing(8);
    r.push(1, 1);
    r.resetFrom([2, 3, 4], [20, 30, 40]);
    expect(r.materialize()).toEqual({ xs: [2, 3, 4], ys: [20, 30, 40] });
  });
});

describe('Host↔Webview plot sync simulation', () => {
  it('ready → snapshot; subsequent flushes apply deltas into bounded rings', () => {
    const store = new SeriesStore(1_000_000, 10_000);
    const host = new PlotPresenter(200, 50);
    const wv = new FakeWebview(32);

    host.requestSnapshot('ready');
    for (const msg of host.flush((n) => store.getWindow(n))) wv.onMessage(msg);
    expect(wv.applied).toBe(1);

    for (let t = 0; t < 100; t++) {
      store.append(t, [t], ['ch']);
      host.addPoints(t, [t], ['ch']);
    }
    for (const msg of host.flush((n) => store.getWindow(n))) wv.onMessage(msg);
    const m = wv.materialize('ch');
    expect(m.xs.length).toBeLessThanOrEqual(32);
    expect(m.xs[m.xs.length - 1]).toBe(99);
  });

  it('5: dropped delta (seq gap) → needSnapshot; 6: host recovers', () => {
    const store = new SeriesStore(1e6, 1000);
    const host = new PlotPresenter();
    const wv = new FakeWebview();

    host.requestSnapshot();
    for (const msg of host.flush(() => store.getWindow(100))) wv.onMessage(msg);

    store.append(1, [1], ['a']);
    host.addPoints(1, [1], ['a']);
    const m1 = host.flush(() => store.getWindow(100));
    // drop m1 on the floor (simulate loss)
    store.append(2, [2], ['a']);
    host.addPoints(2, [2], ['a']);
    const m2 = host.flush(() => store.getWindow(100));
    for (const msg of m2) wv.onMessage(msg);
    expect(wv.needSnapshotRequests).toBe(1);

    host.requestSnapshot('seq-gap');
    for (const msg of host.flush(() => store.getWindow(100))) wv.onMessage(msg);
    expect(wv.needSnapshotRequests).toBe(1);
    expect(wv.materialize('a').ys).toEqual([1, 2]);
  });

  it('7: webview ignores stale generation deltas', () => {
    const store = new SeriesStore(1e6, 100);
    const host = new PlotPresenter();
    const wv = new FakeWebview();
    host.requestSnapshot();
    for (const msg of host.flush(() => store.getWindow(50))) wv.onMessage(msg);

    store.append(1, [1], ['a']);
    host.addPoints(1, [1], ['a']);
    const stale = host.flush(() => store.getWindow(50))[0]!;

    host.bumpGeneration('protocol');
    for (const msg of host.flush(() => store.getWindow(50))) wv.onMessage(msg);

    const before = wv.applied;
    wv.onMessage(stale); // old generation delta
    expect(wv.applied).toBe(before);
  });

  it('15: clear/reset prevents old generation from reappearing', () => {
    const store = new SeriesStore(1e6, 100);
    const host = new PlotPresenter();
    const wv = new FakeWebview();
    host.requestSnapshot();
    store.append(1, [9], ['a']);
    for (const msg of host.flush(() => store.getWindow(50))) wv.onMessage(msg);
    expect(wv.materialize('a').ys).toEqual([9]);

    store.clear();
    const reset = host.buildReset('clear');
    wv.onMessage(reset);
    expect(wv.materialize('a').ys).toEqual([]);

    for (const msg of host.flush(() => store.getWindow(50))) wv.onMessage(msg);
    expect(wv.materialize('a').ys).toEqual([]);
  });
});
