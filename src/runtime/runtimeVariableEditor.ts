import { SessionClock } from '../time/sessionClock';
import { RuntimeSymbol, RuntimeSymbolService } from './runtimeSymbolService';
import { runtimeSymbolKey } from './runtimeSymbolIdentity';

export type PreparedRuntimeEdit = {
  runtimeKey: string;
  expression: string;
  sourceFile?: string;
  firmwareSha256: string;
  address: number;
  type: RuntimeSymbol['type'];
  oldValue?: number | boolean;
};

export type VariableWriteEventFull = {
  type: 'variable-write';
  tMs: number;
  source: 'swd';
  runtimeKey: string;
  expression: string;
  scope?: string;
  sourceFile?: string;
  firmwareSha256: string;
  address: number;
  valueType: RuntimeSymbol['type'];
  oldValue?: number | boolean;
  requestedValue: number | boolean;
  readbackValue?: number | boolean;
  success: boolean;
  error?: string;
};

export type RuntimeEditorDeps = {
  /** Current symbol service (undefined if SWD/ELF not ready). */
  symbols: () => RuntimeSymbolService | undefined;
  clock: SessionClock;
  /** Ensure watch + return cached/confirmed value (may refresh). */
  readValue: (symbol: RuntimeSymbol) => Promise<number | boolean | undefined>;
  /** Serialized SWD write + read-back. */
  writeValue: (
    symbol: RuntimeSymbol,
    value: number | boolean
  ) => Promise<{ readback: number | boolean }>;
  emitEvent: (e: VariableWriteEventFull) => void;
};

export function validateRuntimeEditInput(
  type: RuntimeSymbol['type'],
  raw: string | number | boolean
): { ok: true; value: number | boolean } | { ok: false; error: string } {
  if (type === 'bool') {
    if (typeof raw === 'boolean') return { ok: true, value: raw };
    const s = String(raw).toLowerCase();
    if (s === 'true' || s === '1') return { ok: true, value: true };
    if (s === 'false' || s === '0') return { ok: true, value: false };
    return { ok: false, error: 'bool 必须为 true/false' };
  }
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return { ok: false, error: '需要有限数值' };
  if (type === 'int32') {
    if (!Number.isInteger(n)) return { ok: false, error: 'int32 需要整数' };
    if (n < -2147483648 || n > 2147483647) return { ok: false, error: 'int32 超出范围' };
    return { ok: true, value: n };
  }
  if (type === 'uint32') {
    if (!Number.isInteger(n)) return { ok: false, error: 'uint32 需要整数' };
    if (n < 0 || n > 4294967295) return { ok: false, error: 'uint32 超出范围' };
    return { ok: true, value: n };
  }
  // float32
  return { ok: true, value: n };
}

/**
 * Safe source-variable edit transaction.
 * prepare → user input → commit (re-resolves firmware identity).
 */
export class RuntimeVariableEditor {
  constructor(private readonly deps: RuntimeEditorDeps) {}

  async prepare(symbol: RuntimeSymbol): Promise<PreparedRuntimeEdit> {
    const svc = this.deps.symbols();
    if (!svc) throw new Error('请先连接 CMSIS-DAP 并加载匹配 ELF');
    if (!svc.isCurrent(symbol)) throw new Error('固件已变更，请重新解析变量');
    if (!symbol.writable) throw new Error('只读变量');
    const oldValue = await this.deps.readValue(symbol);
    return {
      runtimeKey: runtimeSymbolKey(symbol),
      expression: symbol.expression,
      sourceFile: symbol.sourceFile,
      firmwareSha256: symbol.firmware.sha256,
      address: symbol.address,
      type: symbol.type,
      oldValue,
    };
  }

  /**
   * Re-resolves the same expression and aborts if firmware/key/address changed (TOCTOU).
   */
  async commit(
    prepared: PreparedRuntimeEdit,
    requestedValue: number | boolean,
    reResolve: () => RuntimeSymbol | undefined
  ): Promise<{ success: true; readback: number | boolean; event: VariableWriteEventFull } | { success: false; error: string; event: VariableWriteEventFull }> {
    const tMs = this.deps.clock.now();
    const fail = (error: string): { success: false; error: string; event: VariableWriteEventFull } => {
      const event: VariableWriteEventFull = {
        type: 'variable-write',
        tMs,
        source: 'swd',
        runtimeKey: prepared.runtimeKey,
        expression: prepared.expression,
        sourceFile: prepared.sourceFile,
        firmwareSha256: prepared.firmwareSha256,
        address: prepared.address,
        valueType: prepared.type,
        oldValue: prepared.oldValue,
        requestedValue,
        success: false,
        error,
      };
      this.deps.emitEvent(event);
      return { success: false, error, event };
    };

    const fresh = reResolve();
    if (!fresh) return fail('固件已变更；请重新解析变量后再写入');
    if (fresh.firmware.sha256 !== prepared.firmwareSha256) {
      return fail('固件已变更；请重新解析变量后再写入');
    }
    const freshKey = runtimeSymbolKey(fresh);
    if (freshKey !== prepared.runtimeKey) {
      return fail('符号身份已变更；请重新解析变量后再写入');
    }
    if (fresh.address !== prepared.address) {
      return fail('解析地址已变更；请重新解析变量后再写入');
    }
    const svc = this.deps.symbols();
    if (!svc || !svc.isCurrent(fresh)) {
      return fail('固件已变更；请重新解析变量后再写入');
    }

    try {
      const { readback } = await this.deps.writeValue(fresh, requestedValue);
      const event: VariableWriteEventFull = {
        type: 'variable-write',
        tMs,
        source: 'swd',
        runtimeKey: freshKey,
        expression: fresh.expression,
        scope: fresh.scope,
        firmwareSha256: fresh.firmware.sha256,
        address: fresh.address,
        valueType: fresh.type,
        oldValue: prepared.oldValue,
        requestedValue,
        readbackValue: readback,
        success: true,
      };
      this.deps.emitEvent(event);
      return { success: true, readback, event };
    } catch (e) {
      return fail((e as Error).message);
    }
  }
}
