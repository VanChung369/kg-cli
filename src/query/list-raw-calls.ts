import type { StoredGraphNode } from "../storage/sqlite-storage.js";

export function formatRawCalls(rawCalls: StoredGraphNode[]): string {
  if (rawCalls.length === 0) {
    return "No raw calls found. Run `kg index` first.";
  }

  const lines: string[] = [];

  lines.push("Raw calls:");
  lines.push("");

  for (const call of rawCalls) {
    lines.push(`- ${call.name}`);

    if (call.filePath) {
      const line = call.startLine ? `:${call.startLine}` : "";
      lines.push(`  file: ${call.filePath}${line}`);
    }

    const callerQualifiedName = call.metadata?.callerQualifiedName;
    if (typeof callerQualifiedName === "string") {
      lines.push(`  caller: ${callerQualifiedName}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}
