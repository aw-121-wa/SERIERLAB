import { describe, expect, it } from 'vitest';
import { CustomProtocolDecoder } from '../protocol/custom';

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('CustomProtocolDecoder', () => {
  it('maps config fields', () => {
    const d = new CustomProtocolDecoder({
      id: 'c1',
      name: 'imu',
      mode: 'config',
      delimiter: 'comma',
      skipPrefix: 'DATA,',
      channels: [
        { index: 0, name: 'ax' },
        { index: 2, name: 'az' },
      ],
    });
    const b = d.feed(enc('DATA,1.25,9.9,-0.5\n'), 1);
    expect(b).toHaveLength(1);
    expect(b[0]!.values).toEqual([1.25, -0.5]);
  });

  it('runs script mode', () => {
    const d = new CustomProtocolDecoder({
      id: 'c2',
      name: 's',
      mode: 'script',
      script: "return line.split(';').slice(1).map(Number);",
    });
    const b = d.feed(enc('X;1;2;3\n'), 1);
    expect(b[0]!.values).toEqual([1, 2, 3]);
  });

  it('counts script errors', () => {
    const d = new CustomProtocolDecoder({
      id: 'c3',
      name: 'bad',
      mode: 'script',
      script: 'throw new Error("x")',
    });
    d.feed(enc('abc\n'), 1);
    expect(d.errors).toBeGreaterThan(0);
  });
});
