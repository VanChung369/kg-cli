import { basename, extname } from "node:path";
import type { GraphNode } from "./graph-types.js";

export function createFileNode(filePath: string): GraphNode {
  return {
    id: `file:${normalizePath(filePath)}`,
    type: "file",
    name: basename(filePath),
    filePath: normalizePath(filePath),
    language: detectLanguage(filePath),
  };
}

function detectLanguage(filePath: string): string {
  const ext = extname(filePath);

  switch (ext) {
    case ".ts":
    case ".tsx":
      return "typescript";

    case ".js":
    case ".jsx":
      return "javascript";

    default:
      return "unknown";
  }
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}
