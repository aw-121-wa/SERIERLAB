import { describe, expect, it } from 'vitest';
import { ProtocolRouter } from '../protocol/router';

describe('ProtocolRouter', () => {
  it('switches decoders and resets pending', () => {
    const r = new ProtocolRouter();
    r.setProtocol('firewater');
    r.feed(new TextEncoder().encode('1,2'), 1);
    r.setProtocol('raw');
    expect(r.feed(new Uint8Array([1, 2, 3]), 2)).toHaveLength(0);
    r.setProtocol('firewater');
    const b = r.feed(new TextEncoder().encode('3,4\n'), 3);
    expect(b).toHaveLength(1);
  });

  it('exposes scriptBlocked for untrusted custom script protocols', () => {
    const r = new ProtocolRouter();
    r.setProtocol(
      {
        kind: 'custom',
        config: {
          id: 's1',
          name: 's',
          mode: 'script',
          script: 'return [1];',
        },
      },
      { scriptAllowed: false }
    );
    expect(r.scriptBlocked).toBe(true);
    expect(r.protocolKind).toBe('custom');
  });

  it('clears scriptBlocked when switching back to builtin', () => {
    const r = new ProtocolRouter();
    r.setProtocol(
      {
        kind: 'custom',
        config: { id: 's1', name: 's', mode: 'script', script: 'return [1];' },
      },
      { scriptAllowed: false }
    );
    expect(r.scriptBlocked).toBe(true);
    r.setProtocol('justfloat');
    expect(r.scriptBlocked).toBe(false);
  });
});
