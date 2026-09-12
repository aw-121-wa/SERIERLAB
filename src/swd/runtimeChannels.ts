import { createHash } from 'crypto';

/**
 * Firmware identity = SHA-256 of ELF **file bytes** (not path).
 * Recompiling to the same path changes identity and must invalidate watches.
 */
export type FirmwareIdentity = {
  /** Full 64-hex SHA-256 of ELF contents. */
  sha256: string;
  /** Prefix used in channel ids (16 hex = 64-bit). */
  idPrefix: string;
};

export function firmwareIdentityFromBytes(bytes: Uint8Array | Buffer): FirmwareIdentity {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { sha256, idPrefix: sha256.slice(0, 16) };
}

export function firmwareIdentityFromPath(elfPath: string): FirmwareIdentity {
  // Lazy require keeps this module importable in unit tests without fs fixtures when unused.
  const { readFileSync } = require('fs') as typeof import('fs');
  return firmwareIdentityFromBytes(readFileSync(elfPath));
}

/** Stable SWD channel id: firmware content id + semantic path (never bare address). */
export function swdChannelId(firmwareSha256: string, expression: string): string {
  return `swd.${firmwareSha256.slice(0, 16)}.${expression}`;
}

export type SwdPlotSample = {
  channelId: string;
  path: string;
  tMs: number;
  value: number | boolean;
  type: 'float32' | 'int32' | 'uint32' | 'bool';
};

/**
 * S13 v1: one global SWD poll rate for all watches (serialLab.swd.pollHz).
 * Channel.pollRateHz mirrors that actual global rate — not per-variable scheduling.
 */
export const SWD_POLL_HZ = [1, 5, 10, 20, 50] as const;
export type SwdPollHz = (typeof SWD_POLL_HZ)[number];

export function clampSwdPollHz(hz: number): number {
  if (!Number.isFinite(hz) || hz <= 0) return 0;
  if (hz >= 50) return 50;
  if (hz >= 20) return 20;
  if (hz >= 10) return 10;
  if (hz >= 5) return 5;
  return 1;
}

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
