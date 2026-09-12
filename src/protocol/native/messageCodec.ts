import {
  NATIVE_MAX_DEVICE_NAME,
  NATIVE_MAX_FIRMWARE,
  NATIVE_MAX_NACK_DETAIL,
  NATIVE_MAX_PATH_BYTES,
  NATIVE_MAX_UNIT_BYTES,
  NativeMessageType,
  NativeParamType,
  ParameterDescriptor,
  utf8ByteLength,
} from './types';
import { decodeParamValue, encodeParamValue, paramValueByteSize } from './valueCodec';

export type HelloRequest = {
  minVersion: number;
  maxVersion: number;
  hostCapabilities: number;
};

export type HelloResponse = {
  selectedVersion: number;
  deviceCapabilities: number;
  parameterCount: number;
  deviceName: string;
  firmwareVersion: string;
};

export function encodeHelloRequest(h: HelloRequest): Uint8Array {
  const p = new Uint8Array(6);
  p[0] = h.minVersion;
  p[1] = h.maxVersion;
  const dv = new DataView(p.buffer);
  dv.setUint32(2, h.hostCapabilities, true);
  return p;
}

export function decodeHelloRequest(p: Uint8Array): HelloRequest | null {
  if (p.length < 6) return null;
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  return {
    minVersion: p[0]!,
    maxVersion: p[1]!,
    hostCapabilities: dv.getUint32(2, true),
  };
}

export function encodeHelloResponse(h: HelloResponse): Uint8Array {
  const name = new TextEncoder().encode(h.deviceName);
  const fw = new TextEncoder().encode(h.firmwareVersion);
  if (name.length > NATIVE_MAX_DEVICE_NAME || fw.length > NATIVE_MAX_FIRMWARE) {
    throw new Error('hello strings too long');
  }
  const p = new Uint8Array(9 + name.length + fw.length);
  p[0] = h.selectedVersion;
  const dv = new DataView(p.buffer);
  dv.setUint32(1, h.deviceCapabilities, true);
  dv.setUint16(5, h.parameterCount, true);
  p[7] = name.length;
  p[8] = fw.length;
  p.set(name, 9);
  p.set(fw, 9 + name.length);
  return p;
}

export function decodeHelloResponse(p: Uint8Array): HelloResponse | null {
  if (p.length < 9) return null;
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const nameLen = p[7]!;
  const fwLen = p[8]!;
  if (p.length < 9 + nameLen + fwLen) return null;
  if (nameLen > NATIVE_MAX_DEVICE_NAME || fwLen > NATIVE_MAX_FIRMWARE) return null;
  const td = new TextDecoder();
  return {
    selectedVersion: p[0]!,
    deviceCapabilities: dv.getUint32(1, true),
    parameterCount: dv.getUint16(5, true),
    deviceName: td.decode(p.subarray(9, 9 + nameLen)),
    firmwareVersion: td.decode(p.subarray(9 + nameLen, 9 + nameLen + fwLen)),
  };
}

export const ACCESS_WRITABLE = 1 << 0;
export const OPT_HAS_MIN = 1 << 0;
export const OPT_HAS_MAX = 1 << 1;
export const OPT_HAS_STEP = 1 << 2;

export function encodeParamDesc(d: ParameterDescriptor): Uint8Array {
  const path = new TextEncoder().encode(d.path);
  const unit = new TextEncoder().encode(d.unit ?? '');
  if (path.length > NATIVE_MAX_PATH_BYTES) throw new Error('path too long');
  if (unit.length > NATIVE_MAX_UNIT_BYTES) throw new Error('unit too long');
  let optionFlags = 0;
  if (d.min !== undefined) optionFlags |= OPT_HAS_MIN;
  if (d.max !== undefined) optionFlags |= OPT_HAS_MAX;
  if (d.step !== undefined) optionFlags |= OPT_HAS_STEP;
  if (d.type === NativeParamType.Bool && optionFlags) {
    throw new Error('bool cannot have min/max/step');
  }
  const vsz = paramValueByteSize(d.type);
  const extras =
    (d.min !== undefined ? vsz : 0) + (d.max !== undefined ? vsz : 0) + (d.step !== undefined ? vsz : 0);
  const p = new Uint8Array(7 + path.length + unit.length + extras);
  p[0] = d.id & 0xff;
  p[1] = (d.id >> 8) & 0xff;
  p[2] = d.type;
  p[3] = d.writable ? ACCESS_WRITABLE : 0;
  p[4] = optionFlags;
  p[5] = path.length;
  p[6] = unit.length;
  p.set(path, 7);
  p.set(unit, 7 + path.length);
  let o = 7 + path.length + unit.length;
  if (d.min !== undefined) {
    p.set(encodeParamValue(d.type, d.min), o);
    o += vsz;
  }
  if (d.max !== undefined) {
    p.set(encodeParamValue(d.type, d.max), o);
    o += vsz;
  }
  if (d.step !== undefined) {
    p.set(encodeParamValue(d.type, d.step), o);
  }
  return p;
}

export type DecodeDescResult =
  | { ok: true; descriptor: ParameterDescriptor }
  | { ok: false; error: string };

export function decodeParamDesc(p: Uint8Array): DecodeDescResult {
  if (p.length < 7) return { ok: false, error: 'desc too short' };
  const id = p[0]! | (p[1]! << 8);
  if (id === 0) return { ok: false, error: 'parameter id 0 reserved' };
  const type = p[2] as NativeParamType;
  if (![1, 2, 3, 4].includes(type)) return { ok: false, error: `bad type ${type}` };
  const access = p[3]!;
  const opt = p[4]!;
  const pathLen = p[5]!;
  const unitLen = p[6]!;
  if (pathLen > NATIVE_MAX_PATH_BYTES || unitLen > NATIVE_MAX_UNIT_BYTES) {
    return { ok: false, error: 'path/unit too long' };
  }
  if (p.length < 7 + pathLen + unitLen) return { ok: false, error: 'desc truncated' };
  const td = new TextDecoder();
  const path = td.decode(p.subarray(7, 7 + pathLen));
  const unit = td.decode(p.subarray(7 + pathLen, 7 + pathLen + unitLen));
  const hasMin = (opt & OPT_HAS_MIN) !== 0;
  const hasMax = (opt & OPT_HAS_MAX) !== 0;
  const hasStep = (opt & OPT_HAS_STEP) !== 0;
  if (type === NativeParamType.Bool && (hasMin || hasMax || hasStep)) {
    return { ok: false, error: 'bool cannot have range' };
  }
  let o = 7 + pathLen + unitLen;
  const vsz = paramValueByteSize(type);
  const need = (hasMin ? vsz : 0) + (hasMax ? vsz : 0) + (hasStep ? vsz : 0);
  if (p.length < o + need) return { ok: false, error: 'desc options truncated' };
  const d: ParameterDescriptor = {
    id,
    path,
    type,
    writable: (access & ACCESS_WRITABLE) !== 0,
    unit: unitLen ? unit : undefined,
  };
  if (hasMin) {
    const r = decodeParamValue(type, p, o);
    if (!r.ok) return r;
    d.min = r.value;
    o += vsz;
  }
  if (hasMax) {
    const r = decodeParamValue(type, p, o);
    if (!r.ok) return r;
    d.max = r.value;
    o += vsz;
  }
  if (hasStep) {
    const r = decodeParamValue(type, p, o);
    if (!r.ok) return r;
    d.step = r.value;
  }
  if (d.min !== undefined && d.max !== undefined) {
    if (typeof d.min === 'number' && typeof d.max === 'number' && d.min > d.max) {
      return { ok: false, error: 'min > max' };
    }
  }
  if (d.step !== undefined) {
    if (typeof d.step === 'number' && !(d.step > 0)) {
      return { ok: false, error: 'step must be > 0' };
    }
  }
  if (
    (d.min !== undefined && typeof d.min === 'number' && !Number.isFinite(d.min)) ||
    (d.max !== undefined && typeof d.max === 'number' && !Number.isFinite(d.max)) ||
    (d.step !== undefined && typeof d.step === 'number' && !Number.isFinite(d.step))
  ) {
    return { ok: false, error: 'min/max/step must be finite' };
  }
  if (utf8ByteLength(path) > NATIVE_MAX_PATH_BYTES) {
    return { ok: false, error: 'path too long' };
  }
  return { ok: true, descriptor: d };
}

export function encodeParamGet(id: number): Uint8Array {
  return new Uint8Array([id & 0xff, (id >> 8) & 0xff]);
}

export function decodeParamGet(p: Uint8Array): number | null {
  if (p.length < 2) return null;
  return p[0]! | (p[1]! << 8);
}

export function encodeParamValueMsg(id: number, type: NativeParamType, value: number | boolean): Uint8Array {
  const v = encodeParamValue(type, value);
  const p = new Uint8Array(3 + v.length);
  p[0] = id & 0xff;
  p[1] = (id >> 8) & 0xff;
  p[2] = type;
  p.set(v, 3);
  return p;
}

export type ValueMsg = { id: number; type: NativeParamType; value: number | boolean };

export function decodeParamValueMsg(p: Uint8Array): ValueMsg | null {
  if (p.length < 3) return null;
  const id = p[0]! | (p[1]! << 8);
  const type = p[2] as NativeParamType;
  const r = decodeParamValue(type, p, 3);
  if (!r.ok) return null;
  return { id, type, value: r.value };
}

export function encodeParamNack(id: number, code: number, detail: string): Uint8Array {
  const d = new TextEncoder().encode(detail);
  if (d.length > NATIVE_MAX_NACK_DETAIL) throw new Error('nack detail too long');
  const q = new Uint8Array(4 + d.length);
  q[0] = id & 0xff;
  q[1] = (id >> 8) & 0xff;
  q[2] = code;
  q[3] = d.length;
  q.set(d, 4);
  return q;
}

export type NackMsg = { id: number; code: number; detail: string };

export function decodeParamNack(p: Uint8Array): NackMsg | null {
  if (p.length < 4) return null;
  const id = p[0]! | (p[1]! << 8);
  const code = p[2]!;
  const len = p[3]!;
  if (p.length < 4 + len) return null;
  return {
    id,
    code,
    detail: new TextDecoder().decode(p.subarray(4, 4 + len)),
  };
}

export { NativeMessageType };
