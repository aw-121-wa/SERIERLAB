import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';

export interface OfflineManifest {
  format: 1; platform: string; arch: string; python: string; dependencies: string; pythonVersion?: string;
  files: { path: string; size: number; sha256: string }[];
}
const magic = Buffer.from('SLRT0001');
function safeName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !name || name.length > 1024 || name.split('/').some(p =>
    !p || p === '.' || p === '..' || /[\\:\x00-\x1f<>"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))) throw new Error('Unsafe archive path');
}
export function validateOfflineManifest(value: any): OfflineManifest {
  if (!value || value.format !== 1 || value.platform !== process.platform || value.arch !== process.arch || value.dependencies !== '0.45.1/0.33' || !Array.isArray(value.files) || value.files.length > 100000) throw new Error('Incompatible offline runtime manifest');
  safeName(value.python); const names = new Set<string>(); let total = 0;
  for (const file of value.files) {
    safeName(file.path); const key = file.path.toLowerCase();
    if (names.has(key) || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid or duplicate archive entry');
    names.add(key); total += file.size;
  }
  if (total > 4 * 1024 ** 3 || !names.has(value.python.toLowerCase())) throw new Error('Invalid runtime size or executable');
  for (const name of names) { const parts = name.split('/'); parts.pop(); while (parts.length) { if (names.has(parts.join('/'))) throw new Error('Conflicting archive paths'); parts.pop(); } }
  return value;
}
async function consume(handle: fs.FileHandle, size: number, sink: (chunk: Buffer) => Promise<void>): Promise<string> {
  const hash = createHash('sha256'); const buffer = Buffer.alloc(Math.min(1024 * 1024, Math.max(1, size)));
  while (size) { const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size), null); if (!bytesRead) throw new Error('Truncated archive'); const chunk = buffer.subarray(0, bytesRead); hash.update(chunk); await sink(chunk); size -= bytesRead; }
  return hash.digest('hex');
}
async function writeAll(handle: fs.FileHandle, bytes: Buffer): Promise<void> {
  let offset = 0; while (offset < bytes.length) { const result = await handle.write(bytes, offset, bytes.length - offset); if (!result.bytesWritten) throw new Error('Archive write failed'); offset += result.bytesWritten; }
}
export async function writeOfflineArchive(source: string, destination: string, python: string, pythonVersion?: string): Promise<void> {
  const manifest: OfflineManifest = { format: 1, platform: process.platform, arch: process.arch, python, pythonVersion, dependencies: '0.45.1/0.33', files: [] };
  async function walk(dir: string, prefix = ''): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const name = prefix + entry.name; const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Offline archives cannot contain links');
      if (entry.isDirectory()) await walk(full, name + '/');
      else if (entry.isFile()) { const size = (await fs.stat(full)).size; const input = await fs.open(full, 'r'); try { manifest.files.push({ path: name, size, sha256: await consume(input, size, async () => {}) }); } finally { await input.close(); } }
      else throw new Error('Unsupported file type');
    }
  }
  await walk(source); validateOfflineManifest(manifest);
  const json = Buffer.from(JSON.stringify(manifest)); if (json.length > 16 * 1024 ** 2) throw new Error('Manifest too large');
  const output = await fs.open(destination, 'wx');
  try {
    const header = Buffer.alloc(12); magic.copy(header); header.writeUInt32LE(json.length, 8); await writeAll(output, header); await writeAll(output, json);
    for (const file of manifest.files) { const input = await fs.open(path.join(source, file.path), 'r'); try { if (await consume(input, file.size, b => writeAll(output, b)) !== file.sha256) throw new Error('Source changed during export'); } finally { await input.close(); } }
    await output.sync();
  } finally { await output.close(); }
}
export async function extractOfflineArchive(archive: string, destination: string): Promise<OfflineManifest> {
  const input = await fs.open(archive, 'r');
  try {
    const headerChunks: Buffer[] = []; await consume(input, 12, async b => { headerChunks.push(Buffer.from(b)); }); const header = Buffer.concat(headerChunks);
    if (!header.subarray(0, 8).equals(magic)) throw new Error('Not a Serial Lab runtime archive');
    const size = header.readUInt32LE(8); if (size > 16 * 1024 ** 2) throw new Error('Manifest too large');
    const chunks: Buffer[] = []; await consume(input, size, async b => { chunks.push(Buffer.from(b)); });
    const manifest = validateOfflineManifest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if ((await input.stat()).size !== 12 + size + manifest.files.reduce((n, f) => n + f.size, 0)) throw new Error('Archive length mismatch');
    // Requiring a new directory prevents pre-existing symlinks/junctions from redirecting writes.
    await fs.mkdir(destination);
    for (const file of manifest.files) {
      const target = path.join(destination, ...file.path.split('/')); await fs.mkdir(path.dirname(target), { recursive: true });
      const output = await fs.open(target, 'wx');
      try { if (await consume(input, file.size, b => writeAll(output, b)) !== file.sha256) throw new Error(`Archive hash mismatch: ${file.path}`); } finally { await output.close(); }
    }
    return manifest;
  } finally { await input.close(); }
}
