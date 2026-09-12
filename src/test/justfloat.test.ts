import { describe, expect, it } from 'vitest';
import { JustFloatDecoder } from '../protocol/justfloat';

function frame(values: number[]): Uint8Array {
  const buf = new ArrayBuffer(4 * values.length + 4);
  const view = new DataView(buf);
  values.forEach((v, i) => view.setFloat32(i * 4, v, true));
  view.setUint8(4 * values.length, 0x00);
  view.setUint8(4 * values.length + 1, 0x00);
  view.setUint8(4 * values.length + 2, 0x80);
  view.setUint8(4 * values.length + 3, 0x7f);
  return new Uint8Array(buf);
}

describe('JustFloatDecoder', () => {
  it('decodes a full frame', () => {
    const d = new JustFloatDecoder();
    const batches = d.feed(frame([1.5, -2, 0.25]), 10);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.values[0]).toBeCloseTo(1.5);
    expect(batches[0]!.values[1]).toBeCloseTo(-2);
    expect(batches[0]!.values[2]).toBeCloseTo(0.25);
  });

  it('handles fragmented frames', () => {
    const d = new JustFloatDecoder();
    const f = frame([1, 2]);
    expect(d.feed(f.subarray(0, 5), 1)).toHaveLength(0);
    const b = d.feed(f.subarray(5), 2);
    expect(b).toHaveLength(1);
    expect(b[0]!.values).toEqual([expect.closeTo(1), expect.closeTo(2)]);
  });

  it('locks channel count and errors on mismatch', () => {
    const d = new JustFloatDecoder();
    d.feed(frame([1, 2, 3]), 1);
    const bad = d.feed(frame([1, 2]), 2);
    expect(bad).toHaveLength(0);
    expect(d.errors).toBe(1);
  });

  it('resets pending on reset', () => {
    const d = new JustFloatDecoder();
    const f = frame([1, 2]);
    d.feed(f.subarray(0, 6), 1);
    d.reset();
    expect(d.feed(f, 2)).toHaveLength(1);
  });
});
