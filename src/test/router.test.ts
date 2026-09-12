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
});
