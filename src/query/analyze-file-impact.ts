import type {
  SqliteGraphStorage,
  StoredGraphNode,
} from "../storage/sqlite-storage.js";
import { analyzeImpact } from "./analyze-impact.js";

const SYMBOL_TYPES = new Set([
  "class",
  "function",
  "method",
  "interface",
  "type",
  "callback",
]);

export type FileImpactCaller = {
  target: StoredGraphNode;
  caller: StoredGraphNode;
  depth: number;
};

export type FileImpactResult = {
  file: StoredGraphNode;
  symbols: StoredGraphNode[];
  callers: FileImpactCaller[];
  affectedFiles: string[];
};

export function analyzeFileImpact(params: {
  storage: SqliteGraphStorage;
  file: StoredGraphNode;
  maxDepth?: number;
}): FileImpactResult {
  const symbols = params.storage
    .findOutgoingNodesByEdgeType(params.file.id, "DECLARES")
    .filter((node) => SYMBOL_TYPES.has(node.type));

  const callers: FileImpactCaller[] = [];
  const affectedFiles = new Set<string>();

  for (const symbol of symbols) {
    const impact = analyzeImpact({
      storage: params.storage,
      target: symbol,
      maxDepth: params.maxDepth ?? 3,
    });

    for (const level of impact.levels) {
      for (const caller of level.callers) {
        callers.push({
          target: symbol,
          caller,
          depth: level.depth,
        });
      }
    }

    for (const filePath of impact.affectedFiles) {
      affectedFiles.add(filePath);
    }
  }

  return {
    file: params.file,
    symbols,
    callers: dedupeCallers(callers),
    affectedFiles: Array.from(affectedFiles).sort(),
  };
}

export function formatFileImpact(result: FileImpactResult): string {
  const lines: string[] = [];
  const filePath = result.file.filePath ?? result.file.name;

  lines.push(`Impact of file ${filePath}`);
  lines.push("");

  lines.push("Declared symbols:");
  if (result.symbols.length === 0) {
    lines.push("- none");
  } else {
    for (const symbol of result.symbols) {
      lines.push(`- ${getQualifiedName(symbol)}`);
    }
  }

  lines.push("");
  lines.push("Affected callers:");

  if (result.callers.length === 0) {
    lines.push("- none");
  } else {
    for (const item of result.callers) {
      lines.push(
        `- ${getQualifiedName(item.caller)} -> ${getQualifiedName(item.target)}`,
      );
      lines.push(`  depth: ${item.depth}`);

      if (item.caller.filePath) {
        const line = item.caller.startLine ? `:${item.caller.startLine}` : "";
        lines.push(`  file: ${item.caller.filePath}${line}`);
      }
    }
  }

  lines.push("");
  lines.push("Affected files:");

  if (result.affectedFiles.length === 0) {
    lines.push("- none");
  } else {
    for (const affectedFile of result.affectedFiles) {
      lines.push(`- ${affectedFile}`);
    }
  }

  return lines.join("\n");
}

function dedupeCallers(callers: FileImpactCaller[]): FileImpactCaller[] {
  const byKey = new Map<string, FileImpactCaller>();

  for (const caller of callers) {
    byKey.set(
      `${caller.target.id}:${caller.caller.id}:${caller.depth}`,
      caller,
    );
  }

  return Array.from(byKey.values()).sort((left, right) => {
    if (left.depth !== right.depth) return left.depth - right.depth;
    return getQualifiedName(left.caller).localeCompare(
      getQualifiedName(right.caller),
    );
  });
}

function getQualifiedName(symbol: StoredGraphNode): string {
  const qualifiedName = symbol.metadata?.qualifiedName;

  if (typeof qualifiedName === "string" && qualifiedName.length > 0) {
    return qualifiedName;
  }

  return symbol.name;
}
