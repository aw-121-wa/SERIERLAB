import { describe, expect, it } from 'vitest';
import { RawBuffer } from '../store/rawBuffer';

describe('RawBuffer', () => {
  it('drops oldest when exceeding capacity', () => {
    const b = new RawBuffer(8);
    b.push(new Uint8Array([1, 2, 3, 4, 5]), 'RX', 1);
    b.push(new Uint8Array([6, 7, 8, 9, 10]), 'RX', 2);
    expect(b.droppedBytes).toBeGreaterThan(0);
    const all = b.toArray();
    expect(all.length).toBeLessThanOrEqual(8);
    expect(all[all.length - 1]).toBe(10);
  });
  it('keeps TX/RX entries', () => {
    const b = new RawBuffer(64);
    b.push(new Uint8Array([1]), 'RX', 10);
    b.push(new Uint8Array([2]), 'TX', 11);
    expect(b.entries()).toHaveLength(2);
    expect(b.entries()[1]!.dir).toBe('TX');
  });
});
