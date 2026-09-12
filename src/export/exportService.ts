import { RawEntry } from '../store/rawBuffer';
import { encodeHex } from '../protocol/hex';
import { SeriesStore } from '../store/seriesStore';

export function formatRawLog(entries: RawEntry[]): string {
  const lines = ['timestamp_iso,t_ms,dir,payload_hex'];
  for (const e of entries) {
    const iso = new Date(e.tMs).toISOString();
    lines.push(`${iso},${e.tMs},${e.dir},${encodeHex(e.bytes)}`);
  }
  return lines.join('\n');
}

export function samplesCsvFromStore(store: SeriesStore): string {
  return store.exportCsv();
}
