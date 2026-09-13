import { describe, expect, it } from 'vitest';
import { RuntimeSymbolService, DwarfSymbolRecord } from '../runtime/runtimeSymbolService';
import { firmwareIdentityFromBytes } from '../swd/runtimeChannels';

const fwA = firmwareIdentityFromBytes(Buffer.from('ELF-A'));
const fwB = firmwareIdentityFromBytes(Buffer.from('ELF-B-rebuilt'));

const symbols: DwarfSymbolRecord[] = [
  { path: 'global_gain', address: 0x20001000, type: 'float32', size: 4, writable: true },
  { path: 'file_counter', address: 0x20001004, type: 'uint32', size: 4, writable: true, sourceFile: 'motor.c' },
  { path: 'controller', address: 0x20002000, type: 'int32', size: 4, writable: true },
  { path: 'controller.yaw.kp', address: 0x20002000, type: 'float32', size: 4, writable: true },
  { path: 'controller.yaw.ki', address: 0x20002004, type: 'float32', size: 4, writable: true },
  { path: 'motors', address: 0x20003000, type: 'uint32', size: 4, writable: true },
  { path: 'motors[0].speed', address: 0x20003000, type: 'float32', size: 4, writable: true },
  { path: 'motors[2].speed', address: 0x20003080, type: 'float32', size: 4, writable: true },
  { path: 'dup', address: 0x20004000, type: 'int32', size: 4, writable: true },
  { path: 'dup', address: 0x20004004, type: 'int32', size: 4, writable: true },
  { path: 'flash_const', address: 0x08001000, type: 'float32', size: 4, writable: false },
];

function svc(sha = fwA.sha256, list = symbols) {
  return new RuntimeSymbolService({
    elfPath: 'D:/fw/a.elf',
    firmwareSha256: sha,
    symbols: list,
    ram: { start: 0x20000000, end: 0x2000ffff },
  });
}

describe('RuntimeSymbolService', () => {
  it('offers full paths for a struct root or member declaration without guessing an instance', () => {
    expect(svc().candidateExpressions('kp')).toContain('controller.yaw.kp');
    expect(svc().candidateExpressions('controller')).toContain('controller.yaw.ki');
    expect(svc().candidateExpressions('ptr->kp')).toEqual([]);
  });
  it('resolves global float with firmware content identity', () => {
    const r = svc().resolveExpression('global_gain');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.symbol.address).toBe(0x20001000);
    expect(r.symbol.type).toBe('float32');
    expect(r.symbol.firmware.sha256).toBe(fwA.sha256);
    expect(r.symbol.firmware.idPrefix).toHaveLength(16);
    expect(r.symbol.writable).toBe(true);
  });

  it('resolves nested struct member at computed address', () => {
    const r = svc().resolveExpression('controller.yaw.kp');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.symbol.address).toBe(0x20002000);
    expect(r.symbol.resolution.rootAddress).toBe(0x20002000);
    expect(r.symbol.resolution.byteOffset).toBe(0);
    const ki = svc().resolveExpression('controller.yaw.ki');
    expect(ki.ok && ki.symbol.address).toBe(0x20002004);
    expect(ki.ok && ki.symbol.resolution.byteOffset).toBe(4);
  });

  it('resolves array literal index + member', () => {
    const r = svc().resolveExpression('motors[2].speed');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.symbol.address).toBe(0x20003080);
  });

  it('unknown root / member → symbol-not-found', () => {
    expect(svc().resolveExpression('missing')).toMatchObject({ reason: 'symbol-not-found' });
    expect(svc().resolveExpression('controller.nope')).toMatchObject({ reason: 'symbol-not-found' });
  });

  it('duplicate path → ambiguous-symbol', () => {
    expect(svc().resolveExpression('dup')).toMatchObject({ reason: 'ambiguous-symbol' });
  });

  it('non-RAM → not-in-ram', () => {
    expect(svc().resolveExpression('flash_const')).toMatchObject({ reason: 'not-in-ram' });
  });

  it('unsupported grammar → unsupported-expression', () => {
    expect(svc().resolveExpression('ptr->kp')).toMatchObject({ reason: 'unsupported-expression' });
    expect(svc().resolveExpression('motors[i]')).toMatchObject({ reason: 'unsupported-expression' });
  });

  it('isCurrent detects firmware content change (stale after rebuild)', () => {
    const a = svc(fwA.sha256);
    const r = a.resolveExpression('global_gain');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(a.isCurrent(r.symbol)).toBe(true);
    // Same service after ELF B: old symbol is stale
    const b = new RuntimeSymbolService({
      elfPath: 'D:/fw/a.elf',
      firmwareSha256: fwB.sha256,
      symbols,
      ram: { start: 0x20000000, end: 0x2000ffff },
    });
    expect(b.isCurrent(r.symbol)).toBe(false);
  });

  it('resolveAtSource uses cursor extraction', () => {
    const src = 'float e = controller.yaw.kp * err;';
    const off = src.indexOf('yaw');
    const r = svc().resolveAtSource(src, off);
    expect(r.ok && r.symbol.expression).toBe('controller.yaw.kp');
  });
});
