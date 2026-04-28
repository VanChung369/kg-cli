import { readFileSync } from "node:fs";
import ts from "typescript";
import type { GraphEdge, GraphNode, NodeType } from "../core/graph-types.js";
import { createEdgeId, normalizeGraphPath } from "../core/graph-id.js";

export type ParsedSymbolsResult = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type ParseTypescriptSymbolsOptions = {
  cwd?: string;
  filePath: string;
};

export function parseTypescriptSymbols(
  options: ParseTypescriptSymbolsOptions,
): ParsedSymbolsResult {
  const cwd = options.cwd ?? process.cwd();
  const filePath = normalizeGraphPath(options.filePath);
  const absolutePath = `${cwd}/${filePath}`;

  const sourceText = readFileSync(absolutePath, "utf8");

  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filePath),
  );

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const fileNodeId = `file:${filePath}`;

  function addSymbolNode(params: {
    type: NodeType;
    name: string;
    astNode: ts.Node;
    parentName?: string;
  }) {
    const symbolName = params.parentName
      ? `${params.parentName}.${params.name}`
      : params.name;

    const nodeId = `symbol:${filePath}#${symbolName}`;

    const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(
      params.astNode.getStart(sourceFile),
    );

    const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(
      params.astNode.getEnd(),
    );

    const symbolNode: GraphNode = {
      id: nodeId,
      type: params.type,
      name: params.name,
      filePath,
      language: "typescript",
      startLine: startLine + 1,
      endLine: endLine + 1,
      metadata: {
        qualifiedName: symbolName,
        parentName: params.parentName,
      },
    };

    nodes.push(symbolNode);

    edges.push({
      id: createEdgeId({
        fromId: fileNodeId,
        toId: nodeId,
        type: "DECLARES",
      }),
      fromId: fileNodeId,
      toId: nodeId,
      type: "DECLARES",
    });

    return symbolNode;
  }

  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      addSymbolNode({
        type: "function",
        name: node.name.text,
        astNode: node,
      });
    }

    if (ts.isInterfaceDeclaration(node)) {
      addSymbolNode({
        type: "interface",
        name: node.name.text,
        astNode: node,
      });
    }

    if (ts.isTypeAliasDeclaration(node)) {
      addSymbolNode({
        type: "type",
        name: node.name.text,
        astNode: node,
      });
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;

      addSymbolNode({
        type: "class",
        name: className,
        astNode: node,
      });

      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name) {
          const methodName = getPropertyName(member.name);

          if (methodName) {
            addSymbolNode({
              type: "method",
              name: methodName,
              astNode: member,
              parentName: className,
            });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return {
    nodes,
    edges,
  };
}

function getScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filePath.endsWith(".js")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function getPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  if (ts.isNumericLiteral(name)) return name.text;

  return null;
}
