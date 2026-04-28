export type NodeType =
  | "project"
  | "folder"
  | "file"
  | "class"
  | "function"
  | "method"
  | "interface"
  | "type"
  | "variable";

export type EdgeType =
  | "CONTAINS"
  | "IMPORTS"
  | "EXPORTS"
  | "DECLARES"
  | "CALLS"
  | "DEPENDS_ON"
  | "EXTENDS"
  | "IMPLEMENTS"
  | "INJECTS";

export type GraphNode = {
  id: string;
  type: NodeType;
  name: string;
  filePath?: string;
  language?: string;
  startLine?: number;
  endLine?: number;
  metadata?: Record<string, unknown>;
};

export type GraphEdge = {
  id: string;
  fromId: string;
  toId: string;
  type: EdgeType;
  metadata?: Record<string, unknown>;
};

export type KnowledgeGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};
