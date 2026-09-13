import * as vscode from 'vscode';
import * as path from 'path';
import type { AppController } from './appController';
import * as state from './state/workspaceState';
import { resolvePython, installTargetPack } from './swd/runtime';
import { SwdClient } from './swd/client';

let pending: Promise<void> | undefined;

/** Repeated commands share the active wizard rather than opening competing pickers. */
export function runConnectionWizard(context: vscode.ExtensionContext, controller: AppController): Promise<void> {
  if (!pending) pending = wizard(context, controller).finally(() => { pending = undefined; });
  return pending;
}

/** All picker cancellations exit before attaching to hardware. */
async function wizard(context: vscode.ExtensionContext, controller: AppController): Promise<void> {
  try {
    const transport = await vscode.window.showQuickPick([
      { label: 'Serial / UART', id: 'serial', description: '串口数据、波形和 Native 参数' },
      { label: 'SWD', id: 'swd', description: '通过调试探针读取运行中的 RAM 变量' },
    ], { title: 'Serial Lab: 首次连接向导', placeHolder: '选择连接方式' });
    if (!transport) return;
    if (transport.id === 'serial') {
      const ports = await controller.serial.listPorts();
      if (!ports.length) { await vscode.window.showWarningMessage('没有发现串口，请连接设备后重新运行向导。'); return; }
      const port = await vscode.window.showQuickPick(ports.map(p => ({ label: p.friendly, path: p.path })), { placeHolder: '选择串口' });
      if (!port) return;
      const snapshot = controller.projectConfig.snapshot();
      const projectBaud = snapshot.project?.serial?.baudRate;
      let baud: string | undefined;
      if (projectBaud !== undefined) {
        const framing = snapshot.effective.serial;
        const choice = await vscode.window.showQuickPick([
          { label: `使用项目波特率 ${projectBaud}`, id: 'project', description: `${framing.dataBits} data bits · ${framing.parity} parity · ${framing.stopBits} stop bits · ${framing.flowControl} flow control` },
          { label: '打开 .seriallab.json 修改后重新运行向导', id: 'edit' },
        ], { placeHolder: '.seriallab.json 的串口配置优先于 VS Code 设置' });
        if (!choice) return;
        if (choice.id === 'edit') { await controller.projectConfig.editProjectConfig(); return; }
        baud = String(projectBaud);
      } else {
        baud = await vscode.window.showInputBox({ title: '串口波特率', value: String(state.loadConnection().baudRate), validateInput: s => /^\d+$/.test(s) && Number(s) > 0 && Number(s) <= 12000000 ? undefined : '输入 1–12000000 的整数' });
      }
      if (!baud) return;
      const protocol = await vscode.window.showQuickPick([
        { label: 'JustFloat', id: 'justfloat' }, { label: 'FireWater', id: 'firewater' },
        { label: 'Raw', id: 'raw' }, { label: 'Native', id: 'native' },
      ], { placeHolder: '选择固件发送的数据协议' });
      if (!protocol) return;
      await state.saveConnection({ ...state.loadConnection(), path: port.path, baudRate: Number(baud) }, { context });
      await state.saveProtocol(protocol.id);
      controller.reloadProtocol();
      await controller.connect();
      return;
    }
    if (!vscode.workspace.isTrusted) { await vscode.window.showWarningMessage('SWD 需要受信任的工作区，请信任此工作区后重新运行向导。'); return; }
    const python = await resolvePython(context);
    const helper = new SwdClient(python, ['-u', vscode.Uri.joinPath(context.extensionUri, 'scripts', 'swd_backend.py').fsPath]);
    try {
      const probes = await helper.request<{ probes: { unique_id: string; description?: string }[] }>('probes');
      if (!probes.probes.length) { await vscode.window.showWarningMessage('没有发现 SWD 探针，请检查 USB 连接和驱动后重试。'); return; }
      const probe = await vscode.window.showQuickPick(probes.probes.map(p => ({ label: p.description || p.unique_id, description: p.unique_id, uid: p.unique_id })), { placeHolder: '选择 SWD 探针' });
      if (!probe) return;
      let installed = await helper.request<{ targets: { name: string }[] }>('targets');
      const choice = await vscode.window.showQuickPick([
        { label: '手动输入芯片型号 / 安装支持包', manual: true },
        ...installed.targets.map(t => ({ label: t.name, manual: false })),
      ], { placeHolder: '搜索并选择实际芯片型号（不会从 ELF 推断）', matchOnDescription: true });
      if (!choice) return;
      const target = choice.manual ? (await vscode.window.showInputBox({ title: '输入实际芯片的 pyOCD target ID', validateInput: s => /^[a-zA-Z0-9_-]+$/.test(s) ? undefined : '仅限字母、数字、下划线和连字符' }))?.trim().toLowerCase() : choice.label;
      if (!target) return;
      const cfg = vscode.workspace.getConfiguration('serialLab');
      const scope = vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      if (!installed.targets.some(t => t.name.toLowerCase() === target.toLowerCase())) {
        await cfg.update('swd.target', target, scope);
        await installTargetPack(context);
        installed = await helper.request('targets');
        if (!installed.targets.some(t => t.name.toLowerCase() === target.toLowerCase())) {
          await vscode.window.showWarningMessage(`芯片支持尚未就绪：${target}。请确认准确型号后重试。`); return;
        }
      }
      const files = await vscode.window.showOpenDialog({ canSelectMany: false, title: '选择与板上固件一致的 ELF', filters: { ELF: ['elf', 'axf', 'out'] } });
      if (!files?.length) return;
      const previousElf = cfg.get<string>('swd.elf', '');
      const root = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
      const sameElf = previousElf && path.resolve(root || '.', previousElf) === path.resolve(files[0].fsPath);
      const previousWatches = sameElf ? cfg.get<{ path: string; min?: number; max?: number }[]>('swd.watch', []) : [];
      const inspected = await helper.request<{ symbols: { path: string; type: string; address: number }[] }>('inspect', { elf: files[0].fsPath });
      const counts = new Map<string, number>();
      for (const symbol of inspected.symbols) counts.set(symbol.path, (counts.get(symbol.path) ?? 0) + 1);
      const watches = await vscode.window.showQuickPick(inspected.symbols.filter(s => counts.get(s.path) === 1).map(s => ({ label: s.path, description: `${s.type} · 0x${s.address.toString(16)}` })), { canPickMany: true, placeHolder: '选择 1–64 个 RAM 变量' });
      if (!watches) return;
      if (!watches.length || watches.length > 64) { await vscode.window.showWarningMessage('请选择 1–64 个 RAM 变量，然后重新运行向导。'); return; }
      if (!vscode.workspace.isTrusted) return;
      await cfg.update('swd.target', target, scope);
      await cfg.update('swd.probeId', probe.uid, scope);
      await cfg.update('swd.elf', files[0].fsPath, scope);
      await cfg.update('swd.watch', watches.map(w => previousWatches.find(old => old.path === w.label) ?? { path: w.label }), scope);
      // A ready SWD session ignores connect; release it after all choices are complete.
      await controller.handleSwdAction('disconnect');
      controller.handleWebviewMessage({ type: 'parameters.source', source: 'swd' });
      await controller.handleSwdAction('connect');
    } finally { helper.dispose(); }
  } catch (error) { await vscode.window.showErrorMessage(`Serial Lab 连接向导：${error instanceof Error ? error.message : String(error)}`); }
}
