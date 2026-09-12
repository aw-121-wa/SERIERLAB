import { describe, expect, it } from 'vitest';
import { formatRawLog } from '../export/exportService';
import { SessionClock } from '../time/sessionClock';

describe('formatRawLog', () => {
  it('formats direction and hex payload', () => {
    const text = formatRawLog([
      { tMs: 0, dir: 'RX', bytes: new Uint8Array([1, 2]) },
      { tMs: 5, dir: 'TX', bytes: new Uint8Array([0x41]) },
    ]);
    expect(text).toContain('RX');
    expect(text).toContain('01 02');
    expect(text).toContain('41');
  });

  it('emits wall-clock ISO via toIso, never 1970 for session-relative t_ms', () => {
    const epoch = Date.UTC(2026, 5, 1, 12, 0, 0);
    const clock = new SessionClock({ epochMs: epoch, monoNow: () => 0 });
    const text = formatRawLog(
      [{ tMs: 3215, dir: 'RX', bytes: new Uint8Array([1]) }],
      (t) => clock.toIso(t)
    );
    const line = text.split('\n')[1]!;
    expect(line.startsWith('2026-06-01T12:00:03.215Z')).toBe(true);
    expect(line).toContain(',3215,');
  });

  it('leaves iso empty when toIso is omitted (no fake 1970 timestamps)', () => {
    const text = formatRawLog([{ tMs: 3215, dir: 'RX', bytes: new Uint8Array([1]) }]);
    const line = text.split('\n')[1]!;
    expect(line.startsWith(',3215,')).toBe(true);
  });
});
