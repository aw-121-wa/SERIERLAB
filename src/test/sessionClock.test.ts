import { describe, expect, it } from 'vitest';
import { SessionClock } from '../time/sessionClock';

describe('SessionClock', () => {
  it('reports session-relative monotonic ms', () => {
    let mono = 1000;
    const c = new SessionClock({ epochMs: 1_700_000_000_000, monoNow: () => mono });
    expect(c.now()).toBe(0);
    mono = 1321;
    expect(c.now()).toBe(321);
  });

  it('maps session t_ms to wall clock via epoch, not 1970', () => {
    const epoch = Date.UTC(2026, 0, 2, 3, 4, 5);
    const c = new SessionClock({ epochMs: epoch, monoNow: () => 0 });
    expect(c.toIso(3215)).toBe(new Date(epoch + 3215).toISOString());
    expect(c.toIso(0).startsWith('2026-01-02')).toBe(true);
    expect(c.toIso(3215).startsWith('1970')).toBe(false);
  });

  it('uses performance.now by default without throwing', () => {
    const c = new SessionClock();
    const a = c.now();
    const b = c.now();
    expect(b).toBeGreaterThanOrEqual(a);
    expect(Number.isFinite(c.epochMs)).toBe(true);
  });
});
