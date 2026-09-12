import { NativeParamType, NativeParamValue, ParameterDescriptor } from './types';

export type ParameterRuntimeState = {
  descriptor: ParameterDescriptor;
  confirmedValue?: NativeParamValue;
  pending?: {
    requestId: number;
    requestedValue: NativeParamValue;
    sentAtMs: number;
  };
  lastError?: { code: number; detail?: string };
};

export type ParameterStoreResult = { ok: true } | { ok: false; error: string };

export class ParameterStore {
  private byId = new Map<number, ParameterRuntimeState>();
  private byPath = new Map<string, number>();

  clear(): void {
    this.byId.clear();
    this.byPath.clear();
  }

  list(): ParameterRuntimeState[] {
    return [...this.byId.values()];
  }

  getById(id: number): ParameterRuntimeState | undefined {
    return this.byId.get(id);
  }

  getByPath(path: string): ParameterRuntimeState | undefined {
    const id = this.byPath.get(path);
    return id === undefined ? undefined : this.byId.get(id);
  }

  count(): number {
    return this.byId.size;
  }

  applyDescriptor(d: ParameterDescriptor): ParameterStoreResult {
    if (!Number.isInteger(d.id) || d.id < 1 || d.id > 65535) {
      return { ok: false, error: `invalid id ${d.id}` };
    }
    if (!d.path || !d.path.length) return { ok: false, error: 'empty path' };
    const existingId = this.byId.get(d.id);
    const pathOwner = this.byPath.get(d.path);
    if (pathOwner !== undefined && pathOwner !== d.id) {
      return { ok: false, error: `duplicate path ${d.path}` };
    }
    if (existingId && existingId.descriptor.path !== d.path) {
      this.byPath.delete(existingId.descriptor.path);
    }
    const prev = this.byId.get(d.id);
    this.byId.set(d.id, {
      descriptor: d,
      confirmedValue: prev?.confirmedValue,
      pending: prev?.pending,
      lastError: prev?.lastError,
    });
    this.byPath.set(d.path, d.id);
    return { ok: true };
  }

  markPending(id: number, requestId: number, value: NativeParamValue, sentAtMs: number): ParameterStoreResult {
    const s = this.byId.get(id);
    if (!s) return { ok: false, error: 'unknown parameter' };
    s.pending = { requestId, requestedValue: value, sentAtMs };
    s.lastError = undefined;
    return { ok: true };
  }

  applyValue(id: number, value: NativeParamValue): ParameterStoreResult {
    const s = this.byId.get(id);
    if (!s) return { ok: false, error: 'unknown parameter' };
    s.confirmedValue = value;
    s.pending = undefined;
    s.lastError = undefined;
    return { ok: true };
  }

  applyAck(id: number, applied: NativeParamValue, requestId: number): ParameterStoreResult {
    const s = this.byId.get(id);
    if (!s) return { ok: false, error: 'unknown parameter' };
    if (s.pending && s.pending.requestId !== requestId) {
      return { ok: false, error: 'ack requestId mismatch' };
    }
    s.confirmedValue = applied;
    s.pending = undefined;
    s.lastError = undefined;
    return { ok: true };
  }

  applyNack(id: number, code: number, detail: string | undefined, requestId: number): ParameterStoreResult {
    const s = this.byId.get(id);
    if (!s) return { ok: false, error: 'unknown parameter' };
    if (s.pending && s.pending.requestId !== requestId) {
      return { ok: false, error: 'nack requestId mismatch' };
    }
    s.pending = undefined;
    s.lastError = { code, detail };
    return { ok: true };
  }

  clearPendingByRequest(requestId: number): void {
    for (const s of this.byId.values()) {
      if (s.pending?.requestId === requestId) s.pending = undefined;
    }
  }
}

export function typeMatches(descType: NativeParamType, valueType: NativeParamType): boolean {
  return descType === valueType;
}
