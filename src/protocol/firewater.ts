import { SampleBatch, StreamDecoder } from './types';

const MAX_PENDING = 64 * 1024;

export class FireWaterDecoder implements StreamDecoder {
  private pending = '';
  errors = 0;

  reset(): void {
    this.pending = '';
  }

  feed(chunk: Uint8Array, tMs: number): SampleBatch[] {
    this.pending += new TextDecoder('utf-8', { fatal: false }).decode(chunk);
    if (this.pending.length > MAX_PENDING) {
      this.pending = this.pending.slice(-MAX_PENDING);
      this.errors += 1;
    }
    const out: SampleBatch[] = [];
    let idx: number;
    while ((idx = this.pending.search(/\r\n|\n|\r/)) >= 0) {
      const line = this.pending.slice(0, idx);
      this.pending = this.pending.slice(idx + (this.pending.startsWith('\r\n', idx) ? 2 : 1));
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/[,\s]+/).filter(Boolean);
      const values: number[] = [];
      let ok = parts.length > 0;
      for (const p of parts) {
        const n = Number(p);
        if (!Number.isFinite(n)) {
          ok = false;
          break;
        }
        values.push(n);
      }
      if (!ok) {
        this.errors += 1;
        continue;
      }
      out.push({ tMs, values });
    }
    return out;
  }
}
