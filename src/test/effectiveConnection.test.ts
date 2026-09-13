import { expect, it, vi } from 'vitest';
vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (key: string, fallback: unknown) => key === 'connection' ? { baudRate: 230400 } : fallback }) } }));
vi.mock('../webview/panel', () => ({ getPanel: () => undefined }));
import { AppController } from '../appController';

it('reports active serial settings separately from project overrides for next connection', () => {
  const c = Object.create(AppController.prototype) as any;
  c.context = { workspaceState: { get: () => 'COM9' } };
  c.serial = { getState: () => 'connected', activeOptions: { path: 'COM3', baudRate: 9600 }, rxBytes: 12, txBytes: 0, lastError: '' };
  c.router = { protocolKind: 'firewater', errors: 0 };
  c.swd = { state: 'error', detail: 'probe lost' };
  c.decodedBatches = 0; c.protocolRxBaseline = 0;
  c.projectConfig = { snapshot: () => ({ effective: { serial: { baudRate: 115200 }, sources: { serial: 'project' } }, error: null }) };
  const result = c.connectionDiagnostics();
  expect(result.serial.active).toEqual({ path: 'COM3', baudRate: 9600 });
  expect(result.serial.nextConnection).toEqual({ path: 'COM9', baudRate: 115200 });
  expect(result.serial.configurationSource).toBe('project');
  expect(c.connectionSummary()).toContain('probe lost');
  expect(c.connectionSummary()).toContain('尚未解析');
});
