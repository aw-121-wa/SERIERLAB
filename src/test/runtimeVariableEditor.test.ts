import { describe, expect, it } from 'vitest';
import {
  RuntimeVariableEditor,
  validateRuntimeEditInput,
  PreparedRuntimeEdit,
} from '../runtime/runtimeVariableEditor';
import { RuntimeSymbol, RuntimeSymbolService } from '../runtime/runtimeSymbolService';
import { runtimeSymbolKey } from '../runtime/runtimeSymbolIdentity';
import { SessionClock } from '../time/sessionClock';
import { firmwareIdentityFromBytes } from '../swd/runtimeChannels';

const shaA = firmwareIdentityFromBytes(Buffer.from('ELF-A')).sha256;
const shaB = firmwareIdentityFromBytes(Buffer.from('ELF-B')).sha256;

function makeSymbol(sha: string, addr = 0x20003128): RuntimeSymbol {
  return {
    expression: 'yaw_pid.kp',
    rootName: 'yaw_pid',
    kind: 'global',
    scope: 'global',
    type: 'float32',
    byteSize: 4,
    address: addr,
    writable: true,
    firmware: { elfPath: 'a.elf', sha256: sha, idPrefix: sha.slice(0, 16) },
    resolution: { rootAddress: addr, byteOffset: 0 },
  };
}

function svcFor(sha: string, addr = 0x20003128) {
  return new RuntimeSymbolService({
    elfPath: 'a.elf',
    firmwareSha256: sha,
    symbols: [
      { path: 'yaw_pid.kp', address: addr, type: 'float32', size: 4, writable: true },
    ],
  });
}

describe('S14.3 RuntimeVariableEditor', () => {
  it('validate types and ranges', () => {
    expect(validateRuntimeEditInput('float32', '4.2')).toEqual({ ok: true, value: 4.2 });
    expect(validateRuntimeEditInput('float32', 'NaN').ok).toBe(false);
    expect(validateRuntimeEditInput('float32', 'Infinity').ok).toBe(false);
    expect(validateRuntimeEditInput('int32', '1.5').ok).toBe(false);
    expect(validateRuntimeEditInput('int32', '-2147483648')).toEqual({ ok: true, value: -2147483648 });
    expect(validateRuntimeEditInput('int32', '-2147483649').ok).toBe(false);
    expect(validateRuntimeEditInput('uint32', -1).ok).toBe(false);
    expect(validateRuntimeEditInput('uint32', '4294967295')).toEqual({ ok: true, value: 4294967295 });
    expect(validateRuntimeEditInput('bool', 'true')).toEqual({ ok: true, value: true });
  });

  it('commit succeeds with write + readback and emits event', async () => {
    const writes: unknown[] = [];
    const events: unknown[] = [];
    const svc = svcFor(shaA);
    const editor = new RuntimeVariableEditor({
      symbols: () => svc,
      clock: new SessionClock({ epochMs: 1000, monoNow: () => 0 }),
      readValue: async () => 3.5,
      writeValue: async (_s, v) => {
        writes.push(v);
        return { readback: Number(v) }; // simulate float32 quantize
      },
      emitEvent: (e) => events.push(e),
    });
    const sym = makeSymbol(shaA);
    const prepared = await editor.prepare(sym);
    expect(prepared.oldValue).toBe(3.5);
    const result = await editor.commit(prepared, 4.23, () => {
      const r = svc.resolveExpression('yaw_pid.kp');
      return r.ok ? r.symbol : undefined;
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.readback).toBeCloseTo(4.23, 5);
    expect(writes).toEqual([4.23]);
    const ev = result.event;
    expect(ev.success).toBe(true);
    expect(ev.firmwareSha256).toBe(shaA);
    expect(ev.runtimeKey).toBe(runtimeSymbolKey(sym));
  });

  it('TOCTOU: firmware change aborts write (0 backend writes)', async () => {
    let writes = 0;
    const events: any[] = [];
    const svcA = svcFor(shaA);
    const svcB = svcFor(shaB, 0x20004210);
    const editor = new RuntimeVariableEditor({
      symbols: () => svcA,
      clock: new SessionClock({ epochMs: 0, monoNow: () => 0 }),
      readValue: async () => 3.5,
      writeValue: async () => {
        writes++;
        return { readback: 0 };
      },
      emitEvent: (e) => events.push(e),
    });
    const prepared = await editor.prepare(makeSymbol(shaA));
    // Firmware switches while input box is open
    const result = await editor.commit(prepared, 4.2, () => {
      const r = svcB.resolveExpression('yaw_pid.kp');
      return r.ok ? r.symbol : undefined;
    });
    expect(result.success).toBe(false);
    expect(writes).toBe(0);
    expect(events[0].success).toBe(false);
    expect(result.success === false && result.error).toMatch(/固件已变更/);
  });

  it('TOCTOU: address change under same name also aborts', async () => {
    let writes = 0;
    const svcA = svcFor(shaA, 0x20001000);
    const svcSameSha = svcFor(shaA, 0x20002000);
    const editor = new RuntimeVariableEditor({
      symbols: () => svcA,
      clock: new SessionClock({ epochMs: 0, monoNow: () => 0 }),
      readValue: async () => 1,
      writeValue: async () => {
        writes++;
        return { readback: 1 };
      },
      emitEvent: () => {},
    });
    const prepared = await editor.prepare(makeSymbol(shaA, 0x20001000));
    const result = await editor.commit(prepared, 2, () => {
      const r = svcSameSha.resolveExpression('yaw_pid.kp');
      return r.ok ? r.symbol : undefined;
    });
    expect(result.success).toBe(false);
    expect(writes).toBe(0);
  });

  it('prepare rejects readonly / stale', async () => {
    const ro: RuntimeSymbol = {
      ...makeSymbol(shaA),
      writable: false,
      expression: 'flash_const',
      rootName: 'flash_const',
    };
    const editor = new RuntimeVariableEditor({
      symbols: () => svcFor(shaA),
      clock: new SessionClock({ epochMs: 0, monoNow: () => 0 }),
      readValue: async () => 1,
      writeValue: async () => ({ readback: 1 }),
      emitEvent: () => {},
    });
    await expect(editor.prepare(ro)).rejects.toThrow(/只读/);

    const stale = makeSymbol(shaB);
    await expect(editor.prepare(stale)).rejects.toThrow(/固件/);
  });
});
it('rejects whitespace-only numerical edits', () => {
  expect(validateRuntimeEditInput('float32', '   ').ok).toBe(false);
  expect(validateRuntimeEditInput('int32', '').ok).toBe(false);
});
