import { ChannelRing } from './channelRing';
import { minMaxDownsampleFrom } from './minMaxDownsample';

export type SeriesPointMeta = { id: string; name: string; color: string; visible: boolean };

export type ChannelWindow = SeriesPointMeta & { xs: number[]; ys: number[] };

export class SeriesStore {
  private rings = new Map<string, ChannelRing>();
  private meta = new Map<string, SeriesPointMeta>();

  constructor(
    private readonly windowMs: number,
    private readonly maxPointsPerChannel = 20_000
  ) {
    if (maxPointsPerChannel < 1) throw new Error('maxPointsPerChannel must be >= 1');
  }

  private ringFor(id: string): ChannelRing {
    let r = this.rings.get(id);
    if (!r) {
      r = new ChannelRing(this.maxPointsPerChannel);
      this.rings.set(id, r);
    }
    return r;
  }

  setMeta(id: string, meta: Partial<SeriesPointMeta> & { name?: string }): void {
    const prev = this.meta.get(id) ?? {
      id,
      name: meta.name ?? id,
      color: '#3b82f6',
      visible: true,
    };
    this.meta.set(id, { ...prev, ...meta, id });
    this.ringFor(id);
  }

  /** Newest sample on a channel, or undefined if empty. */
  lastValue(id: string): number | undefined {
    const r = this.rings.get(id);
    if (!r || r.count === 0) return undefined;
    return r.yAt(r.count - 1);
  }

  /** Newest sample per channel (id → value). */
  lastValues(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, r] of this.rings) {
      if (r.count > 0) out[id] = r.yAt(r.count - 1);
    }
    return out;
  }

  append(tMs: number, values: number[], channelIds: string[]): void {
    for (let i = 0; i < channelIds.length; i++) {
      const id = channelIds[i]!;
      const v = values[i];
      if (v === undefined || !Number.isFinite(v)) continue;
      if (!this.meta.has(id)) {
        this.meta.set(id, { id, name: id, color: '#3b82f6', visible: true });
      }
      const ring = this.ringFor(id);
      ring.push(tMs, v);
      ring.evictBefore(tMs - this.windowMs);
    }
  }

  /**
   * Display/snapshot window for all channels.
   * Hidden channels are still included (visible=false) so the webview can re-show them
   * without a host round-trip; visibility is presentation-only.
   */
  getWindow(maxPoints = 4000): ChannelWindow[] {
    const out: ChannelWindow[] = [];
    for (const [id, meta] of this.meta) {
      const ring = this.rings.get(id);
      const n = ring?.count ?? 0;
      const series = minMaxDownsampleFrom(
        n,
        (i) => ring!.xAt(i),
        (i) => ring!.yAt(i),
        maxPoints
      );
      out.push({ ...meta, xs: series.xs, ys: series.ys });
    }
    return out;
  }

  /**
   * @param aliasMap optional display-name override per channel id
   * @param toIso maps session-relative t_ms → wall-clock ISO; omit to leave iso_time empty
   *   (never pass session-relative ms into `new Date` — that yields 1970).
   */
  exportCsv(aliasMap?: Map<string, string>, toIso?: (tMs: number) => string): string {
    const ids = [...this.meta.keys()];
    const headers = ['t_ms', 'iso_time', ...ids.map((id) => aliasMap?.get(id) ?? this.meta.get(id)!.name)];
    const maxLen = Math.max(0, ...ids.map((id) => this.rings.get(id)?.count ?? 0));
    const lines: string[] = [headers.join(',')];
    const tRing = this.rings.get(ids[0] ?? '');
    for (let i = 0; i < maxLen; i++) {
      const t = tRing && i < tRing.count ? tRing.xAt(i) : undefined;
      const iso = t !== undefined && toIso ? toIso(t) : '';
      const row = [String(t ?? ''), iso];
      for (const id of ids) {
        const r = this.rings.get(id);
        const v = r && i < r.count ? r.yAt(i) : undefined;
        row.push(v === undefined ? '' : String(v));
      }
      lines.push(row.join(','));
    }
    return lines.join('\n');
  }

  clear(): void {
    for (const r of this.rings.values()) r.clear();
  }
}
