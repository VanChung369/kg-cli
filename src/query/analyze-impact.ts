import type {
  StoredGraphNode,
  SqliteGraphStorage,
} from "../storage/sqlite-storage.js";

export type ImpactLevel = {
  depth: number;
  callers: StoredGraphNode[];
};

export type ImpactResult = {
  target: StoredGraphNode;
  levels: ImpactLevel[];
  affectedFiles: string[];
};

export function analyzeImpact(params: {
  storage: SqliteGraphStorage;
  target: StoredGraphNode;
  maxDepth?: number;
}): ImpactResult {
  const maxDepth = params.maxDepth ?? 3;
  const visited = new Set<string>([params.target.id]);

  const levels: ImpactLevel[] = [];
  let currentLevel: StoredGraphNode[] = [params.target];

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const nextLevel: StoredGraphNode[] = [];

    for (const node of currentLevel) {
      const callers = params.storage
        .findIncomingNodesByEdgeType(node.id, "CALLS")
        .filter((caller) => caller.type !== "raw_call");

      for (const caller of callers) {
        if (visited.has(caller.id)) continue;

        visited.add(caller.id);
        nextLevel.push(caller);
      }
    }

    if (nextLevel.length === 0) break;

    levels.push({
      depth,
      callers: nextLevel,
    });

    currentLevel = nextLevel;
  }

  const affectedFiles = Array.from(
    new Set(
      levels
        .flatMap((level) => level.callers)
        .map((node) => node.filePath)
        .filter((filePath): filePath is string => Boolean(filePath)),
    ),
  ).sort();

  return {
    target: params.target,
    levels,
    affectedFiles,
  };
}

export function formatImpact(result: ImpactResult): string {
  const lines: string[] = [];

  lines.push(`Impact of ${getQualifiedName(result.target)}`);
  lines.push("");

  if (result.levels.length === 0) {
    lines.push("No resolved callers found.");
    return lines.join("\n");
  }

  const directCallers = result.levels[0]?.callers ?? [];

  lines.push("Direct callers:");
  if (directCallers.length === 0) {
    lines.push("- none");
  } else {
    for (const caller of directCallers) {
      lines.push(`- ${getQualifiedName(caller)}`);
      if (caller.filePath) {
        const line = caller.startLine ? `:${caller.startLine}` : "";
        lines.push(`  file: ${caller.filePath}${line}`);
      }
    }
  }

  lines.push("");
  lines.push("Affected files:");

  if (result.affectedFiles.length === 0) {
    lines.push("- none");
  } else {
    for (const file of result.affectedFiles) {
      lines.push(`- ${file}`);
    }
  }

  lines.push("");

  for (const level of result.levels) {
    lines.push(`Depth ${level.depth}:`);

    for (const caller of level.callers) {
      lines.push(`- ${getQualifiedName(caller)}`);
      lines.push(`  type: ${caller.type}`);

      if (caller.filePath) {
        const line = caller.startLine ? `:${caller.startLine}` : "";
        lines.push(`  file: ${caller.filePath}${line}`);
      }

      lines.push("");
    }
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
