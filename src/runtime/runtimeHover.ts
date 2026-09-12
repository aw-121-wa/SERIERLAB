import { formatParamValue } from '../protocol/native/parameterView';

export type HoverCacheEntry = {
  value: number | boolean;
  updatedAtMs?: number;
};

export type HoverRuntimeSymbolRef = {
  expression: string;
  scope: string;
  firmware: { sha256: string };
};

export type HoverRuntimeSource = {
  /** Current firmware content SHA (empty = no SWD session). */
  firmwareSha256: string;
  /** Lookup by full RuntimeSymbol identity (firmware + scope + expression). */
  lookupValue(symbol: HoverRuntimeSymbolRef): HoverCacheEntry | undefined;
  isWatched(symbol: HoverRuntimeSymbolRef): boolean;
};

export function formatAddress32(addr: number): string {
  return '0x' + (addr >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

export function buildRuntimeHoverMarkdown(opts: {
  expression: string;
  type: 'float32' | 'int32' | 'uint32' | 'bool';
  address: number;
  writable: boolean;
  firmwarePrefix: string;
  value?: number | boolean;
  watching: boolean;
}): string {
  const lines: string[] = [];
  lines.push('**SERIERLAB Runtime**');
  lines.push('');
  lines.push('`' + opts.expression + '`');
  lines.push('');
  lines.push('| | |');
  lines.push('|-|-|');
  lines.push(`| Type | \`${opts.type}\` |`);
  if (opts.value !== undefined) {
    lines.push(`| Value | **${formatParamValue(opts.value, opts.type)}** |`);
  } else {
    lines.push('| Value | Not watched |');
  }
  lines.push(`| Address | \`${formatAddress32(opts.address)}\` |`);
  lines.push('| Source | `SWD` |');
  lines.push(`| Firmware | \`${opts.firmwarePrefix}\` |`);
  if (!opts.writable) {
    lines.push('| Access | Read only |');
  }
  if (opts.watching) {
    lines.push('');
    lines.push('_Watching_');
  }
  return lines.join('\n');
}
