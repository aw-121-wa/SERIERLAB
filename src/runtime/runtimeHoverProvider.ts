import * as vscode from 'vscode';
import { RuntimeSymbolService } from './runtimeSymbolService';
import { HoverRuntimeSource, buildRuntimeHoverMarkdown } from './runtimeHover';

/**
 * Read-only Hover. Never starts pyOCD, never polls, never writes.
 * Values come from existing SWD watch cache only.
 */
export class RuntimeHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly symbols: () => RuntimeSymbolService | undefined,
    private readonly runtime: HoverRuntimeSource
  ) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Hover> {
    const service = this.symbols();
    if (!service) return undefined;

    const offset = document.offsetAt(position);
    const resolution = service.resolveAtSource(document.getText(), offset, document.uri.fsPath);
    if (!resolution.ok) return undefined;

    const symbol = resolution.symbol;
    if (!service.isCurrent(symbol)) return undefined;

    const watched = this.runtime.isWatched(symbol);
    const cached = watched ? this.runtime.lookupValue(symbol) : undefined;

    const md = buildRuntimeHoverMarkdown({
      expression: symbol.expression,
      type: symbol.type,
      address: symbol.address,
      writable: symbol.writable,
      firmwarePrefix: symbol.firmware.idPrefix,
      value: cached?.value,
      watching: watched,
    });

    const span = symbol.sourceSpan;
    const range = span
      ? new vscode.Range(
          document.positionAt(span.startOffset),
          document.positionAt(span.endOffset)
        )
      : new vscode.Range(position, position);

    return new vscode.Hover(new vscode.MarkdownString(md), range);
  }
}
