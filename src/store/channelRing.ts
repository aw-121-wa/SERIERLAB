/**
 * Bounded circular buffer for one channel's (t, v) series.
 * Physical layout may wrap; logical order is always oldest → newest.
 * Capacity overflow drops oldest. Time eviction advances head (amortized O(1)).
 */
export class ChannelRing {
  readonly capacity: number;
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private head = 0;
  private len = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('ChannelRing capacity must be an integer >= 1');
    }
    this.capacity = capacity;
    this.xs = new Float64Array(capacity);
    this.ys = new Float64Array(capacity);
  }

  get count(): number {
    return this.len;
  }

  /** Append newest sample. When full, overwrites the oldest slot. */
  push(tMs: number, value: number): void {
    if (this.len < this.capacity) {
      const i = (this.head + this.len) % this.capacity;
      this.xs[i] = tMs;
      this.ys[i] = value;
      this.len += 1;
      return;
    }
    this.xs[this.head] = tMs;
    this.ys[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
  }

  /** Drop samples with timestamp < cutoff, from the oldest end only. */
  evictBefore(cutoff: number): void {
    while (this.len > 0 && this.xs[this.head]! < cutoff) {
      this.head = (this.head + 1) % this.capacity;
      this.len -= 1;
    }
  }

  /** Logical index: 0 = oldest, count-1 = newest. */
  xAt(i: number): number {
    return this.xs[(this.head + i) % this.capacity]!;
  }

  yAt(i: number): number {
    return this.ys[(this.head + i) % this.capacity]!;
  }

  clear(): void {
    this.head = 0;
    this.len = 0;
  }
}
