import { describe, expect, it } from 'vitest';
import { encodeFrame } from '../protocol/native/frameCodec';
import {
  encodeHelloRequest,
  encodeParamGet,
  encodeParamNack,
  encodeParamValueMsg,
} from '../protocol/native/messageCodec';
import { NativeFrameFlags, NativeMessageType, NativeParamType } from '../protocol/native/types';

/**
 * Golden wire vectors — S11 STM32 C SDK must match these exact bytes.
 * Do not "fix" by regenerating without updating the C side.
 */
const HEX = {
  HELLO_REQ: [
    0x03, 0x01, 0x01, 0x01, 0x02, 0x01, 0x02, 0x06, 0x03, 0x01, 0x01, 0x01, 0x01, 0x01, 0x03, 0x17,
    0x97, 0x00,
  ],
  GET1: [
    0x03, 0x01, 0x11, 0x01, 0x02, 0x01, 0x02, 0x02, 0x02, 0x01, 0x03, 0x58, 0xad, 0x00,
  ],
  SET_F32: [
    0x03, 0x01, 0x13, 0x01, 0x02, 0x02, 0x02, 0x07, 0x02, 0x11, 0x08, 0x01, 0x66, 0x66, 0x86, 0x40,
    0x42, 0x31, 0x00,
  ],
  ACK: [
    0x04, 0x01, 0x14, 0x01, 0x02, 0x02, 0x02, 0x07, 0x02, 0x11, 0x08, 0x01, 0x66, 0x66, 0x86, 0x40,
    0x27, 0x04, 0x00,
  ],
  NACK: [
    0x04, 0x01, 0x15, 0x01, 0x02, 0x03, 0x02, 0x04, 0x02, 0x01, 0x02, 0x02, 0x03, 0xf8, 0xea, 0x00,
  ],
  SET_BOOL: [
    0x03, 0x01, 0x13, 0x01, 0x02, 0x04, 0x02, 0x04, 0x02, 0x05, 0x05, 0x04, 0x01, 0x27, 0xc3, 0x00,
  ],
  SET_I32: [
    0x03, 0x01, 0x13, 0x01, 0x02, 0x05, 0x02, 0x07, 0x02, 0x02, 0x08, 0x02, 0xff, 0xff, 0xff, 0xff,
    0x61, 0x2e, 0x00,
  ],
  SET_U32: [
    0x03, 0x01, 0x13, 0x01, 0x02, 0x06, 0x02, 0x07, 0x02, 0x03, 0x08, 0x03, 0xff, 0xff, 0xff, 0xff,
    0xab, 0x44, 0x00,
  ],
};

function expectWire(actual: Uint8Array, expected: number[], label: string): void {
  expect(Array.from(actual), label).toEqual(expected);
  expect(actual[actual.length - 1], `${label} delimiter`).toBe(0);
}

describe('Native golden wire vectors', () => {
  it('HELLO request', () => {
    const wire = encodeFrame({
      messageType: NativeMessageType.Hello,
      flags: 0,
      requestId: 1,
      payload: encodeHelloRequest({ minVersion: 1, maxVersion: 1, hostCapabilities: 0 }),
    });
    expectWire(wire, HEX.HELLO_REQ, 'HELLO_REQ');
  });

  it('PARAM_GET id=1', () => {
    const wire = encodeFrame({
      messageType: NativeMessageType.ParamGet,
      flags: 0,
      requestId: 1,
      payload: encodeParamGet(1),
    });
    expectWire(wire, HEX.GET1, 'GET1');
  });

  it('PARAM_SET float32 id=17 value=4.2', () => {
    const wire = encodeFrame({
      messageType: NativeMessageType.ParamSet,
      flags: 0,
      requestId: 2,
      payload: encodeParamValueMsg(17, NativeParamType.Float32, 4.2),
    });
    expectWire(wire, HEX.SET_F32, 'SET_F32');
  });

  it('PARAM_ACK appliedValue float32', () => {
    const wire = encodeFrame({
      messageType: NativeMessageType.ParamAck,
      flags: NativeFrameFlags.Response,
      requestId: 2,
      payload: encodeParamValueMsg(17, NativeParamType.Float32, 4.2),
    });
    expectWire(wire, HEX.ACK, 'ACK');
  });

  it('PARAM_NACK', () => {
    const wire = encodeFrame({
      messageType: NativeMessageType.ParamNack,
      flags: NativeFrameFlags.Response,
      requestId: 3,
      payload: encodeParamNack(1, 2, ''),
    });
    expectWire(wire, HEX.NACK, 'NACK');
  });

  it('PARAM_SET bool true', () => {
    const wire = encodeFrame({
      messageType: NativeMessageType.ParamSet,
      flags: 0,
      requestId: 4,
      payload: encodeParamValueMsg(5, NativeParamType.Bool, true),
    });
    expectWire(wire, HEX.SET_BOOL, 'SET_BOOL');
  });

  it('PARAM_SET int32 -1', () => {
    const wire = encodeFrame({
      messageType: NativeMessageType.ParamSet,
      flags: 0,
      requestId: 5,
      payload: encodeParamValueMsg(2, NativeParamType.Int32, -1),
    });
    expectWire(wire, HEX.SET_I32, 'SET_I32');
  });

  it('PARAM_SET uint32 max', () => {
    const wire = encodeFrame({
      messageType: NativeMessageType.ParamSet,
      flags: 0,
      requestId: 6,
      payload: encodeParamValueMsg(3, NativeParamType.UInt32, 0xffffffff),
    });
    expectWire(wire, HEX.SET_U32, 'SET_U32');
  });
});
