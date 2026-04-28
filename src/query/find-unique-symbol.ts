import type { StoredGraphNode } from "../storage/sqlite-storage.js";

export type FindUniqueSymbolResult =
  | {
      ok: true;
      symbol: StoredGraphNode;
    }
  | {
      ok: false;
      reason: "not_found" | "ambiguous";
      matches: StoredGraphNode[];
    };

export function findUniqueSymbolFromMatches(
  matches: StoredGraphNode[],
): FindUniqueSymbolResult {
  if (matches.length === 0) {
    return {
      ok: false,
      reason: "not_found",
      matches,
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      matches,
    };
  }

  return {
    ok: true,
    symbol: matches[0]!,
  };
}
