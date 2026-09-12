import * as vscode from 'vscode';
import { getNonce } from './nonce';

let panel: vscode.WebviewPanel | undefined;

export function getPanel(): vscode.WebviewPanel | undefined {
  return panel;
}

export function revealPanel(
  context: vscode.ExtensionContext,
  onMessage: (m: unknown) => void
): vscode.WebviewPanel {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside);
    return panel;
  }
  panel = vscode.window.createWebviewPanel(
    'serialLabWorkbench',
    'Serial Lab',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.webview.html = getHtml(panel.webview, context.extensionUri);
  panel.webview.onDidReceiveMessage(onMessage, undefined, context.subscriptions);
  panel.onDidDispose(() => {
    panel = undefined;
  });
  return panel;
}

function getHtml(webview: vscode.Webview, ext: vscode.Uri): string {
  const nonce = getNonce();
  const script = webview.asWebviewUri(vscode.Uri.joinPath(ext, 'src', 'webview', 'media', 'main.js'));
  const css = webview.asWebviewUri(vscode.Uri.joinPath(ext, 'src', 'webview', 'media', 'main.css'));
  const uplotJs = webview.asWebviewUri(vscode.Uri.joinPath(ext, 'src', 'webview', 'media', 'uplot.min.js'));
  const uplotCss = webview.asWebviewUri(vscode.Uri.joinPath(ext, 'src', 'webview', 'media', 'uplot.min.css'));
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource};" />
  <link href="${uplotCss}" rel="stylesheet" />
  <link href="${css}" rel="stylesheet" />
  <title>Serial Lab</title>
</head>
<body>
  <div class="toolbar">
    <button id="pause">暂停</button>
    <button id="clear-term">清空终端</button>
    <button id="clear-wave">清空波形</button>
    <button id="reset-zoom" title="双击图区也可重置">重置缩放</button>
    <button id="follow-live" title="实时跟随最新数据">跟随:开</button>
    <span class="hint">滚轮/框选自由缩放 · 跟随开时新数据会向前滚 · 重置恢复全览</span>
    <label>RX <select id="rx-enc"><option value="text">文本</option><option value="hex">HEX</option></select></label>
    <span id="span-info" class="hint"></span>
    <span id="status" class="status"></span>
  </div>
  <div class="main-grid">
    <div class="plot-col">
      <div id="plot"></div>
      <div id="legend"></div>
    </div>
    <aside class="params-col" id="params-col">
      <div class="params-header">
        <div class="params-title">Parameters</div>
        <label>参数来源 <select id="params-source"><option value="native">Native 串口</option><option value="swd">SWD / DAPLink</option></select></label>
        <div id="swd-controls" hidden>
          <button data-swd="elf">选择 ELF</button>
          <button data-swd="watch">选择参数</button>
          <button data-swd="settings">SWD 设置</button>
          <button data-swd="runtime">安装/修复环境</button>
          <button data-swd="pack">安装芯片支持</button>
          <button data-swd="help">使用说明</button>
          <button data-swd="connect">连接 SWD</button>
          <button data-swd="disconnect">断开 SWD</button>
          <button data-swd="refresh">刷新</button>
          <div class="hint">运行态 RAM 调参 · 复位后恢复默认值</div>
        </div>
        <div id="params-state" class="params-state">—</div>
        <div id="params-device" class="params-device"></div>
        <input id="params-search" class="params-search" placeholder="搜索 path / unit…" />
      </div>
      <div id="params-list" class="params-list"></div>
    </aside>
  </div>
  <div class="term-wrap">
    <div id="term" class="term"></div>
  </div>
  <div class="send-wrap">
    <select id="tx-enc">
      <option value="text">文本</option>
      <option value="hex">HEX</option>
    </select>
    <select id="tx-eol">
      <option value="lf">LF</option>
      <option value="crlf">CRLF</option>
      <option value="cr">CR</option>
      <option value="none">无</option>
    </select>
    <input id="tx-input" placeholder="发送内容" />
    <button id="tx-send">发送</button>
  </div>
  <script nonce="${nonce}" src="${uplotJs}"></script>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
