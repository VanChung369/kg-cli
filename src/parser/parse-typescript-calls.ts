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
  localVariableTypes: Map<string, string>;
  thisPropertyTypes: Map<string, string>;
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
          localVariableTypes: new Map(),
          thisPropertyTypes: new Map(),
        },
        () => {
          ts.forEachChild(node, visit);
        },
      );

      return;
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      const thisPropertyTypes = extractConstructorInjectedProperties(node);

      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name) {
          const methodName = getPropertyName(member.name);
          if (!methodName) continue;

          const qualifiedName = `${className}.${methodName}`;

          withCurrentCallable(
            {
              symbolId: createSymbolId(filePath, qualifiedName),
              qualifiedName,
              localVariableTypes: new Map(),
              thisPropertyTypes: new Map(thisPropertyTypes),
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
      const parentCallable = callableStack.at(-1);

      const callbackNode = createCallbackNode({
        filePath,
        sourceFile,
        node,
        parentCallable,
      });

      nodes.push(callbackNode);

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
          localVariableTypes: new Map(parentCallable?.localVariableTypes ?? []),
          thisPropertyTypes: new Map(parentCallable?.thisPropertyTypes ?? []),
        },
        () => {
          ts.forEachChild(node, visit);
        },
      );

      return;
    }

    collectLocalVariableType(node);
    collectAssignmentVariableType(node);

    if (ts.isCallExpression(node)) {
      const currentCallable = callableStack.at(-1);

      if (currentCallable) {
        const rawCall = getCallExpressionText(node.expression, sourceFile);

        if (rawCall) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile),
          );

          const lineNumber = line + 1;
          const resolutionHint = getResolutionHintFromRawCall(
            rawCall,
            currentCallable.localVariableTypes,
            currentCallable.thisPropertyTypes,
          );

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
              ...resolutionHint,
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
              ...resolutionHint,
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

  function collectLocalVariableType(node: ts.Node) {
    const currentCallable = callableStack.at(-1);
    if (!currentCallable) return;

    if (!ts.isVariableDeclaration(node)) return;
    if (!ts.isIdentifier(node.name)) return;

    const variableName = node.name.text;
    const typeName =
      getTypeNameFromTypeNode(node.type) ??
      (node.initializer
        ? inferTypeFromInitializer(node.initializer, sourceFile)
        : null);

    if (!typeName) return;

    currentCallable.localVariableTypes.set(variableName, typeName);
  }

  function collectAssignmentVariableType(node: ts.Node) {
    const currentCallable = callableStack.at(-1);
    if (!currentCallable) return;

    if (!ts.isBinaryExpression(node)) return;
    if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
    if (!ts.isIdentifier(node.left)) return;

    const variableName = node.left.text;
    const typeName = inferTypeFromInitializer(node.right, sourceFile);

    if (!typeName) return;

    currentCallable.localVariableTypes.set(variableName, typeName);
  }
}

function inferTypeFromInitializer(
  initializer: ts.Expression,
  sourceFile: ts.SourceFile,
): string | null {
  if (ts.isNewExpression(initializer)) {
    const expression = initializer.expression;

    if (ts.isIdentifier(expression)) {
      return expression.text;
    }

    if (ts.isPropertyAccessExpression(expression)) {
      return expression.name.text;
    }

    return expression.getText(sourceFile);
  }

  if (
    ts.isAsExpression(initializer) ||
    ts.isTypeAssertionExpression(initializer)
  ) {
    return getTypeNameFromTypeNode(initializer.type);
  }

  return null;
}

function extractConstructorInjectedProperties(
  node: ts.ClassDeclaration,
): Map<string, string> {
  const thisPropertyTypes = new Map<string, string>();

  for (const member of node.members) {
    if (ts.isPropertyDeclaration(member) && member.name) {
      const propertyName = getPropertyName(member.name);
      if (!propertyName) continue;

      const typeName =
        getTypeNameFromTypeNode(member.type) ??
        (member.initializer
          ? inferTypeFromInitializer(member.initializer, member.getSourceFile())
          : null);

      if (typeName) {
        thisPropertyTypes.set(propertyName, typeName);
      }
    }

    if (!ts.isConstructorDeclaration(member)) continue;

    const constructorParameterTypes = new Map<string, string>();

    for (const parameter of member.parameters) {
      if (!ts.isIdentifier(parameter.name)) continue;

      const parameterName = parameter.name.text;
      const typeName = getTypeNameFromTypeNode(parameter.type);

      if (!typeName) continue;

      constructorParameterTypes.set(parameterName, typeName);

      if (isParameterProperty(parameter)) {
        thisPropertyTypes.set(parameterName, typeName);
      }
    }

    if (member.body) {
      collectConstructorAssignments({
        node: member.body,
        constructorParameterTypes,
        thisPropertyTypes,
      });
    }
  }

  return thisPropertyTypes;
}

function collectConstructorAssignments(params: {
  node: ts.Node;
  constructorParameterTypes: Map<string, string>;
  thisPropertyTypes: Map<string, string>;
}) {
  if (ts.isBinaryExpression(params.node)) {
    const { left, right, operatorToken } = params.node;

    if (
      operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(left) &&
      left.expression.kind === ts.SyntaxKind.ThisKeyword &&
      ts.isIdentifier(right)
    ) {
      const typeName = params.constructorParameterTypes.get(right.text);

      if (typeName) {
        params.thisPropertyTypes.set(left.name.text, typeName);
      }
    }
  }

  ts.forEachChild(params.node, (child) =>
    collectConstructorAssignments({
      node: child,
      constructorParameterTypes: params.constructorParameterTypes,
      thisPropertyTypes: params.thisPropertyTypes,
    }),
  );
}

function isParameterProperty(parameter: ts.ParameterDeclaration): boolean {
  const modifiers = ts.canHaveModifiers(parameter)
    ? ts.getModifiers(parameter)
    : undefined;

  return Boolean(
    modifiers?.some((modifier) =>
      [
        ts.SyntaxKind.PublicKeyword,
        ts.SyntaxKind.PrivateKeyword,
        ts.SyntaxKind.ProtectedKeyword,
        ts.SyntaxKind.ReadonlyKeyword,
      ].includes(modifier.kind),
    ),
  );
}

function getTypeNameFromTypeNode(
  typeNode: ts.TypeNode | undefined,
): string | null {
  if (!typeNode) return null;

  if (ts.isTypeReferenceNode(typeNode)) {
    return getEntityNameText(typeNode.typeName);
  }

  if (ts.isUnionTypeNode(typeNode)) {
    for (const childType of typeNode.types) {
      const childTypeName = getTypeNameFromTypeNode(childType);

      if (
        childTypeName &&
        childTypeName !== "null" &&
        childTypeName !== "undefined"
      ) {
        return childTypeName;
      }
    }
  }

  if (typeNode.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (typeNode.kind === ts.SyntaxKind.UndefinedKeyword) return "undefined";

  return null;
}

function getEntityNameText(name: ts.EntityName): string {
  if (ts.isIdentifier(name)) return name.text;
  return name.right.text;
}

function getResolutionHintFromRawCall(
  rawCall: string,
  localVariableTypes: Map<string, string>,
  thisPropertyTypes: Map<string, string>,
): Record<string, unknown> {
  const normalizedRawCall = rawCall.replaceAll("?.", ".");
  const parts = normalizedRawCall.split(".");

  if (parts.length < 2) return {};

  if (parts[0] === "this" && parts.length >= 3) {
    const propertyName = parts[1]?.replace(/!$/, "");
    const methodName = parts.at(-1);

    if (!propertyName || !methodName) return {};

    const receiverType = thisPropertyTypes.get(propertyName);

    if (!receiverType) return {};

    return {
      receiver: `this.${propertyName}`,
      receiverType,
      methodName,
      resolvedQualifiedNameHint: `${receiverType}.${methodName}`,
      resolutionHint: "this_property",
    };
  }

  const receiver = parts[0];
  const methodName = parts.at(-1);

  if (!receiver || !methodName) return {};

  const receiverType = localVariableTypes.get(receiver);

  if (!receiverType) return {};

  return {
    receiver,
    receiverType,
    methodName,
    resolvedQualifiedNameHint: `${receiverType}.${methodName}`,
    resolutionHint: "local_new_expression",
  };
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
