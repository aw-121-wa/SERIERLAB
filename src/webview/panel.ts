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
    <label>RX <select id="rx-enc"><option value="text">文本</option><option value="hex">HEX</option></select></label>
    <span id="status" class="status"></span>
  </div>
  <div id="plot"></div>
  <div id="legend"></div>
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
