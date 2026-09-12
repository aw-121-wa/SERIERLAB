import { SerialPortOpenOptions } from './types';

export type EffectiveSerialFraming = {
  baudRate: number;
  dataBits: number;
  parity: string;
  stopBits: number;
  flowControl: string;
};

/**
 * Map resolved project/settings framing to serialport open options.
 * Ensures dataBits/parity/stopBits/flowControl actually reach the port.
 */
export function toSerialPortOpenOptions(
  path: string,
  framing: EffectiveSerialFraming
): SerialPortOpenOptions {
  const dataBits =
    framing.dataBits === 5 || framing.dataBits === 6 || framing.dataBits === 7 || framing.dataBits === 8
      ? framing.dataBits
      : 8;
  const stopBits =
    framing.stopBits === 1 || framing.stopBits === 1.5 || framing.stopBits === 2 ? framing.stopBits : 1;
  const parity = (['none', 'even', 'odd', 'mark', 'space'] as string[]).includes(framing.parity)
    ? (framing.parity as SerialPortOpenOptions['parity'])
    : 'none';
  const flow = framing.flowControl;
  return {
    path,
    baudRate: framing.baudRate,
    dataBits,
    stopBits,
    parity,
    rtscts: flow === 'hardware',
    xon: flow === 'software',
    xoff: flow === 'software',
    autoOpen: false,
  };
}
