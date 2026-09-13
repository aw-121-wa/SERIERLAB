import * as vscode from 'vscode';
import { CustomProtocolConfig } from '../protocol/custom';
import { ChannelView } from '../store/channels';

const cfg = () => vscode.workspace.getConfiguration('serialLab');

function settingsTarget(): vscode.ConfigurationTarget {
  return vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

export type ConnSettings = {
  path: string;
  baudRate: number;
  dataBits: 8;
  parity: 'none' | 'even' | 'odd';
  stopBits: 1;
};

const PORT_KEY = 'serialLab.selectedPort';

/** Machine-local port lives in workspaceState — never auto-write .vscode/settings.json. */
export function loadSelectedPort(context: vscode.ExtensionContext): string {
  return context.workspaceState.get<string>(PORT_KEY) ?? '';
}

export async function saveSelectedPort(
  context: vscode.ExtensionContext,
  port: string
): Promise<void> {
  await context.workspaceState.update(PORT_KEY, port);
}

export function loadConnection(context?: vscode.ExtensionContext): ConnSettings {
  const fallback = {
    path: context ? loadSelectedPort(context) : '',
    baudRate: 115200,
    dataBits: 8 as const,
    parity: 'none' as const,
    stopBits: 1 as const,
  };
  const fromSettings = cfg().get<Partial<ConnSettings>>('connection');
  return {
    path: context ? loadSelectedPort(context) : fromSettings?.path ?? fallback.path,
    baudRate: fromSettings?.baudRate ?? fallback.baudRate,
    dataBits: (fromSettings?.dataBits ?? fallback.dataBits) as 8,
    parity: (fromSettings?.parity ?? fallback.parity) as ConnSettings['parity'],
    stopBits: (fromSettings?.stopBits ?? fallback.stopBits) as 1,
  };
}

/**
 * Persist connection framing to workspace settings only when the user changes baud etc.
 * Port is stored in workspaceState (machine-local).
 */
export async function saveConnection(
  c: ConnSettings,
  options?: { context?: vscode.ExtensionContext; saveFramingToSettings?: boolean }
): Promise<void> {
  if (options?.context) {
    await saveSelectedPort(options.context, c.path);
  }
  if (options?.saveFramingToSettings !== false) {
    // Do not include path — avoids dirtying git with COMx.
    await cfg().update(
      'connection',
      {
        baudRate: c.baudRate,
        dataBits: c.dataBits,
        parity: c.parity,
        stopBits: c.stopBits,
      },
      settingsTarget()
    );
  }
}

export function loadProtocol(): string {
  return cfg().get<string>('protocol') ?? 'justfloat';
}

export async function saveProtocol(id: string): Promise<void> {
  await cfg().update('protocol', id, settingsTarget());
}

export function loadActiveCustomId(): string {
  return cfg().get<string>('activeCustomProtocolId') ?? '';
}

export async function saveActiveCustomId(id: string): Promise<void> {
  await cfg().update('activeCustomProtocolId', id, settingsTarget());
}

export function loadCustomProtocols(): CustomProtocolConfig[] {
  return cfg().get<CustomProtocolConfig[]>('protocols') ?? [];
}

export async function saveCustomProtocols(list: CustomProtocolConfig[]): Promise<void> {
  await cfg().update('protocols', list, settingsTarget());
}

export function loadChannelPrefs(): Record<string, Partial<ChannelView>> {
  return cfg().get('channels') ?? {};
}

export async function saveChannelPrefs(v: Record<string, Partial<ChannelView>>): Promise<void> {
  await cfg().update('channels', v, settingsTarget());
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
  await cfg().update('terminal', t, settingsTarget());
}
