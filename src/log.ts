import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getLog(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Serial Lab');
  }
  return channel;
}

export const log = {
  info: (m: string) => getLog().appendLine(`[info] ${m}`),
  warn: (m: string) => getLog().appendLine(`[warn] ${m}`),
  error: (m: string) => getLog().appendLine(`[error] ${m}`),
};
