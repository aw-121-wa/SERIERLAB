import { describe, expect, it } from 'vitest';
import { ChannelRing } from '../store/channelRing';

describe('ChannelRing', () => {
  it('keeps order before wrap', () => {
    const r = new ChannelRing(8);
    for (let i = 0; i < 5; i++) r.push(i, i * 10);
    expect(r.count).toBe(5);
    expect(r.xAt(0)).toBe(0);
    expect(r.xAt(4)).toBe(4);
    expect(r.yAt(2)).toBe(20);
  });

  it('keeps logical oldest→newest after wrap', () => {
    const r = new ChannelRing(4);
    for (let i = 0; i < 10; i++) r.push(i, i);
    expect(r.count).toBe(4);
    expect([r.xAt(0), r.xAt(1), r.xAt(2), r.xAt(3)]).toEqual([6, 7, 8, 9]);
    expect([r.yAt(0), r.yAt(1), r.yAt(2), r.yAt(3)]).toEqual([6, 7, 8, 9]);
  });

  it('supports capacity 1', () => {
    const r = new ChannelRing(1);
    r.push(1, 10);
    r.push(2, 20);
    r.push(3, 30);
    expect(r.count).toBe(1);
    expect(r.xAt(0)).toBe(3);
    expect(r.yAt(0)).toBe(30);
  });

  it('evicts before cutoff across wrap', () => {
    const r = new ChannelRing(4);
    // fill and wrap so physical layout is [8,9,6,7] with head at 8
    for (let i = 6; i <= 9; i++) r.push(i, i);
    expect(r.count).toBe(4);
    r.evictBefore(8);
    expect(r.count).toBe(2);
    expect(r.xAt(0)).toBe(8);
    expect(r.xAt(1)).toBe(9);
  });

  it('clear resets fully', () => {
    const r = new ChannelRing(4);
    for (let i = 0; i < 4; i++) r.push(i, i);
    r.clear();
    expect(r.count).toBe(0);
    r.push(100, 1);
    expect(r.count).toBe(1);
    expect(r.xAt(0)).toBe(100);
    expect(r.yAt(0)).toBe(1);
  });

  it('rejects invalid capacity', () => {
    expect(() => new ChannelRing(0)).toThrow();
  });
});
