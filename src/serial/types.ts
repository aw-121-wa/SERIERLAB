export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export type PortInfo = {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  friendly: string;
};

export type RuntimeCounters = {
  rxBytes: number;
  txBytes: number;
  decoderErrors: number;
  droppedBytes: number;
};

/** Minimal SerialPort surface used by SerialService (allows test doubles). */
export interface SerialPortLike {
  open(callback: (err: Error | null) => void): void;
  close(callback?: (err: Error | null) => void): void;
  write(data: Buffer, callback: (err: Error | null | undefined) => void): boolean;
  on(event: 'data', listener: (buffer: Buffer) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'close', listener: () => void): this;
}

/** Injectable SerialPort constructor for tests without hardware. */
export type SerialPortCtor = new (options: {
  path: string;
  baudRate: number;
  autoOpen: boolean;
}) => SerialPortLike;

/** Raw OS port entry (subset of serialport PortInfo). */
export type RawPortInfo = {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
};

/** Injectable port enumeration for tests without hardware. */
export type ListPortsFn = () => Promise<RawPortInfo[]>;

export type SerialServiceDeps = {
  SerialPortImpl?: SerialPortCtor;
  listPortsImpl?: ListPortsFn;
};
