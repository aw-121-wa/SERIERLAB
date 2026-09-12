import { describe, expect, it } from 'vitest';
import { decodeHex, encodeHex } from '../protocol/hex';

describe('hex', () => {
  it('encodes uppercase spaced pairs', () => {
    expect(encodeHex(new Uint8Array([0, 15, 255]))).toBe('00 0F FF');
  });
  it('decodes with optional whitespace', () => {
    expect(Array.from(decodeHex('00 0f\nFF'))).toEqual([0, 15, 255]);
  });
  it('rejects odd length and bad chars', () => {
    expect(() => decodeHex('0')).toThrow();
    expect(() => decodeHex('GG')).toThrow();
  });
});
