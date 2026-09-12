import { describe, expect, it } from 'vitest';
import { encodeFrame, NativeFrameDecoder, decodeRawFrame } from '../protocol/native/frameCodec';
import { NATIVE_VERSION, NativeMessageType } from '../protocol/native/types';

function frag(bytes: Uint8Array, every: number): Uint8Array[] {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += every) {
    parts.push(bytes.slice(i, Math.min(i + every, bytes.length)));
  }
  return parts;
}

describe('Native frame codec', () => {
  const payload = Uint8Array.from([1, 2, 3, 4]);
  const wire = encodeFrame({
    messageType: NativeMessageType.ParamGet,
    flags: 0,
    requestId: 1,
    payload: Uint8Array.from([1, 0]),
  });

  it('encode produces COBS body + 0x00 delimiter', () => {
    expect(wire[wire.length - 1]).toBe(0);
    expect(wire.includes(0)).toBe(false || wire[wire.length - 1] === 0);
    // no internal zero before delimiter
    for (let i = 0; i < wire.length - 1; i++) expect(wire[i]).not.toBe(0);
  });

  it('decode raw frame after COBS', () => {
    const dec = new NativeFrameDecoder();
    const frames = dec.feed(wire);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.version).toBe(NATIVE_VERSION);
    expect(frames[0]!.messageType).toBe(NativeMessageType.ParamGet);
    expect(frames[0]!.requestId).toBe(1);
    expect(Array.from(frames[0]!.payload)).toEqual([1, 0]);
  });

  it('arbitrary fragmentation every split', () => {
    for (let n = 1; n <= wire.length; n++) {
      const dec = new NativeFrameDecoder();
      const out = [];
      for (const p of frag(wire, n)) out.push(...dec.feed(p));
      expect(out).toHaveLength(1);
      expect(out[0]!.requestId).toBe(1);
    }
  });

  it('multiple frames in one chunk', () => {
    const a = encodeFrame({ messageType: 1, flags: 0, requestId: 1, payload: new Uint8Array(0) });
    const b = encodeFrame({ messageType: 2, flags: 0, requestId: 2, payload: Uint8Array.from([9]) });
    const both = new Uint8Array(a.length + b.length);
    both.set(a, 0);
    both.set(b, a.length);
    const frames = new NativeFrameDecoder().feed(both);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.requestId).toBe(1);
    expect(frames[1]!.requestId).toBe(2);
  });

  it('bad CRC discards frame and recovers', () => {
    const good = encodeFrame({ messageType: 1, flags: 0, requestId: 7, payload: Uint8Array.from([1]) });
    const bad = Uint8Array.from(good);
    // flip a payload-ish byte inside COBS (not delimiter)
    bad[1] ^= 0xff;
    const dec = new NativeFrameDecoder();
    const first = dec.feed(bad);
    expect(first).toHaveLength(0);
    expect(dec.crcErrors + dec.decodeErrors).toBeGreaterThan(0);
    const second = dec.feed(good);
    expect(second).toHaveLength(1);
    expect(second[0]!.requestId).toBe(7);
  });

  it('unsupported version reject', () => {
    const raw = new Uint8Array(10);
    raw[0] = 9;
    raw[6] = 0;
    raw[7] = 0;
    // skip CRC for this unit check on decodeRawFrame
    const r = decodeRawFrame(raw);
    expect(r.ok).toBe(false);
  });

  it('payloadLength mismatch reject', () => {
    const w = encodeFrame({ messageType: 1, flags: 0, requestId: 1, payload: Uint8Array.from([1, 2, 3]) });
    const dec = new NativeFrameDecoder();
    const f = dec.feed(w);
    expect(f).toHaveLength(1);
    // corrupt by re-encoding wrong length is covered via decodeRawFrame
    const raw = new Uint8Array(8);
    raw[0] = 1;
    raw[6] = 5;
    raw[7] = 0;
    expect(decodeRawFrame(raw).ok).toBe(false);
  });

  it('stray delimiter alone is ignored', () => {
    const dec = new NativeFrameDecoder();
    expect(dec.feed(Uint8Array.from([0]))).toHaveLength(0);
  });
});
