import { describe, expect, it } from 'vitest';
import {
  clampSwdPollHz,
  firmwareIdentityFromBytes,
  swdChannelId,
} from '../swd/runtimeChannels';
import { ChannelRegistry } from '../store/channels';
import { SeriesStore } from '../store/seriesStore';

describe('S13 firmware identity + unified channels', () => {
  it('identity is ELF content hash, not path string', () => {
    const a = firmwareIdentityFromBytes(Buffer.from('ELF-A-bytes'));
    const b = firmwareIdentityFromBytes(Buffer.from('ELF-A-bytes'));
    const c = firmwareIdentityFromBytes(Buffer.from('ELF-B-rebuilt'));
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).not.toBe(c.sha256);
    expect(a.idPrefix).toHaveLength(16);
    // Same expression, different firmware content → different channel id
    expect(swdChannelId(a.sha256, 'yaw_pid.kp')).not.toBe(swdChannelId(c.sha256, 'yaw_pid.kp'));
  });

  it('stale firmware identity cannot be reused for the same channel id', () => {
    const elfA = firmwareIdentityFromBytes(Buffer.from('fwA'));
    const elfB = firmwareIdentityFromBytes(Buffer.from('fwB'));
    const idA = swdChannelId(elfA.sha256, 'yaw_pid.kp');
    const idB = swdChannelId(elfB.sha256, 'yaw_pid.kp');
    expect(idA).not.toBe(idB);
    expect(idA.startsWith('swd.')).toBe(true);
    expect(idA.split('.')[1]).toHaveLength(16);
  });

  it('clamp poll rates (global v1)', () => {
    expect(clampSwdPollHz(0)).toBe(0);
    expect(clampSwdPollHz(3)).toBe(1);
    expect(clampSwdPollHz(10)).toBe(10);
    expect(clampSwdPollHz(100)).toBe(50);
  });

  it('SWD sample enters SeriesStore; pollRateHz is the global actual rate', () => {
    const reg = new ChannelRegistry();
    const store = new SeriesStore(60_000, 1000);
    const sha = firmwareIdentityFromBytes(Buffer.from('fw')).sha256;
    const id = swdChannelId(sha, 'yaw_pid.kp');
    const view = reg.registerSwdChannel({ id, path: 'yaw_pid.kp', pollRateHz: 20 });
    expect(view.sourceKind).toBe('swd');
    expect(view.pollRateHz).toBe(20);
    store.setMeta(view.id, {
      path: view.path,
      displayName: view.displayName,
      color: view.color,
      visible: view.visible,
    });
    store.append(1, [3.5], [view.id]);
    store.append(50, [4.2], [view.id]);
    expect(store.lastValue(view.id)).toBeCloseTo(4.2, 5);

    const uart = reg.syncBuiltin('justfloat', 1);
    store.append(50, [9], uart.ids);
    expect(reg.get(uart.ids[0]!)!.sourceKind).toBe('serial');
  });

  it('reconnect after ELF content change uses a new channel id (old not reused)', () => {
    const reg = new ChannelRegistry();
    const shaA = firmwareIdentityFromBytes(Buffer.from('A')).sha256;
    const shaB = firmwareIdentityFromBytes(Buffer.from('B')).sha256;
    reg.registerSwdChannel({ id: swdChannelId(shaA, 'kp'), path: 'kp' });
    // Simulate disconnect/reconnect with rebuilt ELF — only B ids are registered anew
    reg.registerSwdChannel({ id: swdChannelId(shaB, 'kp'), path: 'kp' });
    expect(reg.list().map((c) => c.id).sort()).toEqual(
      [swdChannelId(shaA, 'kp'), swdChannelId(shaB, 'kp')].sort()
    );
  });

  it('registerSwdChannel is idempotent for the same firmware id', () => {
    const reg = new ChannelRegistry();
    const sha = firmwareIdentityFromBytes(Buffer.from('x')).sha256;
    const id = swdChannelId(sha, 'ki');
    reg.registerSwdChannel({ id, path: 'ki', unit: '' });
    reg.registerSwdChannel({ id, path: 'ki', unit: 'x', pollRateHz: 10 });
    expect(reg.list().filter((c) => c.id === id)).toHaveLength(1);
    expect(reg.get(id)!.unit).toBe('x');
    expect(reg.get(id)!.pollRateHz).toBe(10);
  });
});
