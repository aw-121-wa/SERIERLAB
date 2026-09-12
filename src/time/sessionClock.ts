export type SessionClockDeps = {
  /** Wall-clock epoch at session start (Unix ms). */
  epochMs?: number;
  /** Monotonic time source in milliseconds. */
  monoNow?: () => number;
};

function defaultMonoNow(): number {
  return performance.now();
}

/**
 * Session-relative monotonic time plus wall-clock epoch.
 * `now()` is suitable for waveforms/logs; `toIso` is for export only.
 */
export class SessionClock {
  readonly epochMs: number;
  private readonly t0: number;
  private readonly monoNow: () => number;

  constructor(deps: SessionClockDeps = {}) {
    this.epochMs = deps.epochMs ?? Date.now();
    this.monoNow = deps.monoNow ?? defaultMonoNow;
    this.t0 = this.monoNow();
  }

  /** Monotonic ms since session start. */
  now(): number {
    return this.monoNow() - this.t0;
  }

  toWallClock(tMs: number): Date {
    return new Date(this.epochMs + tMs);
  }

  toIso(tMs: number): string {
    return this.toWallClock(tMs).toISOString();
  }
}
