import { describe, expect, it } from 'vitest';
import { firmwareIdentityFromBytes, swdChannelId } from '../swd/runtimeChannels';
import { ChannelRegistry } from '../store/channels';
import { SeriesStore } from '../store/seriesStore';

/** Informational: 20 SWD vars @ 20Hz × 10min simulated — no CI time gate. */
describe('S13 SWD poll bench (informational)', () => {
  it('20 vars × 20Hz × 10min stays bounded', () => {
    const reg = new ChannelRegistry();
    const store = new SeriesStore(600_000, 20_000);
    const sha = firmwareIdentityFromBytes(Buffer.from('bench-elf')).sha256;
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const path = `var${i}.x`;
      const id = swdChannelId(sha, path);
      reg.registerSwdChannel({ id, path, pollRateHz: 20 });
      store.setMeta(id, { path, displayName: path, color: '#888', visible: true });
      ids.push(id);
    }
    const values = ids.map((_, i) => i);
    const t0 = performance.now();
    // 20Hz × 600s = 12000 polls
    for (let n = 0; n < 12_000; n++) {
      const t = n * 50; // ms
      store.append(t, values, ids);
    }
    const ms = performance.now() - t0;
    expect(store.getWindow(5000)[0]!.xs.length).toBeLessThanOrEqual(20_000);
    console.info(`[bench] swd 20var×20Hz×10min append ${ms.toFixed(1)}ms; ch0=${store.getWindow(5000)[0]!.xs.length}`);
  });
});
