import type { StoredGraphNode } from "../storage/sqlite-storage.js";

export function formatImports(params: {
  sourceFilePath: string;
  imports: StoredGraphNode[];
}): string {
  const lines: string[] = [];

  lines.push(`Imports of ${params.sourceFilePath}:`);
  lines.push("");

  if (params.imports.length === 0) {
    lines.push("No imports found.");
    return lines.join("\n");
  }

  for (const item of params.imports) {
    lines.push(`- ${item.filePath ?? item.name}`);
  }

  return lines.join("\n");
}
