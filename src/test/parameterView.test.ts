import { describe, expect, it } from 'vitest';
import {
  buildParamTree,
  formatParamValue,
  parseWebviewSetValue,
  searchParameters,
  toParameterView,
  validateSetInput,
} from '../protocol/native/parameterView';
import { NativeParamType } from '../protocol/native/types';
import { ParameterRuntimeState } from '../protocol/native/parameterStore';

function st(over: Partial<ParameterRuntimeState> & { descriptor: ParameterRuntimeState['descriptor'] }): ParameterRuntimeState {
  return { ...over } as ParameterRuntimeState;
}

describe('ParameterView presentation', () => {
  it('descriptor → view with confirmed/pending/error', () => {
    const v = toParameterView(
      st({
        descriptor: {
          id: 1,
          path: 'chassis.yaw.kp',
          type: NativeParamType.Float32,
          writable: true,
          unit: 'rpm',
          min: 0,
          max: 20,
          step: 0.1,
        },
        confirmedValue: 3.5,
        pending: { requestId: 2, requestedValue: 4.2, sentAtMs: 1 },
        lastError: { code: 4, detail: 'out of range' },
      })
    );
    expect(v.id).toBe(1);
    expect(v.type).toBe('float32');
    expect(v.unit).toBe('rpm');
    expect(v.min).toBe(0);
    expect(v.max).toBe(20);
    expect(v.confirmedValue).toBe(3.5);
    expect(v.pending?.requestedValue).toBe(4.2);
    expect(v.lastError?.detail).toBe('out of range');
  });

  it('groups path hierarchy', () => {
    const tree = buildParamTree([
      { id: 1, path: 'chassis.yaw.kp', type: 'float32', writable: true },
      { id: 2, path: 'chassis.yaw.ki', type: 'float32', writable: true },
      { id: 3, path: 'motor.max', type: 'uint32', writable: true },
    ]);
    expect(tree.map((n) => n.name).sort()).toEqual(['chassis', 'motor']);
    const chassis = tree.find((n) => n.name === 'chassis')!;
    expect(chassis.children[0]!.name).toBe('yaw');
    expect(chassis.children[0]!.children.map((c) => c.name).sort()).toEqual(['ki', 'kp']);
  });

  it('search matches path, leaf, unit (case insensitive)', () => {
    const list = [
      { id: 1, path: 'chassis.yaw.kp', type: 'float32' as const, writable: true, unit: 'rpm' },
      { id: 2, path: 'motor.max_pwm', type: 'uint32' as const, writable: true },
    ];
    expect(searchParameters(list, 'chassis').map((p) => p.id)).toEqual([1]);
    expect(searchParameters(list, 'KP').map((p) => p.id)).toEqual([1]);
    expect(searchParameters(list, 'RPM').map((p) => p.id)).toEqual([1]);
    expect(searchParameters(list, 'max').map((p) => p.id)).toEqual([2]);
  });

  it('validateSetInput float/int/uint/bool/readonly/range', () => {
    expect(validateSetInput({ type: 'float32', writable: true, max: 20 }, '4.23')).toEqual({
      ok: true,
      value: 4.23,
    });
    expect(validateSetInput({ type: 'int32', writable: true }, '1.5').ok).toBe(false);
    expect(validateSetInput({ type: 'uint32', writable: true }, -1).ok).toBe(false);
    expect(validateSetInput({ type: 'bool', writable: true }, 'true')).toEqual({ ok: true, value: true });
    expect(validateSetInput({ type: 'float32', writable: false }, 1).ok).toBe(false);
    expect(validateSetInput({ type: 'float32', writable: true, max: 20 }, 21).ok).toBe(false);
  });

  it('formatParamValue compact', () => {
    expect(formatParamValue(3.5, 'float32')).toBe('3.5');
    expect(formatParamValue(800, 'uint32')).toBe('800');
    expect(formatParamValue(true, 'bool')).toBe('true');
  });

  it('parseWebviewSetValue validates shape', () => {
    expect(parseWebviewSetValue(1, 2.5)).toEqual({ ok: true, parameterId: 1, value: 2.5 });
    expect(parseWebviewSetValue(0, 1).ok).toBe(false);
    expect(parseWebviewSetValue(1, NaN).ok).toBe(false);
    expect(parseWebviewSetValue(1, true)).toEqual({ ok: true, parameterId: 1, value: true });
  });
});
