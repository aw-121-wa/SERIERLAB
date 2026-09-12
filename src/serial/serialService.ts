import { EventEmitter } from 'events';
import { SerialPort } from 'serialport';
import {
  ConnectionState,
  ListPortsFn,
  PortInfo,
  SerialPortCtor,
  SerialPortLike,
  SerialServiceDeps,
} from './types';

const defaultListPorts: ListPortsFn = () => SerialPort.list();

export class SerialService extends EventEmitter {
  private port: SerialPortLike | null = null;
  private readonly SerialPortImpl: SerialPortCtor;
  private readonly listPortsImpl: ListPortsFn;
  private state: ConnectionState = 'disconnected';
  rxBytes = 0;
  txBytes = 0;
  lastError = '';

  constructor(deps: SerialServiceDeps = {}) {
    super();
    this.SerialPortImpl = deps.SerialPortImpl ?? (SerialPort as unknown as SerialPortCtor);
    this.listPortsImpl = deps.listPortsImpl ?? defaultListPorts;
  }

  getState(): ConnectionState {
    return this.state;
  }

  async listPorts(): Promise<PortInfo[]> {
    const ports = await this.listPortsImpl();
    return ports.map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer,
      serialNumber: p.serialNumber,
      friendly: p.path + (p.manufacturer ? ` — ${p.manufacturer}` : ''),
    }));
  }

  async connect(path: string, baudRate: number): Promise<void> {
    await this.disconnect();
    this.setState('connecting');
    await new Promise<void>((resolve, reject) => {
      const port = new this.SerialPortImpl({ path, baudRate, autoOpen: false });
      port.open((err) => {
        if (err) {
          this.lastError = err.message;
          this.setState('error');
          reject(err);
          return;
        }
        this.port = port;
        port.on('data', (buf: Buffer) => {
          this.rxBytes += buf.length;
          this.emit('data', new Uint8Array(buf));
        });
        port.on('error', (e: Error) => {
          this.lastError = e.message;
          this.setState('error');
        });
        port.on('close', () => {
          this.port = null;
          this.setState('disconnected');
        });
        this.setState('connected');
        resolve();
      });
    });
  }

  async disconnect(): Promise<void> {
    const port = this.port;
    this.port = null;
    if (!port) {
      this.setState('disconnected');
      return;
    }
    await new Promise<void>((resolve) => {
      port.close(() => resolve());
    });
    this.setState('disconnected');
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.port) throw new Error('Not connected');
    const port = this.port;
    await new Promise<void>((resolve, reject) => {
      port.write(Buffer.from(bytes), (err) => {
        if (err) reject(err);
        else {
          this.txBytes += bytes.length;
          resolve();
        }
      });
    });
  }

  private setState(s: ConnectionState): void {
    this.state = s;
    this.emit('state', s);
  }
}
