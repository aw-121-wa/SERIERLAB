import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { writeOfflineArchive, extractOfflineArchive, validateOfflineManifest } from '../swd/offlineArchive';

describe('offline runtime archives', () => {
  it('round trips files and rejects corruption before returning a runtime', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swd-offline-'));
    try {
      const source = path.join(root, 'source'); await fs.mkdir(source);
      await fs.writeFile(path.join(source, 'python.exe'), 'portable executable');
      const archive = path.join(root, 'runtime.slrt');
      await writeOfflineArchive(source, archive, 'python.exe');
      await extractOfflineArchive(archive, path.join(root, 'good'));
      expect(await fs.readFile(path.join(root, 'good/python.exe'), 'utf8')).toBe('portable executable');
      await expect(extractOfflineArchive(archive, path.join(root, 'good'))).rejects.toThrow();
      expect(await fs.readFile(path.join(root, 'good/python.exe'), 'utf8')).toBe('portable executable');
      const bytes = await fs.readFile(archive); bytes[bytes.length - 1] ^= 1; await fs.writeFile(archive, bytes);
      await expect(extractOfflineArchive(archive, path.join(root, 'bad'))).rejects.toThrow(/hash/i);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  it('rejects traversal, Windows special paths, duplicates and platform mismatches', () => {
    const base = { format: 1, platform: process.platform, arch: process.arch, python: 'python.exe', dependencies: '0.45.1/0.33', files: [] };
    for (const name of ['../x', '/x', 'C:/x', 'a\\x', 'a:stream', 'CON', 'a/../x', 'x.', 'x ']) {
      expect(() => validateOfflineManifest({ ...base, files: [{ path: name, size: 1, sha256: 'a'.repeat(64) }] })).toThrow();
    }
    expect(() => validateOfflineManifest({ ...base, platform: 'wrong' })).toThrow();
    expect(() => validateOfflineManifest({ ...base, files: ['python.exe', 'PYTHON.EXE'].map(p => ({ path: p, size: 1, sha256: 'a'.repeat(64) })) })).toThrow();
  });
});
