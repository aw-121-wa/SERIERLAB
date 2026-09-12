import * as vscode from 'vscode';
import * as path from 'path';
import { SwdClient } from './client';
import { resolvePython } from './runtime';
import { ParameterView } from '../protocol/native/parameterView';
import { firmwareIdentityFromPath, swdChannelId } from './runtimeChannels';
import { DwarfSymbolRecord } from '../runtime/runtimeSymbolService';

export type SwdPlotPush = {
  channelId: string;
  path: string;
  type: ParameterView['type'];
  value: number | boolean;
  unit?: string;
  writable: boolean;
  min?: number;
  max?: number;
  /** Actual global SWD poll rate at sample time (not a per-variable request). */
  pollRateHz?: number;
};

export class SwdController implements vscode.Disposable {
  private client?: SwdClient;
  private generation = 0;
  private timer?: NodeJS.Timeout;
  private reading = false;
  private writing = false;
  private connecting?: Promise<void>;
  private closing: Promise<void> = Promise.resolve();
  parameters: ParameterView[] = [];
  /** Flattened DWARF records for RuntimeSymbolService (includes address). */
  symbolRecords: DwarfSymbolRecord[] = [];
  state = 'disconnected';
  detail = '';
  elfPath = '';
  /** Full SHA-256 of ELF file bytes at last successful connect. */
  elfSha256 = '';
  /** Actual global poll rate (S13 v1 — not per-variable). */
  pollHz = 0;

  constructor(
    private context: vscode.ExtensionContext,
    private changed: (update?: ParameterView) => void,
    /** Called after a successful poll with values intended for SeriesStore/Plot. */
    private onPlotSample?: (samples: SwdPlotPush[]) => void
  ) {}

  private settings() {
    const cfg = vscode.workspace.getConfiguration('serialLab');
    const elf = cfg.get<string>('swd.elf', '');
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!elf) throw new Error('请设置 serialLab.swd.elf，或点击“选择 ELF”');
    if (!path.isAbsolute(elf) && !root) throw new Error('相对 ELF 路径需要打开工作区');
    const pollHz = cfg.get<number>('swd.pollHz', 5);
    if (!Number.isFinite(pollHz) || pollHz < 0 || pollHz > 20) throw new Error('swd.pollHz 必须为 0..20');
    return {
      python: cfg.get<string>('swd.pythonPath', ''),
      pollHz,
      args: {
        elf: path.isAbsolute(elf) ? elf : path.resolve(root!, elf),
        target: cfg.get<string>('swd.target', ''),
        probeId: cfg.get<string>('swd.probeId', ''),
        frequency: cfg.get<number>('swd.frequency', 1000000),
        watch: cfg.get<unknown[]>('swd.watch', []),
      },
    };
  }

  private makeClient(python: string) {
    if (!vscode.workspace.isTrusted) throw new Error('SWD 需要受信任的工作区');
    return new SwdClient(python, ['-u', vscode.Uri.joinPath(this.context.extensionUri, 'scripts', 'swd_backend.py').fsPath]);
  }

  async chooseElf(): Promise<void> {
    const files = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { ELF: ['elf', 'axf', 'out'] } });
    if (!files?.length) return;
    await vscode.workspace.getConfiguration('serialLab').update('swd.elf', files[0].fsPath, vscode.ConfigurationTarget.Workspace);
    await this.chooseWatches();
  }

  async chooseWatches(): Promise<void> {
    const cfg = this.settings();
    const helper = this.makeClient(await resolvePython(this.context));
    try {
      const result = await helper.request<{ symbols: { path: string; type: string; address: number }[] }>('inspect', { elf: cfg.args.elf });
      const old = cfg.args.watch as { path: string; min?: number; max?: number }[];
      const counts = new Map<string, number>();
      for (const s of result.symbols) counts.set(s.path, (counts.get(s.path) ?? 0) + 1);
      const picked = await vscode.window.showQuickPick(result.symbols.filter(s => counts.get(s.path) === 1).map(s => ({
        label: s.path, description: `${s.type} · 0x${s.address.toString(16)}`, picked: old.some(w => w.path === s.path),
      })), { canPickMany: true, placeHolder: '选择最多 64 个 RAM 参数；修改后重新连接生效' });
      if (picked) {
        if (picked.length > 64) throw new Error('最多选择 64 个参数');
        await vscode.workspace.getConfiguration('serialLab').update('swd.watch', picked.map(p => old.find(w => w.path === p.label) ?? { path: p.label }), vscode.ConfigurationTarget.Workspace);
      }
    } finally { helper.dispose(); }
  }

  connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.state === 'ready') return Promise.resolve();
    this.connecting = this.connectOnce().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private async connectOnce(): Promise<void> {
    // Reserve the generation before yielding so a later disconnect always wins.
    const cleanup = this.disconnect();
    const generation = ++this.generation;
    this.state = 'connecting'; this.detail = '正在附加并核对 ELF 与 Flash…'; this.changed();
    try {
      await cleanup;
      if (generation !== this.generation) return;
      const cfg = this.settings();
      const python = await resolvePython(this.context);
      if (generation !== this.generation) return;
      const client = this.makeClient(python);
      this.client = client;
      const result = await client.request<{
        parameters: (ParameterView & { address?: number; size?: number })[];
        verifiedBytes: number;
      }>('connect', cfg.args);
      if (generation !== this.generation) return;
      this.elfPath = cfg.args.elf;
      this.elfSha256 = firmwareIdentityFromPath(cfg.args.elf).sha256;
      this.pollHz = cfg.pollHz;
      this.parameters = result.parameters;
      this.symbolRecords = result.parameters
        .filter((p) => typeof p.address === 'number')
        .map((p) => ({
          path: p.path,
          address: p.address!,
          type: p.type,
          size: p.type === 'bool' ? 1 : 4,
          writable: p.writable,
        }));
      this.state = 'ready'; this.detail = `SWD · 已核对 ${result.verifiedBytes} 字节 Flash`;
      this.changed();
      await this.refresh();
      if (generation === this.generation && this.state === 'ready' && cfg.pollHz > 0) {
        // Single central timer — not one setInterval per variable.
        this.timer = setInterval(() => { void this.refresh(); }, 1000 / cfg.pollHz);
      }
    } catch (e) {
      if (generation === this.generation) this.fail(e);
    }
  }

  async refresh(): Promise<void> {
    if (this.reading || this.writing || this.state !== 'ready' || !this.client) return;
    const generation = this.generation;
    this.reading = true;
    try {
      const values = await this.client.request<{ id: number; value: number | boolean }[]>('read');
      if (generation !== this.generation) return;
      const plot: SwdPlotPush[] = [];
      for (const { id, value } of values) {
        const p = this.parameters.find(p => p.id === id);
        if (p && !p.pending) {
          p.confirmedValue = value;
          this.changed(p);
          if (this.elfSha256 && value !== undefined) {
            plot.push({
              channelId: swdChannelId(this.elfSha256, p.path),
              path: p.path,
              type: p.type,
              value,
              unit: p.unit,
              writable: p.writable,
              min: p.min,
              max: p.max,
              pollRateHz: this.pollHz,
            });
          }
        }
      }
      if (plot.length) this.onPlotSample?.(plot);
    } catch (e) { if (generation === this.generation) this.fail(e); }
    finally { if (generation === this.generation) this.reading = false; }
  }

  async set(id: number, value: number | boolean): Promise<void> {
    const p = this.parameters.find(p => p.id === id);
    if (!p || this.state !== 'ready' || !this.client || this.writing) return;
    const generation = this.generation;
    this.writing = true;
    p.pending = { requestedValue: value }; p.lastError = undefined; this.changed(p);
    try {
      const actual = await this.client.request<number | boolean>('write', { id, value });
      if (generation === this.generation) p.confirmedValue = actual;
    } catch (e) {
      if (generation === this.generation) {
        p.lastError = { detail: (e as Error).message };
        if (this.client?.isClosed) this.fail(e);
      }
    } finally {
      if (generation === this.generation) {
        this.writing = false; p.pending = undefined; this.changed(p);
      }
    }
  }

  private fail(error: unknown) {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.state = 'error'; this.detail = (error as Error).message;
    const client = this.client; this.client = undefined;
    if (client) this.closing = this.closing.then(() => client.close()).catch(() => {});
    this.changed();
  }

  async disconnect(): Promise<void> {
    ++this.generation;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined; this.reading = false; this.writing = false;
    const client = this.client; this.client = undefined;
    this.parameters = []; this.state = 'disconnected'; this.detail = '';
    this.symbolRecords = [];
    // Drop firmware identity so stale watches cannot be reused after ELF change.
    this.elfPath = ''; this.elfSha256 = ''; this.pollHz = 0;
    this.changed();
    if (client) this.closing = this.closing.then(() => client.close()).catch(() => {});
    await this.closing;
  }

  dispose(): void { void this.disconnect(); }
}
