import { describe, expect, it } from 'vitest';
import {
  builtinChannelId,
  builtinChannelPath,
  customChannelId,
  customChannelPath,
  legacyChannelId,
  legacyCustomChannelId,
} from '../store/channelIdentity';
import { ChannelRegistry } from '../store/channels';
import { SeriesStore } from '../store/seriesStore';

describe('Channel identity', () => {
  it('builtin ids match frozen public format', () => {
    expect(builtinChannelId('justfloat', 0)).toBe('justfloat.ch0');
    expect(builtinChannelId('firewater', 12)).toBe('firewater.ch12');
    expect(builtinChannelPath('justfloat', 0)).toBe('justfloat.ch0');
  });

  it('legacy formula matches pre-S8 source', () => {
    // Old: `${protocolKind}.${name ?? 'ch'+i}`
    expect(legacyChannelId('justfloat', 0)).toBe('justfloat.ch0');
    expect(legacyCustomChannelId(0, 'speed')).toBe('custom.speed');
    expect(legacyCustomChannelId(1)).toBe('custom.ch1');
  });

  it('custom id is stable across renames', () => {
    expect(customChannelId('robot', 0)).toBe('custom.robot.idx0');
    const r1 = new ChannelRegistry();
    r1.syncCustom('robot', 1, [{ index: 0, name: 'speed' }]);
    const id1 = r1.list()[0]!.id;
    const r2 = new ChannelRegistry();
    r2.syncCustom('robot', 1, [{ index: 0, name: 'motor_speed' }]);
    expect(r2.list()[0]!.id).toBe(id1);
    expect(id1).toBe('custom.robot.idx0');
  });

  it('robot.idx0 and sensor.idx0 do not collide', () => {
    const r = new ChannelRegistry();
    r.syncCustom('robot', 1, [{ index: 0, name: 'speed' }]);
    r.syncCustom('sensor', 1, [{ index: 0, name: 'speed' }]);
    const ids = r.list().map((c) => c.id).sort();
    expect(ids).toEqual(['custom.robot.idx0', 'custom.sensor.idx0']);
  });

  it('configured path wins; fallback never uses displayName', () => {
    expect(customChannelPath('robot', 0, 'motor.fl.speed')).toBe('motor.fl.speed');
    expect(customChannelPath('robot', 0)).toBe('custom.robot.ch0');
    expect(customChannelPath('robot', 0, '  ')).toBe('custom.robot.ch0');
  });

  it('name change does not change fallback path', () => {
    const r = new ChannelRegistry();
    r.syncCustom('robot', 1, [{ index: 0, name: 'speed' }]);
    const p1 = r.list()[0]!.path;
    expect(p1).toBe('custom.robot.ch0');
    r.updateCustomMeta('custom.robot.idx0', { displayName: '左前轮速度' });
    expect(r.get('custom.robot.idx0')!.path).toBe(p1);
  });
});

describe('ChannelRegistry presentation vs identity', () => {
  it('setDisplayName / setColor / setVisible never touch id or path', () => {
    const r = new ChannelRegistry();
    r.syncBuiltin('justfloat', 2);
    const before = { ...r.get('justfloat.ch0')! };
    r.setDisplayName('justfloat.ch0', '左前轮速度');
    r.setColor('justfloat.ch0', '#ff0000');
    r.setVisible('justfloat.ch0', false);
    const after = r.get('justfloat.ch0')!;
    expect(after.id).toBe(before.id);
    expect(after.path).toBe(before.path);
    expect(after.displayName).toBe('左前轮速度');
    expect(after.color).toBe('#ff0000');
    expect(after.visible).toBe(false);
  });

  it('setAlias only changes displayName', () => {
    const r = new ChannelRegistry();
    r.syncBuiltin('justfloat', 1);
    const id = 'justfloat.ch0';
    const path = r.get(id)!.path;
    r.setAlias(id, 'Motor');
    expect(r.get(id)!.displayName).toBe('Motor');
    expect(r.get(id)!.id).toBe(id);
    expect(r.get(id)!.path).toBe(path);
  });
});

describe('ChannelRegistry sync hot path', () => {
  it('first batch registers all; second identical batch changed=[]', () => {
    const r = new ChannelRegistry();
    const a = r.syncBuiltin('justfloat', 3);
    expect(a.ids).toEqual(['justfloat.ch0', 'justfloat.ch1', 'justfloat.ch2']);
    expect(a.changed).toHaveLength(3);
    const b = r.syncBuiltin('justfloat', 3);
    expect(b.ids).toEqual(a.ids);
    expect(b.changed).toHaveLength(0);
  });

  it('growing channel count only adds the new channel to changed', () => {
    const r = new ChannelRegistry();
    r.syncBuiltin('justfloat', 2);
    const more = r.syncBuiltin('justfloat', 3);
    expect(more.ids).toHaveLength(3);
    expect(more.changed).toHaveLength(1);
    expect(more.changed[0]!.id).toBe('justfloat.ch2');
  });

  it('ids[i] maps to values[i] by source index', () => {
    const r = new ChannelRegistry();
    const s = r.syncCustom('robot', 3, [
      { index: 0, name: 'a' },
      { index: 2, name: 'c' },
    ]);
    expect(s.ids).toEqual(['custom.robot.idx0', 'custom.robot.idx1', 'custom.robot.idx2']);
    const store = new SeriesStore(10_000, 100);
    for (const ch of s.changed) {
      store.setMeta(ch.id, {
        path: ch.path,
        displayName: ch.displayName,
        unit: ch.unit,
        color: ch.color,
        visible: ch.visible,
      });
    }
    store.append(1, [10, 20, 30], s.ids);
    expect(store.lastValue('custom.robot.idx0')).toBe(10);
    expect(store.lastValue('custom.robot.idx1')).toBe(20);
    expect(store.lastValue('custom.robot.idx2')).toBe(30);
    // rename does not shift mapping
    r.setDisplayName('custom.robot.idx0', 'renamed');
    const s2 = r.syncCustom('robot', 3);
    expect(s2.ids[0]).toBe('custom.robot.idx0');
    store.append(2, [11, 21, 31], s2.ids);
    expect(store.lastValue('custom.robot.idx0')).toBe(11);
  });

  it('unit flows into SeriesStore metadata', () => {
    const r = new ChannelRegistry();
    const s = r.syncCustom('robot', 1, [{ index: 0, name: 'speed', unit: 'rpm', path: 'motor.fl.speed' }]);
    const store = new SeriesStore(1000, 10);
    const ch = s.changed[0]!;
    store.setMeta(ch.id, {
      path: ch.path,
      displayName: ch.displayName,
      unit: ch.unit,
      color: ch.color,
      visible: ch.visible,
    });
    const w = store.getWindow(10);
    expect(w[0]!.unit).toBe('rpm');
    expect(w[0]!.path).toBe('motor.fl.speed');
    expect(w[0]!.displayName).toBe('speed');
    expect(w[0]!.id).toBe('custom.robot.idx0');
  });
});

describe('Legacy preference migration', () => {
  it('migrates legacy custom pref (name-based id) to new id', () => {
    const r = new ChannelRegistry();
    r.applySavedPrefs({
      'custom.speed': { name: '左前轮速度', color: '#00ff00', visible: false, unit: 'rpm' },
    });
    const sync = r.syncCustom('robot', 1, [{ index: 0, name: 'speed' }]);
    const ch = sync.changed[0]!;
    expect(ch.id).toBe('custom.robot.idx0');
    expect(ch.displayName).toBe('左前轮速度');
    expect(ch.color).toBe('#00ff00');
    expect(ch.visible).toBe(false);
    expect(ch.unit).toBe('rpm');
  });

  it('legacy name field is read as displayName', () => {
    const r = new ChannelRegistry();
    r.applySavedPrefs({ 'justfloat.ch0': { name: 'Vbus' } });
    r.syncBuiltin('justfloat', 1);
    expect(r.get('justfloat.ch0')!.displayName).toBe('Vbus');
  });

  it('does not let legacy pref override an explicit new-id pref', () => {
    const r = new ChannelRegistry();
    r.applySavedPrefs({
      'custom.robot.idx0': { displayName: 'NewName', color: '#111111', visible: true },
      'custom.speed': { name: 'OldName', color: '#eeeeee', visible: false },
    });
    r.syncCustom('robot', 1, [{ index: 0, name: 'speed' }]);
    const ch = r.get('custom.robot.idx0')!;
    expect(ch.displayName).toBe('NewName');
    expect(ch.color).toBe('#111111');
    expect(ch.visible).toBe(true);
  });

  it('builtin prefs work with no migration', () => {
    const r = new ChannelRegistry();
    r.applySavedPrefs({
      'justfloat.ch0': { displayName: 'I', color: '#123456', visible: false },
      'justfloat.ch1': { displayName: 'II' },
    });
    const s = r.syncBuiltin('justfloat', 2);
    expect(s.changed).toHaveLength(2);
    expect(r.get('justfloat.ch0')!.displayName).toBe('I');
    expect(r.get('justfloat.ch0')!.visible).toBe(false);
    expect(r.get('justfloat.ch1')!.displayName).toBe('II');
  });
});

describe('Hot path instrumentation', () => {
  it('100k batches only discover metadata once', () => {
    const r = new ChannelRegistry();
    let discover = 0;
    let metaChanged = 0;
    let setMetaCalls = 0;
    const store = new SeriesStore(5_000, 50);
    const ids8 = 8;
    for (let b = 0; b < 100_000; b++) {
      const sync = r.syncBuiltin('justfloat', ids8);
      discover += sync.ids.length;
      metaChanged += sync.changed.length;
      for (const ch of sync.changed) {
        setMetaCalls += 1;
        store.setMeta(ch.id, {
          path: ch.path,
          displayName: ch.displayName,
          color: ch.color,
          visible: ch.visible,
        });
      }
      store.append(b, [1, 2, 3, 4, 5, 6, 7, 8], sync.ids);
    }
    expect(discover).toBe(100_000 * 8);
    expect(metaChanged).toBe(8);
    expect(setMetaCalls).toBe(8);
    expect(r.list()).toHaveLength(8);
  });
});
