/**
 * Bounded circular display buffer (presentation only).
 * Logical order is always oldest → newest.
 */
export class DisplayRing {
  readonly capacity: number;
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private head = 0;
  private len = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('DisplayRing capacity must be an integer >= 1');
    }
    this.capacity = capacity;
    this.xs = new Float64Array(capacity);
    this.ys = new Float64Array(capacity);
  }

  get count(): number {
    return this.len;
  }

  push(x: number, y: number): void {
    if (this.len < this.capacity) {
      const i = (this.head + this.len) % this.capacity;
      this.xs[i] = x;
      this.ys[i] = y;
      this.len += 1;
      return;
    }
    this.xs[this.head] = x;
    this.ys[this.head] = y;
    this.head = (this.head + 1) % this.capacity;
  }

  xAt(i: number): number {
    return this.xs[(this.head + i) % this.capacity]!;
  }

  yAt(i: number): number {
    return this.ys[(this.head + i) % this.capacity]!;
  }

  /** Copy logical order into plain arrays for uPlot. */
  materialize(): { xs: number[]; ys: number[] } {
    const xs = new Array<number>(this.len);
    const ys = new Array<number>(this.len);
    for (let i = 0; i < this.len; i++) {
      xs[i] = this.xAt(i);
      ys[i] = this.yAt(i);
    }
    return { xs, ys };
  }

  clear(): void {
    this.head = 0;
    this.len = 0;
  }

  resetFrom(xs: ArrayLike<number>, ys: ArrayLike<number>): void {
    this.clear();
    const n = Math.min(xs.length, ys.length);
    for (let i = 0; i < n; i++) this.push(xs[i]!, ys[i]!);
  }
}
