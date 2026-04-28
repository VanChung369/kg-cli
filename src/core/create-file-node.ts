import { basename, extname } from "node:path";
import type { GraphNode } from "./graph-types.js";
import { normalizeGraphPath } from "./graph-id.js";

export function createFileNode(filePath: string): GraphNode {
  const normalizedPath = normalizeGraphPath(filePath);

  return {
    id: `file:${normalizedPath}`,
    type: "file",
    name: basename(normalizedPath),
    filePath: normalizedPath,
    language: detectLanguage(normalizedPath),
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
