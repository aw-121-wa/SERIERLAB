import { describe, expect, it } from 'vitest';
import { decodeParamValue, encodeParamValue, validateParamValue } from '../protocol/native/valueCodec';
import { decodeParamDesc, encodeParamDesc, decodeParamNack, encodeParamNack } from '../protocol/native/messageCodec';
import { NativeParamType } from '../protocol/native/types';

describe('Native values', () => {
  it('float32 LE roundtrip', () => {
    const e = encodeParamValue(NativeParamType.Float32, 4.2);
    expect(e.length).toBe(4);
    const d = decodeParamValue(NativeParamType.Float32, e);
    expect(d.ok && d.value).toBeCloseTo(4.2, 5);
  });

  it('int32 min/max', () => {
    for (const v of [-2147483648, 2147483647, 0]) {
      const e = encodeParamValue(NativeParamType.Int32, v);
      expect(decodeParamValue(NativeParamType.Int32, e)).toEqual({ ok: true, value: v });
    }
  });

  it('uint32 min/max', () => {
    for (const v of [0, 0xffffffff]) {
      const e = encodeParamValue(NativeParamType.UInt32, v);
      expect(decodeParamValue(NativeParamType.UInt32, e)).toEqual({ ok: true, value: v });
    }
  });

  it('bool 0/1 and malformed >1', () => {
    expect(decodeParamValue(NativeParamType.Bool, Uint8Array.from([0]))).toEqual({ ok: true, value: false });
    expect(decodeParamValue(NativeParamType.Bool, Uint8Array.from([1]))).toEqual({ ok: true, value: true });
    expect(decodeParamValue(NativeParamType.Bool, Uint8Array.from([2])).ok).toBe(false);
  });

  it('NaN / Infinity rejected by host validate', () => {
    expect(validateParamValue(NativeParamType.Float32, NaN).ok).toBe(false);
    expect(validateParamValue(NativeParamType.Float32, Infinity).ok).toBe(false);
  });
});

describe('PARAM_DESC codec', () => {
  it('valid float descriptor with min/max', () => {
    const p = encodeParamDesc({
      id: 17,
      path: 'chassis.yaw.kp',
      type: NativeParamType.Float32,
      writable: true,
      unit: 'rpm',
      min: 0,
      max: 20,
      step: 0.1,
    });
    const r = decodeParamDesc(p);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.descriptor.id).toBe(17);
    expect(r.descriptor.path).toBe('chassis.yaw.kp');
    expect(r.descriptor.unit).toBe('rpm');
    expect(r.descriptor.writable).toBe(true);
    expect(r.descriptor.min).toBeCloseTo(0, 5);
    expect(r.descriptor.max).toBeCloseTo(20, 5);
  });

  it('path max 127 / too long reject', () => {
    const ok = 'a'.repeat(127);
    expect(decodeParamDesc(encodeParamDesc({ id: 1, path: ok, type: NativeParamType.Int32, writable: false })).ok).toBe(true);
    expect(() =>
      encodeParamDesc({ id: 1, path: 'a'.repeat(128), type: NativeParamType.Int32, writable: false })
    ).toThrow();
  });

  it('bool + range reject', () => {
    expect(() =>
      encodeParamDesc({
        id: 1,
        path: 'f',
        type: NativeParamType.Bool,
        writable: true,
        min: 0,
      })
    ).toThrow();
  });

  it('min>max reject', () => {
    const p = encodeParamDesc({ id: 1, path: 'x', type: NativeParamType.Int32, writable: true, min: 5, max: 1 });
    // encode allows; decode validates
    const r = decodeParamDesc(p);
    expect(r.ok).toBe(false);
  });

  it('nack codec', () => {
    const p = encodeParamNack(9, 4, 'out of range');
    const n = decodeParamNack(p);
    expect(n).toEqual({ id: 9, code: 4, detail: 'out of range' });
  });
});
