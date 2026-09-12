import { describe, expect, it } from 'vitest';
import { PlotPresenter } from '../plot/plotPresenter';
import { PendingPlotDelta } from '../plot/pendingPlotDelta';
import { ChannelWindow } from '../store/seriesStore';

function fakeWindow(id = 'ch', n = 3): ChannelWindow {
  return {
    id,
    name: id,
    color: '#fff',
    visible: true,
    xs: Array.from({ length: n }, (_, i) => i),
    ys: Array.from({ length: n }, (_, i) => i * 10),
  };
}

describe('PendingPlotDelta', () => {
  it('drains all points and clears', () => {
    const p = new PendingPlotDelta();
    p.add('a', 1, 1);
    p.add('a', 2, 2);
    p.add('b', 1, 9);
    expect(p.totalPoints).toBe(3);
    const d = p.drainForSend(100);
    expect(p.totalPoints).toBe(0);
    expect(d).toHaveLength(2);
    expect(d.find((s) => s.id === 'a')!.ys).toEqual([1, 2]);
  });

  it('minmax-downsamples when over per-channel budget', () => {
    const p = new PendingPlotDelta();
    for (let i = 0; i < 1000; i++) p.add('a', i, i === 500 ? 999 : 0);
    const d = p.drainForSend(50);
    expect(d[0]!.xs.length).toBeLessThanOrEqual(50);
    expect(d[0]!.ys).toContain(999);
  });
});

describe('PlotPresenter', () => {
  it('1: ready → one snapshot', () => {
    const p = new PlotPresenter(3000, 512);
    p.requestSnapshot('ready');
    const msgs = p.flush(() => [fakeWindow()]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.type).toBe('plot.snapshot');
  });

  it('2-4: snapshot then deltas only new points; seq monotonic', () => {
    const p = new PlotPresenter();
    p.requestSnapshot('ready');
    const s0 = p.flush(() => [fakeWindow('a', 2)]);
    expect(s0[0]!.type).toBe('plot.snapshot');
    const seq0 = (s0[0] as { seq: number }).seq;

    p.addPoints(10, [1], ['a']);
    const d1 = p.flush(() => [fakeWindow('a', 2)]);
    expect(d1).toHaveLength(1);
    expect(d1[0]!.type).toBe('plot.delta');
    const delta1 = d1[0] as { seq: number; series: { xs: number[]; ys: number[] }[] };
    expect(delta1.seq).toBe(seq0 + 1);
    expect(delta1.series[0]!.xs).toEqual([10]);
    expect(delta1.series[0]!.ys).toEqual([1]);

    p.addPoints(11, [2], ['a']);
    p.addPoints(12, [3], ['a']);
    const d2 = p.flush(() => [fakeWindow('a', 2)]);
    const delta2 = d2[0] as { seq: number; series: { xs: number[] }[] };
    expect(delta2.seq).toBe(seq0 + 2);
    expect(delta2.series[0]!.xs).toEqual([11, 12]);

    // no new points → no message
    expect(p.flush(() => [fakeWindow()])).toHaveLength(0);
  });

  it('5-6: seq gap recovery via requestSnapshot (webview path)', () => {
    const p = new PlotPresenter();
    p.requestSnapshot();
    const a = p.flush(() => [fakeWindow()]);
    p.addPoints(1, [1], ['a']);
    p.flush(() => [fakeWindow()]); // seq consumed
    p.addPoints(2, [2], ['a']);
    p.flush(() => [fakeWindow()]); // another seq — simulate webview missing middle
    p.requestSnapshot('seq-gap');
    const snap = p.flush(() => [fakeWindow('a', 5)]);
    expect(snap[0]!.type).toBe('plot.snapshot');
    expect((snap[0] as { seq: number }).seq).toBe((a[0] as { seq: number }).seq + 3);
  });

  it('7: generation change invalidates (bump + snapshot)', () => {
    const p = new PlotPresenter();
    p.requestSnapshot();
    const s1 = p.flush(() => [fakeWindow()]);
    const g1 = (s1[0] as { generation: number }).generation;
    p.addPoints(1, [1], ['a']);
    p.bumpGeneration('protocol');
    const s2 = p.flush(() => [fakeWindow()]);
    const msg2 = s2[0] as { generation: number; type: string };
    expect(msg2.type).toBe('plot.snapshot');
    expect(msg2.generation).toBe(g1 + 1);
    expect(p.pendingPoints).toBe(0);
  });

  it('8: reload/ready restores from getWindow snapshot source', () => {
    const store = [fakeWindow('x', 4)];
    const p = new PlotPresenter();
    p.requestSnapshot('ready');
    const m = p.flush(() => store)[0] as { series: ChannelWindow[] };
    expect(m.series[0]!.xs).toEqual([0, 1, 2, 3]);
  });

  it('9-10: pause keeps presenter pending bounded; addPoints ignored', () => {
    const p = new PlotPresenter();
    p.requestSnapshot();
    p.flush(() => [fakeWindow()]);
    p.setPaused(true);
    for (let i = 0; i < 10_000; i++) p.addPoints(i, [i], ['a']);
    expect(p.pendingPoints).toBe(0);
    expect(p.flush(() => [fakeWindow()])).toHaveLength(0);
  });

  it('11: resume sends fresh snapshot, does not replay pause backlog', () => {
    const p = new PlotPresenter();
    p.requestSnapshot();
    p.flush(() => [fakeWindow('a', 1)]);
    p.setPaused(true);
    for (let i = 0; i < 1000; i++) p.addPoints(i, [i], ['a']);
    p.setPaused(false);
    const msgs = p.flush(() => [fakeWindow('a', 3)]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.type).toBe('plot.snapshot');
    const snap = msgs[0] as { series: ChannelWindow[] };
    expect(snap.series[0]!.ys).toEqual([0, 10, 20]); // from fakeWindow, not 1000 backlog points
  });

  it('15: buildReset bumps generation and requires snapshot', () => {
    const p = new PlotPresenter();
    p.requestSnapshot();
    const before = p.currentGeneration;
    const reset = p.buildReset('clear');
    expect(reset.generation).toBe(before + 1);
    expect(reset.type).toBe('plot.reset');
    expect(p.snapshotRequired).toBe(true);
    const snap = p.flush(() => [fakeWindow()]);
    expect(snap[0]!.type).toBe('plot.snapshot');
    expect((snap[0] as { generation: number }).generation).toBe(reset.generation);
  });

  it('14: multi-channel delta', () => {
    const p = new PlotPresenter();
    p.requestSnapshot();
    p.flush(() => [fakeWindow('a'), fakeWindow('b')]);
    p.addPoints(5, [1, 2], ['a', 'b']);
    const d = p.flush(() => [])[0] as {
      series: { id: string; ys: number[] }[];
    };
    expect(d.series.map((s) => s.id).sort()).toEqual(['a', 'b']);
    expect(d.series.find((s) => s.id === 'a')!.ys).toEqual([1]);
    expect(d.series.find((s) => s.id === 'b')!.ys).toEqual([2]);
  });

  it('delta over budget uses minmax and stays bounded', () => {
    const p = new PlotPresenter(3000, 100);
    p.requestSnapshot();
    p.flush(() => [fakeWindow()]);
    for (let i = 0; i < 5000; i++) p.addPoints(i, [i === 2500 ? 42 : 0], ['a']);
    const d = p.flush(() => [])[0] as { series: { xs: number[]; ys: number[] }[] };
    expect(d.series[0]!.xs.length).toBeLessThanOrEqual(100);
    expect(d.series[0]!.ys).toContain(42);
  });
});
