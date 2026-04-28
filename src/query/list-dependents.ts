import type { StoredGraphNode } from "../storage/sqlite-storage.js";

export function formatDependents(params: {
  targetFilePath: string;
  dependents: StoredGraphNode[];
}): string {
  const lines: string[] = [];

  lines.push(`Dependents of ${params.targetFilePath}:`);
  lines.push("");

  if (params.dependents.length === 0) {
    lines.push("No dependents found.");
    return lines.join("\n");
  }

  for (const item of params.dependents) {
    lines.push(`- ${item.filePath ?? item.name}`);
  }

  return lines.join("\n");
}
