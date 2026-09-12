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

  it('blocks script mode when scriptAllowed is false', () => {
    const d = new CustomProtocolDecoder(
      {
        id: 'c4',
        name: 's',
        mode: 'script',
        script: 'return [1];',
      },
      { scriptAllowed: false }
    );
    expect(d.scriptBlocked).toBe(true);
    expect(d.scriptExperimental).toBe(true);
    expect(d.errors).toBeGreaterThan(0);
    expect(d.feed(enc('X;1\n'), 1)).toHaveLength(0);
  });

  it('config mode is unaffected when scriptAllowed is false', () => {
    const d = new CustomProtocolDecoder(
      {
        id: 'c5',
        name: 'cfg',
        mode: 'config',
        delimiter: 'comma',
      },
      { scriptAllowed: false }
    );
    expect(d.scriptBlocked).toBe(false);
    expect(d.scriptExperimental).toBe(false);
    const b = d.feed(enc('1,2,3\n'), 1);
    expect(b[0]!.values).toEqual([1, 2, 3]);
  });

  it('marks script mode as experimental', () => {
    const d = new CustomProtocolDecoder({
      id: 'c6',
      name: 's',
      mode: 'script',
      script: 'return [1];',
    });
    expect(d.scriptExperimental).toBe(true);
    expect(d.scriptBlocked).toBe(false);
    expect(d.feed(enc('x\n'), 1)[0]!.values).toEqual([1]);
  });
});
