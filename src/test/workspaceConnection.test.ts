import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  workspace: { workspaceFolders: undefined as unknown, workspaceFile: undefined as unknown },
  update: vi.fn(),
}));
vi.mock('vscode', () => ({
  workspace: Object.assign(mock.workspace, { getConfiguration: () => ({ update: mock.update }) }),
  ConfigurationTarget: { Global: 1, Workspace: 2 },
}));
import { saveConnection, saveProtocol } from '../state/workspaceState';
beforeEach(() => {
  mock.workspace.workspaceFolders = undefined;
  mock.workspace.workspaceFile = undefined;
  mock.update.mockReset().mockImplementation(async (_key, _value, target) => {
    if (target === 2 && !mock.workspace.workspaceFolders && !mock.workspace.workspaceFile) {
      throw new Error('No workspace is opened');
    }
  });
});
it('saves serial framing and protocol in an empty VS Code window', async () => {
  await expect(saveConnection({ path: 'COM3', baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1 })).resolves.toBeUndefined();
  await expect(saveProtocol('raw')).resolves.toBeUndefined();
  expect(mock.update).toHaveBeenCalledWith('connection', {
    baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1,
  }, 1);
});
it('keeps settings scoped to an open folder or saved workspace', async () => {
  mock.workspace.workspaceFolders = [{}];
  await saveProtocol('raw');
  expect(mock.update).toHaveBeenLastCalledWith('protocol', 'raw', 2);
  mock.workspace.workspaceFolders = undefined;
  mock.workspace.workspaceFile = {};
  await saveProtocol('firewater');
  expect(mock.update).toHaveBeenLastCalledWith('protocol', 'firewater', 2);
});
