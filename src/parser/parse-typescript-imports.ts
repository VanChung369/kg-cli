import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import ts from "typescript";
import type { GraphEdge } from "../core/graph-types.js";
import { createEdgeId, normalizeGraphPath } from "../core/graph-id.js";

export type ParsedImportsResult = {
  edges: GraphEdge[];
};

type ParseTypescriptImportsOptions = {
  cwd?: string;
  filePath: string;
  allFiles: string[];
};

export function parseTypescriptImports(
  options: ParseTypescriptImportsOptions,
): ParsedImportsResult {
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

  const edges: GraphEdge[] = [];
  const fromFileNodeId = `file:${filePath}`;

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;

    const moduleSpecifier = statement.moduleSpecifier;

    if (!ts.isStringLiteral(moduleSpecifier)) continue;

    const importPath = moduleSpecifier.text;

    const resolvedFilePath = resolveImportPath({
      cwd,
      fromFilePath: filePath,
      importPath,
      allFiles: options.allFiles,
    });

    if (!resolvedFilePath) continue;

    const toFileNodeId = `file:${resolvedFilePath}`;

    edges.push({
      id: createEdgeId({
        fromId: fromFileNodeId,
        toId: toFileNodeId,
        type: "IMPORTS",
      }),
      fromId: fromFileNodeId,
      toId: toFileNodeId,
      type: "IMPORTS",
      metadata: {
        importPath,
      },
    });
  }

  return {
    edges,
  };
}

function resolveImportPath(params: {
  cwd: string;
  fromFilePath: string;
  importPath: string;
  allFiles: string[];
}): string | null {
  const { cwd, fromFilePath, importPath, allFiles } = params;

  if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
    return null;
  }

  const fromDir = dirname(fromFilePath);

  const rawTargetPath = normalizeGraphPath(
    normalize(join(fromDir, importPath)),
  );

  const candidates = createImportCandidates(rawTargetPath);

  for (const candidate of candidates) {
    if (allFiles.includes(candidate)) {
      return candidate;
    }

    const absoluteCandidate = join(cwd, candidate);
    if (existsSync(absoluteCandidate)) {
      return normalizeGraphPath(candidate);
    }
  }

  return null;
}

function createImportCandidates(rawTargetPath: string): string[] {
  const withoutJsExtension = rawTargetPath
    .replace(/\.js$/, "")
    .replace(/\.jsx$/, "")
    .replace(/\.mjs$/, "")
    .replace(/\.cjs$/, "");

  const candidates = [
    rawTargetPath,
    withoutJsExtension,
    `${withoutJsExtension}.ts`,
    `${withoutJsExtension}.tsx`,
    `${withoutJsExtension}.js`,
    `${withoutJsExtension}.jsx`,
    `${withoutJsExtension}/index.ts`,
    `${withoutJsExtension}/index.tsx`,
    `${withoutJsExtension}/index.js`,
    `${withoutJsExtension}/index.jsx`,
  ];

  return Array.from(new Set(candidates.map(normalizeGraphPath)));
}

function getScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filePath.endsWith(".js")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
