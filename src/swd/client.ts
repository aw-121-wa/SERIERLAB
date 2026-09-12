import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

/** One request at a time. A timeout closes the session; writes are never retried. */
export class SwdClient {
  private child: ChildProcessWithoutNullStreams;
  private closed = false;
  private buffer = '';
  private diagnostic = '';
  private nextId = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private pending?: { id: number; resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

  get isClosed(): boolean { return this.closed; }

  constructor(executable: string, args: string[], private timeoutMs = 30000) {
    this.child = spawn(executable, args, { shell: false, windowsHide: true, stdio: 'pipe' });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (s: string) => { this.diagnostic = (this.diagnostic + s).slice(-3000); });
    this.child.stdout.on('data', (s: string) => this.feed(s));
    this.child.stdin.on('error', (e) => this.fail(e));
    this.child.on('error', (e) => this.fail(new Error(`Cannot start SWD Python helper: ${e.message}`)));
    this.child.on('exit', (code) => this.fail(new Error(`SWD helper exited (${code}). ${this.diagnostic}`)));
  }

  request<T = unknown>(method: string, args: unknown = {}): Promise<T> {
    const task = this.tail.then(() => new Promise<T>((resolve, reject) => {
      if (this.closed) { reject(new Error('SWD helper closed')); return; }
      const id = ++this.nextId;
      const timer = setTimeout(() => this.fail(new Error('SWD request timed out; reconnect before further access')), this.timeoutMs);
      this.pending = { id, resolve, reject, timer };
      this.child.stdin.write(JSON.stringify({ id, method, args }) + '\n');
    }));
    this.tail = task.catch(() => {});
    return task;
  }

  private feed(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 8 * 1024 * 1024) { this.fail(new Error('SWD helper response exceeds limit')); return; }
    let end: number;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      try {
        const response = JSON.parse(line);
        const pending = this.pending;
        if (!pending || response.id !== pending.id) throw new Error('unexpected response ID');
        clearTimeout(pending.timer);
        this.pending = undefined;
        if (typeof response.error === 'string') pending.reject(new Error(response.error));
        else pending.resolve(response.result);
      } catch (e) { this.fail(new Error(`Invalid SWD helper response: ${(e as Error).message}`)); }
    }
  }

  private fail(error: Error): void {
    this.closed = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = undefined;
    }
    this.child.kill();
  }

  async close(): Promise<void> {
    try { if (!this.closed) await this.request('disconnect'); }
    finally { this.dispose(); }
  }

  dispose(): void { this.fail(new Error('SWD helper closed')); }
}
