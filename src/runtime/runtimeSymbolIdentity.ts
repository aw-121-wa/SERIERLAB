import { createHash } from 'crypto';
import { RuntimeSymbol } from './runtimeSymbolService';

export type RuntimeSymbolKeyParts = {
  /** Full 64-hex ELF content SHA. */
  firmwareSha256: string;
  /** 'global' or normalized compile-unit / source file. */
  scope: string;
  expression: string;
};

/**
 * Canonical compile-unit / source scope.
 * Uses the full path (not basename) so App/motor.c ≠ Drivers/motor.c.
 * POSIX-style separators; Windows drive lowercased; `.` / `..` collapsed.
 * Case is preserved (do not assume case-insensitive filesystems).
 */
export function normalizeSourceScope(sourceFile: string | undefined): string {
  if (!sourceFile) return 'global';
  let p = sourceFile.replace(/\\/g, '/');
  p = p.replace(/^([A-Za-z]):/, (_m, d: string) => d.toLowerCase() + ':');
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..' && !parts[parts.length - 1]!.includes(':')) {
        parts.pop();
      } else {
        parts.push('..');
      }
      continue;
    }
    parts.push(seg);
  }
  return parts.join('/');
}

/** True if two scope paths refer to the same CU (absolute vs relative, etc.). */
export function scopePathsMatch(a: string | undefined, b: string | undefined): boolean {
  const na = normalizeSourceScope(a);
  const nb = normalizeSourceScope(b);
  if (na === 'global' || nb === 'global') return na === nb;
  if (na === nb) return true;
  return na.endsWith('/' + nb) || nb.endsWith('/' + na);
}

/** Short stable hash of compile-unit scope for channel ids. */
export function scopeHash(scope: string): string {
  return createHash('sha256').update(scope).digest('hex').slice(0, 8);
}

/**
 * Canonical string key for runtime identity.
 * Format: `<fullElfSha>::<scope>::<expression>`
 */
export function runtimeSymbolKey(symbol: RuntimeSymbol): string;
export function runtimeSymbolKey(parts: RuntimeSymbolKeyParts): string;
export function runtimeSymbolKey(arg: RuntimeSymbol | RuntimeSymbolKeyParts): string {
  const parts: RuntimeSymbolKeyParts =
    'firmwareSha256' in arg && 'scope' in arg && 'expression' in arg
      ? (arg as RuntimeSymbolKeyParts)
      : {
          firmwareSha256: (arg as RuntimeSymbol).firmware.sha256,
          scope: (arg as RuntimeSymbol).scope || 'global',
          expression: (arg as RuntimeSymbol).expression,
        };
  return `${parts.firmwareSha256}::${parts.scope}::${parts.expression}`;
}

/**
 * SWD plot/watch channel id from runtime identity.
 * global:     swd.<elfPrefix>.global.<expression>
 * file-static: swd.<elfPrefix>.<scopeHash8>.<expression>
 */
export function swdChannelIdFromSymbol(symbol: RuntimeSymbol): string;
export function swdChannelIdFromSymbol(parts: RuntimeSymbolKeyParts & { elfPrefix?: string }): string;
export function swdChannelIdFromSymbol(
  arg: RuntimeSymbol | (RuntimeSymbolKeyParts & { elfPrefix?: string })
): string {
  const parts: RuntimeSymbolKeyParts =
    'firmwareSha256' in arg && 'scope' in arg && 'expression' in arg && !('firmware' in arg)
      ? (arg as RuntimeSymbolKeyParts)
      : {
          firmwareSha256: (arg as RuntimeSymbol).firmware.sha256,
          scope: (arg as RuntimeSymbol).scope || 'global',
          expression: (arg as RuntimeSymbol).expression,
        };
  const elfPrefix = parts.firmwareSha256.slice(0, 16);
  const scopePart = parts.scope === 'global' ? 'global' : scopeHash(parts.scope);
  return `swd.${elfPrefix}.${scopePart}.${parts.expression}`;
}
