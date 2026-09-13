import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { download, runtimeAsset, verifyDownload } from './runtimeDownload';
import { run } from './runtimeProcess';
import { resolveOfflinePython } from './offlineRuntime';

const pending = new Map<string, Promise<string>>();
const check = 'import importlib.metadata as m; import pyocd, elftools; print(m.version("pyocd")+"/"+m.version("pyelftools"))';
const version = '0.45.1/0.33';
function configuredProxy(): string | undefined {
  return vscode.workspace.getConfiguration('http').get<string>('proxy', '') || process.env.HTTPS_PROXY || process.env.https_proxy;
}
export async function resolvePython(context: vscode.ExtensionContext, repair = false, allowInstall = true): Promise<string> {
  if (!vscode.workspace.isTrusted) throw new Error('SWD 需要受信任的工作区');
  const custom = vscode.workspace.getConfiguration('serialLab').get<string>('swd.pythonPath', '').trim();
  if (custom) {
    try { await run(custom, ['-c', check], () => {}, undefined, 30000); return custom; }
    catch { throw new Error('自定义 Python 缺少 pyocd/pyelftools 或无法启动。请安装 scripts/requirements-swd.txt，或清空 serialLab.swd.pythonPath 使用自动环境。'); }
  }
  if (!repair) {
    const offline = await resolveOfflinePython(context.globalStorageUri.fsPath);
    if (offline) return offline;
  }
  const root = path.join(context.globalStorageUri.fsPath, 'swd', 'runtime-v1');
  // Read-only startup checks must not publish a failed no-install task to interactive callers.
  if (!allowInstall) return managed(root, context, repair, false);
  let task = pending.get(root);
  if (!task) { task = managed(root, context, repair).finally(() => pending.delete(root)); pending.set(root, task); }
  return task;
}
async function managed(root: string, context: vscode.ExtensionContext, repair: boolean, allowInstall = true): Promise<string> {
  const pythonIn = (dir: string) => path.join(dir, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!repair) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(root, 'active.json'), 'utf8'));
      if (!/^env-[a-f0-9-]+$/.test(manifest.env)) throw new Error('Invalid environment manifest');
      const python = pythonIn(path.join(root, manifest.env));
      if ((await run(python, ['-c', check], () => {}, undefined, 30000)).trim() === version) return python;
    } catch { /* Missing or damaged environments are installed only after consent. */ }
  }
  if (!allowInstall) throw new Error('SWD 环境尚未准备或已损坏；请使用连接向导、安装/修复环境或导入离线环境。');
  const asset = runtimeAsset(process.platform, process.arch);
  const answer = await vscode.window.showInformationMessage('Serial Lab 需要下载独立的 Python 和 SWD 依赖（uv、pyOCD、pyelftools）。仅存放在插件存储目录，不修改系统 Python。', { modal: true }, '安装');
  if (answer !== '安装') throw new Error('已取消 SWD 环境安装');
  const output = vscode.window.createOutputChannel('Serial Lab SWD Setup'); context.subscriptions.push(output); output.show(true);
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Serial Lab: 安装 SWD 环境', cancellable: false }, async progress => {
    await fs.mkdir(root, { recursive: true });
    const lock = path.join(root, 'install.lock');
    let lease;
    try { lease = await fs.open(lock, 'wx'); }
    catch { throw new Error(`另一个窗口正在安装 SWD 环境。请稍后重试；若上次安装崩溃，请关闭所有 VS Code 窗口后删除 ${lock}`); }
    const envName = `env-${randomUUID()}`;
    const staging = path.join(root, `download-${randomUUID()}`);
    const log = (s: string) => output.append(s);
    try {
      await fs.mkdir(staging);
      progress.report({ message: '下载并校验 uv' });
      const proxy = configuredProxy();
      const bytes = await download(asset.url, proxy); verifyDownload(bytes, asset.sha256);
      const archive = path.join(staging, asset.name); await fs.writeFile(archive, bytes);
      await run('tar', ['-xf', archive, '-C', staging], log);
      const uv = process.platform === 'win32' ? path.join(staging, 'uv.exe') : path.join(staging, asset.name.replace(/\.tar\.gz$/, ''), 'uv');
      const env: NodeJS.ProcessEnv = { ...process.env, UV_PYTHON_INSTALL_DIR: path.join(root, 'python'), UV_CACHE_DIR: path.join(root, 'cache'), UV_PYTHON_PREFERENCE: 'only-managed', UV_PYTHON_DOWNLOADS: 'automatic', ...(proxy ? { HTTPS_PROXY: proxy } : {}) };
      progress.report({ message: '准备 Python 3.11' });
      await run(uv, ['venv', '--python', '3.11', path.join(root, envName)], log, env);
      const python = pythonIn(path.join(root, envName));
      progress.report({ message: '安装 pyOCD 和 ELF 解析器' });
      await run(uv, ['pip', 'install', '--python', python, 'pyocd==0.45.1', 'pyelftools==0.33'], log, env);
      if ((await run(python, ['-c', check], log)).trim() !== version) throw new Error('SWD dependency verification failed');
      const manifest = path.join(root, `active-${randomUUID()}.json`);
      await fs.writeFile(manifest, JSON.stringify({ env: envName })); await fs.rename(manifest, path.join(root, 'active.json'));
      output.appendLine('\nSWD 环境已就绪。'); return python;
    } catch (error) {
      // Only this attempt's unpublished venv is removed; never move/delete an active venv.
      await fs.rm(path.join(root, envName), { recursive: true, force: true }).catch(() => {});
      output.appendLine(`\n${String(error)}\n可再次连接或执行 Install / Repair SWD Environment 重试。`); throw error;
    }
    finally { await lease.close(); await fs.unlink(lock); await fs.rm(staging, { recursive: true, force: true }); }
  });
}
export async function installTargetPack(context: vscode.ExtensionContext): Promise<void> {
  const target = vscode.workspace.getConfiguration('serialLab').get<string>('swd.target', '');
  if (!/^[a-zA-Z0-9_-]+$/.test(target)) throw new Error('请先设置 serialLab.swd.target 为准确的芯片型号');
  const python = await resolvePython(context);
  if (await vscode.window.showInformationMessage(`下载并安装 ${target} 的 pyOCD 芯片支持包？`, { modal: true }, '安装') !== '安装') return;
  const output = vscode.window.createOutputChannel('Serial Lab SWD Packs'); context.subscriptions.push(output); output.show(true);
  const proxy = configuredProxy();
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Serial Lab: 安装芯片支持包' }, () => run(python, ['-m', 'pyocd', 'pack', 'install', target], s => output.append(s), { ...process.env, ...(proxy ? { HTTPS_PROXY: proxy } : {}) }));
}
