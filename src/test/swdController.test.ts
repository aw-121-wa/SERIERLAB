import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../swd/runtime', () => ({ resolvePython: vi.fn(async () => 'python') }));
const env = vi.hoisted(() => ({ clients: [] as any[], trusted: true, pollHz: 0 }));
vi.mock('vscode', () => ({
  workspace: {
    get isTrusted() { return env.trusted; }, workspaceFolders: [{ uri: { fsPath: 'D:/firmware' } }],
    getConfiguration: () => ({ get: (key: string, fallback: unknown) => ({ 'swd.elf': 'test.elf', 'swd.target': 'stm32f407vg', 'swd.pollHz': env.pollHz } as any)[key] ?? fallback }),
  },
  Uri: { joinPath: (...parts: any[]) => ({ fsPath: parts.join('/') }) },
}));
vi.mock('../swd/runtimeChannels', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../swd/runtimeChannels')>();
  return {
    ...mod,
    firmwareIdentityFromPath: () => ({
      sha256: 'a'.repeat(64),
      idPrefix: 'a'.repeat(16),
    }),
  };
});
vi.mock('../swd/client', () => ({ SwdClient: class {
  request = vi.fn(async (method: string) => method === 'connect'
    ? { parameters: [{ id: 1, path: 'kp', type: 'float32', writable: true }], verifiedBytes: 128 }
    : method === 'read' ? [{ id: 1, value: 3.5 }] : 4);
  close = vi.fn(async () => {});
  dispose = vi.fn();
  constructor() { env.clients.push(this); }
} }));
import { SwdController } from '../swd/controller';
import { resolvePython } from '../swd/runtime';

describe('SWD controller lifecycle', () => {
  it('disconnect during runtime preparation prevents attachment', async () => {
    let release!: (value: string) => void;
    vi.mocked(resolvePython).mockImplementationOnce(() => new Promise(r => { release = r; }));
    const c = new SwdController({ extensionUri: 'ext' } as any, vi.fn());
    const connecting = c.connect();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await c.disconnect(); release('python'); await connecting;
    expect(env.clients).toHaveLength(0); expect(c.state).toBe('disconnected');
  });
  beforeEach(() => { env.clients = []; env.trusted = true; env.pollHz = 0; });
  it('coalesces concurrent connection attempts into one owned helper', async () => {
    const c = new SwdController({ extensionUri: 'ext' } as any, vi.fn());
    await Promise.all([c.connect(), c.connect()]);
    expect(env.clients).toHaveLength(1);
    await c.disconnect();
    expect(env.clients[0].close).toHaveBeenCalledOnce();
  });
  it('disconnect immediately after connect prevents a delayed attachment', async () => {
    const c = new SwdController({ extensionUri: 'ext' } as any, vi.fn());
    const connecting = c.connect();
    await c.disconnect(); await connecting;
    expect(c.state).toBe('disconnected');
    expect(env.clients).toHaveLength(0);
  });
  it('connects, reads and confirms writes without any serial dependency', async () => {
    const c = new SwdController({ extensionUri: 'ext' } as any, vi.fn());
    await c.connect();
    expect(c.state).toBe('ready');
    expect(c.parameters[0].confirmedValue).toBe(3.5);
    await c.set(1, 4);
    expect(c.parameters[0].confirmedValue).toBe(4);
    expect(c.parameters[0].pending).toBeUndefined();
    await c.disconnect();
    expect(env.clients[0].close).toHaveBeenCalledOnce();
    expect(c.parameters).toEqual([]);
  });
  it('does not start a helper in an untrusted workspace', async () => {
    env.trusted = false;
    const c = new SwdController({ extensionUri: 'ext' } as any, vi.fn());
    await c.connect();
    expect(c.state).toBe('error');
    expect(env.clients).toHaveLength(0);
  });
  it('does not overlap reads or resurrect values after disconnect', async () => {
    const c = new SwdController({ extensionUri: 'ext' } as any, vi.fn());
    await c.connect();
    let finish!: (v: any) => void;
    const request = env.clients[0].request;
    request.mockImplementation(() => new Promise(r => { finish = r; }));
    const read = c.refresh();
    await c.refresh();
    expect(request).toHaveBeenCalledTimes(3); // connect + initial read + one refresh
    await c.disconnect();
    finish([{ id: 1, value: 9 }]); await read;
    expect(c.state).toBe('disconnected'); expect(c.parameters).toEqual([]);
  });
  it('keeps confirmed value on rejected writes and exposes the error', async () => {
    const c = new SwdController({ extensionUri: 'ext' } as any, vi.fn());
    await c.connect();
    env.clients[0].request.mockRejectedValueOnce(new Error('outside bounds'));
    await c.set(1, 99);
    expect(c.parameters[0].confirmedValue).toBe(3.5);
    expect(c.parameters[0].lastError?.detail).toBe('outside bounds');
    await c.disconnect();
  });
  it('waits for failed-session cleanup before reconnecting', async () => {
    const c = new SwdController({ extensionUri: 'ext' } as any, vi.fn());
    await c.connect();
    let release!: () => void;
    env.clients[0].close.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    env.clients[0].request.mockRejectedValueOnce(new Error('probe lost'));
    await c.refresh();
    expect(c.state).toBe('error');
    const reconnect = c.connect();
    await Promise.resolve();
    expect(env.clients).toHaveLength(1);
    release(); await reconnect;
    expect(env.clients).toHaveLength(2);
    await c.disconnect();
  });
});
