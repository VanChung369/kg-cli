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
    const hintedEdge = resolveByQualifiedNameHint(storage, item);

    if (hintedEdge) {
      resolvedEdges.push(hintedEdge);
      continue;
    }

    const simpleEdge = resolveBySimpleIdentifier(storage, item);

    if (simpleEdge) {
      resolvedEdges.push(simpleEdge);
      continue;
    }

    skippedCount += 1;
  }

  storage.addEdges(resolvedEdges);

  return {
    resolvedEdges,
    resolvedCount: resolvedEdges.length,
    skippedCount,
  };
}

function resolveByQualifiedNameHint(
  storage: SqliteGraphStorage,
  item: {
    rawCallNode: {
      id: string;
      metadata: Record<string, unknown> | null;
    };
    callerId: string;
    rawCall: string;
    line: number | null;
  },
): GraphEdge | null {
  const hint = item.rawCallNode.metadata?.resolvedQualifiedNameHint;

  if (typeof hint !== "string" || hint.length === 0) {
    return null;
  }

  const targetSymbol = storage.findSymbolByQualifiedName(hint);

  if (!targetSymbol) return null;
  if (item.callerId === targetSymbol.id) return null;

  return {
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
      resolution: item.rawCallNode.metadata?.resolutionHint ?? "qualified_hint",
      resolvedQualifiedName: hint,
      line: item.line,
      rawCallNodeId: item.rawCallNode.id,
    },
  };
}

function resolveBySimpleIdentifier(
  storage: SqliteGraphStorage,
  item: {
    rawCallNode: {
      id: string;
    };
    callerId: string;
    rawCall: string;
    line: number | null;
  },
): GraphEdge | null {
  if (!isSimpleIdentifierCall(item.rawCall)) {
    return null;
  }

  const matchedSymbols = storage.findSymbolsByExactName(item.rawCall);

  if (matchedSymbols.length !== 1) {
    return null;
  }

  const targetSymbol = matchedSymbols[0]!;

  if (item.callerId === targetSymbol.id) {
    return null;
  }

  return {
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
  };
}

function isSimpleIdentifierCall(rawCall: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(rawCall);
}
