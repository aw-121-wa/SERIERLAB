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
});
