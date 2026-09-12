import { describe, expect, it } from 'vitest';
import { cobsDecode, cobsEncode } from '../protocol/native/cobs';

describe('COBS', () => {
  it('empty → [0x01]', () => {
    expect(Array.from(cobsEncode(new Uint8Array(0)))).toEqual([0x01]);
    expect(Array.from(cobsDecode(new Uint8Array([0x01]))!)).toEqual([]);
  });

  it('embedded zeros', () => {
    const src = Uint8Array.from([0x00, 0x00, 0x00]);
    const enc = cobsEncode(src);
    expect(enc.includes(0)).toBe(false);
    expect(Array.from(cobsDecode(enc)!)).toEqual([0, 0, 0]);
  });

  it('long run without zero uses 0xFF codes', () => {
    const src = new Uint8Array(300).fill(0x41);
    const enc = cobsEncode(src);
    expect(enc.includes(0)).toBe(false);
    const dec = cobsDecode(enc);
    expect(dec).not.toBeNull();
    expect(Array.from(dec!)).toEqual(Array.from(src));
  });

  it('malformed COBS rejects embedded zero in code stream incorrectly handled', () => {
    // encode never produces internal 0; decode of [0x02, 0x00] is malformed
    expect(cobsDecode(Uint8Array.from([0x02, 0x00]))).toBeNull();
  });

  it('roundtrip mixed', () => {
    const src = Uint8Array.from([1, 0, 2, 3, 0, 0, 4, 0xff, 0]);
    expect(Array.from(cobsDecode(cobsEncode(src))!)).toEqual(Array.from(src));
  });
});
