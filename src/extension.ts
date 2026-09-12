import * as vscode from 'vscode';
import { log } from './log';

export function activate(context: vscode.ExtensionContext): void {
  log.info('Serial Lab activated');
  context.subscriptions.push(
    vscode.commands.registerCommand('serialLab.openWorkbench', () => {
      void vscode.window.showInformationMessage('Serial Lab workbench opens in Task 9');
    })
  );
}

export function deactivate(): void {}
