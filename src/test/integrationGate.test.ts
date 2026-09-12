import { describe, expect, it } from 'vitest';
import { JustFloatDecoder } from '../protocol/justfloat';
import { FireWaterDecoder } from '../protocol/firewater';
import { SeriesStore } from '../store/seriesStore';
import { PendingUiQueue } from '../store/pendingUiQueue';
import { PlotPresenter } from '../plot/plotPresenter';
import { DisplayRing } from '../store/displayRing';

/**
 * S7 Integration Gate — pure software pipeline (no serial hardware).
 *
 * Synthetic source → Decoder → SeriesStore(Ring) → PlotPresenter → FakeWebview
 *
 * Gate (not absolute CPU%):
 * - presentation buffers stay bounded
 * - session timestamps keep increasing
 * - pipeline does not stall
 * - pause / resume / clear state machine stays consistent
 */

function encodeJustFloat(values: number[]): Uint8Array {
  const bytes = new Uint8Array(4 + values.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) view.setFloat32(i * 4, values[i]!, true);
  view.setUint32(values.length * 4, 0x7f800000, true);
  return bytes;
}

class FakeWebview {
  generation = -1;
  expectedSeq = -1;
  rings = new Map<string, DisplayRing>();
  needSnapshots = 0;
  appliedSnapshots = 0;
  appliedDeltas = 0;

  constructor(private readonly cap = 4096) {}

  onMessage(msg: { type: string; generation?: number; seq?: number; series?: any[]; reason?: string }): void {
    if (msg.type === 'plot.snapshot') {
      if ((msg.generation ?? 0) < this.generation) return;
      this.generation = msg.generation!;
      this.expectedSeq = msg.seq! + 1;
      this.rings.clear();
      for (const s of msg.series || []) {
        const r = new DisplayRing(this.cap);
        const xs = s.xs || [];
        const ys = s.ys || [];
        for (let i = 0; i < xs.length; i++) r.push(xs[i], ys[i]);
        this.rings.set(s.id, r);
      }
      this.appliedSnapshots += 1;
      return;
    }
    if (msg.type === 'plot.delta') {
      if (msg.generation !== this.generation) return;
      if (msg.seq !== this.expectedSeq) {
        this.needSnapshots += 1;
        return;
      }
      this.expectedSeq = msg.seq! + 1;
      for (const s of msg.series || []) {
        let r = this.rings.get(s.id);
        if (!r) {
          r = new DisplayRing(this.cap);
          this.rings.set(s.id, r);
        }
        const xs = s.xs || [];
        const ys = s.ys || [];
        for (let i = 0; i < xs.length; i++) r.push(xs[i], ys[i]);
      }
      this.appliedDeltas += 1;
      return;
    }
    if (msg.type === 'plot.reset') {
      this.generation = msg.generation!;
      this.expectedSeq = msg.seq! + 1;
      this.rings.clear();
    }
  }

  totalPoints(): number {
    let n = 0;
    this.rings.forEach((r) => {
      n += r.count;
    });
    return n;
  }

  maxPointsPerChannel(): number {
    let m = 0;
    this.rings.forEach((r) => {
      if (r.count > m) m = r.count;
    });
    return m;
  }

  latestT(): number | null {
    let t: number | null = null;
    this.rings.forEach((r) => {
      if (r.count > 0) {
        const last = r.xAt(r.count - 1);
        if (t === null || last > t) t = last;
      }
    });
    return t;
  }
}

type Gate = {
  store: SeriesStore;
  host: PlotPresenter;
  ui: PendingUiQueue;
  wv: FakeWebview;
  decoder: JustFloatDecoder;
  ids: string[];
  stats: {
    frames: number;
    flushes: number;
    snapshots: number;
    deltas: number;
    maxUiBytes: number;
    maxWvPoints: number;
    maxStoreCh0: number;
  };
};

function createGate(opts?: { channels?: number; capacity?: number; uiMaxBytes?: number; wvCap?: number }): Gate {
  const channels = opts?.channels ?? 8;
  const ids = Array.from({ length: channels }, (_, i) => `ch${i}`);
  const decoder = new JustFloatDecoder();
  const store = new SeriesStore(60_000, opts?.capacity ?? 20_000);
  const host = new PlotPresenter(3000, 512);
  const ui = new PendingUiQueue({
    maxBytes: opts?.uiMaxBytes ?? 512 * 1024,
    maxEntries: 4000,
  });
  const wv = new FakeWebview(opts?.wvCap ?? 4096);
  host.requestSnapshot('gate');
  let snapshots = 0;
  for (const m of host.flush((n) => store.getWindow(n))) {
    wv.onMessage(m);
    if (m.type === 'plot.snapshot') snapshots += 1;
  }
  return {
    store,
    host,
    ui,
    wv,
    decoder,
    ids,
    stats: {
      frames: 0,
      flushes: 0,
      snapshots,
      deltas: 0,
      maxUiBytes: 0,
      maxWvPoints: 0,
      maxStoreCh0: 0,
    },
  };
}

function feedFrame(g: Gate, t: number, values: number[]): void {
  const frame = encodeJustFloat(values);
  g.stats.frames += 1;
  for (const b of g.decoder.feed(frame, t)) {
    g.store.append(b.tMs, b.values, g.ids);
    g.host.addPoints(b.tMs, b.values, g.ids);
  }
  g.ui.push(t, 'RX', frame);
  if (g.ui.bytes > g.stats.maxUiBytes) g.stats.maxUiBytes = g.ui.bytes;
}

function flushUi(g: Gate): void {
  g.ui.drain();
  for (const m of g.host.flush((n) => g.store.getWindow(n))) {
    g.wv.onMessage(m);
    if (m.type === 'plot.snapshot') g.stats.snapshots += 1;
    if (m.type === 'plot.delta') g.stats.deltas += 1;
  }
  const wvPts = g.wv.maxPointsPerChannel();
  if (wvPts > g.stats.maxWvPoints) g.stats.maxWvPoints = wvPts;
  const ch0 = g.store.getWindow(20_000).find((s) => s.id === 'ch0');
  const n = ch0?.xs.length ?? 0;
  if (n > g.stats.maxStoreCh0) g.stats.maxStoreCh0 = n;
  g.stats.flushes += 1;
}

describe('Integration Gate (software)', () => {
  it('8ch @ 1kHz × 20s: bounded buffers, rising t, no stall', () => {
    const g = createGate();
    const values = g.ids.map((_, i) => i + 0.5);
    for (let t = 0; t < 20_000; t++) {
      feedFrame(g, t, values.map((v) => v + Math.sin(t / 200) * 0.1));
      if (t % 50 === 49) flushUi(g);
    }
    expect(g.decoder.errors).toBe(0);
    expect(g.stats.frames).toBe(20_000);
    expect(g.stats.snapshots).toBeGreaterThanOrEqual(1);
    expect(g.stats.deltas).toBeGreaterThan(300);
    expect(g.wv.appliedDeltas).toBe(g.stats.deltas);
    expect(g.wv.needSnapshots).toBe(0);

    const latest = g.wv.latestT();
    expect(latest).not.toBeNull();
    expect(latest!).toBeGreaterThanOrEqual(19_000);

    expect(g.stats.maxUiBytes).toBeLessThanOrEqual(512 * 1024);
    expect(g.stats.maxWvPoints).toBeLessThanOrEqual(4096);
    expect(g.stats.maxStoreCh0).toBeGreaterThan(10_000);
    expect(g.stats.maxStoreCh0).toBeLessThanOrEqual(20_000);

    // Host authoritative last sample still advances
    expect(g.store.lastValue('ch0')).toBeGreaterThan(0);
  }, 60_000);

  it('high-rate burst: 8ch, 5 frames/ms × 2s (~40k samples/ch)', () => {
    const g = createGate();
    const values = g.ids.map((_, i) => i);
    for (let ms = 0; ms < 2000; ms++) {
      for (let k = 0; k < 5; k++) {
        const t = ms + k * 0.2;
        feedFrame(g, t, values.map((v) => v + t * 0.001));
      }
      if (ms % 50 === 49) flushUi(g);
    }
    expect(g.decoder.errors).toBe(0);
    expect(g.stats.maxUiBytes).toBeLessThanOrEqual(512 * 1024);
    expect(g.stats.maxWvPoints).toBeLessThanOrEqual(4096);
    expect(g.wv.latestT()).toBeGreaterThan(1900);
  }, 60_000);

  it('state machine: run → pause → resume → clear → run', () => {
    const g = createGate();
    const values = g.ids.map((_, i) => i);
    let phase = 0;
    for (let t = 0; t < 8000; t++) {
      feedFrame(g, t, values);
      if (t === 2000) {
        g.host.setPaused(true);
        phase = 1;
      }
      if (t === 4000) {
        expect(g.store.getWindow(3000)[0]!.xs.length).toBeGreaterThan(1500);
        expect(g.host.pendingPoints).toBe(0);
        g.host.setPaused(false);
        phase = 2;
      }
      if (t === 5000) {
        g.wv.onMessage(g.host.buildReset('clear'));
        g.store.clear();
        phase = 3;
      }
      if (t % 50 === 49) flushUi(g);
    }
    expect(phase).toBe(3);
    expect(g.wv.latestT()).toBeGreaterThanOrEqual(7000);
    expect(g.stats.maxWvPoints).toBeLessThanOrEqual(4096);
    expect(g.wv.needSnapshots).toBe(0);
  }, 30_000);

  it('FireWater text path feeds SeriesStore', () => {
    const d = new FireWaterDecoder();
    const store = new SeriesStore(10_000, 1000);
    const enc = new TextEncoder();
    for (let i = 0; i < 100; i++) {
      for (const b of d.feed(enc.encode(`${i},${i * 2},${i * 3}\n`), i)) {
        store.append(b.tMs, b.values, ['a', 'b', 'c']);
      }
    }
    expect(d.errors).toBe(0);
    expect(store.lastValue('c')).toBe(99 * 3);
  });
});
