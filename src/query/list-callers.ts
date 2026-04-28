import type { StoredGraphNode } from "../storage/sqlite-storage.js";

export function formatCallers(params: {
  symbolName: string;
  target: StoredGraphNode | null;
  callers: StoredGraphNode[];
}): string {
  const lines: string[] = [];

  if (!params.target) {
    lines.push(`Target symbol not found: ${params.symbolName}`);
    return lines.join("\n");
  }

  lines.push(`Callers of ${getQualifiedName(params.target)}:`);
  lines.push("");

  if (params.callers.length === 0) {
    lines.push("No resolved callers found.");
    return lines.join("\n");
  }

  for (const caller of params.callers) {
    lines.push(`- ${getQualifiedName(caller)}`);
    lines.push(`  type: ${caller.type}`);

    if (caller.filePath) {
      const line = caller.startLine ? `:${caller.startLine}` : "";
      lines.push(`  file: ${caller.filePath}${line}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

function getQualifiedName(symbol: StoredGraphNode): string {
  const qualifiedName = symbol.metadata?.qualifiedName;

  if (typeof qualifiedName === "string" && qualifiedName.length > 0) {
    return qualifiedName;
  }

  return symbol.name;
}
