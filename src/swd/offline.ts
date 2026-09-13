import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { buildOfflineRuntime, activateOfflineRuntime } from './offlineRuntime';

export async function exportOfflineRuntime(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.isTrusted) throw new Error('导出 SWD 环境需要受信任的工作区');
  const selected = await vscode.window.showSaveDialog({ filters: { 'Serial Lab SWD Runtime': ['slrt'] }, defaultUri: vscode.Uri.file(path.join(context.globalStorageUri.fsPath, `swd-${process.platform}-${process.arch}.slrt`)) });
  if (!selected) return;
  const { resolvePython } = await import('./runtime'); const python = await resolvePython(context);
  const staging = path.join(context.globalStorageUri.fsPath, `offline-export-${randomUUID()}`); const temporary = selected.fsPath + `.${randomUUID()}.tmp`;
  await fs.mkdir(context.globalStorageUri.fsPath, { recursive: true });
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '正在导出 SWD Python、依赖和芯片支持包', cancellable: false }, () => buildOfflineRuntime(python, staging, temporary));
    await fs.rename(temporary, selected.fsPath);
    await vscode.window.showInformationMessage('已导出 SWD Python、依赖和已安装芯片支持包。USB 探针驱动需单独安装，详见 SWD_OFFLINE.md。');
  } finally { await fs.rm(staging, { recursive: true, force: true }); await fs.rm(temporary, { force: true }); }
}
export async function importOfflineRuntime(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.isTrusted) throw new Error('导入 SWD 环境需要受信任的工作区');
  const selected = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'Serial Lab SWD Runtime': ['slrt'] } }); if (!selected?.[0]) return;
  if (await vscode.window.showWarningMessage('离线包包含 Python 可执行程序和原生库，导入时会运行它们以验证环境。哈希只能检查损坏，不能认证来源。请仅导入来自可信电脑或人员的包。', { modal: true }, '信任并导入') !== '信任并导入') return;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '正在校验并导入离线 SWD 环境', cancellable: false }, () => activateOfflineRuntime(context.globalStorageUri.fsPath, selected[0].fsPath));
  await vscode.window.showInformationMessage('离线 SWD 环境已激活。清空 serialLab.swd.pythonPath 后重新连接 SWD。已包含导出时安装的芯片支持包，USB 驱动需单独安装。');
}
