import { minMaxDownsample } from '../store/minMaxDownsample';

export type PlotDeltaSeries = { id: string; xs: number[]; ys: number[] };

/**
 * Bounded presentation-only delta buffer.
 * Not a substitute for SeriesStore — host still appends to the authoritative ring.
 */
export class PendingPlotDelta {
  private data = new Map<string, { xs: number[]; ys: number[] }>();
  private points = 0;

  get totalPoints(): number {
    return this.points;
  }

  get channelCount(): number {
    return this.data.size;
  }

  add(id: string, tMs: number, value: number): void {
    let s = this.data.get(id);
    if (!s) {
      s = { xs: [], ys: [] };
      this.data.set(id, s);
    }
    s.xs.push(tMs);
    s.ys.push(value);
    this.points += 1;
  }

  /** Drain for one flush. Per-channel envelope if over budget. */
  drainForSend(maxPerChannel: number): PlotDeltaSeries[] {
    const out: PlotDeltaSeries[] = [];
    for (const [id, s] of this.data) {
      if (s.xs.length === 0) continue;
      if (s.xs.length <= maxPerChannel) {
        out.push({ id, xs: s.xs, ys: s.ys });
      } else {
        const d = minMaxDownsample(s.xs, s.ys, maxPerChannel);
        if (d.xs.length > 0) out.push({ id, xs: d.xs, ys: d.ys });
      }
    }
    this.clear();
    return out;
  }

  clear(): void {
    this.data.clear();
    this.points = 0;
  }
}
