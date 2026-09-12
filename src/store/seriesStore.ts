export type SeriesPointMeta = { id: string; name: string; color: string; visible: boolean };

export type ChannelWindow = SeriesPointMeta & { xs: number[]; ys: number[] };

export class SeriesStore {
  private xs = new Map<string, number[]>();
  private ys = new Map<string, number[]>();
  private meta = new Map<string, SeriesPointMeta>();

  constructor(
    private readonly windowMs: number,
    private readonly maxPointsPerChannel = 20_000
  ) {}

  setMeta(id: string, meta: Partial<SeriesPointMeta> & { name?: string }): void {
    const prev = this.meta.get(id) ?? {
      id,
      name: meta.name ?? id,
      color: '#3b82f6',
      visible: true,
    };
    this.meta.set(id, { ...prev, ...meta, id });
    if (!this.xs.has(id)) {
      this.xs.set(id, []);
      this.ys.set(id, []);
    }
  }

  append(tMs: number, values: number[], channelIds: string[]): void {
    for (let i = 0; i < channelIds.length; i++) {
      const id = channelIds[i]!;
      const v = values[i];
      if (v === undefined || !Number.isFinite(v)) continue;
      if (!this.xs.has(id)) {
        this.xs.set(id, []);
        this.ys.set(id, []);
      }
      if (!this.meta.has(id)) {
        this.meta.set(id, { id, name: id, color: '#3b82f6', visible: true });
      }
      const xs = this.xs.get(id)!;
      const ys = this.ys.get(id)!;
      xs.push(tMs);
      ys.push(v);
      while (xs.length > this.maxPointsPerChannel) {
        xs.shift();
        ys.shift();
      }
      const cutoff = tMs - this.windowMs;
      while (xs.length && xs[0]! < cutoff) {
        xs.shift();
        ys.shift();
      }
    }
  }

  getWindow(maxPoints = 4000): ChannelWindow[] {
    const out: ChannelWindow[] = [];
    for (const [id, meta] of this.meta) {
      if (!meta.visible) continue;
      const xs = this.xs.get(id) ?? [];
      const ys = this.ys.get(id) ?? [];
      const stride = Math.max(1, Math.ceil(xs.length / maxPoints));
      const oxs: number[] = [];
      const oys: number[] = [];
      for (let i = 0; i < xs.length; i += stride) {
        oxs.push(xs[i]!);
        oys.push(ys[i]!);
      }
      out.push({ ...meta, xs: oxs, ys: oys });
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
    const maxLen = Math.max(0, ...ids.map((id) => (this.xs.get(id) ?? []).length));
    const lines: string[] = [headers.join(',')];
    for (let i = 0; i < maxLen; i++) {
      const t = this.xs.get(ids[0] ?? '')?.[i];
      const iso = t !== undefined && toIso ? toIso(t) : '';
      const row = [String(t ?? ''), iso];
      for (const id of ids) {
        const v = this.ys.get(id)?.[i];
        row.push(v === undefined ? '' : String(v));
      }
      lines.push(row.join(','));
    }
    return lines.join('\n');
  }

  clear(): void {
    for (const id of this.xs.keys()) {
      this.xs.set(id, []);
      this.ys.set(id, []);
    }
  }
}
