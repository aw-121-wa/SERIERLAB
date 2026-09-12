/** Native Runtime Control Protocol v1 types. */

export const NATIVE_VERSION = 1;
export const NATIVE_MAX_DECODED_FRAME = 1024;
export const NATIVE_MAX_ENCODED_PENDING = 1400;
export const NATIVE_MAX_PENDING_REQUESTS = 32;
export const NATIVE_DEFAULT_TIMEOUT_MS = 1000;
export const NATIVE_DISCOVERY_TIMEOUT_MS = 2000;
export const NATIVE_MAX_PATH_BYTES = 127;
export const NATIVE_MAX_UNIT_BYTES = 31;
export const NATIVE_MAX_DEVICE_NAME = 63;
export const NATIVE_MAX_FIRMWARE = 31;
export const NATIVE_MAX_NACK_DETAIL = 127;

export enum NativeFrameFlags {
  Response = 1 << 0,
  Unsolicited = 1 << 1,
}

export enum NativeMessageType {
  Hello = 0x01,
  ParamDesc = 0x10,
  ParamGet = 0x11,
  ParamValue = 0x12,
  ParamSet = 0x13,
  ParamAck = 0x14,
  ParamNack = 0x15,
}

export enum NativeParamType {
  Float32 = 1,
  Int32 = 2,
  UInt32 = 3,
  Bool = 4,
}

export enum NativeParamError {
  UnknownParameter = 1,
  ReadOnly = 2,
  TypeMismatch = 3,
  OutOfRange = 4,
  InvalidValue = 5,
  Busy = 6,
  InternalError = 7,
}

export type NativeParamValue = number | boolean;

export type ParameterDescriptor = {
  id: number;
  path: string;
  type: NativeParamType;
  writable: boolean;
  unit?: string;
  min?: NativeParamValue;
  max?: NativeParamValue;
  step?: NativeParamValue;
};

export type NativeFrame = {
  version: number;
  messageType: number;
  flags: number;
  reserved: number;
  requestId: number;
  payload: Uint8Array;
};

export function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
