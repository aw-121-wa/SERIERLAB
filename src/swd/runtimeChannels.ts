import { createHash } from 'crypto';

/** Stable SWD channel id: ELF identity + semantic path (never bare address). */
export function swdElfKey(elfPath: string): string {
  return createHash('sha256').update(elfPath.replace(/\\/g, '/').toLowerCase()).digest('hex').slice(0, 8);
}

export function swdChannelId(elfPath: string, expression: string): string {
  return `swd.${swdElfKey(elfPath)}.${expression}`;
}

export type SwdPlotSample = {
  channelId: string;
  path: string;
  tMs: number;
  value: number | boolean;
  type: 'float32' | 'int32' | 'uint32' | 'bool';
};

/**
 * Central SWD poll schedule — one timer owner, bounded rates.
 * High-rate telemetry stays on UART; SWD is low-rate observation.
 */
export const SWD_POLL_HZ = [1, 5, 10, 20, 50] as const;
export type SwdPollHz = (typeof SWD_POLL_HZ)[number];

export function clampSwdPollHz(hz: number): number {
  if (!Number.isFinite(hz) || hz <= 0) return 0; // 0 = no plot poll
  if (hz >= 50) return 50;
  if (hz >= 20) return 20;
  if (hz >= 10) return 10;
  if (hz >= 5) return 5;
  return 1;
}

/** In-memory variable-write markers (S15 will persist). */
export type VariableWriteEvent = {
  type: 'variable-write';
  source: 'swd' | 'native';
  tMs: number;
  symbol: string;
  oldValue?: number | boolean;
  requestedValue: number | boolean;
  readbackValue?: number | boolean;
  error?: string;
};
