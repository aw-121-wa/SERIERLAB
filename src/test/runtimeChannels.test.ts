import { describe, expect, it } from 'vitest';
import { swdChannelId, swdElfKey, clampSwdPollHz } from '../swd/runtimeChannels';
import { ChannelRegistry } from '../store/channels';
import { SeriesStore } from '../store/seriesStore';

describe('S13 unified SWD runtime channels', () => {
  it('stable id uses elf key + symbol, not bare address', () => {
    const a = swdChannelId('C:/fw/a.elf', 'yaw_pid.kp');
    const b = swdChannelId('c:\\fw\\a.elf', 'yaw_pid.kp');
    expect(a).toBe(b);
    expect(a.startsWith(`swd.${swdElfKey('C:/fw/a.elf')}.`)).toBe(true);
    const other = swdChannelId('C:/fw/b.elf', 'yaw_pid.kp');
    expect(other).not.toBe(a);
  });

  it('clamp poll rates', () => {
    expect(clampSwdPollHz(0)).toBe(0);
    expect(clampSwdPollHz(3)).toBe(1);
    expect(clampSwdPollHz(10)).toBe(10);
    expect(clampSwdPollHz(100)).toBe(50);
  });

  it('SWD sample enters SeriesStore as a normal channel', () => {
    const reg = new ChannelRegistry();
    const store = new SeriesStore(60_000, 1000);
    const id = swdChannelId('/fw/x.elf', 'yaw_pid.kp');
    const view = reg.registerSwdChannel({ id, path: 'yaw_pid.kp', unit: '', pollRateHz: 10 });
    expect(view.sourceKind).toBe('swd');
    store.setMeta(view.id, {
      path: view.path,
      displayName: view.displayName,
      color: view.color,
      visible: view.visible,
    });
    store.append(1, [3.5], [view.id]);
    store.append(2, [4.2], [view.id]);
    expect(store.lastValue(view.id)).toBeCloseTo(4.2, 5);
    // mixed with UART channel
    const uart = reg.syncBuiltin('justfloat', 1);
    store.append(2, [uart.ids[0] ? 9 : 0], uart.ids);
    expect(store.lastValue(uart.ids[0]!)).toBeDefined();
    expect(reg.get(uart.ids[0]!)!.sourceKind).toBe('serial');
  });

  it('registerSwdChannel is idempotent', () => {
    const reg = new ChannelRegistry();
    const id = swdChannelId('/fw/x.elf', 'ki');
    reg.registerSwdChannel({ id, path: 'ki', unit: '' });
    reg.registerSwdChannel({ id, path: 'ki', unit: 'x' });
    expect(reg.list().filter((c) => c.id === id)).toHaveLength(1);
    expect(reg.get(id)!.unit).toBe('x');
  });
});
