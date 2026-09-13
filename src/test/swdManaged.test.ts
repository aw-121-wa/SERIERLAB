import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
const state = vi.hoisted(() => ({ trusted: true, custom: '', consent: undefined as string | undefined, run: vi.fn(), download: vi.fn(), prompt: vi.fn() }));
vi.mock('vscode', () => ({
  workspace: { get isTrusted() { return state.trusted; }, getConfiguration: () => ({ get: (key: string, fallback: unknown) => key === 'swd.pythonPath' ? state.custom : fallback }) },
  window: { showInformationMessage: (...args: any[]) => { state.prompt(...args); return state.consent; }, createOutputChannel: () => ({ show() {}, append() {}, appendLine() {} }), withProgress: (_: any, fn: any) => fn({ report() {} }) },
  ProgressLocation: { Notification: 15 },
}));
vi.mock('../swd/runtimeProcess', () => ({ run: (...args: any[]) => state.run(...args) }));
vi.mock('../swd/runtimeDownload', () => ({ runtimeAsset: () => ({ name: 'uv.zip', url: 'https://example.test/uv', sha256: '' }), download: (...args: any[]) => state.download(...args), verifyDownload() {} }));
import { resolvePython } from '../swd/runtime';
describe('managed SWD environment lifecycle', () => {
  let root: string; let context: any;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'seriallab-test-'));
    context = { globalStorageUri: { fsPath: root }, subscriptions: [] };
    state.trusted = true; state.custom = ''; state.consent = '安装'; state.prompt.mockClear(); state.run.mockReset().mockResolvedValue('0.45.1/0.33\n'); state.download.mockReset().mockResolvedValue(Buffer.from('archive'));
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
  it('startup preflight never prompts or downloads when environment is absent', async () => {
    await expect(resolvePython(context, false, false)).rejects.toThrow('尚未准备');
    expect(state.prompt).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
  });
  it('startup preflight validates an existing environment', async () => {
    const installed = await resolvePython(context);
    state.prompt.mockClear(); state.download.mockClear();
    expect(await resolvePython(context, false, false)).toBe(installed);
    expect(state.prompt).not.toHaveBeenCalled(); expect(state.download).not.toHaveBeenCalled();
  });
  it('coalesces installation and reuses a verified environment', async () => {
    const [a,b] = await Promise.all([resolvePython(context), resolvePython(context)]);
    expect(a).toBe(b); expect(state.download).toHaveBeenCalledOnce();
    expect(await resolvePython(context)).toBe(a); expect(state.prompt).toHaveBeenCalledOnce();
  });
  it('does not download without consent or workspace trust', async () => {
    state.consent = undefined; await expect(resolvePython(context)).rejects.toThrow('取消');
    state.trusted = false; await expect(resolvePython(context)).rejects.toThrow('信任');
    expect(state.download).not.toHaveBeenCalled();
  });
  it('validates custom Python without installing into it', async () => {
    state.custom = 'custom-python'; expect(await resolvePython(context, true)).toBe('custom-python');
    expect(state.download).not.toHaveBeenCalled(); expect(state.prompt).not.toHaveBeenCalled();
    state.run.mockRejectedValueOnce(new Error('missing module'));
    await expect(resolvePython(context)).rejects.toThrow('自定义 Python');
  });
  it('releases the installation lock after failure so retry works', async () => {
    state.download.mockRejectedValueOnce(new Error('offline'));
    await expect(resolvePython(context)).rejects.toThrow('offline');
    await expect(resolvePython(context)).resolves.toContain('env-');
  });
  it('preserves the previous environment when repair fails', async () => {
    const original = await resolvePython(context);
    state.download.mockRejectedValueOnce(new Error('offline'));
    await expect(resolvePython(context, true)).rejects.toThrow('offline');
    expect(await resolvePython(context)).toBe(original);
  });
  it('rejects a manifest that escapes storage', async () => {
    const dir = path.join(root, 'swd', 'runtime-v1'); await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'active.json'), JSON.stringify({ env: '../../outside' }));
    state.consent = undefined;
    await expect(resolvePython(context)).rejects.toThrow('取消'); expect(state.run).not.toHaveBeenCalled();
  });
});
