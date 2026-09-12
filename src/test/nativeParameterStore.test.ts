import { describe, expect, it } from 'vitest';
import { ParameterStore } from '../protocol/native/parameterStore';
import { NativeParamType } from '../protocol/native/types';

describe('ParameterStore', () => {
  it('apply descriptor and lookup by id/path', () => {
    const s = new ParameterStore();
    expect(
      s.applyDescriptor({
        id: 17,
        path: 'chassis.yaw.kp',
        type: NativeParamType.Float32,
        writable: true,
        min: 0,
        max: 20,
      }).ok
    ).toBe(true);
    expect(s.getById(17)?.descriptor.path).toBe('chassis.yaw.kp');
    expect(s.getByPath('chassis.yaw.kp')?.descriptor.id).toBe(17);
  });

  it('duplicate path is protocol error', () => {
    const s = new ParameterStore();
    s.applyDescriptor({ id: 1, path: 'a.b', type: NativeParamType.Int32, writable: true });
    const r = s.applyDescriptor({ id: 2, path: 'a.b', type: NativeParamType.Int32, writable: true });
    expect(r.ok).toBe(false);
  });

  it('duplicate id updates same slot', () => {
    const s = new ParameterStore();
    s.applyDescriptor({ id: 1, path: 'x', type: NativeParamType.Int32, writable: true });
    s.applyDescriptor({ id: 1, path: 'y', type: NativeParamType.Int32, writable: true });
    expect(s.count()).toBe(1);
    expect(s.getById(1)?.descriptor.path).toBe('y');
  });

  it('SET pending then ACK confirms applied value', () => {
    const s = new ParameterStore();
    s.applyDescriptor({ id: 5, path: 'p', type: NativeParamType.Float32, writable: true });
    s.markPending(5, 9, 4.2, 100);
    expect(s.getById(5)?.pending?.requestedValue).toBe(4.2);
    s.applyAck(5, 4.0, 9); // device clamped
    expect(s.getById(5)?.confirmedValue).toBe(4.0);
    expect(s.getById(5)?.pending).toBeUndefined();
  });

  it('NACK preserves old confirmed', () => {
    const s = new ParameterStore();
    s.applyDescriptor({ id: 5, path: 'p', type: NativeParamType.Float32, writable: true });
    s.applyValue(5, 3.5);
    s.markPending(5, 2, 99, 1);
    s.applyNack(5, 4, 'out of range', 2);
    expect(s.getById(5)?.confirmedValue).toBe(3.5);
    expect(s.getById(5)?.lastError?.code).toBe(4);
    expect(s.getById(5)?.pending).toBeUndefined();
  });

  it('unsolicited value update', () => {
    const s = new ParameterStore();
    s.applyDescriptor({ id: 1, path: 'v', type: NativeParamType.UInt32, writable: true });
    s.applyValue(1, 42);
    expect(s.getById(1)?.confirmedValue).toBe(42);
  });

  it('clear empties registry', () => {
    const s = new ParameterStore();
    s.applyDescriptor({ id: 1, path: 'a', type: NativeParamType.Bool, writable: false });
    s.clear();
    expect(s.count()).toBe(0);
    expect(s.getByPath('a')).toBeUndefined();
  });
});
