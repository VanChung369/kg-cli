import { loadConfig } from "../config/load-config.js";
import { createContainsEdge } from "../core/create-contains-edge.js";
import { createFileNode } from "../core/create-file-node.js";
import { createProjectNode } from "../core/create-project-node.js";
import type { KnowledgeGraph } from "../core/graph-types.js";
import { parseNestjsSemantics } from "../parser/parse-nestjs-semantics.js";
import { parseTypescriptCalls } from "../parser/parse-typescript-calls.js";
import { parseTypescriptImports } from "../parser/parse-typescript-imports.js";
import { parseTypescriptSymbols } from "../parser/parse-typescript-symbols.js";
import { resolveSimpleCalls } from "../resolver/resolve-simple-calls.js";
import { scanFiles } from "../scanner/scan-files.js";
import { SqliteGraphStorage } from "../storage/sqlite-storage.js";

export type IndexProjectResult = {
  storagePath: string;
  graph: KnowledgeGraph;
  files: number;
  symbols: number;
  imports: number;
  rawCalls: number;
  callEdges: number;
  nestjsSemanticEdges: number;
  resolvedSimpleCalls: number;
  skippedRawCalls: number;
};

type IndexProjectOptions = {
  cwd?: string;
};

export async function indexProject(
  options: IndexProjectOptions = {},
): Promise<IndexProjectResult> {
  const cwd = options.cwd ?? process.cwd();
  const config = loadConfig({ cwd });

  const files = await scanFiles({
    cwd,
    include: config.include,
    exclude: config.exclude,
  });

  const projectNode = createProjectNode(config.projectName);
  const fileNodes = files.map(createFileNode);

  const symbolResults = files.map((filePath) =>
    parseTypescriptSymbols({
      cwd,
      filePath,
    }),
  );

  const importResults = files.map((filePath) =>
    parseTypescriptImports({
      cwd,
      filePath,
      allFiles: files,
    }),
  );

  const callResults = files.map((filePath) =>
    parseTypescriptCalls({
      cwd,
      filePath,
    }),
  );

  const nestjsResults = files.map((filePath) =>
    parseNestjsSemantics({
      cwd,
      filePath,
      allFiles: files,
    }),
  );

  const symbolNodes = symbolResults.flatMap((result) => result.nodes);
  const symbolEdges = symbolResults.flatMap((result) => result.edges);
  const importEdges = importResults.flatMap((result) => result.edges);
  const rawCallNodes = callResults.flatMap((result) => result.nodes);
  const callEdges = callResults.flatMap((result) => result.edges);
  const nestjsEdges = nestjsResults.flatMap((result) => result.edges);

  const graph: KnowledgeGraph = {
    nodes: [projectNode, ...fileNodes, ...symbolNodes, ...rawCallNodes],
    edges: [
      ...fileNodes.map((fileNode) => createContainsEdge(projectNode, fileNode)),
      ...symbolEdges,
      ...importEdges,
      ...callEdges,
      ...nestjsEdges,
    ],
  };

  const storage = new SqliteGraphStorage({
    cwd,
    dbPath: config.storage.path,
  });

  try {
    storage.saveGraph(graph);

    const simpleCallResolution = resolveSimpleCalls(storage);

    return {
      storagePath: config.storage.path,
      graph,
      files: fileNodes.length,
      symbols: symbolNodes.length,
      imports: importEdges.length,
      rawCalls: rawCallNodes.length,
      callEdges: callEdges.length,
      nestjsSemanticEdges: nestjsEdges.length,
      resolvedSimpleCalls: simpleCallResolution.resolvedCount,
      skippedRawCalls: simpleCallResolution.skippedCount,
    };
  } finally {
    storage.close();
  }
}

export function formatIndexProjectResult(result: IndexProjectResult): string {
  const lines: string[] = [];

  lines.push("Knowledge graph indexed successfully.");
  lines.push(`Storage: ${result.storagePath}`);
  lines.push(`Nodes: ${result.graph.nodes.length}`);
  lines.push(`Edges: ${result.graph.edges.length}`);
  lines.push(`Files: ${result.files}`);
  lines.push(`Symbols: ${result.symbols}`);
  lines.push(`Imports: ${result.imports}`);
  lines.push(`Raw calls: ${result.rawCalls}`);
  lines.push(`Call edges: ${result.callEdges}`);
  lines.push(`NestJS semantic edges: ${result.nestjsSemanticEdges}`);
  lines.push(`Resolved simple calls: ${result.resolvedSimpleCalls}`);
  lines.push(`Skipped raw calls: ${result.skippedRawCalls}`);

  return lines.join("\n");
}
