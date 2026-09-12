import { cobsDecode, cobsEncode } from './cobs';
import { crc16CcittFalse } from './crc16';
import { NATIVE_MAX_DECODED_FRAME, NATIVE_MAX_ENCODED_PENDING, NATIVE_VERSION, NativeFrame } from './types';

export const FRAME_HEADER_SIZE = 8;
export const FRAME_CRC_SIZE = 2;

export type FrameDecodeResult =
  | { ok: true; frame: NativeFrame }
  | { ok: false; error: string };

export function encodeFrame(frame: {
  messageType: number;
  flags: number;
  requestId: number;
  payload: Uint8Array;
}): Uint8Array {
  const n = frame.payload.length;
  const raw = new Uint8Array(FRAME_HEADER_SIZE + n + FRAME_CRC_SIZE);
  raw[0] = NATIVE_VERSION;
  raw[1] = frame.messageType & 0xff;
  raw[2] = frame.flags & 0xff;
  raw[3] = 0;
  raw[4] = frame.requestId & 0xff;
  raw[5] = (frame.requestId >> 8) & 0xff;
  raw[6] = n & 0xff;
  raw[7] = (n >> 8) & 0xff;
  raw.set(frame.payload, FRAME_HEADER_SIZE);
  const crc = crc16CcittFalse(raw.subarray(0, FRAME_HEADER_SIZE + n));
  raw[FRAME_HEADER_SIZE + n] = crc & 0xff;
  raw[FRAME_HEADER_SIZE + n + 1] = (crc >> 8) & 0xff;
  const encoded = cobsEncode(raw);
  const wire = new Uint8Array(encoded.length + 1);
  wire.set(encoded, 0);
  wire[encoded.length] = 0;
  return wire;
}

export function decodeRawFrame(raw: Uint8Array): FrameDecodeResult {
  if (raw.length < FRAME_HEADER_SIZE + FRAME_CRC_SIZE) {
    return { ok: false, error: 'frame too short' };
  }
  if (raw.length > NATIVE_MAX_DECODED_FRAME) {
    return { ok: false, error: 'frame exceeds max decoded size' };
  }
  const version = raw[0]!;
  if (version !== NATIVE_VERSION) {
    return { ok: false, error: `unsupported version ${version}` };
  }
  const payloadLength = raw[6]! | (raw[7]! << 8);
  const expected = FRAME_HEADER_SIZE + payloadLength + FRAME_CRC_SIZE;
  if (raw.length !== expected) {
    return { ok: false, error: 'payloadLength mismatch' };
  }
  const crcRx = raw[expected - 2]! | (raw[expected - 1]! << 8);
  const crcCalc = crc16CcittFalse(raw.subarray(0, expected - 2));
  if (crcRx !== crcCalc) {
    return { ok: false, error: 'crc mismatch' };
  }
  const payload = raw.slice(FRAME_HEADER_SIZE, FRAME_HEADER_SIZE + payloadLength);
  return {
    ok: true,
    frame: {
      version,
      messageType: raw[1]!,
      flags: raw[2]!,
      reserved: raw[3]!,
      requestId: raw[4]! | (raw[5]! << 8),
      payload,
    },
  };
}

/**
 * Incremental stream decoder: feed bytes, receive complete frames.
 * Recovers after malformed COBS/CRC by resyncing on next 0x00.
 */
export class NativeFrameDecoder {
  private pending: number[] = [];
  framesRx = 0;
  crcErrors = 0;
  decodeErrors = 0;
  oversizeErrors = 0;

  feed(chunk: Uint8Array): NativeFrame[] {
    const out: NativeFrame[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i]!;
      if (b === 0) {
        if (this.pending.length === 0) continue; // stray delimiter
        const encoded = Uint8Array.from(this.pending);
        this.pending = [];
        if (encoded.length > NATIVE_MAX_ENCODED_PENDING) {
          this.oversizeErrors += 1;
          this.decodeErrors += 1;
          continue;
        }
        const decoded = cobsDecode(encoded);
        if (!decoded) {
          this.decodeErrors += 1;
          continue;
        }
        const res = decodeRawFrame(decoded);
        if (!res.ok) {
          if (res.error === 'crc mismatch') this.crcErrors += 1;
          else this.decodeErrors += 1;
          continue;
        }
        this.framesRx += 1;
        out.push(res.frame);
      } else {
        if (this.pending.length >= NATIVE_MAX_ENCODED_PENDING) {
          // Discard until delimiter (handled when 0x00 arrives)
          this.oversizeErrors += 1;
          this.decodeErrors += 1;
          this.pending.push(b);
          if (this.pending.length > NATIVE_MAX_ENCODED_PENDING + 64) {
            this.pending = [];
          }
          continue;
        }
        this.pending.push(b);
      }
    }
    return out;
  }

  reset(): void {
    this.pending = [];
  }
}
