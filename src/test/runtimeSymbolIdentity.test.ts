import { describe, expect, it } from 'vitest';
import {
  normalizeSourceScope,
  runtimeSymbolKey,
  scopeHash,
  swdChannelIdFromSymbol,
} from '../runtime/runtimeSymbolIdentity';
import {
  RuntimeSymbol,
  RuntimeSymbolService,
  DwarfSymbolRecord,
} from '../runtime/runtimeSymbolService';
import { firmwareIdentityFromBytes, swdChannelId } from '../swd/runtimeChannels';

const sha = firmwareIdentityFromBytes(Buffer.from('ELF-A')).sha256;

function sym(partial: Partial<RuntimeSymbol> & { expression: string; scope: string }): any {
  return {
    kind: partial.scope === 'global' ? 'global' : 'file-static',
    type: 'float32',
    byteSize: 4,
    address: 0x20001000,
    writable: true,
    resolution: { rootAddress: 0x20001000, byteOffset: 0 },
    firmware: { elfPath: 'a.elf', sha256: sha, idPrefix: sha.slice(0, 16) },
    ...partial,
    rootName: partial.expression.split('.')[0],
  };
}

describe('S14.2.1 RuntimeSymbol identity', () => {
  it('normalizeSourceScope uses basename and lowercases', () => {
    expect(normalizeSourceScope('D:/proj/motor.c')).toBe('motor.c');
    expect(normalizeSourceScope('D:\\proj\\IMU.C')).toBe('imu.c');
    expect(normalizeSourceScope(undefined)).toBe('global');
  });

  it('runtimeSymbolKey separates same expression in different CU', () => {
    const motor = runtimeSymbolKey(sym({ expression: 'state', scope: 'motor.c' }));
    const imu = runtimeSymbolKey(sym({ expression: 'state', scope: 'imu.c' }));
    expect(motor).not.toBe(imu);
    expect(motor).toBe(`${sha}::motor.c::state`);
    expect(imu).toBe(`${sha}::imu.c::state`);
  });

  it('swdChannelIdFromSymbol: global vs file-static distinct', () => {
    const g = swdChannelIdFromSymbol(sym({ expression: 'yaw', scope: 'global' }));
    const m = swdChannelIdFromSymbol(sym({ expression: 'state', scope: 'motor.c' }));
    const i = swdChannelIdFromSymbol(sym({ expression: 'state', scope: 'imu.c' }));
    expect(g).toBe(`swd.${sha.slice(0, 16)}.global.yaw`);
    expect(m.startsWith(`swd.${sha.slice(0, 16)}.`)).toBe(true);
    expect(m).not.toBe(i);
    expect(m).toContain(scopeHash('motor.c'));
    expect(i).toContain(scopeHash('imu.c'));
  });

  it('swdChannelId helper includes global scope segment', () => {
    expect(swdChannelId(sha, 'yaw')).toBe(`swd.${sha.slice(0, 16)}.global.yaw`);
    expect(swdChannelId(sha, 'state', 'motor.c')).not.toBe(swdChannelId(sha, 'state', 'imu.c'));
  });

  it('hover cache: motor.c state ≠ imu.c state under same ELF', () => {
    const symbols: DwarfSymbolRecord[] = [
      { path: 'state', address: 0x20001000, type: 'float32', size: 4, writable: true, sourceFile: 'motor.c' },
      { path: 'state', address: 0x20002000, type: 'float32', size: 4, writable: true, sourceFile: 'imu.c' },
      { path: 'yaw', address: 0x20003000, type: 'float32', size: 4, writable: true },
    ];
    const svc = new RuntimeSymbolService({ elfPath: 'a.elf', firmwareSha256: sha, symbols });

    const motor = svc.resolveExpression('state', 'D:/fw/motor.c');
    const imu = svc.resolveExpression('state', 'D:/fw/imu.c');
    expect(motor.ok).toBe(true);
    expect(imu.ok).toBe(true);
    if (!motor.ok || !imu.ok) return;
    expect(motor.symbol.address).toBe(0x20001000);
    expect(imu.symbol.address).toBe(0x20002000);
    expect(motor.symbol.scope).toBe('motor.c');
    expect(imu.symbol.scope).toBe('imu.c');
    expect(runtimeSymbolKey(motor.symbol)).not.toBe(runtimeSymbolKey(imu.symbol));

    const cache = new Map<string, number>([
      [runtimeSymbolKey(motor.symbol), 1],
      [runtimeSymbolKey(imu.symbol), 2],
    ]);
    expect(cache.get(runtimeSymbolKey(motor.symbol))).toBe(1);
    expect(cache.get(runtimeSymbolKey(imu.symbol))).toBe(2);
  });

  it('ambiguous when two file-static matches and no sourceFile hint', () => {
    const symbols: DwarfSymbolRecord[] = [
      { path: 'state', address: 1, type: 'float32', size: 4, writable: true, sourceFile: 'motor.c' },
      { path: 'state', address: 2, type: 'float32', size: 4, writable: true, sourceFile: 'imu.c' },
    ];
    const svc = new RuntimeSymbolService({ elfPath: 'a.elf', firmwareSha256: sha, symbols });
    expect(svc.resolveExpression('state')).toMatchObject({ reason: 'ambiguous-symbol' });
  });
});
