import { describe, expect, it } from 'vitest';
import { buildRuntimeHoverMarkdown, formatAddress32 } from '../runtime/runtimeHover';
import { RuntimeSymbolService } from '../runtime/runtimeSymbolService';
import { firmwareIdentityFromBytes } from '../swd/runtimeChannels';

const sha = firmwareIdentityFromBytes(Buffer.from('fw')).sha256;

function svc() {
  return new RuntimeSymbolService({
    elfPath: 'fw.elf',
    firmwareSha256: sha,
    symbols: [
      { path: 'yaw_pid.kp', address: 0x20003128, type: 'float32', size: 4, writable: true },
      { path: 'motor.actual_speed', address: 0x20004000, type: 'float32', size: 4, writable: true },
    ],
  });
}

describe('S14.2 runtime hover', () => {
  it('formats address as 32-bit hex', () => {
    expect(formatAddress32(0x20003128)).toBe('0x20003128');
    expect(formatAddress32(0x20000000)).toBe('0x20000000');
  });

  it('markdown includes type/value/address/firmware; Not watched when no cache', () => {
    const md = buildRuntimeHoverMarkdown({
      expression: 'yaw_pid.kp',
      type: 'float32',
      address: 0x20003128,
      writable: true,
      firmwarePrefix: sha.slice(0, 16),
      watching: false,
    });
    expect(md).toContain('SERIERLAB Runtime');
    expect(md).toContain('yaw_pid.kp');
    expect(md).toContain('float32');
    expect(md).toContain('0x20003128');
    expect(md).toContain(sha.slice(0, 16));
    expect(md).toContain('Not watched');
  });

  it('markdown shows live cache value when watching', () => {
    const md = buildRuntimeHoverMarkdown({
      expression: 'yaw_pid.kp',
      type: 'float32',
      address: 0x20003128,
      writable: true,
      firmwarePrefix: sha.slice(0, 16),
      value: 3.5,
      watching: true,
    });
    expect(md).toContain('3.5');
    expect(md).toContain('Watching');
  });

  it('resolveAtSource binds current firmware; isCurrent fails after ELF change', () => {
    const a = svc();
    const src = 'float e = yaw_pid.kp * err;';
    const r = a.resolveAtSource(src, src.indexOf('yaw'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(a.isCurrent(r.symbol)).toBe(true);
    const b = new RuntimeSymbolService({
      elfPath: 'fw.elf',
      firmwareSha256: firmwareIdentityFromBytes(Buffer.from('fw2')).sha256,
      symbols: [],
    });
    expect(b.isCurrent(r.symbol)).toBe(false);
  });

  it('hover cache key is expression under same firmware (not path alone across ELFs)', () => {
    const s1 = svc();
    const s2 = new RuntimeSymbolService({
      elfPath: 'fw.elf',
      firmwareSha256: firmwareIdentityFromBytes(Buffer.from('other')).sha256,
      symbols: [{ path: 'yaw_pid.kp', address: 0x20009999, type: 'float32', size: 4, writable: true }],
    });
    const r1 = s1.resolveExpression('yaw_pid.kp');
    expect(r1.ok && r1.symbol.address).toBe(0x20003128);
    const r2 = s2.resolveExpression('yaw_pid.kp');
    expect(r2.ok && r2.symbol.address).toBe(0x20009999);
    expect(r1.ok && r2.ok && r1.symbol.firmware.sha256 !== r2.symbol.firmware.sha256).toBe(true);
  });
});
