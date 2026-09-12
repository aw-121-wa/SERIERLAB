export type RawDir = 'RX' | 'TX';
export type RawEntry = { tMs: number; dir: RawDir; bytes: Uint8Array };

export class RawBuffer {
  private chunks: RawEntry[] = [];
  private byteLen = 0;
  private dropped = 0;

  constructor(private readonly capacityBytes: number) {}

  get droppedBytes(): number {
    return this.dropped;
  }

  push(bytes: Uint8Array, dir: RawDir, tMs: number): void {
    this.chunks.push({ tMs, dir, bytes: bytes.slice() });
    this.byteLen += bytes.length;
    while (this.byteLen > this.capacityBytes && this.chunks.length > 0) {
      const old = this.chunks.shift()!;
      this.byteLen -= old.bytes.length;
      this.dropped += old.bytes.length;
    }
  }

  entries(): RawEntry[] {
    return this.chunks;
  }

  toArray(): Uint8Array {
    const out = new Uint8Array(this.byteLen);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c.bytes, o);
      o += c.bytes.length;
    }
    return out;
  }

  clear(): void {
    this.chunks = [];
    this.byteLen = 0;
  }
}
