import * as vscode from 'vscode';
import { log } from './log';
import { AppController } from './appController';
import { revealPanel } from './webview/panel';
import { WebviewToHost } from './webview/bridge';
import { registerSidebar } from './webview/sidebar';
import * as state from './state/workspaceState';

let controller: AppController | undefined;

export function activate(context: vscode.ExtensionContext): void {
  log.info('Serial Lab activated');
  controller = new AppController(context);
  context.subscriptions.push(controller);
  registerSidebar(context, controller);

  context.subscriptions.push(
    vscode.commands.registerCommand('serialLab.openWorkbench', () => {
      revealPanel(context, (m) => controller!.handleWebviewMessage(m as WebviewToHost));
    }),
    vscode.commands.registerCommand('serialLab.connect', () => controller!.connect()),
    vscode.commands.registerCommand('serialLab.disconnect', () => controller!.disconnect()),
    vscode.commands.registerCommand('serialLab.refreshPorts', async () => {
      const ports = await controller!.serial.listPorts();
      const picked = await vscode.window.showQuickPick(
        ports.map((p) => ({ label: p.friendly, description: p.path })),
        { placeHolder: '选择串口' }
      );
      if (picked) {
        const conn = state.loadConnection();
        conn.path = picked.description!;
        await state.saveConnection(conn);
        void vscode.window.showInformationMessage(`Serial Lab: port set to ${conn.path}`);
      }
    }),
    vscode.commands.registerCommand('serialLab.exportSamples', async () => {
      const uri = await vscode.window.showSaveDialog({ filters: { CSV: ['csv'] }, defaultUri: vscode.Uri.file('samples.csv') });
      if (uri) controller!.exportSamples(uri);
    }),
    vscode.commands.registerCommand('serialLab.exportRawLog', async () => {
      const uri = await vscode.window.showSaveDialog({ filters: { Log: ['csv', 'log', 'txt'] }, defaultUri: vscode.Uri.file('raw-log.csv') });
      if (uri) controller!.exportRaw(uri);
    })
  );
}

export function deactivate(): void {
  controller?.dispose();
}
