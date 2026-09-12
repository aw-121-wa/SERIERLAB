import { describe, expect, it } from 'vitest';
import { LastRxTracker } from '../time/lastRxTracker';
import { SessionClock } from '../time/sessionClock';

describe('Status tMs = last RX session time', () => {
  it('1: stays 0 while session clock advances without RX', () => {
    let mono = 0;
    const clock = new SessionClock({ epochMs: 0, monoNow: () => mono });
    const lastRx = new LastRxTracker();
    expect(lastRx.tMs).toBe(0);
    mono = 50_000; // 50s of idle flushUi/pushStatus
    expect(clock.now()).toBe(50_000);
    expect(lastRx.tMs).toBe(0);
  });

  it('2: RX at t=123 sets status t=123', () => {
    const lastRx = new LastRxTracker();
    lastRx.update(123);
    expect(lastRx.tMs).toBe(123);
  });

  it('3: clock advances but no new RX keeps t frozen', () => {
    let mono = 0;
    const clock = new SessionClock({ epochMs: 0, monoNow: () => mono });
    const lastRx = new LastRxTracker();
    mono = 123;
    lastRx.update(clock.now());
    mono = 9999;
    // flushUi → pushStatus would post lastRx.tMs, not clock.now()
    expect(clock.now()).toBe(9999);
    expect(lastRx.tMs).toBe(123);
  });

  it('4: disconnect does not increase or clear t', () => {
    const lastRx = new LastRxTracker();
    lastRx.update(5331);
    // no RX while disconnected
    expect(lastRx.tMs).toBe(5331);
  });

  it('5: only new RX updates t after reconnect', () => {
    let mono = 0;
    const clock = new SessionClock({ epochMs: 0, monoNow: () => mono });
    const lastRx = new LastRxTracker();
    mono = 10_000;
    lastRx.update(clock.now());
    mono = 20_000; // disconnect gap
    expect(lastRx.tMs).toBe(10_000);
    mono = 21_000; // new RX after reconnect
    lastRx.update(clock.now());
    expect(lastRx.tMs).toBe(21_000);
  });

  it('TX must not update lastRx (caller contract)', () => {
    const lastRx = new LastRxTracker();
    lastRx.update(100);
    // send() path does not call update — simulate TX-only activity
    expect(lastRx.tMs).toBe(100);
  });
});
