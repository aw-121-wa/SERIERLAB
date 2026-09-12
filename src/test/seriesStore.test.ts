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
});
