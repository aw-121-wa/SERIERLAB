import { EventEmitter } from 'events';
import { SerialPort } from 'serialport';
import {
  ConnectionState,
  ListPortsFn,
  PortInfo,
  SerialPortCtor,
  SerialPortLike,
  SerialPortOpenOptions,
  SerialServiceDeps,
} from './types';

const defaultListPorts: ListPortsFn = () => SerialPort.list();

export class SerialService extends EventEmitter {
  private port: SerialPortLike | null = null;
  private readonly SerialPortImpl: SerialPortCtor;
  private readonly listPortsImpl: ListPortsFn;
  private state: ConnectionState = 'disconnected';
  private generation = 0;
  activeOptions?: Readonly<SerialPortOpenOptions>;
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

  /**
   * Open a port with full framing options (baud + data/stop/parity + flow control).
   * @param options path/baudRate required; other fields fall back to serialport defaults.
   */
  async connect(options: SerialPortOpenOptions | string, baudRate?: number): Promise<void> {
    const openOpts: SerialPortOpenOptions =
      typeof options === 'string'
        ? { path: options, baudRate: baudRate ?? 115200, autoOpen: false }
        : { ...options, autoOpen: false };
    const cleanup = this.disconnect();
    const generation = ++this.generation;
    await cleanup;
    if (generation !== this.generation) return;
    this.setState('connecting');
    await new Promise<void>((resolve, reject) => {
      const port = new this.SerialPortImpl(openOpts);
      port.open((err) => {
        if (generation !== this.generation) {
          if (!err) port.close(() => resolve());
          else resolve();
          return;
        }
        if (err) {
          this.lastError = err.message;
          this.setState('error');
          reject(err);
          return;
        }
        this.port = port;
        this.activeOptions = Object.freeze({ ...openOpts });
        this.rxBytes = 0; this.txBytes = 0; this.lastError = '';
        port.on('data', (buf: Buffer) => {
          if (this.port !== port) return;
          this.rxBytes += buf.length;
          this.emit('data', new Uint8Array(buf));
        });
        port.on('error', (e: Error) => {
          if (this.port !== port) return;
          this.lastError = e.message;
          this.setState('error');
        });
        port.on('close', () => {
          if (this.port !== port) return;
          this.port = null;
          this.activeOptions = undefined;
          this.setState('disconnected');
        });
        this.setState('connected');
        resolve();
      });
    });
  }

  async disconnect(): Promise<void> {
    const generation = ++this.generation;
    const port = this.port;
    this.port = null;
    this.activeOptions = undefined;
    if (!port) {
      this.setState('disconnected');
      return;
    }
    await new Promise<void>((resolve) => {
      port.close(() => resolve());
    });
    if (generation === this.generation) this.setState('disconnected');
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
