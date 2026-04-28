import type { StoredGraphNode } from "../storage/sqlite-storage.js";

export function formatSymbolDetail(params: {
  query: string;
  symbols: StoredGraphNode[];
}): string {
  const { query, symbols } = params;

  if (symbols.length === 0) {
    return `No symbol found for: ${query}`;
  }

  if (symbols.length === 1) {
    return formatSingleSymbol(symbols[0]!);
  }

  const lines: string[] = [];

  lines.push(`Found ${symbols.length} symbols matching "${query}":`);
  lines.push("");

  symbols.forEach((symbol, index) => {
    lines.push(`${index + 1}. ${getQualifiedName(symbol)}`);
    lines.push(`   type: ${symbol.type}`);

    if (symbol.filePath) {
      lines.push(`   file: ${formatFileLocation(symbol)}`);
    }

    lines.push("");
  });

  return lines.join("\n");
}

function formatSingleSymbol(symbol: StoredGraphNode): string {
  const lines: string[] = [];

  lines.push(`Symbol: ${getQualifiedName(symbol)}`);
  lines.push("");
  lines.push(`type: ${symbol.type}`);

  if (symbol.filePath) {
    lines.push(`file: ${formatFileLocation(symbol)}`);
  }

  const parentName = symbol.metadata?.parentName;
  if (typeof parentName === "string" && parentName.length > 0) {
    lines.push(`parent: ${parentName}`);
  }

  const qualifiedName = symbol.metadata?.qualifiedName;
  if (typeof qualifiedName === "string" && qualifiedName.length > 0) {
    lines.push(`qualifiedName: ${qualifiedName}`);
  }

  const decorators = symbol.metadata?.decorators;
  if (Array.isArray(decorators) && decorators.length > 0) {
    lines.push(`decorators: ${decorators.join(", ")}`);
  }

  const nestjs = symbol.metadata?.nestjs;
  if (isRecord(nestjs)) {
    const kind = nestjs.kind;
    if (typeof kind === "string") {
      lines.push(`nestjs.kind: ${kind}`);
    }

    const route = nestjs.route;
    if (typeof route === "string") {
      const method = typeof nestjs.method === "string" ? nestjs.method : "";
      lines.push(`nestjs.route: ${method} ${route}`.trim());
    }

    const path = nestjs.path;
    if (typeof path === "string" && typeof route !== "string") {
      lines.push(`nestjs.path: ${path}`);
    }
  }

  lines.push(`id: ${symbol.id}`);

  return lines.join("\n");
}

function getQualifiedName(symbol: StoredGraphNode): string {
  const value = symbol.metadata?.qualifiedName;

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return symbol.name;
}

function formatFileLocation(symbol: StoredGraphNode): string {
  const filePath = symbol.filePath ?? symbol.name;

  if (
    symbol.startLine &&
    symbol.endLine &&
    symbol.startLine !== symbol.endLine
  ) {
    return `${filePath}:${symbol.startLine}-${symbol.endLine}`;
  }

  if (symbol.startLine) {
    return `${filePath}:${symbol.startLine}`;
  }

  return filePath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
