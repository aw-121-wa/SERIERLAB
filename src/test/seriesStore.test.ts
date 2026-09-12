import { describe, expect, it } from 'vitest';
import { SeriesStore } from '../store/seriesStore';

describe('SeriesStore', () => {
  it('appends and exports csv', () => {
    const s = new SeriesStore(60_000, 1000);
    s.append(0, [1, 2], ['p.a', 'p.b']);
    s.append(10, [3, 4], ['p.a', 'p.b']);
    const csv = s.exportCsv();
    expect(csv.split('\n')[0]).toContain('t_ms');
    expect(csv).toContain('1');
    expect(csv).toContain('4');
  });

  it('evicts old samples', () => {
    const s = new SeriesStore(100, 1000);
    s.append(0, [1], ['p.a']);
    s.append(200, [2], ['p.a']);
    const w = s.getWindow(100);
    expect(w[0]!.ys[w[0]!.ys.length - 1]).toBe(2);
    expect(w[0]!.ys.length).toBe(1);
  });

  it('exportCsv uses toIso for wall clock and keeps t_ms session-relative', () => {
    const s = new SeriesStore(60_000, 1000);
    s.append(0, [1], ['p.a']);
    s.append(3215, [2], ['p.a']);
    const epoch = Date.UTC(2026, 0, 1, 0, 0, 0);
    const csv = s.exportCsv(undefined, (t) => new Date(epoch + t).toISOString());
    const lines = csv.split('\n');
    expect(lines[0]).toContain('t_ms');
    expect(lines[1]).toBe(`0,${new Date(epoch).toISOString()},1`);
    expect(lines[2]).toBe(`3215,${new Date(epoch + 3215).toISOString()},2`);
    expect(csv).not.toContain('1970-01-01');
  });

  it('exportCsv leaves iso_time empty without toIso', () => {
    const s = new SeriesStore(60_000, 1000);
    s.append(3215, [1], ['p.a']);
    const csv = s.exportCsv();
    expect(csv.split('\n')[1]).toBe('3215,,1');
  });

  it('getWindow keeps time order after ring wrap', () => {
    const s = new SeriesStore(1_000_000, 8);
    for (let i = 0; i < 20; i++) s.append(i, [i], ['ch']);
    const w = s.getWindow(100);
    expect(w[0]!.xs).toEqual([12, 13, 14, 15, 16, 17, 18, 19]);
    expect(w[0]!.ys).toEqual([12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it('capacity overflow drops oldest', () => {
    const s = new SeriesStore(1_000_000, 3);
    for (let i = 0; i < 10; i++) s.append(i, [i * 2], ['a']);
    const w = s.getWindow(100);
    expect(w[0]!.xs).toEqual([7, 8, 9]);
    expect(w[0]!.ys).toEqual([14, 16, 18]);
  });

  it('supports capacity 1', () => {
    const s = new SeriesStore(1_000_000, 1);
    s.append(1, [10], ['a']);
    s.append(2, [20], ['a']);
    const w = s.getWindow(100);
    expect(w[0]!.xs).toEqual([2]);
    expect(w[0]!.ys).toEqual([20]);
  });

  it('keeps channels independent', () => {
    const s = new SeriesStore(1_000_000, 4);
    s.append(1, [1, 10], ['a', 'b']);
    s.append(2, [2, 20], ['a', 'b']);
    for (let i = 3; i <= 8; i++) s.append(i, [i, i * 10], ['a', 'b']);
    // b was hidden then shown; both rings full at last 4
    const w = s.getWindow(100);
    const byId = Object.fromEntries(w.map((c) => [c.id, c]));
    expect(byId['a']!.ys).toEqual([5, 6, 7, 8]);
    expect(byId['b']!.ys).toEqual([50, 60, 70, 80]);
  });

  it('evicts by 60s history window across wrap', () => {
    const s = new SeriesStore(60_000, 10_000);
    for (let i = 0; i < 100; i++) s.append(i * 1000, [i], ['h']);
    // newest = 99000, cutoff = 39000 → samples with t < 39000 gone (0..38)
    const w = s.getWindow(1000);
    expect(w[0]!.xs[0]).toBe(39_000);
    expect(w[0]!.ys[0]).toBe(39);
    expect(w[0]!.xs[w[0]!.xs.length - 1]).toBe(99_000);
  });

  it('clear resets samples but keeps meta', () => {
    const s = new SeriesStore(60_000, 100);
    s.append(1, [5], ['a']);
    s.setMeta('a', { name: 'Vbus', color: '#fff', visible: true });
    s.clear();
    const w = s.getWindow(100);
    expect(w).toHaveLength(1);
    expect(w[0]!.name).toBe('Vbus');
    expect(w[0]!.xs).toEqual([]);
    s.append(2, [9], ['a']);
    expect(s.getWindow(100)[0]!.ys).toEqual([9]);
  });

  it('exportCsv stays in logical time order after wrap', () => {
    const s = new SeriesStore(1_000_000, 5);
    for (let i = 0; i < 12; i++) s.append(i, [i], ['a']);
    const csv = s.exportCsv();
    const rows = csv.split('\n').slice(1);
    expect(rows.map((r) => r.split(',')[0])).toEqual(['7', '8', '9', '10', '11']);
    expect(rows.map((r) => r.split(',')[2])).toEqual(['7', '8', '9', '10', '11']);
  });

  it('getWindow uses min/max envelope and respects maxPoints budget', () => {
    const s = new SeriesStore(1_000_000, 100);
    for (let i = 0; i < 100; i++) s.append(i, [i === 47 ? 999 : i], ['a']);
    const w = s.getWindow(10);
    expect(w[0]!.xs.length).toBeLessThanOrEqual(10);
    expect(w[0]!.ys).toContain(999);
    expect(w[0]!.xs[0]).toBe(0);
    expect(w[0]!.xs[w[0]!.xs.length - 1]).toBe(99);
  });

  it('I: spike survives getWindow after ring wrap', () => {
    const s = new SeriesStore(1_000_000, 16);
    for (let i = 0; i < 40; i++) {
      // spike inside the retained window after wrap
      const v = i === 33 ? 1e6 : 0;
      s.append(i, [v], ['ch']);
    }
    const w = s.getWindow(8);
    expect(w[0]!.xs.length).toBeLessThanOrEqual(8);
    expect(w[0]!.ys).toContain(1e6);
    expect(w[0]!.xs[0]).toBe(24);
    expect(w[0]!.xs[w[0]!.xs.length - 1]).toBe(39);
  });

  it('J: multi-channel downsample is independent', () => {
    const s = new SeriesStore(1_000_000, 200);
    for (let i = 0; i < 200; i++) {
      s.append(i, [i === 50 ? -1 : 0, i === 150 ? 2 : 0], ['a', 'b']);
    }
    const w = s.getWindow(20);
    const byId = Object.fromEntries(w.map((c) => [c.id, c]));
    expect(byId['a']!.ys).toContain(-1);
    expect(byId['a']!.ys).not.toContain(2);
    expect(byId['b']!.ys).toContain(2);
    expect(byId['b']!.ys).not.toContain(-1);
    expect(byId['a']!.xs.length).toBeLessThanOrEqual(20);
    expect(byId['b']!.xs.length).toBeLessThanOrEqual(20);
  });

  it('exportCsv still has full ring data (not downsampled)', () => {
    const s = new SeriesStore(1_000_000, 50);
    for (let i = 0; i < 50; i++) s.append(i, [i === 10 ? 777 : i], ['a']);
    // force display downsample
    const w = s.getWindow(5);
    expect(w[0]!.ys.length).toBeLessThanOrEqual(5);
    const csv = s.exportCsv();
    const rows = csv.split('\n').slice(1);
    expect(rows).toHaveLength(50);
    expect(csv).toContain('777');
  });

  it('getWindow includes hidden channels (presentation can re-show them)', () => {
    const s = new SeriesStore(1_000_000, 100);
    s.append(1, [1, 2], ['a', 'b']);
    s.setMeta('b', { visible: false });
    const w = s.getWindow(100);
    expect(w.map((c) => c.id).sort()).toEqual(['a', 'b']);
    expect(w.find((c) => c.id === 'b')!.visible).toBe(false);
    expect(w.find((c) => c.id === 'b')!.ys).toEqual([2]);
    s.setMeta('b', { visible: true });
    const w2 = s.getWindow(100);
    expect(w2.find((c) => c.id === 'b')!.visible).toBe(true);
  });

  it('lastValue / lastValues expose newest samples', () => {
    const s = new SeriesStore(60_000, 100);
    expect(s.lastValue('a')).toBeUndefined();
    s.append(1, [1.5, 2.5], ['a', 'b']);
    s.append(2, [9.25, 3], ['a', 'b']);
    expect(s.lastValue('a')).toBe(9.25);
    expect(s.lastValues()).toEqual({ a: 9.25, b: 3 });
  });

  it('skips non-finite values', () => {
    const s = new SeriesStore(1_000_000, 10);
    s.append(1, [1, NaN], ['a', 'b']);
    s.append(2, [2, 3], ['a', 'b']);
    const w = s.getWindow(10);
    const byId = Object.fromEntries(w.map((c) => [c.id, c]));
    expect(byId['a']!.ys).toEqual([1, 2]);
    expect(byId['b']!.ys).toEqual([3]);
  });
});
