import * as vscode from 'vscode';
import { AppController } from '../appController';
import * as state from '../state/workspaceState';
import { getNonce } from './nonce';
import { revealPanel } from './panel';
import { WebviewToHost } from './bridge';

export function registerSidebar(
  context: vscode.ExtensionContext,
  controller: AppController
): void {
  const provider = new SidebarViewProvider(context, controller);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('serialLab.sidebar', provider),
    provider
  );
}

class SidebarViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private mirrorTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: AppController
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview', 'media'),
      ],
    };
    const nonce = getNonce();
    const js = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview', 'media', 'sidebar.js')
    );
    const css = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview', 'media', 'sidebar.css')
    );
    const conn = state.loadConnection(this.context);
    webviewView.webview.html = `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webviewView.webview.cspSource}; script-src 'nonce-${nonce}';" />
<link href="${css}" rel="stylesheet"/>
</head><body>
  <section class="section">
    <h3>连接</h3>
    <button id="wizard">首次连接向导</button>
    <button id="diagnostics">复制诊断报告</button>
    <pre id="effective-connection"></pre>
    <div class="row">
      <select id="port" class="grow"></select>
      <button id="refresh" title="刷新串口列表">刷新</button>
    </div>
    <div class="row">
      <label class="grow">波特率
        <input id="baud" type="number" value="${conn.baudRate}" min="1"/>
      </label>
    </div>
    <div class="row">
      <span id="conn-state" class="status">disconnected</span>
    </div>
    <div class="row">
      <button id="connect" class="primary">连接</button>
      <button id="disconnect">断开</button>
    </div>
    <div class="row">
      <button id="open-workbench" class="primary grow" title="打开波形 / 终端面板">打开波形面板</button>
    </div>
  </section>
  <section class="section">
    <h3>协议</h3>
    <div class="row">
      <select id="protocol" class="grow">
        <option value="justfloat">JustFloat</option>
        <option value="firewater">FireWater</option>
        <option value="raw">RawData</option>
        <option value="native">Native (在线调参)</option>
        <option value="custom">自定义</option>
      </select>
    </div>
    <div class="row">
      <button id="edit-custom" class="grow">编辑自定义协议</button>
    </div>
  </section>
  <section class="section">
    <h3>通道</h3>
    <ul id="channels" class="channels"></ul>
  </section>
  <script nonce="${nonce}" src="${js}"></script>
</body></html>`;

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      try {
      switch (msg.type) {
        case 'wizard': await vscode.commands.executeCommand('serialLab.connectionWizard'); break;
        case 'diagnostics': await this.controller.copyDiagnostics(); break;
        case 'ready': {
          await this.pushInit();
          await this.pushPorts();
          this.pushMirror();
          break;
        }
        case 'refreshPorts': {
          await this.pushPorts();
          break;
        }
        case 'saveConn': {
          const c = state.loadConnection(this.context);
          if (typeof msg.path === 'string' && msg.path) c.path = msg.path;
          c.baudRate = Number(msg.baudRate) || 115200;
          await state.saveConnection(c, { context: this.context });
          break;
        }
        case 'connect': {
          const c = state.loadConnection(this.context);
          if (typeof msg.path === 'string' && msg.path) c.path = msg.path;
          if (msg.baudRate !== undefined) c.baudRate = Number(msg.baudRate) || 115200;
          await state.saveConnection(c, { context: this.context });
          await this.controller.connect();
          this.pushMirror();
          if (this.controller.serial.getState() === 'connected') {
            this.openWorkbench();
          }
          break;
        }
        case 'openWorkbench':
          this.openWorkbench();
          break;
        case 'disconnect':
          await this.controller.disconnect();
          this.pushMirror();
          break;
        case 'setProtocol': {
          await state.saveProtocol(msg.protocol);
          if (msg.protocol === 'custom') {
            const list = state.loadCustomProtocols();
            if (list.length === 0) {
              void vscode.window.showWarningMessage(
                'Serial Lab: 没有自定义协议，请先编辑自定义协议 JSON'
              );
            } else {
              const active = state.loadActiveCustomId();
              const pick = await vscode.window.showQuickPick(
                list.map((p) => ({
                  label: p.name,
                  description: p.id,
                  picked: p.id === active,
                })),
                { placeHolder: '选择自定义协议' }
              );
              if (pick?.description) await state.saveActiveCustomId(pick.description);
            }
          }
          this.controller.reloadProtocol();
          break;
        }
        case 'editCustom': {
          const doc = await vscode.workspace.openTextDocument({
            language: 'json',
            content: JSON.stringify(state.loadCustomProtocols(), null, 2),
          });
          await vscode.window.showTextDocument(doc);
          break;
        }
      }
      } catch (e) {
        void vscode.window.showErrorMessage(`Serial Lab: 操作失败 (${msg.type}): ${e instanceof Error ? e.message : String(e)}`);
        this.pushMirror();
      }
    });

    webviewView.onDidDispose(() => {
      this.stopMirror();
      this.view = undefined;
    });

    this.startMirror();
    // Also respond immediately in case the webview already loaded.
    void this.pushInit();
  }

  private async pushInit(): Promise<void> {
    await this.post({
      type: 'init',
      connection: state.loadConnection(this.context),
      protocol: state.loadProtocol(),
    });
  }

  private openWorkbench(): void {
    revealPanel(this.context, (m) =>
      this.controller.handleWebviewMessage(m as WebviewToHost)
    );
  }

  private async pushPorts(): Promise<void> {
    try {
      const ports = await this.controller.serial.listPorts();
      await this.post({
        type: 'ports',
        ports,
        selected: state.loadConnection(this.context).path,
      });
    } catch (e) {
      await this.post({ type: 'ports', ports: [], selected: state.loadConnection(this.context).path });
      void vscode.window.showErrorMessage(
        `Serial Lab: 列举串口失败: ${(e as Error).message}`
      );
    }
  }

  private pushMirror(): void {
    void this.post({
      type: 'channels',
      channels: this.controller.channelViews(),
    });
    void this.post({
      type: 'connState',
      state: this.controller.serial.getState(),
      summary: this.controller.connectionSummary(),
    });
  }

  private startMirror(): void {
    this.stopMirror();
    this.mirrorTimer = setInterval(() => this.pushMirror(), 200);
  }

  private stopMirror(): void {
    if (this.mirrorTimer) {
      clearInterval(this.mirrorTimer);
      this.mirrorTimer = undefined;
    }
  }

  private async post(msg: unknown): Promise<void> {
    if (this.view) {
      await this.view.webview.postMessage(msg);
    }
  }

  dispose(): void {
    this.stopMirror();
  }
}
