import { encodeFrame, NativeFrameDecoder } from './frameCodec';
import {
  decodeHelloResponse,
  decodeParamDesc,
  decodeParamNack,
  decodeParamValueMsg,
  encodeHelloRequest,
  encodeParamGet,
  encodeParamValueMsg,
} from './messageCodec';
import { ParameterStore } from './parameterStore';
import { NativeRequestManager } from './nativeRequestManager';
import {
  NATIVE_DISCOVERY_TIMEOUT_MS,
  NATIVE_VERSION,
  NativeFrame,
  NativeFrameFlags,
  NativeMessageType,
  NativeParamType,
  NativeParamValue,
  ParameterDescriptor,
} from './types';
import { validateParamValue } from './valueCodec';

export type NativeSessionMetrics = {
  framesRx: number;
  framesTx: number;
  crcErrors: number;
  decodeErrors: number;
  requestTimeouts: number;
  nackCount: number;
};

export type NativeSessionState =
  | 'idle'
  | 'handshaking'
  | 'discovering'
  | 'ready'
  | 'incompatible'
  | 'discovery_failed'
  | 'disconnected';

export type NativeParamEvent = {
  kind: 'state' | 'descriptor' | 'value' | 'pending' | 'ack' | 'nack';
  parameterId?: number;
  state: NativeSessionState;
};

/**
 * Host-side native control session.
 * Transport is injected (serial write); no vscode/webview dependency.
 */
export class NativeSession {
  private decoder = new NativeFrameDecoder();
  private requests = new NativeRequestManager();
  private store = new ParameterStore();
  private state: NativeSessionState = 'idle';
  private expectedDescs = 0;
  private discoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private discoveryError: string | null = null;
  private deviceName = '';
  private firmwareVersion = '';
  private deviceCapabilities = 0;
  private changeListeners: ((e: NativeParamEvent) => void)[] = [];
  metrics: NativeSessionMetrics = {
    framesRx: 0,
    framesTx: 0,
    crcErrors: 0,
    decodeErrors: 0,
    requestTimeouts: 0,
    nackCount: 0,
  };

  constructor(private readonly send: (bytes: Uint8Array) => void) {}

  onChange(cb: (e: NativeParamEvent) => void): void {
    this.changeListeners.push(cb);
  }

  private emit(kind: NativeParamEvent['kind'], parameterId?: number): void {
    const e: NativeParamEvent = { kind, parameterId, state: this.state };
    for (const cb of this.changeListeners) {
      try {
        cb(e);
      } catch {
        /* ignore listener errors */
      }
    }
  }

  listRuntime() {
    return this.store.list();
  }

  getState(): NativeSessionState {
    return this.state;
  }

  getParameters(): ParameterDescriptor[] {
    return this.store.list().map((s) => s.descriptor);
  }

  getParameter(idOrPath: number | string) {
    return typeof idOrPath === 'number' ? this.store.getById(idOrPath) : this.store.getByPath(idOrPath);
  }

  getParameterValue(idOrPath: number | string): NativeParamValue | undefined {
    return this.getParameter(idOrPath)?.confirmedValue;
  }

  getDeviceName(): string {
    return this.deviceName;
  }

  getFirmwareVersion(): string {
    return this.firmwareVersion;
  }

  getDiscoveryError(): string | null {
    return this.discoveryError;
  }

  private clearDiscoveryTimer(): void {
    if (this.discoveryTimer !== undefined) {
      clearTimeout(this.discoveryTimer);
      this.discoveryTimer = undefined;
    }
  }

  private armDiscoveryTimeout(): void {
    this.clearDiscoveryTimer();
    this.discoveryError = null;
    this.discoveryTimer = setTimeout(() => {
      if (this.state === 'discovering') {
        this.state = 'discovery_failed';
        this.discoveryError = `discovery timeout: got ${this.store.count()}/${this.expectedDescs} descriptors`;
      }
    }, NATIVE_DISCOVERY_TIMEOUT_MS);
  }

  reset(): void {
    this.clearDiscoveryTimer();
    this.discoveryError = null;
    this.decoder.reset();
    this.requests.rejectAll('reset');
    this.store.clear();
    this.expectedDescs = 0;
    this.deviceName = '';
    this.firmwareVersion = '';
    this.state = 'idle';
    this.syncTimeoutMetric();
  }

  disconnect(): void {
    this.clearDiscoveryTimer();
    this.requests.rejectAll('disconnected');
    this.store.clear();
    this.decoder.reset();
    this.state = 'disconnected';
    this.syncTimeoutMetric();
  }

  private syncTimeoutMetric(): void {
    this.metrics.requestTimeouts = this.requests.timeouts;
    this.metrics.crcErrors = this.decoder.crcErrors;
    this.metrics.decodeErrors = this.decoder.decodeErrors;
  }

  private tx(messageType: number, flags: number, requestId: number, payload: Uint8Array): void {
    const wire = encodeFrame({ messageType, flags, requestId, payload });
    this.metrics.framesTx += 1;
    this.send(wire);
  }

  async startHandshake(): Promise<void> {
    this.reset();
    this.state = 'handshaking';
    const requestId = this.requests.allocateId();
    const promise = this.requests.register(requestId);
    this.tx(NativeMessageType.Hello, 0, requestId, encodeHelloRequest({
      minVersion: 1,
      maxVersion: 1,
      hostCapabilities: 0,
    }));
    try {
      // HELLO + PARAM_DESC may arrive in the same send stack; state is applied in handleFrame.
      const frame = await promise;
      if (frame.messageType !== NativeMessageType.Hello) {
        throw new Error('expected HELLO response');
      }
      if ((this.state as NativeSessionState) === 'incompatible') {
        throw new Error('unsupported native version');
      }
    } catch (e) {
      this.syncTimeoutMetric();
      if (this.state === 'handshaking') this.state = 'idle';
      throw e;
    }
  }

  feed(bytes: Uint8Array): void {
    const frames = this.decoder.feed(bytes);
    this.metrics.framesRx += this.decoder.framesRx;
    this.syncTimeoutMetric();
    for (const f of frames) this.handleFrame(f);
  }

  private handleFrame(frame: NativeFrame): void {
    const isResponse = (frame.flags & NativeFrameFlags.Response) !== 0;
    // Apply HELLO side effects before resolving the request (descs may follow in-stack).
    if (frame.messageType === NativeMessageType.Hello && isResponse) {
      const hello = decodeHelloResponse(frame.payload);
      if (!hello) {
        this.metrics.decodeErrors += 1;
      } else if (hello.selectedVersion !== NATIVE_VERSION) {
        this.state = 'incompatible';
        this.expectedDescs = 0;
      } else {
        this.deviceName = hello.deviceName;
        this.firmwareVersion = hello.firmwareVersion;
        this.deviceCapabilities = hello.deviceCapabilities;
        this.expectedDescs = hello.parameterCount;
        if (hello.parameterCount === 0) {
          this.clearDiscoveryTimer();
          this.state = 'ready';
        } else {
          this.state = 'discovering';
          this.armDiscoveryTimeout();
        }
      }
    }
    if (isResponse && frame.requestId !== 0) {
      const consumed = this.requests.onResponse(frame);
      if (consumed) {
        this.afterResponseFrame(frame);
        return;
      }
    }
    const isUnsol = (frame.flags & NativeFrameFlags.Unsolicited) !== 0;
    if (frame.messageType === NativeMessageType.ParamDesc && isUnsol) {
      this.onParamDesc(frame.payload);
      return;
    }
    if (frame.messageType === NativeMessageType.ParamValue && isUnsol) {
      const v = decodeParamValueMsg(frame.payload);
      if (!v) {
        this.metrics.decodeErrors += 1;
        return;
      }
      // Unsolicited: frame.requestId===0; payload.parameterId must still be 1..65535.
      if (v.id === 0) {
        this.metrics.decodeErrors += 1;
        return;
      }
      this.store.applyValue(v.id, v.value);
      this.emit('value', v.id);
      return;
    }
  }

  private afterResponseFrame(frame: NativeFrame): void {
    if (frame.messageType === NativeMessageType.ParamValue) {
      const v = decodeParamValueMsg(frame.payload);
      if (!v || v.id === 0) {
        this.metrics.decodeErrors += 1;
        return;
      }
      this.store.applyValue(v.id, v.value);
      this.emit('value', v.id);
      return;
    }
    if (frame.messageType === NativeMessageType.ParamAck) {
      const v = decodeParamValueMsg(frame.payload);
      if (v) {
        this.store.applyAck(v.id, v.value, frame.requestId);
        this.emit('ack', v.id);
      }
      return;
    }
    if (frame.messageType === NativeMessageType.ParamNack) {
      const n = decodeParamNack(frame.payload);
      if (n) {
        this.metrics.nackCount += 1;
        this.store.applyNack(n.id, n.code, n.detail, frame.requestId);
        this.emit('nack', n.id);
      }
    }
  }

  private onParamDesc(payload: Uint8Array): void {
    const r = decodeParamDesc(payload);
    if (!r.ok) {
      this.metrics.decodeErrors += 1;
      return;
    }
    const applied = this.store.applyDescriptor(r.descriptor);
    if (!applied.ok) {
      this.metrics.decodeErrors += 1;
      return;
    }
    if (this.state === 'discovering' && this.store.count() >= this.expectedDescs) {
      this.clearDiscoveryTimer();
      this.discoveryError = null;
      this.state = 'ready';
      this.emit('state');
    } else {
      this.emit('descriptor', r.descriptor.id);
    }
  }

  async getParameterAsync(id: number): Promise<NativeParamValue | undefined> {
    const desc = this.store.getById(id)?.descriptor;
    if (!desc) throw new Error(`unknown parameter ${id}`);
    const requestId = this.requests.allocateId();
    const p = this.requests.register(requestId);
    this.tx(NativeMessageType.ParamGet, 0, requestId, encodeParamGet(id));
    await p;
    this.syncTimeoutMetric();
    return this.store.getById(id)?.confirmedValue;
  }

  async setParameter(id: number, value: NativeParamValue): Promise<NativeParamValue> {
    const st = this.store.getById(id);
    if (!st) throw new Error(`unknown parameter ${id}`);
    const d = st.descriptor;
    if (!d.writable) throw new Error(`parameter ${id} is read-only`);
    const valid = validateParamValue(d.type, value, { min: d.min, max: d.max });
    if (!valid.ok) throw new Error(valid.error);
    const requestId = this.requests.allocateId();
    this.store.markPending(id, requestId, value, Date.now());
    this.emit('pending', id);
    const p = this.requests.register(requestId);
    this.tx(NativeMessageType.ParamSet, 0, requestId, encodeParamValueMsg(id, d.type, value));
    let frame: NativeFrame;
    try {
      frame = await p;
    } catch (e) {
      this.store.clearPendingByRequest(requestId);
      const st2 = this.store.getById(id);
      if (st2) {
        st2.pending = undefined;
        if (/timeout/i.test((e as Error).message)) {
          st2.lastError = { code: 0, detail: 'timeout' };
        }
      }
      this.emit('nack', id);
      throw e;
    }
    this.syncTimeoutMetric();
    if (frame.messageType === NativeMessageType.ParamAck) {
      const v = decodeParamValueMsg(frame.payload);
      if (!v) throw new Error('malformed ACK');
      this.store.applyAck(id, v.value, requestId);
      this.emit('ack', id);
      return v.value;
    }
    if (frame.messageType === NativeMessageType.ParamNack) {
      const n = decodeParamNack(frame.payload);
      this.metrics.nackCount += 1;
      this.store.applyNack(id, n?.code ?? 0, n?.detail, requestId);
      this.emit('nack', id);
      throw new Error(n?.detail || `NACK ${n?.code}`);
    }
    this.store.clearPendingByRequest(requestId);
    this.emit('nack', id);
    throw new Error(`unexpected response type ${frame.messageType}`);
  }
}

export type { ParameterStore, NativeRequestManager };
