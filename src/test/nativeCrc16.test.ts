import { describe, expect, it } from 'vitest';
import { crc16CcittFalse } from '../protocol/native/crc16';

describe('CRC-16/CCITT-FALSE', () => {
  it('standard check value for "123456789" is 0x29B1', () => {
    const ascii = new TextEncoder().encode('123456789');
    expect(crc16CcittFalse(ascii)).toBe(0x29b1);
  });

  it('single bit corruption changes CRC', () => {
    const a = new TextEncoder().encode('123456789');
    const b = Uint8Array.from(a);
    b[0] ^= 0x01;
    expect(crc16CcittFalse(a)).not.toBe(crc16CcittFalse(b));
  });

  it('empty buffer is init value', () => {
    expect(crc16CcittFalse(new Uint8Array(0))).toBe(0xffff);
  });
});
