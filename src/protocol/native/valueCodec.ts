import { NativeParamType, NativeParamValue } from './types';

export function encodeParamValue(type: NativeParamType, value: NativeParamValue): Uint8Array {
  switch (type) {
    case NativeParamType.Float32: {
      const buf = new ArrayBuffer(4);
      new DataView(buf).setFloat32(0, Number(value), true);
      return new Uint8Array(buf);
    }
    case NativeParamType.Int32: {
      const buf = new ArrayBuffer(4);
      new DataView(buf).setInt32(0, Number(value), true);
      return new Uint8Array(buf);
    }
    case NativeParamType.UInt32: {
      const buf = new ArrayBuffer(4);
      new DataView(buf).setUint32(0, Number(value), true);
      return new Uint8Array(buf);
    }
    case NativeParamType.Bool: {
      return new Uint8Array([value ? 1 : 0]);
    }
    default:
      throw new Error(`unsupported param type ${type}`);
  }
}

export function paramValueByteSize(type: NativeParamType): number {
  return type === NativeParamType.Bool ? 1 : 4;
}

export type DecodeValueResult = { ok: true; value: NativeParamValue } | { ok: false; error: string };

export function decodeParamValue(type: NativeParamType, data: Uint8Array, offset = 0): DecodeValueResult {
  const need = paramValueByteSize(type);
  if (data.length < offset + need) return { ok: false, error: 'value truncated' };
  const view = new DataView(data.buffer, data.byteOffset + offset, need);
  switch (type) {
    case NativeParamType.Float32:
      return { ok: true, value: view.getFloat32(0, true) };
    case NativeParamType.Int32:
      return { ok: true, value: view.getInt32(0, true) };
    case NativeParamType.UInt32:
      return { ok: true, value: view.getUint32(0, true) };
    case NativeParamType.Bool: {
      const b = data[offset]!;
      if (b > 1) return { ok: false, error: 'bool must be 0 or 1' };
      return { ok: true, value: b === 1 };
    }
    default:
      return { ok: false, error: `unsupported type ${type}` };
  }
}

/** Host-side range/type checks (UX only — device must re-validate). */
export function validateParamValue(
  type: NativeParamType,
  value: NativeParamValue,
  opts?: { min?: NativeParamValue; max?: NativeParamValue; writable?: boolean }
): { ok: true } | { ok: false; error: string } {
  if (type === NativeParamType.Bool) {
    if (typeof value !== 'boolean') return { ok: false, error: 'bool required' };
    return { ok: true };
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: 'finite number required' };
  }
  if (opts?.min !== undefined && typeof opts.min === 'number' && value < opts.min) {
    return { ok: false, error: `below min ${opts.min}` };
  }
  if (opts?.max !== undefined && typeof opts.max === 'number' && value > opts.max) {
    return { ok: false, error: `above max ${opts.max}` };
  }
  if (type === NativeParamType.Int32 || type === NativeParamType.UInt32) {
    if (!Number.isInteger(value)) return { ok: false, error: 'integer required' };
  }
  if (type === NativeParamType.UInt32 && value < 0) {
    return { ok: false, error: 'uint32 must be >= 0' };
  }
  return { ok: true };
}
