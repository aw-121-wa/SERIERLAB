import * as vscode from 'vscode';
import { SerialService } from './serial/serialService';
import { ProtocolRouter } from './protocol/router';
import { RawBuffer } from './store/rawBuffer';
import { SeriesStore } from './store/seriesStore';
import { ChannelRegistry } from './store/channels';
import * as state from './state/workspaceState';
import { decodeHex, encodeHex } from './protocol/hex';
import { log } from './log';
import { HostToWebview, WebviewToHost } from './webview/bridge';
import { formatRawLog } from './export/exportService';
import { getPanel } from './webview/panel';
import { CustomProtocolConfig } from './protocol/custom';

export class AppController implements vscode.Disposable {
  readonly serial = new SerialService();
  readonly router = new ProtocolRouter();
  readonly raw: RawBuffer;
  readonly series: SeriesStore;
  readonly channels = new ChannelRegistry();
  private customConfig: CustomProtocolConfig | undefined;
  private pendingRaw: { tMs: number; dir: 'RX' | 'TX'; bytes: Uint8Array }[] = [];
  private paused = false;
  private rxEncoding: 'text' | 'hex' = 'text';
  private timer: NodeJS.Timeout | undefined;
  private sessionT0 = Date.now();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.raw = new RawBuffer(vscode.workspace.getConfiguration('serialLab').get<number>('rawBufferBytes') ?? 2 * 1024 * 1024);
    this.series = new SeriesStore(
      (vscode.workspace.getConfiguration('serialLab').get<number>('historySeconds') ?? 60) * 1000
    );
    this.channels.applySaved(state.loadChannelPrefs());
    this.applyProtocolFromState();
    this.serial.on('data', (bytes: Uint8Array) => this.onRx(bytes));
    this.serial.on('state', () => this.pushStatus());
    this.timer = setInterval(() => this.flushUi(), 50);
  }

  private nowMs(): number {
    return Date.now() - this.sessionT0;
  }

  private applyProtocolFromState(): void {
    const p = state.loadProtocol();
    if (p === 'custom') {
      const id = state.loadActiveCustomId();
      const cfg = state.loadCustomProtocols().find((c) => c.id === id) ?? {
        id: 'none',
        name: 'none',
        mode: 'config' as const,
      };
      this.customConfig = cfg;
      this.router.setProtocol({ kind: 'custom', config: cfg });
    } else {
      this.customConfig = undefined;
      if (p === 'firewater') this.router.setProtocol({ kind: 'firewater' });
      else if (p === 'raw') this.router.setProtocol({ kind: 'raw' });
      else this.router.setProtocol({ kind: 'justfloat' });
    }
  }

  reloadProtocol(): void {
    this.applyProtocolFromState();
    this.pushStatus();
  }

  private onRx(bytes: Uint8Array): void {
    const t = this.nowMs();
    this.raw.push(bytes, 'RX', t);
    this.pendingRaw.push({ tMs: t, dir: 'RX', bytes });
    if (this.router.protocolKind === 'raw') return;
    const batches = this.router.feed(bytes, t);
    for (const b of batches) {
      const names = this.customConfig?.channels?.map((c) => c.name);
      const ids = this.channels.syncFromBatch(b.values.length, this.router.protocolKind, names);
      for (const id of ids) {
        const view = this.channels.list().find((c) => c.id === id);
        this.series.setMeta(id, { name: view?.name ?? id, color: view?.color, visible: view?.visible });
      }
      this.series.append(b.tMs, b.values, ids);
    }
  }

  handleWebviewMessage(msg: WebviewToHost): void {
    switch (msg.type) {
      case 'ready':
        this.pushStatus();
        this.flushUi();
        break;
      case 'pause':
        this.paused = msg.paused;
        break;
      case 'toggleChannel': {
        this.channels.setVisible(msg.id, msg.visible);
        void state.saveChannelPrefs(this.channels.toSaved());
        this.pushStatus();
        break;
      }
      case 'send':
        void this.send(msg.encoding, msg.payload, msg.lineEnding);
        break;
      case 'setRxEncoding':
        this.rxEncoding = msg.encoding;
        break;
      case 'clearTerminal':
        this.raw.clear();
        this.post({ type: 'cleared' });
        break;
      case 'clearWaveform':
        this.series.clear();
        break;
    }
  }

  async send(encoding: 'text' | 'hex', payload: string, lineEnding: 'none' | 'lf' | 'cr' | 'crlf'): Promise<void> {
    try {
      let bytes: Uint8Array;
      if (encoding === 'hex') bytes = decodeHex(payload);
      else bytes = new TextEncoder().encode(payload);
      if (encoding === 'text' && lineEnding !== 'none') {
        const eol =
          lineEnding === 'lf' ? '\n' : lineEnding === 'cr' ? '\r' : '\r\n';
        const withEol = new Uint8Array(bytes.length + eol.length);
        withEol.set(bytes, 0);
        withEol.set(new TextEncoder().encode(eol), bytes.length);
        bytes = withEol;
      }
      await this.serial.write(bytes);
      const t = this.nowMs();
      this.raw.push(bytes, 'TX', t);
      this.pendingRaw.push({ tMs: t, dir: 'TX', bytes });
      this.pushStatus();
    } catch (e) {
      void vscode.window.showErrorMessage(`Serial Lab send failed: ${(e as Error).message}`);
    }
  }

  async connect(): Promise<void> {
    const conn = state.loadConnection();
    if (!conn.path) {
      void vscode.window.showWarningMessage('Serial Lab: select a serial port first');
      return;
    }
    try {
      await this.serial.connect(conn.path, conn.baudRate);
      log.info(`Connected ${conn.path} @ ${conn.baudRate}`);
    } catch (e) {
      void vscode.window.showErrorMessage(`Serial Lab connect failed: ${(e as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    await this.serial.disconnect();
  }

  exportSamples(uri: vscode.Uri): void {
    void vscode.workspace.fs.writeFile(uri, Buffer.from(this.series.exportCsv(), 'utf8'));
  }

  exportRaw(uri: vscode.Uri): void {
    const text = formatRawLog(this.raw.entries());
    void vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
  }

  private post(msg: HostToWebview): void {
    getPanel()?.webview.postMessage(msg);
  }

  private pushStatus(): void {
    this.post({
      type: 'status',
      state: this.serial.getState(),
      path: state.loadConnection().path,
      protocol: this.router.protocolKind,
      rxBytes: this.serial.rxBytes,
      txBytes: this.serial.txBytes,
      errors: this.router.errors,
      channels: this.channels.list(),
    });
  }

  private flushUi(): void {
    if (this.paused) return;
    const raw = this.pendingRaw;
    this.pendingRaw = [];
    if (raw.length) {
      this.post({
        type: 'raw',
        entries: raw.map((r) => ({
          tMs: r.tMs,
          dir: r.dir,
          text: new TextDecoder('utf-8', { fatal: false }).decode(r.bytes),
          hex: encodeHex(r.bytes),
        })),
      });
    }
    const series = this.series.getWindow(3000);
    if (series.some((s) => s.xs.length)) {
      this.post({ type: 'samples', t: this.nowMs(), series });
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    void this.serial.disconnect();
  }
}
