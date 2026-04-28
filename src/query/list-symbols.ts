import type { StoredGraphNode } from "../storage/sqlite-storage.js";

const SYMBOL_TYPES = ["class", "function", "method", "interface", "type"];

export function getSymbolNodeTypes(): string[] {
  return SYMBOL_TYPES;
}

export function formatSymbols(symbols: StoredGraphNode[]): string {
  if (symbols.length === 0) {
    return "No symbols found. Run `kg index` first.";
  }

  const lines: string[] = [];

  lines.push("Symbols:");
  lines.push("");

  for (const symbol of symbols) {
    const qualifiedName = getQualifiedName(symbol);

    lines.push(`- ${qualifiedName}`);
    lines.push(`  type: ${symbol.type}`);

    if (symbol.filePath) {
      const line = symbol.startLine ? `:${symbol.startLine}` : "";
      lines.push(`  file: ${symbol.filePath}${line}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

function getQualifiedName(symbol: StoredGraphNode): string {
  const value = symbol.metadata?.qualifiedName;

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return symbol.name;
}
