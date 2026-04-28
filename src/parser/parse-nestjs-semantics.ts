import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import type { GraphEdge } from "../core/graph-types.js";
import { createEdgeId, normalizeGraphPath } from "../core/graph-id.js";
import { resolveImportPath } from "./parse-typescript-imports.js";

export type ParsedNestjsSemanticsResult = {
  edges: GraphEdge[];
};

type ParseNestjsSemanticsOptions = {
  cwd?: string;
  filePath: string;
  allFiles: string[];
};

type ImportedSymbol = {
  filePath: string;
  symbolName: string;
};

export function parseNestjsSemantics(
  options: ParseNestjsSemanticsOptions,
): ParsedNestjsSemanticsResult {
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

  const namedImports = collectNamedImports({
    cwd,
    filePath,
    sourceFile,
    allFiles: options.allFiles,
  });
  const localClasses = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (ts.isClassDeclaration(statement) && statement.name) {
      localClasses.add(statement.name.text);
    }
  }

  const edges: GraphEdge[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement) || !statement.name) continue;

    const className = statement.name.text;
    const classSymbolId = createSymbolId(filePath, className);

    edges.push(
      ...extractModuleEdges({
        classNode: statement,
        classSymbolId,
        filePath,
        localClasses,
        namedImports,
      }),
      ...extractConstructorInjectionEdges({
        classNode: statement,
        classSymbolId,
        filePath,
        localClasses,
        namedImports,
      }),
    );
  }

  return {
    edges,
  };
}

function extractModuleEdges(params: {
  classNode: ts.ClassDeclaration;
  classSymbolId: string;
  filePath: string;
  localClasses: Set<string>;
  namedImports: Map<string, ImportedSymbol>;
}): GraphEdge[] {
  const moduleDecorator = getDecoratorCall(params.classNode, "Module");
  if (!moduleDecorator) return [];

  const metadata = moduleDecorator.arguments[0];
  if (!metadata || !ts.isObjectLiteralExpression(metadata)) return [];

  const edges: GraphEdge[] = [];

  for (const controllerName of getIdentifierArrayProperty(
    metadata,
    "controllers",
  )) {
    const targetId = resolveClassSymbolId({
      name: controllerName,
      currentFilePath: params.filePath,
      localClasses: params.localClasses,
      namedImports: params.namedImports,
    });

    if (!targetId) continue;

    edges.push(
      createSemanticEdge({
        fromId: params.classSymbolId,
        toId: targetId,
        type: "CONTAINS",
        relation: "nestjs_controller",
      }),
    );
  }

  for (const providerName of getIdentifierArrayProperty(metadata, "providers")) {
    const targetId = resolveClassSymbolId({
      name: providerName,
      currentFilePath: params.filePath,
      localClasses: params.localClasses,
      namedImports: params.namedImports,
    });

    if (!targetId) continue;

    edges.push(
      createSemanticEdge({
        fromId: params.classSymbolId,
        toId: targetId,
        type: "PROVIDES",
        relation: "nestjs_provider",
      }),
    );
  }

  for (const importedModuleName of getIdentifierArrayProperty(
    metadata,
    "imports",
  )) {
    const targetId = resolveClassSymbolId({
      name: importedModuleName,
      currentFilePath: params.filePath,
      localClasses: params.localClasses,
      namedImports: params.namedImports,
    });

    if (!targetId) continue;

    edges.push(
      createSemanticEdge({
        fromId: params.classSymbolId,
        toId: targetId,
        type: "DEPENDS_ON",
        relation: "nestjs_module_import",
      }),
    );
  }

  return edges;
}

function extractConstructorInjectionEdges(params: {
  classNode: ts.ClassDeclaration;
  classSymbolId: string;
  filePath: string;
  localClasses: Set<string>;
  namedImports: Map<string, ImportedSymbol>;
}): GraphEdge[] {
  const edges: GraphEdge[] = [];

  for (const member of params.classNode.members) {
    if (!ts.isConstructorDeclaration(member)) continue;

    for (const parameter of member.parameters) {
      if (!ts.isIdentifier(parameter.name)) continue;

      const injectedTypeName = getTypeNameFromTypeNode(parameter.type);
      if (!injectedTypeName) continue;

      const targetId = resolveClassSymbolId({
        name: injectedTypeName,
        currentFilePath: params.filePath,
        localClasses: params.localClasses,
        namedImports: params.namedImports,
      });

      if (!targetId) continue;

      edges.push(
        createSemanticEdge({
          fromId: params.classSymbolId,
          toId: targetId,
          type: "INJECTS",
          relation: "constructor_parameter",
          metadata: {
            parameterName: parameter.name.text,
          },
        }),
      );
    }
  }

  return edges;
}

function collectNamedImports(params: {
  cwd: string;
  filePath: string;
  sourceFile: ts.SourceFile;
  allFiles: string[];
}): Map<string, ImportedSymbol> {
  const imports = new Map<string, ImportedSymbol>();

  for (const statement of params.sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

    const resolvedFilePath = resolveImportPath({
      cwd: params.cwd,
      fromFilePath: params.filePath,
      importPath: statement.moduleSpecifier.text,
      allFiles: params.allFiles,
    });

    if (!resolvedFilePath) continue;

    const importClause = statement.importClause;
    if (!importClause) continue;

    if (importClause.name) {
      imports.set(importClause.name.text, {
        filePath: resolvedFilePath,
        symbolName: importClause.name.text,
      });
    }

    const namedBindings = importClause.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;

    for (const element of namedBindings.elements) {
      imports.set(element.name.text, {
        filePath: resolvedFilePath,
        symbolName: element.propertyName?.text ?? element.name.text,
      });
    }
  }

  return imports;
}

function getDecoratorCall(
  node: ts.Node,
  decoratorName: string,
): ts.CallExpression | null {
  const decorators = ts.canHaveDecorators(node)
    ? ts.getDecorators(node)
    : undefined;

  if (!decorators) return null;

  for (const decorator of decorators) {
    if (!ts.isCallExpression(decorator.expression)) continue;

    const expression = decorator.expression.expression;
    const name = ts.isIdentifier(expression)
      ? expression.text
      : ts.isPropertyAccessExpression(expression)
        ? expression.name.text
        : null;

    if (name === decoratorName) {
      return decorator.expression;
    }
  }

  return null;
}

function getIdentifierArrayProperty(
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string,
): string[] {
  const property = objectLiteral.properties.find((item) => {
    if (!ts.isPropertyAssignment(item)) return false;
    return getPropertyName(item.name) === propertyName;
  });

  if (!property || !ts.isPropertyAssignment(property)) return [];
  if (!ts.isArrayLiteralExpression(property.initializer)) return [];

  return property.initializer.elements
    .map(getIdentifierLikeName)
    .filter((name): name is string => Boolean(name));
}

function getIdentifierLikeName(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return null;
}

function resolveClassSymbolId(params: {
  name: string;
  currentFilePath: string;
  localClasses: Set<string>;
  namedImports: Map<string, ImportedSymbol>;
}): string | null {
  if (params.localClasses.has(params.name)) {
    return createSymbolId(params.currentFilePath, params.name);
  }

  const importedSymbol = params.namedImports.get(params.name);
  if (!importedSymbol) return null;

  return createSymbolId(importedSymbol.filePath, importedSymbol.symbolName);
}

function createSemanticEdge(params: {
  fromId: string;
  toId: string;
  type: GraphEdge["type"];
  relation: string;
  metadata?: Record<string, unknown>;
}): GraphEdge {
  return {
    id: createEdgeId({
      fromId: params.fromId,
      toId: params.toId,
      type: params.type,
    }),
    fromId: params.fromId,
    toId: params.toId,
    type: params.type,
    metadata: {
      framework: "nestjs",
      relation: params.relation,
      ...params.metadata,
    },
  };
}

function getTypeNameFromTypeNode(typeNode: ts.TypeNode | undefined): string | null {
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

  return null;
}

function getEntityNameText(name: ts.EntityName): string {
  if (ts.isIdentifier(name)) return name.text;
  return name.right.text;
}

function getPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  if (ts.isNumericLiteral(name)) return name.text;
  return null;
}

function createSymbolId(filePath: string, className: string): string {
  return `symbol:${filePath}#${className}`;
}

function getScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filePath.endsWith(".js")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
