import type { GraphEdge } from "../core/graph-types.js";
import { createEdgeId } from "../core/graph-id.js";
import type { SqliteGraphStorage } from "../storage/sqlite-storage.js";

export type ResolveSimpleCallsResult = {
  resolvedEdges: GraphEdge[];
  resolvedCount: number;
  skippedCount: number;
};

export function resolveSimpleCalls(
  storage: SqliteGraphStorage,
): ResolveSimpleCallsResult {
  const rawCalls = storage.findRawCallsWithCaller();

  const resolvedEdges: GraphEdge[] = [];
  let skippedCount = 0;

  for (const item of rawCalls) {
    if (!isSimpleIdentifierCall(item.rawCall)) {
      skippedCount += 1;
      continue;
    }

    const matchedSymbols = storage.findSymbolsByExactName(item.rawCall);

    if (matchedSymbols.length !== 1) {
      skippedCount += 1;
      continue;
    }

    const targetSymbol = matchedSymbols[0]!;

    if (item.callerId === targetSymbol.id) {
      skippedCount += 1;
      continue;
    }

    resolvedEdges.push({
      id: createEdgeId({
        fromId: item.callerId,
        toId: targetSymbol.id,
        type: "CALLS",
      }),
      fromId: item.callerId,
      toId: targetSymbol.id,
      type: "CALLS",
      metadata: {
        resolvedFrom: item.rawCall,
        resolution: "simple_identifier",
        line: item.line,
        rawCallNodeId: item.rawCallNode.id,
      },
    });
  }

  storage.addEdges(resolvedEdges);

  return {
    resolvedEdges,
    resolvedCount: resolvedEdges.length,
    skippedCount,
  };
}

function isSimpleIdentifierCall(rawCall: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(rawCall);
}
