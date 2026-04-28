import type { StoredGraphNode } from "../storage/sqlite-storage.js";

export function formatCallees(params: {
  symbolName: string;
  caller: StoredGraphNode | null;
  callees: StoredGraphNode[];
}): string {
  const lines: string[] = [];

  if (!params.caller) {
    lines.push(`Caller symbol not found: ${params.symbolName}`);
    return lines.join("\n");
  }

  lines.push(`Callees of ${getQualifiedName(params.caller)}:`);
  lines.push("");

  if (params.callees.length === 0) {
    lines.push("No resolved callees found.");
    return lines.join("\n");
  }

  for (const callee of params.callees) {
    lines.push(`- ${getQualifiedName(callee)}`);
    lines.push(`  type: ${callee.type}`);

    if (callee.filePath) {
      const line = callee.startLine ? `:${callee.startLine}` : "";
      lines.push(`  file: ${callee.filePath}${line}`);
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
