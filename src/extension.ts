import * as vscode from 'vscode';
import { log } from './log';
import { AppController } from './appController';
import { revealPanel } from './webview/panel';
import { WebviewToHost } from './webview/bridge';
import { registerSidebar } from './webview/sidebar';
import * as state from './state/workspaceState';
import { resolvePython, installTargetPack } from './swd/runtime';
import { RuntimeHoverProvider } from './runtime/runtimeHoverProvider';
import { validateRuntimeEditInput } from './runtime/runtimeVariableEditor';

let controller: AppController | undefined;

export function activate(context: vscode.ExtensionContext): void {
  log.info('Serial Lab activated');
  controller = new AppController(context);
  context.subscriptions.push(controller);
  registerSidebar(context, controller);

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      [{ language: 'c' }, { language: 'cpp' }],
      new RuntimeHoverProvider(
        () => controller?.getRuntimeSymbolService(),
        {
          get firmwareSha256() {
            return controller?.getHoverRuntimeSource().firmwareSha256 ?? '';
          },
          isWatched: (sym) => !!controller?.getHoverRuntimeSource().isWatched(sym),
          lookupValue: (sym) => controller?.getHoverRuntimeSource().lookupValue(sym),
        }
      )
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('serialLab.swd.installRuntime', async () => {
      try { await resolvePython(context, true); void vscode.window.showInformationMessage('SWD 环境已就绪'); }
      catch (e) { void vscode.window.showErrorMessage(`Serial Lab SWD: ${(e as Error).message}`); }
    }),
    vscode.commands.registerCommand('serialLab.swd.installTargetPack', async () => {
      try { await installTargetPack(context); }
      catch (e) { void vscode.window.showErrorMessage(`Serial Lab SWD: ${(e as Error).message}`); }
    }),
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
        const conn = state.loadConnection(context);
        conn.path = picked.description!;
        await state.saveConnection(conn, { context, saveFramingToSettings: false });
        void vscode.window.showInformationMessage(`Serial Lab: port set to ${conn.path}`);
      }
    }),
    vscode.commands.registerCommand('serialLab.editProjectConfig', () =>
      controller!.projectConfig.editProjectConfig()
    ),
    vscode.commands.registerCommand('serialLab.exportSamples', async () => {
      const uri = await vscode.window.showSaveDialog({ filters: { CSV: ['csv'] }, defaultUri: vscode.Uri.file('samples.csv') });
      if (uri) controller!.exportSamples(uri);
    }),
    vscode.commands.registerCommand('serialLab.exportRawLog', async () => {
      const uri = await vscode.window.showSaveDialog({ filters: { Log: ['csv', 'log', 'txt'] }, defaultUri: vscode.Uri.file('raw-log.csv') });
      if (uri) controller!.exportRaw(uri);
    }),
    vscode.commands.registerCommand('serialLab.runtime.watch', async () => {
      try {
        const path = await controller!.watchRuntimeAtCursor();
        void vscode.window.showInformationMessage(`Serial Lab: watching ${path}`);
      } catch (e) {
        void vscode.window.showErrorMessage(`Serial Lab: ${(e as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('serialLab.runtime.plot', async () => {
      try {
        const path = await controller!.plotRuntimeAtCursor();
        void vscode.window.showInformationMessage(`Serial Lab: plotting ${path}`);
      } catch (e) {
        void vscode.window.showErrorMessage(`Serial Lab: ${(e as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('serialLab.runtime.reveal', async () => {
      try {
        const path = await controller!.watchRuntimeAtCursor();
        revealPanel(context, (m) => controller!.handleWebviewMessage(m as WebviewToHost));
        void vscode.window.showInformationMessage(`Serial Lab: revealed ${path}`);
      } catch (e) {
        void vscode.window.showErrorMessage(`Serial Lab: ${(e as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('serialLab.runtime.edit', async () => {
      const c = controller!;
      const resolved = c.resolveAtEditor();
      if (!resolved.ok) {
        void vscode.window.showErrorMessage(
          resolved.reason === 'no-editor'
            ? '请在 C/C++ 源码编辑器中使用'
            : '光标下没有受支持的运行时变量'
        );
        return;
      }
      const symbol = resolved.symbol;
      const editor = c.getRuntimeEditor();
      let prepared;
      try {
        prepared = await editor.prepare(symbol);
      } catch (e) {
        void vscode.window.showErrorMessage(`Serial Lab: ${(e as Error).message}`);
        return;
      }
      let raw: string | boolean | undefined;
      if (symbol.type === 'bool') {
        const pick = await vscode.window.showQuickPick(
          [
            { label: 'true', value: true },
            { label: 'false', value: false },
          ],
          { placeHolder: `${symbol.expression} = ${prepared.oldValue === undefined ? '?' : prepared.oldValue}` }
        );
        raw = pick?.value;
      } else {
        raw = await vscode.window.showInputBox({
          prompt: `Edit ${symbol.expression} (${symbol.type})`,
          value: prepared.oldValue === undefined ? '' : String(prepared.oldValue),
          validateInput: (v) => {
            const check = validateRuntimeEditInput(symbol.type, v);
            return check.ok ? null : check.error;
          },
        });
      }
      if (raw === undefined || raw === '') return;
      const parsed = validateRuntimeEditInput(symbol.type, raw);
      if (!parsed.ok) {
        void vscode.window.showErrorMessage(`Serial Lab: ${parsed.error}`);
        return;
      }
      // Re-resolve at commit time (TOCTOU: firmware may change while dialog is open).
      const result = await editor.commit(prepared, parsed.value, () => {
        const again = c.resolveAtEditor();
        return again.ok ? again.symbol : undefined;
      });
      if (result.success) {
        const rb = result.event.readbackValue;
        void vscode.window.showInformationMessage(
          `Serial Lab: ${symbol.expression} = ${rb}` +
            (result.event.requestedValue !== rb ? ` (requested ${result.event.requestedValue})` : '')
        );
      } else {
        void vscode.window.showErrorMessage(`Serial Lab: ${result.error}`);
      }
    })
  );
}

export function deactivate(): void {
  controller?.dispose();
}
