import { describe, expect, it } from 'vitest';
import { formatRawLog } from '../export/exportService';

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
});
