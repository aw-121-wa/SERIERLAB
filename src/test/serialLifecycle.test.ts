import { EventEmitter } from 'events';
import { expect, it } from 'vitest';
import { SerialService } from '../serial/serialService';

it('disconnect cancels a pending open and closes the late port', async () => {
  let port!: Port;
  class Port extends EventEmitter {
    done!: (e: Error | null) => void;
    closed = false;
    constructor() { super(); port = this; }
    open(cb: (e: Error | null) => void) { this.done = cb; }
    close(cb?: () => void) { this.closed = true; cb?.(); }
    write() { return true; }
  }
  const serial = new SerialService({ SerialPortImpl: Port as never });
  const connecting = serial.connect('COM1');
  await Promise.resolve();
  await serial.disconnect();
  port.done(null);
  await connecting;
  expect(serial.getState()).toBe('disconnected');
  expect(port.closed).toBe(true);
});

it('overlapping connections do not let an old port replace the latest one', async () => {
  const ports: Port[] = [];
  class Port extends EventEmitter {
    done!: (e: Error | null) => void;
    closed = false;
    constructor() { super(); ports.push(this); }
    open(cb: (e: Error | null) => void) { this.done = cb; }
    close(cb?: () => void) { this.closed = true; cb?.(); }
    write() { return true; }
  }
  const serial = new SerialService({ SerialPortImpl: Port as never });
  const first = serial.connect('COM1'); await Promise.resolve();
  const second = serial.connect('COM2'); await Promise.resolve();
  ports[1].done(null); await second;
  ports[0].done(null); await first;
  expect(ports[0].closed).toBe(true);
  expect(serial.getState()).toBe('connected');
  expect(serial.activeOptions?.path).toBe('COM2');
  ports[0].emit('close');
  expect(serial.getState()).toBe('connected');
  await serial.disconnect();
  expect(ports[1].closed).toBe(true);
  expect(serial.activeOptions).toBeUndefined();
});

it('reports a snapshot of the actual options, not later setting changes', async () => {
  class Port extends EventEmitter {
    open(cb: (e: Error | null) => void) { cb(null); }
    close(cb?: () => void) { cb?.(); }
    write() { return true; }
  }
  const serial = new SerialService({ SerialPortImpl: Port as never });
  const settings = { path: 'COM3', baudRate: 9600, autoOpen: false };
  await serial.connect(settings);
  settings.baudRate = 115200;
  expect(serial.activeOptions?.baudRate).toBe(9600);
  await serial.disconnect();
});
