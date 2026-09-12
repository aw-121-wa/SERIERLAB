import * as vscode from 'vscode';
import { CustomProtocolConfig } from '../protocol/custom';
import { ChannelView } from '../store/channels';

const cfg = () => vscode.workspace.getConfiguration('serialLab');

export type ConnSettings = {
  path: string;
  baudRate: number;
  dataBits: 8;
  parity: 'none' | 'even' | 'odd';
  stopBits: 1;
};

export function loadConnection(): ConnSettings {
  return cfg().get<ConnSettings>('connection') ?? {
    path: '',
    baudRate: 115200,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
  };
}

export async function saveConnection(c: ConnSettings): Promise<void> {
  await cfg().update('connection', c, vscode.ConfigurationTarget.Workspace);
}

export function loadProtocol(): string {
  return cfg().get<string>('protocol') ?? 'justfloat';
}

export async function saveProtocol(id: string): Promise<void> {
  await cfg().update('protocol', id, vscode.ConfigurationTarget.Workspace);
}

export function loadActiveCustomId(): string {
  return cfg().get<string>('activeCustomProtocolId') ?? '';
}

export async function saveActiveCustomId(id: string): Promise<void> {
  await cfg().update('activeCustomProtocolId', id, vscode.ConfigurationTarget.Workspace);
}

export function loadCustomProtocols(): CustomProtocolConfig[] {
  return cfg().get<CustomProtocolConfig[]>('protocols') ?? [];
}

export async function saveCustomProtocols(list: CustomProtocolConfig[]): Promise<void> {
  await cfg().update('protocols', list, vscode.ConfigurationTarget.Workspace);
}

export function loadChannelPrefs(): Record<string, Partial<ChannelView>> {
  return cfg().get('channels') ?? {};
}

export async function saveChannelPrefs(v: Record<string, Partial<ChannelView>>): Promise<void> {
  await cfg().update('channels', v, vscode.ConfigurationTarget.Workspace);
}

export function loadTerminal() {
  return (
    cfg().get('terminal') ?? {
      rxEncoding: 'text',
      txEncoding: 'text',
      txLineEnding: 'lf',
    }
  );
}

export async function saveTerminal(t: unknown): Promise<void> {
  await cfg().update('terminal', t, vscode.ConfigurationTarget.Workspace);
}
