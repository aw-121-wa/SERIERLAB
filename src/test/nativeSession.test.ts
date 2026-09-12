import { describe, expect, it } from 'vitest';
import { NativeSession } from '../protocol/native/nativeSession';
import { encodeFrame, NativeFrameDecoder } from '../protocol/native/frameCodec';
import {
  encodeHelloResponse,
  encodeParamDesc,
  encodeParamValueMsg,
  encodeParamNack,
  decodeParamGet,
  decodeHelloRequest,
} from '../protocol/native/messageCodec';
import { NativeFrame, NativeFrameFlags, NativeMessageType, NativeParamType } from '../protocol/native/types';
import { decodeParamValue } from '../protocol/native/valueCodec';

class FakeDevice {
  private decoder = new NativeFrameDecoder();
  params = new Map<number, { path: string; type: NativeParamType; writable: boolean; value: number | boolean }>();
  private toHost: (b: Uint8Array) => void = () => {};
  helloVersion = 1;

  bind(toHost: (b: Uint8Array) => void): void {
    this.toHost = toHost;
  }

  feedFromHost(bytes: Uint8Array): void {
    for (const f of this.decoder.feed(bytes)) this.onFrame(f);
  }

  private tx(msgType: number, flags: number, rid: number, payload: Uint8Array): void {
    this.toHost(encodeFrame({ messageType: msgType, flags, requestId: rid, payload }));
  }

  private onFrame(f: NativeFrame): void {
    if (f.messageType === NativeMessageType.Hello) {
      decodeHelloRequest(f.payload);
      this.tx(
        NativeMessageType.Hello,
        NativeFrameFlags.Response,
        f.requestId,
        encodeHelloResponse({
          selectedVersion: this.helloVersion,
          deviceCapabilities: 0,
          parameterCount: this.params.size,
          deviceName: 'FakeMCU',
          firmwareVersion: '0.0.1',
        })
      );
      for (const [id, p] of this.params) {
        this.tx(
          NativeMessageType.ParamDesc,
          NativeFrameFlags.Unsolicited,
          0,
          encodeParamDesc({
            id,
            path: p.path,
            type: p.type,
            writable: p.writable,
            min: p.type === NativeParamType.Float32 ? 0 : undefined,
            max: p.type === NativeParamType.Float32 ? 100 : undefined,
          })
        );
      }
      return;
    }
    if (f.messageType === NativeMessageType.ParamGet) {
      const id = decodeParamGet(f.payload);
      if (id == null) return;
      const p = this.params.get(id);
      if (!p) {
        this.tx(NativeMessageType.ParamNack, NativeFrameFlags.Response, f.requestId, encodeParamNack(id, 1, 'unknown'));
        return;
      }
      this.tx(NativeMessageType.ParamValue, NativeFrameFlags.Response, f.requestId, encodeParamValueMsg(id, p.type, p.value));
      return;
    }
    if (f.messageType === NativeMessageType.ParamSet && f.payload.length >= 3) {
      const id = f.payload[0]! | (f.payload[1]! << 8);
      const type = f.payload[2] as NativeParamType;
      const p = this.params.get(id);
      if (!p) {
        this.tx(NativeMessageType.ParamNack, NativeFrameFlags.Response, f.requestId, encodeParamNack(id, 1, 'unknown'));
        return;
      }
      if (!p.writable) {
        this.tx(NativeMessageType.ParamNack, NativeFrameFlags.Response, f.requestId, encodeParamNack(id, 2, 'ro'));
        return;
      }
      const r = decodeParamValue(type, f.payload, 3);
      if (!r.ok) {
        this.tx(NativeMessageType.ParamNack, NativeFrameFlags.Response, f.requestId, encodeParamNack(id, 5, r.error));
        return;
      }
      let applied = r.value;
      // Quantize float by step 0.1 (not range-clamp — host already enforces min/max).
      if (type === NativeParamType.Float32 && typeof applied === 'number') {
        applied = Math.round(applied * 10) / 10;
      }
      p.value = applied;
      this.tx(NativeMessageType.ParamAck, NativeFrameFlags.Response, f.requestId, encodeParamValueMsg(id, p.type, applied));
    }
  }

  unsolicitedValue(id: number): void {
    const p = this.params.get(id);
    if (!p) return;
    this.tx(NativeMessageType.ParamValue, NativeFrameFlags.Unsolicited, 0, encodeParamValueMsg(id, p.type, p.value));
  }
}

function pair() {
  const device = new FakeDevice();
  let send: (b: Uint8Array) => void = () => {};
  const session = new NativeSession((b) => send(b));
  device.bind((b) => session.feed(b));
  send = (b) => device.feedFromHost(b);
  return { session, device };
}

describe('NativeSession integration', () => {
  it('HELLO → 4 params → GET → SET/ACK → clamp → unsolicited → disconnect', async () => {
    const { session, device } = pair();
    device.params.set(1, { path: 'chassis.yaw.kp', type: NativeParamType.Float32, writable: true, value: 3.5 });
    device.params.set(2, { path: 'chassis.yaw.ki', type: NativeParamType.Float32, writable: true, value: 0.1 });
    device.params.set(3, { path: 'motor.max_pwm', type: NativeParamType.UInt32, writable: true, value: 1000 });
    device.params.set(4, { path: 'debug.flag', type: NativeParamType.Bool, writable: true, value: false });

    await session.startHandshake();
    expect(session.getState()).toBe('ready');
    expect(session.getParameters()).toHaveLength(4);
    expect(session.getDeviceName()).toBe('FakeMCU');

    expect(await session.getParameterAsync(1)).toBe(3.5);
    // Device quantizes by step 0.1 → ACK appliedValue 4.2
    expect(await session.setParameter(1, 4.23)).toBeCloseTo(4.2, 5);
    expect(session.getParameterValue(1) as number).toBeCloseTo(4.2, 5);

    device.params.get(2)!.value = 0.55;
    device.unsolicitedValue(2);
    expect(session.getParameterValue(2) as number).toBeCloseTo(0.55, 5);

    session.disconnect();
    expect(session.getState()).toBe('disconnected');
    expect(session.getParameters()).toHaveLength(0);
  });

  it('version mismatch → incompatible', async () => {
    const { session, device } = pair();
    device.helloVersion = 9;
    await expect(session.startHandshake()).rejects.toThrow(/unsupported native version/);
    expect(session.getState()).toBe('incompatible');
  });

  it('parameterCount=0 → ready immediately', async () => {
    const { session } = pair();
    await session.startHandshake();
    expect(session.getState()).toBe('ready');
    expect(session.getParameters()).toHaveLength(0);
  });

  it('readonly / out-of-range rejected on host', async () => {
    const { session, device } = pair();
    device.params.set(1, { path: 'ro', type: NativeParamType.Int32, writable: false, value: 1 });
    device.params.set(2, { path: 'kp', type: NativeParamType.Float32, writable: true, value: 1 });
    await session.startHandshake();
    await expect(session.setParameter(1, 2)).rejects.toThrow(/read-only/);
    await expect(session.setParameter(2, 101)).rejects.toThrow(/max/);
  });

  it('NACK keeps old confirmed value', async () => {
    const { session, device } = pair();
    device.params.set(1, { path: 'kp', type: NativeParamType.Float32, writable: true, value: 1 });
    await session.startHandshake();
    await session.getParameterAsync(1);
    device.params.get(1)!.writable = false;
    await expect(session.setParameter(1, 2)).rejects.toThrow(/ro/);
    expect(session.getParameterValue(1)).toBe(1);
  });

  it('discovery timeout when descriptors incomplete', async () => {
    const device = new FakeDevice();
    device.params.set(1, { path: 'a', type: NativeParamType.Int32, writable: true, value: 0 });
    device.params.set(2, { path: 'b', type: NativeParamType.Int32, writable: true, value: 0 });
    let descSeen = 0;
    let send: (b: Uint8Array) => void = () => {};
    const session = new NativeSession((b) => send(b));
    device.bind((b) => {
      const dec = new NativeFrameDecoder();
      for (const f of dec.feed(b)) {
        if (f.messageType === NativeMessageType.ParamDesc) {
          descSeen += 1;
          if (descSeen > 1) continue;
        }
        session.feed(encodeFrame({
          messageType: f.messageType,
          flags: f.flags,
          requestId: f.requestId,
          payload: f.payload,
        }));
      }
    });
    send = (b) => device.feedFromHost(b);
    await session.startHandshake();
    expect(session.getState()).toBe('discovering');
    await new Promise((r) => setTimeout(r, 2100));
    expect(session.getState()).toBe('discovery_failed');
    expect(session.getDiscoveryError()).toMatch(/discovery timeout/);
  });

  it('unsolicited PARAM_VALUE with parameterId 0 is rejected', async () => {
    const { session, device } = pair();
    device.params.set(1, { path: 'a', type: NativeParamType.Int32, writable: true, value: 7 });
    await session.startHandshake();
    const before = session.metrics.decodeErrors;
    session.feed(
      encodeFrame({
        messageType: NativeMessageType.ParamValue,
        flags: NativeFrameFlags.Unsolicited,
        requestId: 0,
        payload: encodeParamValueMsg(0, NativeParamType.Int32, 1),
      })
    );
    expect(session.metrics.decodeErrors).toBeGreaterThan(before);
  });
});
