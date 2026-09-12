import { createHash } from 'crypto';
import { RuntimeSymbol } from './runtimeSymbolService';

export type RuntimeSymbolKeyParts = {
  /** Full 64-hex ELF content SHA. */
  firmwareSha256: string;
  /** 'global' or normalized compile-unit / source file. */
  scope: string;
  expression: string;
};

/** Normalize source path for identity (basename-ish, forward slashes, lowercased). */
export function normalizeSourceScope(sourceFile: string | undefined): string {
  if (!sourceFile) return 'global';
  const norm = sourceFile.replace(/\\/g, '/');
  const base = norm.split('/').filter(Boolean).pop() ?? norm;
  return base.toLowerCase();
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
