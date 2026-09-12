import { NativeFrame, NATIVE_DEFAULT_TIMEOUT_MS, NATIVE_MAX_PENDING_REQUESTS } from './types';

export type PendingRequest = {
  requestId: number;
  resolve: (frame: NativeFrame) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class NativeRequestManager {
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  timeouts = 0;
  rejectedOnDisconnect = 0;

  constructor(
    private readonly timeoutMs: number = NATIVE_DEFAULT_TIMEOUT_MS,
    private readonly maxPending: number = NATIVE_MAX_PENDING_REQUESTS,
    private readonly now: () => number = () => Date.now()
  ) {}

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Allocate next request id, skipping currently pending ids. */
  allocateId(): number {
    for (let i = 0; i < 65535; i++) {
      const id = this.nextId;
      this.nextId = this.nextId >= 65535 ? 1 : this.nextId + 1;
      if (id !== 0 && !this.pending.has(id)) return id;
    }
    throw new Error('request id space exhausted');
  }

  register(requestId: number): Promise<NativeFrame> {
    if (this.pending.size >= this.maxPending) {
      return Promise.reject(new Error('too many pending native requests'));
    }
    if (requestId === 0) {
      return Promise.reject(new Error('requestId 0 reserved for unsolicited'));
    }
    if (this.pending.has(requestId)) {
      return Promise.reject(new Error(`requestId ${requestId} already pending`));
    }
    return new Promise<NativeFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.timeouts += 1;
        reject(new Error(`native request ${requestId} timeout`));
      }, this.timeoutMs);
      this.pending.set(requestId, { requestId, resolve, reject, timer });
    });
  }

  /** Match an incoming response frame; returns true if consumed. */
  onResponse(frame: NativeFrame): boolean {
    if (frame.requestId === 0) return false;
    const p = this.pending.get(frame.requestId);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(frame.requestId);
    p.resolve(frame);
    return true;
  }

  rejectAll(reason = 'disconnected'): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.rejectedOnDisconnect += this.pending.size;
    this.pending.clear();
  }

  nowMs(): number {
    return this.now();
  }
}
