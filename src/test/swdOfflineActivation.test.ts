import { it, expect, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
vi.mock('../swd/runtimeProcess', () => ({ run: vi.fn(async () => '0.45.1/0.33') }));
import { run } from '../swd/runtimeProcess';
import { writeOfflineArchive } from '../swd/offlineArchive';
import { activateOfflineRuntime, resolveOfflinePython } from '../swd/offlineRuntime';

it.skipIf(process.platform !== 'win32')('keeps the previous generation active after a failed interpreter verification', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'offline-activation-'));
  try {
    await fs.mkdir(path.join(root, 'source')); await fs.writeFile(path.join(root, 'source/python.exe'), 'test interpreter');
    const archive = path.join(root, 'runtime.slrt'); await writeOfflineArchive(path.join(root, 'source'), archive, 'python.exe');
    const first = await activateOfflineRuntime(root, archive);
    vi.mocked(run).mockRejectedValueOnce(new Error('Invalid runtime'));
    await expect(activateOfflineRuntime(root, archive)).rejects.toThrow('Invalid runtime');
    expect(await resolveOfflinePython(root)).toBe(first);
    const bytes = await fs.readFile(archive); bytes[bytes.length - 1] ^= 1; await fs.writeFile(archive, bytes);
    await expect(activateOfflineRuntime(root, archive)).rejects.toThrow(/hash/i);
    expect(await resolveOfflinePython(root)).toBe(first);
    expect((await fs.readdir(path.join(root, 'swd/offline-v1'))).filter(n => n.startsWith('env-'))).toHaveLength(1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
