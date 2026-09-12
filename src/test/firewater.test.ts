import { describe, expect, it } from 'vitest';
import { FireWaterDecoder } from '../protocol/firewater';

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('FireWaterDecoder', () => {
  it('parses comma lines', () => {
    const d = new FireWaterDecoder();
    const b = d.feed(enc('1.5,2,3\n'), 5);
    expect(b).toHaveLength(1);
    expect(b[0]!.values).toEqual([1.5, 2, 3]);
  });
  it('parses space separated scientific', () => {
    const d = new FireWaterDecoder();
    const b = d.feed(enc('1e-3 2.5\n'), 1);
    expect(b[0]!.values[0]).toBeCloseTo(0.001);
  });
  it('handles CRLF and fragments', () => {
    const d = new FireWaterDecoder();
    expect(d.feed(enc('1,2'), 1)).toHaveLength(0);
    expect(d.feed(enc(',3\r\n'), 2)).toHaveLength(1);
  });
  it('skips bad lines and counts errors', () => {
    const d = new FireWaterDecoder();
    d.feed(enc('1,abc\n2,3\n'), 1);
    expect(d.errors).toBe(1);
  });
});
