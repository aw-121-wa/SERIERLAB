import { ChannelWindow } from '../store/seriesStore';
import { PendingPlotDelta } from './pendingPlotDelta';

export type PlotSnapshotMsg = {
  type: 'plot.snapshot';
  generation: number;
  seq: number;
  series: ChannelWindow[];
};

export type PlotDeltaMsg = {
  type: 'plot.delta';
  generation: number;
  seq: number;
  series: { id: string; xs: number[]; ys: number[] }[];
};

export type PlotResetMsg = {
  type: 'plot.reset';
  generation: number;
  seq: number;
  reason: string;
};

export type PlotFlushResult = PlotSnapshotMsg | PlotDeltaMsg;

/**
 * Host-side plot presentation sync.
 * SeriesStore remains authoritative; this only decides snapshot vs delta messages.
 *
 * generation: plot data epoch (clear / protocol reset / resync)
 * seq: monotonic Host→Webview plot message id (gap ⇒ webview requests snapshot)
 */
export class PlotPresenter {
  private generation = 1;
  private seq = 0;
  private pending = new PendingPlotDelta();
  private needsSnapshot = true;
  private paused = false;

  constructor(
    private readonly snapshotMaxPoints = 3000,
    private readonly deltaMaxPointsPerChannel = 512
  ) {}

  get currentGeneration(): number {
    return this.generation;
  }

  get currentSeq(): number {
    return this.seq;
  }

  get pendingPoints(): number {
    return this.pending.totalPoints;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get snapshotRequired(): boolean {
    return this.needsSnapshot;
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      // Do not accumulate presentation backlog while plot UI is paused.
      this.pending.clear();
    } else {
      // Resume: fresh snapshot, never replay the pause backlog.
      this.pending.clear();
      this.needsSnapshot = true;
    }
  }

  addPoints(tMs: number, values: number[], channelIds: string[]): void {
    if (this.paused) return;
    for (let i = 0; i < channelIds.length; i++) {
      const v = values[i];
      if (v === undefined || !Number.isFinite(v)) continue;
      this.pending.add(channelIds[i]!, tMs, v);
    }
  }

  requestSnapshot(_reason?: string): void {
    this.pending.clear();
    this.needsSnapshot = true;
  }

  bumpGeneration(_reason?: string): number {
    this.generation += 1;
    this.pending.clear();
    this.needsSnapshot = true;
    return this.generation;
  }

  buildReset(reason: string): PlotResetMsg {
    this.generation += 1;
    this.pending.clear();
    this.needsSnapshot = true;
    this.seq += 1;
    return {
      type: 'plot.reset',
      generation: this.generation,
      seq: this.seq,
      reason,
    };
  }

  /**
   * One UI flush tick.
   * @param getWindow authoritative snapshot source (SeriesStore.getWindow)
   */
  flush(getWindow: (maxPoints: number) => ChannelWindow[]): PlotFlushResult[] {
    if (this.paused) return [];

    if (this.needsSnapshot) {
      this.seq += 1;
      const msg: PlotSnapshotMsg = {
        type: 'plot.snapshot',
        generation: this.generation,
        seq: this.seq,
        series: getWindow(this.snapshotMaxPoints),
      };
      this.pending.clear();
      this.needsSnapshot = false;
      return [msg];
    }

    const series = this.pending
      .drainForSend(this.deltaMaxPointsPerChannel)
      .filter((s) => s.xs.length > 0);
    if (series.length === 0) return [];
    this.seq += 1;
    const msg: PlotDeltaMsg = {
      type: 'plot.delta',
      generation: this.generation,
      seq: this.seq,
      series,
    };
    return [msg];
  }
}
