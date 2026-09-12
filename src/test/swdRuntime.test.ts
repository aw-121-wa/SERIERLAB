import { describe, it, expect } from 'vitest';
import { runtimeAsset, verifyDownload } from '../swd/runtimeDownload';
import { createHash } from 'crypto';

describe('managed SWD download', () => {
  it('selects pinned archives for each supported platform', () => {
    for (const [os, arch] of [['win32','x64'], ['darwin','x64'], ['darwin','arm64'], ['linux','x64'], ['linux','arm64']]) {
      const a = runtimeAsset(os, arch);
      expect(a.url).toContain('/0.8.22/uv-');
      expect(a.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(() => runtimeAsset('win32','arm64')).toThrow(/custom Python/);
  });
  it('rejects a corrupted download before extraction', () => {
    const data = Buffer.from('archive');
    expect(() => verifyDownload(data, '0'.repeat(64))).toThrow(/checksum/);
    expect(() => verifyDownload(data, createHash('sha256').update(data).digest('hex'))).not.toThrow();
  });
});
