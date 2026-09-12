import { describe, expect, it } from 'vitest';
import { PendingUiQueue } from '../store/pendingUiQueue';

function bytes(n: number, fill = 1): Uint8Array {
  return new Uint8Array(n).fill(fill);
}

describe('PendingUiQueue', () => {
  it('copies input bytes so callers can reuse buffers', () => {
    const q = new PendingUiQueue({ maxBytes: 1024, maxEntries: 10 });
    const src = bytes(4, 0xaa);
    q.push(1, 'RX', src);
    src.fill(0xbb);
    const out = q.drain();
    expect(out).toHaveLength(1);
    expect(out[0]!.bytes[0]).toBe(0xaa);
  });

  it('drops oldest when exceeding maxEntries', () => {
    const q = new PendingUiQueue({ maxBytes: 1_000_000, maxEntries: 3 });
    for (let i = 0; i < 5; i++) q.push(i, 'RX', bytes(1, i));
    expect(q.length).toBe(3);
    expect(q.droppedEntryCount).toBe(2);
    const out = q.drain();
    expect(out.map((e) => e.tMs)).toEqual([2, 3, 4]);
    expect(out[0]!.bytes[0]).toBe(2);
  });

  it('drops oldest when exceeding maxBytes', () => {
    const q = new PendingUiQueue({ maxBytes: 10, maxEntries: 100 });
    q.push(1, 'RX', bytes(6, 1));
    q.push(2, 'RX', bytes(6, 2));
    expect(q.length).toBe(1);
    expect(q.bytes).toBe(6);
    expect(q.droppedByteCount).toBe(6);
    expect(q.drain()[0]!.bytes[0]).toBe(2);
  });

  it('stays bounded under sustained pause-like push without drain', () => {
    const q = new PendingUiQueue({ maxBytes: 64, maxEntries: 8 });
    for (let i = 0; i < 10_000; i++) q.push(i, 'RX', bytes(4, i & 0xff));
    expect(q.length).toBeLessThanOrEqual(8);
    expect(q.bytes).toBeLessThanOrEqual(64);
    expect(q.droppedEntryCount).toBeGreaterThan(0);
  });

  it('trimForResume keeps only a small recent tail', () => {
    const q = new PendingUiQueue({
      maxBytes: 1_000_000,
      maxEntries: 1000,
      resumeKeepEntries: 3,
      resumeKeepBytes: 1_000_000,
    });
    for (let i = 0; i < 20; i++) q.push(i, 'RX', bytes(1, i));
    q.trimForResume();
    expect(q.length).toBe(3);
    const out = q.drain();
    expect(out.map((e) => e.tMs)).toEqual([17, 18, 19]);
    expect(q.droppedEntryCount).toBe(17);
  });

  it('drain empties the queue', () => {
    const q = new PendingUiQueue({ maxBytes: 100, maxEntries: 10 });
    q.push(1, 'TX', bytes(2));
    expect(q.drain()).toHaveLength(1);
    expect(q.length).toBe(0);
    expect(q.bytes).toBe(0);
  });

  it('remains bounded when a single entry exceeds maxBytes', () => {
    const q = new PendingUiQueue({ maxBytes: 16, maxEntries: 10 });
    q.push(1, 'RX', bytes(8, 1));
    const big = new Uint8Array(40);
    big.fill(2);
    big[38] = 0xaa;
    big[39] = 0xbb;
    q.push(2, 'RX', big);
    expect(q.bytes).toBeLessThanOrEqual(16);
    expect(q.length).toBe(1);
    const out = q.drain();
    expect(out[0]!.bytes.length).toBe(16);
    // Strategy B: keep the trailing maxBytes of the oversized chunk.
    expect(out[0]!.bytes[14]).toBe(0xaa);
    expect(out[0]!.bytes[15]).toBe(0xbb);
    expect(out[0]!.bytes[0]).toBe(2);
  });

  it('oversized entry alone cannot exceed maxBytes', () => {
    const q = new PendingUiQueue({ maxBytes: 10, maxEntries: 100 });
    q.push(1, 'RX', bytes(800, 9));
    expect(q.bytes).toBe(10);
    expect(q.length).toBe(1);
    expect(q.droppedEntryCount).toBe(0);
  });
});
