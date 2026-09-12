import { RawEntry } from '../store/rawBuffer';
import { encodeHex } from '../protocol/hex';
import { SeriesStore } from '../store/seriesStore';

/**
 * @param toIso maps session-relative t_ms → wall-clock ISO; omit to leave iso empty
 *   (must not do `new Date(sessionRelativeMs)` — that yields 1970).
 */
export function formatRawLog(entries: RawEntry[], toIso?: (tMs: number) => string): string {
  const lines = ['timestamp_iso,t_ms,dir,payload_hex'];
  for (const e of entries) {
    const iso = toIso ? toIso(e.tMs) : '';
    lines.push(`${iso},${e.tMs},${e.dir},${encodeHex(e.bytes)}`);
  }
  return lines.join('\n');
}

export function samplesCsvFromStore(store: SeriesStore): string {
  return store.exportCsv();
}
