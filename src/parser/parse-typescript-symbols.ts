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
    metadata?: Record<string, unknown>;
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
        ...params.metadata,
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
      const classDecorators = getDecorators(node);
      const controllerPath = getDecoratorFirstStringArgument(
        classDecorators,
        "Controller",
      );

      addSymbolNode({
        type: "class",
        name: className,
        astNode: node,
        metadata: getClassSemanticMetadata(classDecorators),
      });

      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name) {
          const methodName = getPropertyName(member.name);

          if (methodName) {
            const methodDecorators = getDecorators(member);

            addSymbolNode({
              type: "method",
              name: methodName,
              astNode: member,
              parentName: className,
              metadata: getMethodSemanticMetadata({
                classDecorators,
                controllerPath,
                methodDecorators,
              }),
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

type DecoratorInfo = {
  name: string;
  stringArguments: string[];
};

function getDecorators(node: ts.Node): DecoratorInfo[] {
  const decorators = ts.canHaveDecorators(node)
    ? ts.getDecorators(node)
    : undefined;

  if (!decorators) return [];

  return decorators.map((decorator) => getDecoratorInfo(decorator));
}

function getDecoratorInfo(decorator: ts.Decorator): DecoratorInfo {
  const expression = decorator.expression;

  if (ts.isCallExpression(expression)) {
    return {
      name: getDecoratorName(expression.expression),
      stringArguments: expression.arguments
        .filter(ts.isStringLiteralLike)
        .map((argument) => argument.text),
    };
  }

  return {
    name: getDecoratorName(expression),
    stringArguments: [],
  };
}

function getDecoratorName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return expression.getText();
}

function getClassSemanticMetadata(
  decorators: DecoratorInfo[],
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  const decoratorNames = decorators.map((decorator) => decorator.name);
  if (decoratorNames.length > 0) {
    metadata.decorators = decoratorNames;
  }

  const controllerPath = getDecoratorFirstStringArgument(
    decorators,
    "Controller",
  );
  if (controllerPath !== null) {
    metadata.nestjs = {
      kind: "controller",
      path: controllerPath,
    };
    return metadata;
  }

  if (decorators.some((decorator) => decorator.name === "Injectable")) {
    metadata.nestjs = {
      kind: "injectable",
    };
    return metadata;
  }

  if (decorators.some((decorator) => decorator.name === "Module")) {
    metadata.nestjs = {
      kind: "module",
    };
  }

  return metadata;
}

function getMethodSemanticMetadata(params: {
  classDecorators: DecoratorInfo[];
  controllerPath: string | null;
  methodDecorators: DecoratorInfo[];
}): Record<string, unknown> {
  const routeDecorator = params.methodDecorators.find((decorator) =>
    ["Get", "Post", "Put", "Patch", "Delete", "Options", "Head", "All"].includes(
      decorator.name,
    ),
  );

  if (!routeDecorator) return {};

  const routePath = routeDecorator.stringArguments[0] ?? "";

  return {
    decorators: params.methodDecorators.map((decorator) => decorator.name),
    nestjs: {
      kind: "route_handler",
      method: routeDecorator.name.toUpperCase(),
      controllerPath: params.controllerPath,
      path: routePath,
      route: joinRouteParts(params.controllerPath ?? "", routePath),
      controllerDecorators: params.classDecorators.map(
        (decorator) => decorator.name,
      ),
    },
  };
}

function getDecoratorFirstStringArgument(
  decorators: DecoratorInfo[],
  decoratorName: string,
): string | null {
  const decorator = decorators.find((item) => item.name === decoratorName);
  if (!decorator) return null;

  return decorator.stringArguments[0] ?? "";
}

function joinRouteParts(basePath: string, routePath: string): string {
  const normalizedBase = basePath.replace(/^\/+|\/+$/g, "");
  const normalizedRoute = routePath.replace(/^\/+|\/+$/g, "");
  const joined = [normalizedBase, normalizedRoute].filter(Boolean).join("/");

  return `/${joined}`;
}
