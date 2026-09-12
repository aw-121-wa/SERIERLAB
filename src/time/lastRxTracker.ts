/**
 * Status-bar session time of the latest RX sample.
 * Intentionally NOT SessionClock.now() (that is extension lifetime).
 */
export class LastRxTracker {
  private t = 0;

  /** Call only when a serial RX chunk is received. */
  update(sessionTMs: number): void {
    this.t = sessionTMs;
  }

  get tMs(): number {
    return this.t;
  }

  /** Disconnect keeps the last RX time; do not clear. */
  resetForTests(): void {
    this.t = 0;
  }
}
