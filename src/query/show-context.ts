import type {
  SqliteGraphStorage,
  StoredGraphNode,
} from "../storage/sqlite-storage.js";
import { analyzeImpact } from "./analyze-impact.js";

export type SymbolContextResult = {
  symbol: StoredGraphNode;
  callers: StoredGraphNode[];
  callees: StoredGraphNode[];
  injections: StoredGraphNode[];
  injectedBy: StoredGraphNode[];
  imports: StoredGraphNode[];
  affectedFiles: string[];
};

export function getSymbolContext(params: {
  storage: SqliteGraphStorage;
  symbol: StoredGraphNode;
  maxDepth?: number;
}): SymbolContextResult {
  const callers = params.storage
    .findIncomingNodesByEdgeType(params.symbol.id, "CALLS")
    .filter((node) => node.type !== "raw_call");

  const callees = params.storage
    .findOutgoingNodesByEdgeType(params.symbol.id, "CALLS")
    .filter((node) => node.type !== "raw_call");

  const injections = params.storage.findOutgoingNodesByEdgeType(
    params.symbol.id,
    "INJECTS",
  );

  const injectedBy = params.storage.findIncomingNodesByEdgeType(
    params.symbol.id,
    "INJECTS",
  );

  const sourceFile = params.symbol.filePath
    ? params.storage.findFileByPath(params.symbol.filePath)
    : null;

  const imports = sourceFile
    ? params.storage.findOutgoingNodesByEdgeType(sourceFile.id, "IMPORTS")
    : [];

  const impact = analyzeImpact({
    storage: params.storage,
    target: params.symbol,
    maxDepth: params.maxDepth ?? 3,
  });

  return {
    symbol: params.symbol,
    callers,
    callees,
    injections,
    injectedBy,
    imports,
    affectedFiles: impact.affectedFiles,
  };
}

export function formatSymbolContext(result: SymbolContextResult): string {
  const lines: string[] = [];

  lines.push(`Symbol: ${getQualifiedName(result.symbol)}`);
  lines.push("");

  lines.push("File:");
  lines.push(`- ${formatNodeLocation(result.symbol)}`);
  lines.push("");

  lines.push("Callers:");
  pushSymbolList(lines, result.callers);
  lines.push("");

  lines.push("Callees:");
  pushSymbolList(lines, result.callees);
  lines.push("");

  lines.push("Injections:");
  pushSymbolList(lines, result.injections);
  lines.push("");

  lines.push("Injected by:");
  pushSymbolList(lines, result.injectedBy);
  lines.push("");

  lines.push("Imports:");
  pushFileList(lines, result.imports);
  lines.push("");

  lines.push("Affected files:");
  if (result.affectedFiles.length === 0) {
    lines.push("- none");
  } else {
    for (const file of result.affectedFiles) {
      lines.push(`- ${file}`);
    }
  }

  return lines.join("\n");
}

function pushSymbolList(lines: string[], symbols: StoredGraphNode[]) {
  if (symbols.length === 0) {
    lines.push("- none");
    return;
  }

  for (const symbol of symbols) {
    lines.push(`- ${getQualifiedName(symbol)}`);
    lines.push(`  file: ${formatNodeLocation(symbol)}`);
  }
}

function pushFileList(lines: string[], files: StoredGraphNode[]) {
  if (files.length === 0) {
    lines.push("- none");
    return;
  }

  for (const file of files) {
    lines.push(`- ${file.filePath ?? file.name}`);
  }
}

function getQualifiedName(symbol: StoredGraphNode): string {
  const qualifiedName = symbol.metadata?.qualifiedName;

  if (typeof qualifiedName === "string" && qualifiedName.length > 0) {
    return qualifiedName;
  }

  return symbol.name;
}

function formatNodeLocation(node: StoredGraphNode): string {
  const filePath = node.filePath ?? node.name;

  if (node.startLine) {
    return `${filePath}:${node.startLine}`;
  }

  return filePath;
}
