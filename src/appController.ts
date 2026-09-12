import * as vscode from 'vscode';
import { SerialService } from './serial/serialService';
import { ProtocolRouter } from './protocol/router';
import { RawBuffer } from './store/rawBuffer';
import { SeriesStore } from './store/seriesStore';
import { ChannelRegistry } from './store/channels';
import { PendingUiQueue } from './store/pendingUiQueue';
import { SessionClock } from './time/sessionClock';
import { LastRxTracker } from './time/lastRxTracker';
import { PlotPresenter } from './plot/plotPresenter';
import * as state from './state/workspaceState';
import { decodeHex, encodeHex } from './protocol/hex';
import { log } from './log';
import { HostToWebview, WebviewToHost } from './webview/bridge';
import { formatRawLog } from './export/exportService';
import { getPanel } from './webview/panel';
import { CustomProtocolConfig } from './protocol/custom';
import { toSerialPortOpenOptions } from './serial/framing';
import { ProjectConfigService, ProjectConfigSnapshot } from './config/projectConfigService';

export class AppController implements vscode.Disposable {
  readonly serial = new SerialService();
  readonly router = new ProtocolRouter();
  readonly raw: RawBuffer;
  readonly series: SeriesStore;
  readonly channels = new ChannelRegistry();
  readonly clock = new SessionClock();
  readonly projectConfig = new ProjectConfigService();
  /** Status-bar `t` = latest RX session time, not extension lifetime. */
  private readonly lastRx = new LastRxTracker();
  private customConfig: CustomProtocolConfig | undefined;
  private readonly pendingUi: PendingUiQueue;
  private readonly plot = new PlotPresenter();
  private paused = false;
  private rxEncoding: 'text' | 'hex' = 'text';
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.raw = new RawBuffer(vscode.workspace.getConfiguration('serialLab').get<number>('rawBufferBytes') ?? 2 * 1024 * 1024);
    this.series = new SeriesStore(
      (vscode.workspace.getConfiguration('serialLab').get<number>('historySeconds') ?? 60) * 1000
    );
    const uiCfg = vscode.workspace.getConfiguration('serialLab');
    this.pendingUi = new PendingUiQueue({
      maxBytes: uiCfg.get<number>('uiPendingMaxBytes') ?? 512 * 1024,
      maxEntries: uiCfg.get<number>('uiPendingMaxEntries') ?? 4000,
    });
    this.channels.applySavedPrefs(state.loadChannelPrefs());
    this.applyProtocolFromState();
    this.serial.on('data', (bytes: Uint8Array) => this.onRx(bytes));
    this.serial.on('state', () => this.pushStatus());
    this.timer = setInterval(() => this.flushUi(), 50);
    this.projectConfig.onChange((snap) => this.applyProjectConfig(snap));
    void this.projectConfig.start().then(() => this.applyProjectConfig(this.projectConfig.snapshot()));
    context.subscriptions.push(
      this.projectConfig,
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        this.reloadProtocol();
      })
    );
  }

  /** Apply project channel presentation overrides (never id/path). */
  private applyProjectConfig(snap: ProjectConfigSnapshot): void {
    for (const [id, ov] of Object.entries(snap.effective.channels)) {
      if (ov.displayName !== undefined) this.channels.setDisplayName(id, ov.displayName);
      if (ov.unit !== undefined) this.channels.setUnit(id, ov.unit);
      if (ov.color !== undefined) this.channels.setColor(id, ov.color);
      if (ov.visible !== undefined) this.channels.setVisible(id, ov.visible);
      const view = this.channels.get(id);
      if (view) {
        this.series.setMeta(id, {
          displayName: view.displayName,
          unit: view.unit,
          color: view.color,
          visible: view.visible,
        });
      }
    }
    // Project protocol: apply when not connected (avoid surprising live reset).
    if (this.serial.getState() !== 'connected' && snap.project?.protocol) {
      const kind = snap.effective.protocol.kind;
      if (kind === 'custom' && snap.effective.protocol.customId) {
        void state.saveActiveCustomId(snap.effective.protocol.customId);
      }
      void state.saveProtocol(kind);
      this.applyProtocolFromState();
    }
    this.pushStatus();
  }

  private nowMs(): number {
    return this.clock.now();
  }

  private applyProtocolFromState(): void {
    const p = state.loadProtocol();
    const scriptAllowed = vscode.workspace.isTrusted;
    if (p === 'custom') {
      const id = state.loadActiveCustomId();
      const cfg = state.loadCustomProtocols().find((c) => c.id === id) ?? {
        id: 'none',
        name: 'none',
        mode: 'config' as const,
      };
      this.customConfig = cfg;
      this.router.setProtocol({ kind: 'custom', config: cfg }, { scriptAllowed });
    } else {
      this.customConfig = undefined;
      if (p === 'firewater') this.router.setProtocol({ kind: 'firewater' });
      else if (p === 'raw') this.router.setProtocol({ kind: 'raw' });
      else this.router.setProtocol({ kind: 'justfloat' });
    }
    if (this.router.scriptBlocked) {
      void vscode.window.showWarningMessage(
        'Serial Lab: Script Protocol 为 Experimental，且在不受信任的工作区中已禁用。请信任工作区后重试。'
      );
    }
  }

  reloadProtocol(): void {
    this.applyProtocolFromState();
    this.plot.bumpGeneration('protocol');
    this.pushStatus();
  }

  /** Channel list plus live last sample (for sidebar readout). */
  channelViews(): {
    id: string;
    path: string;
    displayName: string;
    unit?: string;
    color: string;
    visible: boolean;
    value?: number;
  }[] {
    return this.channels.list().map((c) => {
      const value = this.series.lastValue(c.id);
      return value === undefined ? { ...c } : { ...c, value };
    });
  }

  private onRx(bytes: Uint8Array): void {
    const t = this.nowMs();
    this.lastRx.update(t);
    this.raw.push(bytes, 'RX', t);
    this.pendingUi.push(t, 'RX', bytes);
    if (this.router.protocolKind === 'raw') return;
    const batches = this.router.feed(bytes, t);
    for (const b of batches) {
      // Control plane: discovery + metadata only on change.
      const sync = this.channels.syncFromBatch(b.values.length, this.router.protocolKind, {
        protocolConfigId: this.customConfig?.id,
        channelMeta: this.customConfig?.channels?.map((c) => ({
          index: c.index,
          name: c.name,
          path: c.path,
          unit: c.unit,
          color: c.color,
        })),
      });
      for (const ch of sync.changed) {
        this.series.setMeta(ch.id, {
          path: ch.path,
          displayName: ch.displayName,
          unit: ch.unit,
          color: ch.color,
          visible: ch.visible,
        });
      }
      // Data plane: ids[i] ↔ values[i]
      this.series.append(b.tMs, b.values, sync.ids);
      this.plot.addPoints(b.tMs, b.values, sync.ids);
    }
  }

  handleWebviewMessage(msg: WebviewToHost): void {
    switch (msg.type) {
      case 'ready':
        this.plot.requestSnapshot('ready');
        this.pushStatus();
        this.flushUi();
        break;
      case 'plot.needSnapshot':
        this.plot.requestSnapshot(msg.reason ?? 'needSnapshot');
        this.flushUi();
        break;
      case 'pause':
        this.paused = msg.paused;
        this.plot.setPaused(msg.paused);
        if (!msg.paused) {
          // Resume: do not replay the entire pause backlog into the terminal.
          this.pendingUi.trimForResume();
          this.pushStatus();
          this.flushUi();
        }
        break;
      case 'toggleChannel': {
        this.channels.setVisible(msg.id, msg.visible);
        this.series.setMeta(msg.id, { visible: msg.visible });
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
        this.pendingUi.clear();
        this.post({ type: 'cleared' });
        break;
      case 'clearWaveform':
        this.series.clear();
        this.post(this.plot.buildReset('clear'));
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
      this.pendingUi.push(t, 'TX', bytes);
      this.pushStatus();
    } catch (e) {
      void vscode.window.showErrorMessage(`Serial Lab send failed: ${(e as Error).message}`);
    }
  }

  async connect(): Promise<void> {
    const conn = state.loadConnection(this.context);
    if (!conn.path) {
      void vscode.window.showWarningMessage('Serial Lab: select a serial port first');
      return;
    }
    // Full framing from project > settings > defaults; applied on next connect only.
    const eff = this.projectConfig.snapshot().effective.serial;
    const open = toSerialPortOpenOptions(conn.path, {
      baudRate: eff.baudRate || conn.baudRate,
      dataBits: eff.dataBits,
      parity: eff.parity,
      stopBits: eff.stopBits,
      flowControl: eff.flowControl,
    });
    try {
      await this.serial.connect(open);
      log.info(
        `Connected ${open.path} @ ${open.baudRate} ${open.dataBits}${String(open.parity)[0]}${open.stopBits} rtscts=${open.rtscts} xon=${open.xon}`
      );
    } catch (e) {
      void vscode.window.showErrorMessage(`Serial Lab connect failed: ${(e as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    await this.serial.disconnect();
  }

  exportSamples(uri: vscode.Uri): void {
    const toIso = (tMs: number) => this.clock.toIso(tMs);
    void vscode.workspace.fs.writeFile(uri, Buffer.from(this.series.exportCsv(undefined, toIso), 'utf8'));
  }

  exportRaw(uri: vscode.Uri): void {
    const toIso = (tMs: number) => this.clock.toIso(tMs);
    const text = formatRawLog(this.raw.entries(), toIso);
    void vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
  }

  private post(msg: HostToWebview): void {
    getPanel()?.webview.postMessage(msg);
  }

  private pushStatus(): void {
    this.post({
      type: 'status',
      state: this.serial.getState(),
      path: state.loadConnection(this.context).path,
      protocol: this.router.protocolKind,
      rxBytes: this.serial.rxBytes,
      txBytes: this.serial.txBytes,
      errors: this.router.errors,
      channels: this.channels.list(),
      droppedUiEntries: this.pendingUi.droppedEntryCount,
      droppedUiBytes: this.pendingUi.droppedByteCount,
      tMs: this.lastRx.tMs,
    });
  }

  private flushUi(): void {
    if (this.paused) return;
    const raw = this.pendingUi.drain();
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
    const plotMsgs = this.plot.flush((maxPoints) => this.series.getWindow(maxPoints));
    for (const m of plotMsgs) this.post(m);
    // Keep RX/TX/err ticking while data flows (was only pushed on rare events).
    this.pushStatus();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    void this.serial.disconnect();
  }
}
