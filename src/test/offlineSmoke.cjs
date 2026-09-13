// Run after npm run compile: node src/test/offlineSmoke.cjs path/to/python.exe
const fs = require('fs/promises');
const path = require('path');
const { buildOfflineRuntime, activateOfflineRuntime, resolveOfflinePython } = require('../../out/swd/offlineRuntime');
const { run } = require('../../out/swd/runtimeProcess');
(async () => {
  const root = await fs.mkdtemp(path.resolve('.offline-smoke-'));
  try {
    const archive = path.join(root, 'runtime.slrt');
    await buildOfflineRuntime(path.resolve(process.argv[2]), path.join(root, 'source'), archive);
    await fs.rm(path.join(root, 'source'), { recursive: true });
    const python = await activateOfflineRuntime(path.join(root, 'destination'), archive);
    if (await resolveOfflinePython(path.join(root, 'destination')) !== python) throw new Error('Resolver mismatch');
    const probe = 'from pyocd.target.pack.pack_target import ManagedPacks; import cmsis_pack_manager,json; t=ManagedPacks.get_installed_targets(); print(json.dumps({"cache":cmsis_pack_manager.Cache(True,True).data_path,"targets":sorted(x.part_number for x in t)}))';
    const original = JSON.parse(await run(path.resolve(process.argv[2]), ['-I', '-c', probe], () => {}));
    const relocated = JSON.parse(await run(python, ['-I', '-c', probe], () => {}));
    if (JSON.stringify(original.targets) !== JSON.stringify(relocated.targets)) throw new Error('Installed targets did not survive transfer');
    if (!relocated.cache.startsWith(path.dirname(python))) throw new Error('Cache is not portable');
    console.log(`Relocated Python passed; ${relocated.targets.length} installed targets preserved; F750: ${relocated.targets.filter(t => t.toLowerCase().includes('f750')).join(', ')}`);
    if (process.argv[3]) { await fs.copyFile(archive, path.resolve(process.argv[3])); console.log(`Retained verified archive: ${path.resolve(process.argv[3])}`); }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
