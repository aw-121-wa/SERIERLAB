import * as vscode from 'vscode';
import {
  EffectiveConfig,
  PROJECT_CONFIG_FILENAME,
  SerialLabProjectConfig,
  minimalProjectConfigText,
  nextProjectLayer,
  parseProjectConfig,
  resolveEffectiveConfig,
  VsCodeLayer,
} from './projectConfig';

export type ProjectConfigSnapshot = {
  /** Last successful parse; null if never loaded or deleted. */
  project: SerialLabProjectConfig | null;
  effective: EffectiveConfig;
  /** Last parse error (invalid file); null if current file is good or absent. */
  error: string | null;
  uri: vscode.Uri | null;
};

export type ProjectConfigChangeHandler = (snap: ProjectConfigSnapshot) => void;

/**
 * Loads <root>/.seriallab.json transactionally.
 * Invalid files keep last-known-good project config and set error.
 * Delete falls back to VS Code settings / defaults (does not rewrite the file).
 */
export class ProjectConfigService implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private lastGood: SerialLabProjectConfig | null = null;
  private lastError: string | null = null;
  private lastNotifiedError: string | null = null;
  private uri: vscode.Uri | null = null;
  private listeners: ProjectConfigChangeHandler[] = [];
  private disposed = false;

  constructor(private readonly debounceMs = 200) {}

  dispose(): void {
    this.disposed = true;
    if (this.debounce) clearTimeout(this.debounce);
    this.watcher?.dispose();
    this.listeners = [];
  }

  onChange(handler: ProjectConfigChangeHandler): void {
    this.listeners.push(handler);
  }

  /** Multi-root v1: active editor folder, else first folder, else null. */
  resolveRoot(): vscode.Uri | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    const active = vscode.window.activeTextEditor?.document.uri;
    if (active) {
      const folder = vscode.workspace.getWorkspaceFolder(active);
      if (folder) return folder.uri;
    }
    return folders[0]!.uri;
  }

  configUri(root = this.resolveRoot()): vscode.Uri | null {
    if (!root) return null;
    return vscode.Uri.joinPath(root, PROJECT_CONFIG_FILENAME);
  }

  async readText(uri: vscode.Uri): Promise<string | null> {
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(raw).toString('utf8');
    } catch {
      return null;
    }
  }

  vsCodeLayer(): VsCodeLayer {
    const cfg = vscode.workspace.getConfiguration('serialLab');
    const conn = cfg.get<{ baudRate?: number; dataBits?: number; parity?: string; stopBits?: number }>(
      'connection'
    );
    return {
      baudRate: conn?.baudRate,
      dataBits: conn?.dataBits,
      parity: conn?.parity,
      stopBits: conn?.stopBits,
      protocolKind: cfg.get<string>('protocol'),
      customId: cfg.get<string>('activeCustomProtocolId') || undefined,
    };
  }

  snapshot(): ProjectConfigSnapshot {
    return {
      project: this.lastGood,
      effective: resolveEffectiveConfig(this.lastGood, this.vsCodeLayer()),
      error: this.lastError,
      uri: this.uri,
    };
  }

  async loadNow(): Promise<ProjectConfigSnapshot> {
    const uri = this.configUri();
    this.uri = uri;
    if (!uri) {
      this.lastGood = null;
      this.lastError = null;
      return this.snapshot();
    }
    const text = await this.readText(uri);
    if (text === null) {
      // File absent — project layer gone; do not write defaults back.
      const next = nextProjectLayer(this.lastGood, { ok: true, config: null });
      this.lastGood = next.project;
      this.lastError = next.error;
      this.lastNotifiedError = null;
      return this.snapshot();
    }
    const parsed = parseProjectConfig(text);
    const next = nextProjectLayer(this.lastGood, parsed);
    this.lastGood = next.project;
    this.lastError = next.error;
    if (next.error) this.notifyErrorOnce(next.error);
    else this.lastNotifiedError = null;
    return this.snapshot();
  }

  private notifyErrorOnce(message: string): void {
    if (this.lastNotifiedError === message) return;
    this.lastNotifiedError = message;
    void vscode.window.showErrorMessage(`Serial Lab: invalid ${PROJECT_CONFIG_FILENAME} — ${message}`);
  }

  async start(): Promise<void> {
    await this.loadNow();
    this.watcher = vscode.workspace.createFileSystemWatcher(`**/${PROJECT_CONFIG_FILENAME}`);
    const schedule = () => this.scheduleReload();
    this.watcher.onDidChange(schedule);
    this.watcher.onDidCreate(schedule);
    this.watcher.onDidDelete(schedule);
  }

  private scheduleReload(): void {
    if (this.disposed) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      void this.loadNow().then((snap) => this.emit(snap));
    }, this.debounceMs);
  }

  private emit(snap: ProjectConfigSnapshot): void {
    for (const h of this.listeners) {
      try {
        h(snap);
      } catch {
        /* listener errors must not break reload */
      }
    }
  }

  /** Open or create minimal .seriallab.json. */
  async editProjectConfig(): Promise<void> {
    const root = this.resolveRoot();
    if (!root) {
      void vscode.window.showWarningMessage('Serial Lab: no workspace folder for .seriallab.json');
      return;
    }
    const uri = vscode.Uri.joinPath(root, PROJECT_CONFIG_FILENAME);
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(minimalProjectConfigText(), 'utf8'));
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  }
}
