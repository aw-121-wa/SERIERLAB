import { expressionAtOffset, splitExpression } from './sourceExpression';
import { firmwareIdentityFromBytes, FirmwareIdentity } from '../swd/runtimeChannels';

export type RuntimeValueType = 'float32' | 'int32' | 'uint32' | 'bool';

export type RuntimeSymbolKind = 'global' | 'file-static';

/** Flattened DWARF record — same shape as scripts/swd_backend.py inspect(). */
export type DwarfSymbolRecord = {
  path: string;
  address: number;
  type: RuntimeValueType;
  size: number;
  writable: boolean;
  sourceFile?: string;
};

export type RuntimeSymbol = {
  expression: string;
  rootName: string;
  kind: RuntimeSymbolKind;
  type: RuntimeValueType;
  byteSize: number;
  address: number;
  writable: boolean;
  sourceFile?: string;
  firmware: {
    elfPath: string;
    sha256: string;
    idPrefix: string;
  };
  resolution: {
    rootAddress: number;
    byteOffset: number;
  };
};

export type RuntimeSymbolResolution =
  | { ok: true; symbol: RuntimeSymbol }
  | {
      ok: false;
      reason:
        | 'no-expression'
        | 'unsupported-expression'
        | 'symbol-not-found'
        | 'ambiguous-symbol'
        | 'unsupported-type'
        | 'not-fixed-address'
        | 'not-in-ram'
        | 'stale-firmware';
      detail?: string;
    };

export type RuntimeSymbolServiceOptions = {
  elfPath: string;
  /** Full SHA-256 of ELF bytes (FirmwareIdentity.sha256). */
  firmwareSha256: string;
  /** Flattened symbols from SWD inspect (path → address/type/size). */
  symbols: DwarfSymbolRecord[];
  /** Target RAM range for write-safety classification. */
  ram?: { start: number; end: number };
};

/**
 * Single source of truth: source expression → fixed RAM symbol metadata.
 * Reuses flattened DWARF from swd_backend inspect — no second DWARF parser.
 */
export class RuntimeSymbolService {
  private readonly firmware: FirmwareIdentity;
  private readonly byPath = new Map<string, DwarfSymbolRecord[]>();

  constructor(private readonly opts: RuntimeSymbolServiceOptions) {
    this.firmware = {
      sha256: opts.firmwareSha256,
      idPrefix: opts.firmwareSha256.slice(0, 16),
    };
    for (const s of opts.symbols) {
      const list = this.byPath.get(s.path) ?? [];
      list.push(s);
      this.byPath.set(s.path, list);
    }
  }

  get identity(): FirmwareIdentity {
    return this.firmware;
  }

  isCurrent(symbol: RuntimeSymbol): boolean {
    return !!this.opts.firmwareSha256 && symbol.firmware.sha256 === this.opts.firmwareSha256;
  }

  resolveExpression(expression: string, sourceFile?: string): RuntimeSymbolResolution {
    const text = expression.trim();
    if (!text) return { ok: false, reason: 'no-expression' };
    if (!splitExpression(text)) {
      return { ok: false, reason: 'unsupported-expression', detail: text };
    }
    const matches = this.byPath.get(text) ?? [];
    if (matches.length === 0) return { ok: false, reason: 'symbol-not-found', detail: text };
    if (matches.length > 1) {
      // Prefer unique; without sourceFile metadata, duplicates are ambiguous.
      return { ok: false, reason: 'ambiguous-symbol', detail: `${matches.length} matches for ${text}` };
    }
    const rec = matches[0]!;
    if (rec.type !== 'float32' && rec.type !== 'int32' && rec.type !== 'uint32' && rec.type !== 'bool') {
      return { ok: false, reason: 'unsupported-type', detail: String(rec.type) };
    }
    // Backend only emits DW_OP_addr globals already in writable storage.
    if (!rec.writable) {
      return { ok: false, reason: 'not-in-ram', detail: text };
    }
    if (this.opts.ram) {
      const end = rec.address + rec.size - 1;
      if (rec.address < this.opts.ram.start || end > this.opts.ram.end) {
        return { ok: false, reason: 'not-in-ram', detail: text };
      }
    }
    const root = text.split(/[.[]/)[0]!;
    const rootRec = (this.byPath.get(root) ?? [])[0];
    const rootAddress = rootRec?.address ?? rec.address;
    return {
      ok: true,
      symbol: {
        expression: text,
        rootName: root,
        kind: 'global',
        type: rec.type,
        byteSize: rec.size,
        address: rec.address,
        writable: rec.writable,
        sourceFile: rec.sourceFile ?? sourceFile,
        firmware: {
          elfPath: this.opts.elfPath,
          sha256: this.firmware.sha256,
          idPrefix: this.firmware.idPrefix,
        },
        resolution: {
          rootAddress,
          byteOffset: rec.address - rootAddress,
        },
      },
    };
  }

  resolveAtSource(sourceText: string, offset: number, sourceFile?: string): RuntimeSymbolResolution {
    const expr = expressionAtOffset(sourceText, offset);
    if (!expr) return { ok: false, reason: 'no-expression' };
    return this.resolveExpression(expr.text, sourceFile);
  }
}
