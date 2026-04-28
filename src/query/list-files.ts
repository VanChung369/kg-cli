import type { StoredGraphNode } from "../storage/sqlite-storage.js";

export type FileSummary = {
  file: StoredGraphNode;
  imports: number;
  declares: number;
};

export function formatFiles(files: FileSummary[]): string {
  if (files.length === 0) {
    return "No files found. Run `kg index` first.";
  }

  const lines: string[] = [];

  lines.push("Files:");
  lines.push("");

  for (const item of files) {
    const filePath = item.file.filePath ?? item.file.name;

    lines.push(`- ${filePath}`);
    lines.push(`  imports: ${item.imports}`);
    lines.push(`  declares: ${item.declares}`);
    lines.push("");
  }

  return lines.join("\n");
}
