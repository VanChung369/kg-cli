import type {
  SqliteGraphStorage,
  StoredGraphNode,
} from "../storage/sqlite-storage.js";

export type ModuleContextResult = {
  module: StoredGraphNode;
  controllers: StoredGraphNode[];
  providers: StoredGraphNode[];
  imports: StoredGraphNode[];
  injections: StoredGraphNode[];
};

export function getModuleContext(params: {
  storage: SqliteGraphStorage;
  module: StoredGraphNode;
}): ModuleContextResult {
  return {
    module: params.module,
    controllers: params.storage.findOutgoingNodesByEdgeType(
      params.module.id,
      "CONTAINS",
    ),
    providers: params.storage.findOutgoingNodesByEdgeType(
      params.module.id,
      "PROVIDES",
    ),
    imports: params.storage.findOutgoingNodesByEdgeType(
      params.module.id,
      "DEPENDS_ON",
    ),
    injections: params.storage.findOutgoingNodesByEdgeType(
      params.module.id,
      "INJECTS",
    ),
  };
}

export function formatModuleContext(result: ModuleContextResult): string {
  const lines: string[] = [];

  lines.push(`Module: ${getQualifiedName(result.module)}`);
  lines.push("");

  lines.push("File:");
  lines.push(`- ${formatNodeLocation(result.module)}`);
  lines.push("");

  lines.push("Controllers:");
  pushSymbolList(lines, result.controllers);
  lines.push("");

  lines.push("Providers:");
  pushSymbolList(lines, result.providers);
  lines.push("");

  lines.push("Imports:");
  pushSymbolList(lines, result.imports);
  lines.push("");

  lines.push("Constructor injections:");
  pushSymbolList(lines, result.injections);

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
