import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import type { GraphEdge, GraphNode } from "../core/graph-types.js";
import { createEdgeId, normalizeGraphPath } from "../core/graph-id.js";

export type ParsedCallsResult = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type ParseTypescriptCallsOptions = {
  cwd?: string;
  filePath: string;
};

type CurrentCallable = {
  symbolId: string;
  qualifiedName: string;
};

export function parseTypescriptCalls(
  options: ParseTypescriptCallsOptions,
): ParsedCallsResult {
  const cwd = options.cwd ?? process.cwd();
  const filePath = normalizeGraphPath(options.filePath);
  const absolutePath = join(cwd, filePath);

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

  const callableStack: CurrentCallable[] = [];

  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const functionName = node.name.text;

      withCurrentCallable(
        {
          symbolId: createSymbolId(filePath, functionName),
          qualifiedName: functionName,
        },
        () => {
          ts.forEachChild(node, visit);
        },
      );

      return;
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;

      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name) {
          const methodName = getPropertyName(member.name);
          if (!methodName) continue;

          const qualifiedName = `${className}.${methodName}`;

          withCurrentCallable(
            {
              symbolId: createSymbolId(filePath, qualifiedName),
              qualifiedName,
            },
            () => {
              ts.forEachChild(member, visit);
            },
          );
        }
      }

      return;
    }

    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      const callbackNode = createCallbackNode({
        filePath,
        sourceFile,
        node,
        parentCallable: callableStack.at(-1),
      });

      nodes.push(callbackNode);

      const parentCallable = callableStack.at(-1);

      if (parentCallable) {
        edges.push({
          id: createEdgeId({
            fromId: parentCallable.symbolId,
            toId: callbackNode.id,
            type: "DECLARES",
          }),
          fromId: parentCallable.symbolId,
          toId: callbackNode.id,
          type: "DECLARES",
          metadata: {
            kind: "callback",
          },
        });
      } else {
        edges.push({
          id: createEdgeId({
            fromId: `file:${filePath}`,
            toId: callbackNode.id,
            type: "DECLARES",
          }),
          fromId: `file:${filePath}`,
          toId: callbackNode.id,
          type: "DECLARES",
          metadata: {
            kind: "callback",
          },
        });
      }

      withCurrentCallable(
        {
          symbolId: callbackNode.id,
          qualifiedName: getCallbackQualifiedName(callbackNode),
        },
        () => {
          ts.forEachChild(node, visit);
        },
      );

      return;
    }

    if (ts.isCallExpression(node)) {
      const currentCallable = callableStack.at(-1);

      if (currentCallable) {
        const rawCall = getCallExpressionText(node.expression, sourceFile);

        if (rawCall) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile),
          );

          const lineNumber = line + 1;

          const rawCallNodeId = createRawCallNodeId({
            filePath,
            rawCall,
            line: lineNumber,
          });

          const rawCallNode: GraphNode = {
            id: rawCallNodeId,
            type: "raw_call",
            name: rawCall,
            filePath,
            language: "typescript",
            startLine: lineNumber,
            endLine: lineNumber,
            metadata: {
              rawCall,
              callerQualifiedName: currentCallable.qualifiedName,
            },
          };

          nodes.push(rawCallNode);

          edges.push({
            id: createEdgeId({
              fromId: currentCallable.symbolId,
              toId: rawCallNodeId,
              type: "CALLS",
            }),
            fromId: currentCallable.symbolId,
            toId: rawCallNodeId,
            type: "CALLS",
            metadata: {
              rawCall,
              line: lineNumber,
            },
          });
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

  function withCurrentCallable(current: CurrentCallable, callback: () => void) {
    callableStack.push(current);

    try {
      callback();
    } finally {
      callableStack.pop();
    }
  }
}

function createCallbackNode(params: {
  filePath: string;
  sourceFile: ts.SourceFile;
  node: ts.ArrowFunction | ts.FunctionExpression;
  parentCallable?: CurrentCallable;
}): GraphNode {
  const { line: startLine } = params.sourceFile.getLineAndCharacterOfPosition(
    params.node.getStart(params.sourceFile),
  );

  const { line: endLine } = params.sourceFile.getLineAndCharacterOfPosition(
    params.node.getEnd(),
  );

  const lineNumber = startLine + 1;
  const name = createCallbackName(params.node, params.sourceFile, lineNumber);
  const parentName = params.parentCallable?.qualifiedName;

  return {
    id: createCallbackNodeId({
      filePath: params.filePath,
      name,
      line: lineNumber,
    }),
    type: "callback",
    name,
    filePath: params.filePath,
    language: "typescript",
    startLine: lineNumber,
    endLine: endLine + 1,
    metadata: {
      qualifiedName: parentName ? `${parentName}.${name}` : name,
      parentName,
    },
  };
}

function createCallbackName(
  node: ts.ArrowFunction | ts.FunctionExpression,
  sourceFile: ts.SourceFile,
  line: number,
): string {
  const parent = node.parent;

  if (ts.isCallExpression(parent)) {
    const callName = getShortCallName(parent.expression, sourceFile);
    return `<callback:${callName}:${line}>`;
  }
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return `<callback:${parent.name.text}:${line}>`;
  }

  if (
    ts.isPropertyAssignment(parent) &&
    (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name))
  ) {
    return `<callback:${parent.name.text}:${line}>`;
  }

  return `<callback:${line}>`;
}

function createCallbackNodeId(params: {
  filePath: string;
  name: string;
  line: number;
}): string {
  const safeName = params.name
    .replaceAll("\\", "/")
    .replaceAll(/\s+/g, "")
    .replaceAll(":", "_")
    .replaceAll("<", "")
    .replaceAll(">", "");

  return `symbol:${params.filePath}#${safeName}:${params.line}`;
}

function getCallbackQualifiedName(node: GraphNode): string {
  const qualifiedName = node.metadata?.qualifiedName;

  if (typeof qualifiedName === "string" && qualifiedName.length > 0) {
    return qualifiedName;
  }

  return node.name;
}

function createSymbolId(filePath: string, qualifiedName: string): string {
  return `symbol:${filePath}#${qualifiedName}`;
}

function createRawCallNodeId(params: {
  filePath: string;
  rawCall: string;
  line: number;
}): string {
  const safeRawCall = params.rawCall
    .replaceAll("\\", "/")
    .replaceAll(/\s+/g, "")
    .replaceAll(":", "_");

  return `raw-call:${params.filePath}#${safeRawCall}:${params.line}`;
}

function getCallExpressionText(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): string | null {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.getText(sourceFile);
  }

  if (ts.isElementAccessExpression(expression)) {
    return expression.getText(sourceFile);
  }

  return expression.getText(sourceFile);
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

function getShortCallName(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): string {
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  return expression.getText(sourceFile);
}
