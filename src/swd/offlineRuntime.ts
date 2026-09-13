import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { run } from './runtimeProcess';
import { extractOfflineArchive, writeOfflineArchive } from './offlineArchive';

const check = 'import sys,importlib.metadata as m; import pyocd,elftools; print(m.version("pyocd")+"/"+m.version("pyelftools"))';
export async function verifyOfflinePython(python: string): Promise<void> {
  if ((await run(python, ['-I', '-c', check], () => {}, undefined, 30000)).trim() !== '0.45.1/0.33') throw new Error('Offline runtime requires pyocd 0.45.1 and pyelftools 0.33');
}
export async function buildOfflineRuntime(python: string, staging: string, archive: string): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Portable SWD runtime export currently supports Windows only');
  await verifyOfflinePython(python);
  const info = JSON.parse((await run(python, ['-I', '-c', 'import sys,sysconfig,json,cmsis_pack_manager; print(json.dumps({"base":sys.base_prefix,"site":sysconfig.get_path("purelib"),"packs":cmsis_pack_manager.Cache(True,True).data_path,"version":sys.version.split()[0]}))'], () => {}, undefined, 30000)).trim());
  if (typeof info.base !== 'string' || typeof info.site !== 'string') throw new Error('Cannot locate Python base environment');
  await fs.mkdir(staging);
  // Copy the actual interpreter distribution, not a venv whose pyvenv.cfg points at the source PC.
  await fs.cp(info.base, staging, { recursive: true, dereference: true, filter: source => {
    const relative = path.relative(info.base, source).replace(/\\/g, '/').toLowerCase();
    return relative !== 'lib/site-packages' && relative !== 'scripts' && relative !== 'pyvenv.cfg' && !relative.split('/').includes('__pycache__');
  } });
  await fs.cp(info.site, path.join(staging, 'Lib', 'site-packages'), { recursive: true, dereference: true, filter: source => !source.split(path.sep).includes('__pycache__') });
  if (typeof info.packs !== 'string') throw new Error('Cannot locate CMSIS pack cache');
  try { await fs.cp(info.packs, path.join(staging, 'pack-cache'), { recursive: true, dereference: true }); }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; await fs.mkdir(path.join(staging, 'pack-cache'), { recursive: true }); }
  // The upstream cache defaults to a per-user absolute directory. Modify only the bundled copy.
  const manager = path.join(staging, 'Lib', 'site-packages', 'cmsis_pack_manager', '__init__.py');
  const source = await fs.readFile(manager, 'utf8');
  const original = "default_path = user_data_dir('cmsis-pack-manager')";
  const portable = "default_path = join(sys.prefix, 'pack-cache') # Serial Lab portable cache";
  if (!source.includes(original) && !source.includes(portable)) throw new Error('Unsupported CMSIS pack manager cache layout');
  await fs.writeFile(manager, source.replace(original, portable));
  await verifyOfflinePython(path.join(staging, 'python.exe'));
  await writeOfflineArchive(staging, archive, 'python.exe', info.version);
}
export async function activateOfflineRuntime(storage: string, archive: string): Promise<string> {
  if (process.platform !== 'win32') throw new Error('Portable SWD runtime import currently supports Windows only');
  const root = path.join(storage, 'swd', 'offline-v1'); await fs.mkdir(root, { recursive: true });
  const lock = await fs.open(path.join(root, 'install.lock'), 'wx').catch(() => { throw new Error('Another offline import is running; close other VS Code windows before removing a stale offline-v1/install.lock'); });
  const generation = `env-${randomUUID()}`; const destination = path.join(root, generation); const temporary = path.join(root, `active-${randomUUID()}.json`);
  try {
    const manifest = await extractOfflineArchive(archive, destination);
    if (manifest.python !== 'python.exe') throw new Error('Unsupported offline interpreter layout');
    const python = path.join(destination, manifest.python); await verifyOfflinePython(python);
    await fs.writeFile(temporary, JSON.stringify({ generation, python: manifest.python }));
    await fs.rename(temporary, path.join(root, 'active.json'));
    return python;
  } catch (error) { await fs.rm(destination, { recursive: true, force: true }); throw error; }
  finally { await fs.rm(temporary, { force: true }); await lock.close(); await fs.unlink(path.join(root, 'install.lock')); }
}
export async function resolveOfflinePython(storage: string): Promise<string | undefined> {
  const root = path.join(storage, 'swd', 'offline-v1'); let raw: string;
  try { raw = await fs.readFile(path.join(root, 'active.json'), 'utf8'); } catch (error: any) { if (error.code === 'ENOENT') return undefined; throw error; }
  const active = JSON.parse(raw);
  if (!/^env-[a-f0-9-]+$/.test(active.generation) || active.python !== 'python.exe') throw new Error('Invalid offline runtime activation manifest; import the package again');
  const python = path.join(root, active.generation, active.python); await verifyOfflinePython(python); return python;
}
