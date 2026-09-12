import { describe, expect, it } from 'vitest';
import { SerialService } from '../serial/serialService';
import { toSerialPortOpenOptions } from '../serial/framing';
import { SerialPortLike, SerialPortOpenOptions } from '../serial/types';
import { parseProjectConfig, resolveEffectiveConfig } from '../config/projectConfig';

function mockPort(): SerialPortLike & { opts?: SerialPortOpenOptions } {
  const listeners: Record<string, unknown[]> = {};
  return {
    opts: undefined,
    open(cb: (e: Error | null) => void) {
      cb(null);
    },
    close(cb?: (e?: Error) => void) {
      cb?.();
    },
    write(_d: Buffer, cb: (e: Error | null | undefined) => void) {
      cb(null);
      return true;
    },
    on(event: string, fn: unknown) {
      (listeners[event] ??= []).push(fn);
      return this;
    },
  } as SerialPortLike & { opts?: SerialPortOpenOptions };
}

describe('Serial framing reaches SerialPort open options', () => {
  it('toSerialPortOpenOptions maps all five framing fields', () => {
    const o = toSerialPortOpenOptions('COM9', {
      baudRate: 921600,
      dataBits: 7,
      parity: 'even',
      stopBits: 2,
      flowControl: 'hardware',
    });
    expect(o).toMatchObject({
      path: 'COM9',
      baudRate: 921600,
      dataBits: 7,
      parity: 'even',
      stopBits: 2,
      rtscts: true,
      autoOpen: false,
    });
  });

  it('software flow control sets xon/xoff, not rtscts', () => {
    const o = toSerialPortOpenOptions('/dev/ttyACM0', {
      baudRate: 115200,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
      flowControl: 'software',
    });
    expect(o.rtscts).toBe(false);
    expect(o.xon).toBe(true);
    expect(o.xoff).toBe(true);
  });

  it('project config dataBits/parity/stopBits/flowControl → open options', () => {
    const parsed = parseProjectConfig(
      JSON.stringify({
        version: 1,
        serial: {
          baudRate: 57600,
          dataBits: 7,
          parity: 'even',
          stopBits: 2,
          flowControl: 'hardware',
        },
      })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const eff = resolveEffectiveConfig(parsed.config, {});
    const open = toSerialPortOpenOptions('COM3', eff.serial);
    expect(open.baudRate).toBe(57600);
    expect(open.dataBits).toBe(7);
    expect(open.parity).toBe('even');
    expect(open.stopBits).toBe(2);
    expect(open.rtscts).toBe(true);
  });

  it('SerialService.connect passes full options into SerialPort ctor', async () => {
    let captured: SerialPortOpenOptions | undefined;
    class Ctor {
      constructor(opts: SerialPortOpenOptions) {
        captured = opts;
        return mockPort();
      }
    }
    const svc = new SerialService({ SerialPortImpl: Ctor as never });
    await svc.connect({
      path: 'COM5',
      baudRate: 230400,
      dataBits: 5,
      stopBits: 1.5,
      parity: 'mark',
      rtscts: true,
      autoOpen: false,
    });
    expect(captured).toMatchObject({
      path: 'COM5',
      baudRate: 230400,
      dataBits: 5,
      stopBits: 1.5,
      parity: 'mark',
      rtscts: true,
      autoOpen: false,
    });
    expect(svc.getState()).toBe('connected');
  });
});
