export type PendingUiDir = 'RX' | 'TX';

export type PendingUiEntry = {
  tMs: number;
  dir: PendingUiDir;
  bytes: Uint8Array;
};

export type PendingUiQueueOptions = {
  maxBytes: number;
  maxEntries: number;
  /** Max entries kept when UI resumes after pause. */
  resumeKeepEntries?: number;
  /** Max bytes kept when UI resumes after pause. */
  resumeKeepBytes?: number;
};

/**
 * Bounded UI presentation queue for terminal flush.
 * Serial/decode/store continue while paused; this queue only feeds the webview.
 * Overflow policy: drop oldest. Oversized single chunks are truncated to the last maxBytes.
 */
export class PendingUiQueue {
  private items: PendingUiEntry[] = [];
  private byteLen = 0;
  private droppedEntries = 0;
  private droppedBytes = 0;

  constructor(private readonly opts: PendingUiQueueOptions) {
    if (!(opts.maxBytes > 0)) throw new Error('maxBytes must be > 0');
    if (!(opts.maxEntries > 0)) throw new Error('maxEntries must be > 0');
  }

  get length(): number {
    return this.items.length;
  }

  get bytes(): number {
    return this.byteLen;
  }

  get droppedEntryCount(): number {
    return this.droppedEntries;
  }

  get droppedByteCount(): number {
    return this.droppedBytes;
  }

  push(tMs: number, dir: PendingUiDir, bytes: Uint8Array): void {
    // Single chunk may exceed maxBytes; keep only the tail so the queue stays bounded.
    const copy =
      bytes.length > this.opts.maxBytes
        ? bytes.slice(bytes.length - this.opts.maxBytes)
        : bytes.slice();
    this.items.push({ tMs, dir, bytes: copy });
    this.byteLen += copy.length;
    this.evictOverflow();
  }

  /** Drain all pending entries for a UI flush. */
  drain(): PendingUiEntry[] {
    const out = this.items;
    this.items = [];
    this.byteLen = 0;
    return out;
  }

  /**
   * On resume: do not replay the entire pause backlog.
   * Keep only a small recent tail; count the rest as dropped UI.
   */
  trimForResume(): void {
    const keepEntries = this.opts.resumeKeepEntries ?? 200;
    const keepBytes = this.opts.resumeKeepBytes ?? 64 * 1024;
    let start = this.items.length;
    let kept = 0;
    while (start > 0 && this.items.length - start < keepEntries) {
      const len = this.items[start - 1]!.bytes.length;
      if (kept + len > keepBytes && start < this.items.length) break;
      kept += len;
      start -= 1;
    }
    for (let i = 0; i < start; i++) {
      this.droppedEntries += 1;
      this.droppedBytes += this.items[i]!.bytes.length;
    }
    this.items = this.items.slice(start);
    this.byteLen = kept;
  }

  clear(): void {
    this.items = [];
    this.byteLen = 0;
  }

  private evictOverflow(): void {
    while (
      this.items.length > 0 &&
      (this.byteLen > this.opts.maxBytes || this.items.length > this.opts.maxEntries)
    ) {
      const old = this.items.shift()!;
      this.byteLen -= old.bytes.length;
      this.droppedEntries += 1;
      this.droppedBytes += old.bytes.length;
    }
  }
}
