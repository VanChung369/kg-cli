#!/usr/bin/env node

import { Command } from "commander";
import { initConfig } from "./config/init-config.js";
import { loadConfig } from "./config/load-config.js";
import { createContainsEdge } from "./core/create-contains-edge.js";
import { createFileNode } from "./core/create-file-node.js";
import { createProjectNode } from "./core/create-project-node.js";
import type { KnowledgeGraph } from "./core/graph-types.js";
import { parseTypescriptImports } from "./parser/parse-typescript-imports.js";
import { parseTypescriptSymbols } from "./parser/parse-typescript-symbols.js";
import { formatSymbols, getSymbolNodeTypes } from "./query/list-symbols.js";
import { scanFiles } from "./scanner/scan-files.js";
import { SqliteGraphStorage } from "./storage/sqlite-storage.js";
import { formatFiles, type FileSummary } from "./query/list-files.js";
import { normalizeGraphPath } from "./core/graph-id.js";
import { formatImports } from "./query/list-imports.js";
import { formatDependents } from "./query/list-dependents.js";
import { formatSymbolDetail } from "./query/show-symbol.js";

const program = new Command();

program
  .name("kg")
  .description("Local knowledge graph CLI for source code")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize knowledge graph config")
  .option("-f, --force", "Overwrite existing config file")
  .action((options: { force?: boolean }) => {
    const result = initConfig({
      force: options.force ?? false,
    });

    console.log(result.message);
    console.log(result.path);
  });

program
  .command("index")
  .description("Index current project")
  .action(async () => {
    let storage: SqliteGraphStorage | null = null;

    try {
      const config = loadConfig();

      const files = await scanFiles({
        include: config.include,
        exclude: config.exclude,
      });

      const projectNode = createProjectNode(config.projectName);
      const fileNodes = files.map(createFileNode);

      const symbolResults = files.map((filePath) =>
        parseTypescriptSymbols({
          filePath,
        }),
      );

      const importResults = files.map((filePath) =>
        parseTypescriptImports({
          filePath,
          allFiles: files,
        }),
      );

      const symbolNodes = symbolResults.flatMap((result) => result.nodes);
      const symbolEdges = symbolResults.flatMap((result) => result.edges);
      const importEdges = importResults.flatMap((result) => result.edges);

      const graph: KnowledgeGraph = {
        nodes: [projectNode, ...fileNodes, ...symbolNodes],
        edges: [
          ...fileNodes.map((fileNode) =>
            createContainsEdge(projectNode, fileNode),
          ),
          ...symbolEdges,
          ...importEdges,
        ],
      };

      storage = new SqliteGraphStorage({
        dbPath: config.storage.path,
      });

      storage.saveGraph(graph);

      console.log("Knowledge graph indexed successfully.");
      console.log(`Storage: ${config.storage.path}`);
      console.log(`Nodes: ${graph.nodes.length}`);
      console.log(`Edges: ${graph.edges.length}`);
      console.log(`Files: ${fileNodes.length}`);
      console.log(`Symbols: ${symbolNodes.length}`);
      console.log(`Imports: ${importEdges.length}`);
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message);
        process.exitCode = 1;
        return;
      }

      console.error("Unknown error");
      process.exitCode = 1;
    } finally {
      storage?.close();
    }
  });

const queryCommand = new Command("query").description(
  "Query indexed knowledge graph",
);

queryCommand
  .command("symbols")
  .description("List indexed symbols")
  .action(() => {
    let storage: SqliteGraphStorage | null = null;

    try {
      const config = loadConfig();

      storage = new SqliteGraphStorage({
        dbPath: config.storage.path,
      });

      const symbols = storage.findNodesByTypes(getSymbolNodeTypes());

      console.log(formatSymbols(symbols));
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message);
        process.exitCode = 1;
        return;
      }

      console.error("Unknown error");
      process.exitCode = 1;
    } finally {
      storage?.close();
    }
  });

queryCommand
  .command("files")
  .description("List indexed files")
  .action(() => {
    let storage: SqliteGraphStorage | null = null;

    try {
      const config = loadConfig();

      storage = new SqliteGraphStorage({
        dbPath: config.storage.path,
      });

      const files = storage.findFiles();

      const summaries: FileSummary[] = files.map((file) => ({
        file,
        imports: storage!.countOutgoingEdgesByType(file.id, "IMPORTS"),
        declares: storage!.countOutgoingEdgesByType(file.id, "DECLARES"),
      }));

      console.log(formatFiles(summaries));
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message);
        process.exitCode = 1;
        return;
      }

      console.error("Unknown error");
      process.exitCode = 1;
    } finally {
      storage?.close();
    }
  });

queryCommand
  .command("imports")
  .description("List files imported by a file")
  .argument("<file>", "Source file path")
  .action((file: string) => {
    let storage: SqliteGraphStorage | null = null;

    try {
      const config = loadConfig();

      storage = new SqliteGraphStorage({
        dbPath: config.storage.path,
      });

      const normalizedFilePath = normalizeGraphPath(file);
      const sourceFile = storage.findFileByPath(normalizedFilePath);

      if (!sourceFile) {
        console.error(`File not found in graph: ${normalizedFilePath}`);
        console.error("Run `kg index` first or check the file path.");
        process.exitCode = 1;
        return;
      }

      const imports = storage.findOutgoingNodesByEdgeType(
        sourceFile.id,
        "IMPORTS",
      );

      console.log(
        formatImports({
          sourceFilePath: normalizedFilePath,
          imports,
        }),
      );
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message);
        process.exitCode = 1;
        return;
      }

      console.error("Unknown error");
      process.exitCode = 1;
    } finally {
      storage?.close();
    }
  });

queryCommand
  .command("dependents")
  .description("List files that import a file")
  .argument("<file>", "Target file path")
  .action((file: string) => {
    let storage: SqliteGraphStorage | null = null;

    try {
      const config = loadConfig();

      storage = new SqliteGraphStorage({
        dbPath: config.storage.path,
      });

      const normalizedFilePath = normalizeGraphPath(file);
      const targetFile = storage.findFileByPath(normalizedFilePath);

      if (!targetFile) {
        console.error(`File not found in graph: ${normalizedFilePath}`);
        console.error("Run `kg index` first or check the file path.");
        process.exitCode = 1;
        return;
      }

      const dependents = storage.findIncomingNodesByEdgeType(
        targetFile.id,
        "IMPORTS",
      );

      console.log(
        formatDependents({
          targetFilePath: normalizedFilePath,
          dependents,
        }),
      );
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message);
        process.exitCode = 1;
        return;
      }

      console.error("Unknown error");
      process.exitCode = 1;
    } finally {
      storage?.close();
    }
  });

queryCommand
  .command("symbol")
  .description("Show symbol detail by name")
  .argument("<name>", "Symbol name or qualified name")
  .action((name: string) => {
    let storage: SqliteGraphStorage | null = null;

    try {
      const config = loadConfig();

      storage = new SqliteGraphStorage({
        dbPath: config.storage.path,
      });

      const symbols = storage.findSymbolsByName(name);

      console.log(
        formatSymbolDetail({
          query: name,
          symbols,
        }),
      );
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message);
        process.exitCode = 1;
        return;
      }

      console.error("Unknown error");
      process.exitCode = 1;
    } finally {
      storage?.close();
    }
  });

program.addCommand(queryCommand);

program.parse(process.argv);
