import type { GraphNode } from "./graph-types.js";
import { normalizeGraphIdPart } from "./graph-id.js";

export function createProjectNode(projectName: string): GraphNode {
  const normalizedProjectName = normalizeGraphIdPart(projectName);

  return {
    id: `project:${normalizedProjectName}`,
    type: "project",
    name: projectName,
  };
}
