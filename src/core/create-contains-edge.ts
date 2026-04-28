import type { GraphEdge, GraphNode } from "./graph-types.js";
import { createEdgeId } from "./graph-id.js";

export function createContainsEdge(from: GraphNode, to: GraphNode): GraphEdge {
  return {
    id: createEdgeId({
      fromId: from.id,
      toId: to.id,
      type: "CONTAINS",
    }),
    fromId: from.id,
    toId: to.id,
    type: "CONTAINS",
  };
}
