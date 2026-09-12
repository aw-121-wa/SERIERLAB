import { SampleBatch, StreamDecoder } from './types';

const TAIL = [0x00, 0x00, 0x80, 0x7f];
const MAX_PENDING = 64 * 1024;

export class JustFloatDecoder implements StreamDecoder {
  private pending: number[] = [];
  private channelCount: number | null = null;
  errors = 0;

  reset(): void {
    this.pending = [];
    this.channelCount = null;
  }

  feed(chunk: Uint8Array, tMs: number): SampleBatch[] {
    const out: SampleBatch[] = [];
    for (const b of chunk) this.pending.push(b);
    if (this.pending.length > MAX_PENDING) {
      this.pending = this.pending.slice(-MAX_PENDING);
      this.errors += 1;
    }
    for (;;) {
      const idx = this.findTail();
      if (idx < 0) break;
      const frameBytes = this.pending.slice(0, idx);
      this.pending = this.pending.slice(idx + 4);
      if (frameBytes.length === 0 || frameBytes.length % 4 !== 0) {
        this.errors += 1;
        continue;
      }
      const count = frameBytes.length / 4;
      if (this.channelCount === null) this.channelCount = count;
      if (count !== this.channelCount) {
        this.errors += 1;
        continue;
      }
      const values: number[] = [];
      for (let i = 0; i < count; i++) {
        const u =
          frameBytes[i * 4]! |
          (frameBytes[i * 4 + 1]! << 8) |
          (frameBytes[i * 4 + 2]! << 16) |
          (frameBytes[i * 4 + 3]! << 24);
        values.push(new Float32Array(new Uint32Array([u >>> 0]).buffer)[0]!);
      }
      out.push({ tMs, values });
    }
    return out;
  }

  private findTail(): number {
    const p = this.pending;
    for (let i = 0; i + 4 <= p.length; i++) {
      if (
        p[i] === TAIL[0] &&
        p[i + 1] === TAIL[1] &&
        p[i + 2] === TAIL[2] &&
        p[i + 3] === TAIL[3]
      ) {
        return i;
      }
    }
    return -1;
  }
}
