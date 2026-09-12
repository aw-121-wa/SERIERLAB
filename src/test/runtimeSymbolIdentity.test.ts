import { describe, expect, it } from 'vitest';
import {
  normalizeSourceScope,
  runtimeSymbolKey,
  scopeHash,
  scopePathsMatch,
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

describe('S14.2.1/2 RuntimeSymbol identity', () => {
  it('normalizeSourceScope keeps full relative path (not basename)', () => {
    expect(normalizeSourceScope('App/motor.c')).toBe('App/motor.c');
    expect(normalizeSourceScope('Drivers/motor.c')).toBe('Drivers/motor.c');
    expect(normalizeSourceScope('D:\\repo\\App\\motor.c')).toBe('d:/repo/App/motor.c');
    expect(normalizeSourceScope('./App/./motor.c')).toBe('App/motor.c');
    expect(normalizeSourceScope('repo/App/../App/motor.c')).toBe('repo/App/motor.c');
    expect(normalizeSourceScope(undefined)).toBe('global');
  });

  it('App/motor.c and Drivers/motor.c never collide', () => {
    const kApp = runtimeSymbolKey(sym({ expression: 'state', scope: 'App/motor.c' }));
    const kDrv = runtimeSymbolKey(sym({ expression: 'state', scope: 'Drivers/motor.c' }));
    expect(kApp).not.toBe(kDrv);
    expect(swdChannelIdFromSymbol(sym({ expression: 'state', scope: 'App/motor.c' }))).not.toBe(
      swdChannelIdFromSymbol(sym({ expression: 'state', scope: 'Drivers/motor.c' }))
    );
  });

  it('scopePathsMatch handles absolute vs relative CU path', () => {
    expect(scopePathsMatch('D:/repo/App/motor.c', 'App/motor.c')).toBe(true);
    expect(scopePathsMatch('App/motor.c', 'Drivers/motor.c')).toBe(false);
    expect(scopePathsMatch('global', 'App/motor.c')).toBe(false);
  });

  it('runtimeSymbolKey separates same expression in different CU', () => {
    const motor = runtimeSymbolKey(sym({ expression: 'state', scope: 'App/motor.c' }));
    const imu = runtimeSymbolKey(sym({ expression: 'state', scope: 'App/imu.c' }));
    expect(motor).not.toBe(imu);
    expect(motor).toBe(`${sha}::App/motor.c::state`);
  });

  it('swdChannelIdFromSymbol: global vs file-static distinct', () => {
    const g = swdChannelIdFromSymbol(sym({ expression: 'yaw', scope: 'global' }));
    const m = swdChannelIdFromSymbol(sym({ expression: 'state', scope: 'App/motor.c' }));
    const d = swdChannelIdFromSymbol(sym({ expression: 'state', scope: 'Drivers/motor.c' }));
    expect(g).toBe(`swd.${sha.slice(0, 16)}.global.yaw`);
    expect(m).not.toBe(d);
    expect(m).toContain(scopeHash('App/motor.c'));
    expect(d).toContain(scopeHash('Drivers/motor.c'));
  });

  it('swdChannelId helper includes global scope segment', () => {
    expect(swdChannelId(sha, 'yaw')).toBe(`swd.${sha.slice(0, 16)}.global.yaw`);
    expect(swdChannelId(sha, 'state', 'App/motor.c')).not.toBe(
      swdChannelId(sha, 'state', 'Drivers/motor.c')
    );
  });

  it('hover cache: App/motor.c state ≠ Drivers/motor.c state', () => {
    const symbols: DwarfSymbolRecord[] = [
      { path: 'state', address: 0x20001000, type: 'float32', size: 4, writable: true, sourceFile: 'App/motor.c' },
      { path: 'state', address: 0x20002000, type: 'float32', size: 4, writable: true, sourceFile: 'Drivers/motor.c' },
      { path: 'yaw', address: 0x20003000, type: 'float32', size: 4, writable: true },
    ];
    const svc = new RuntimeSymbolService({ elfPath: 'a.elf', firmwareSha256: sha, symbols });

    const app = svc.resolveExpression('state', 'D:/proj/App/motor.c');
    const drv = svc.resolveExpression('state', 'D:/proj/Drivers/motor.c');
    expect(app.ok).toBe(true);
    expect(drv.ok).toBe(true);
    if (!app.ok || !drv.ok) return;
    expect(app.symbol.address).toBe(0x20001000);
    expect(drv.symbol.address).toBe(0x20002000);
    expect(app.symbol.scope).toBe('App/motor.c');
    expect(drv.symbol.scope).toBe('Drivers/motor.c');
    expect(runtimeSymbolKey(app.symbol)).not.toBe(runtimeSymbolKey(drv.symbol));

    const cache = new Map<string, number>([
      [runtimeSymbolKey(app.symbol), 1],
      [runtimeSymbolKey(drv.symbol), 2],
    ]);
    expect(cache.get(runtimeSymbolKey(app.symbol))).toBe(1);
    expect(cache.get(runtimeSymbolKey(drv.symbol))).toBe(2);
  });

  it('ambiguous when two file-static matches and no sourceFile hint', () => {
    const symbols: DwarfSymbolRecord[] = [
      { path: 'state', address: 1, type: 'float32', size: 4, writable: true, sourceFile: 'App/motor.c' },
      { path: 'state', address: 2, type: 'float32', size: 4, writable: true, sourceFile: 'Drivers/motor.c' },
    ];
    const svc = new RuntimeSymbolService({ elfPath: 'a.elf', firmwareSha256: sha, symbols });
    expect(svc.resolveExpression('state')).toMatchObject({ reason: 'ambiguous-symbol' });
  });
});
