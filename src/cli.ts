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
import { parseTypescriptCalls } from "./parser/parse-typescript-calls.js";
import { formatRawCalls } from "./query/list-raw-calls.js";
import { resolveSimpleCalls } from "./resolver/resolve-simple-calls.js";
import { findUniqueSymbolFromMatches } from "./query/find-unique-symbol.js";
import { formatCallees } from "./query/list-callees.js";
import { formatCallers } from "./query/list-callers.js";
import { analyzeImpact, formatImpact } from "./query/analyze-impact.js";
import {
  formatSymbolContext,
  getSymbolContext,
} from "./query/show-context.js";
import {
  analyzeFileImpact,
  formatFileImpact,
} from "./query/analyze-file-impact.js";

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

      const callResults = files.map((filePath) =>
        parseTypescriptCalls({
          filePath,
        }),
      );

      const symbolNodes = symbolResults.flatMap((result) => result.nodes);
      const symbolEdges = symbolResults.flatMap((result) => result.edges);
      const importEdges = importResults.flatMap((result) => result.edges);
      const rawCallNodes = callResults.flatMap((result) => result.nodes);
      const callEdges = callResults.flatMap((result) => result.edges);

      const graph: KnowledgeGraph = {
        nodes: [projectNode, ...fileNodes, ...symbolNodes, ...rawCallNodes],
        edges: [
          ...fileNodes.map((fileNode) =>
            createContainsEdge(projectNode, fileNode),
          ),
          ...symbolEdges,
          ...importEdges,
          ...callEdges,
        ],
      };

      storage = new SqliteGraphStorage({
        dbPath: config.storage.path,
      });

      storage.saveGraph(graph);

      const simpleCallResolution = resolveSimpleCalls(storage);

      console.log("Knowledge graph indexed successfully.");
      console.log(`Storage: ${config.storage.path}`);
      console.log(`Nodes: ${graph.nodes.length}`);
      console.log(`Edges: ${graph.edges.length}`);
      console.log(`Files: ${fileNodes.length}`);
      console.log(`Symbols: ${symbolNodes.length}`);
      console.log(`Imports: ${importEdges.length}`);
      console.log(`Raw calls: ${rawCallNodes.length}`);
      console.log(`Call edges: ${callEdges.length}`);
      console.log(
        `Resolved simple calls: ${simpleCallResolution.resolvedCount}`,
      );
      console.log(`Skipped raw calls: ${simpleCallResolution.skippedCount}`);
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

queryCommand
  .command("raw-calls")
  .description("List raw call expressions")
  .action(() => {
    let storage: SqliteGraphStorage | null = null;

    try {
      const config = loadConfig();

      storage = new SqliteGraphStorage({
        dbPath: config.storage.path,
      });

      const rawCalls = storage.findNodesByTypes(["raw_call"]);

      console.log(formatRawCalls(rawCalls));
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
  .command("callees")
  .description("List resolved symbols called by a symbol")
  .argument("<symbol>", "Caller symbol name or qualified name")
  .action((symbol: string) => {
    let storage: SqliteGraphStorage | null = null;

    try {
      const config = loadConfig();

      storage = new SqliteGraphStorage({
        dbPath: config.storage.path,
      });

      const matches = storage.findSymbolsByName(symbol);
      const result = findUniqueSymbolFromMatches(matches);

      if (!result.ok) {
        console.log(
          formatCallees({
            symbolName: symbol,
            caller: null,
            callees: [],
          }),
        );

        if (result.reason === "ambiguous") {
          console.log("");
          console.log("Multiple matches found. Use a qualified name:");
          for (const match of result.matches) {
            const qualifiedName =
              typeof match.metadata?.qualifiedName === "string"
                ? match.metadata.qualifiedName
                : match.name;

            console.log(`- ${qualifiedName} (${match.filePath ?? "unknown"})`);
          }
        }

        process.exitCode = 1;
        return;
      }

      const callees = storage
        .findOutgoingNodesByEdgeType(result.symbol.id, "CALLS")
        .filter((node) => node.type !== "raw_call");

      console.log(
        formatCallees({
          symbolName: symbol,
          caller: result.symbol,
          callees,
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
  .command("callers")
  .description("List resolved symbols that call a symbol")
  .argument("<symbol>", "Target symbol name or qualified name")
  .action((symbol: string) => {
    let storage: SqliteGraphStorage | null = null;

    try {
      const config = loadConfig();

      storage = new SqliteGraphStorage({
        dbPath: config.storage.path,
      });

      const matches = storage.findSymbolsByName(symbol);
      const result = findUniqueSymbolFromMatches(matches);

      if (!result.ok) {
        console.log(
          formatCallers({
            symbolName: symbol,
            target: null,
            callers: [],
          }),
        );

        if (result.reason === "ambiguous") {
          console.log("");
          console.log("Multiple matches found. Use a qualified name:");
          for (const match of result.matches) {
            const qualifiedName =
              typeof match.metadata?.qualifiedName === "string"
                ? match.metadata.qualifiedName
                : match.name;

            console.log(`- ${qualifiedName} (${match.filePath ?? "unknown"})`);
          }
        }

        process.exitCode = 1;
        return;
      }

      const callers = storage
        .findIncomingNodesByEdgeType(result.symbol.id, "CALLS")
        .filter((node) => node.type !== "raw_call");

      console.log(
        formatCallers({
          symbolName: symbol,
          target: result.symbol,
          callers,
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
  .command("impact")
  .description("Analyze callers affected by a symbol")
  .argument("<symbol>", "Target symbol name or qualified name")
  .option("-d, --depth <number>", "Max caller depth", "3")
  .action((symbol: string, options: { depth?: string }) => {
    let storage: SqliteGraphStorage | null = null;

    try {
      const config = loadConfig();

      storage = new SqliteGraphStorage({
        dbPath: config.storage.path,
      });

      const matches = storage.findSymbolsByName(symbol);
      const result = findUniqueSymbolFromMatches(matches);

      if (!result.ok) {
        console.log(`Target symbol not found: ${symbol}`);

        if (result.reason === "ambiguous") {
          console.log("");
          console.log("Multiple matches found. Use a qualified name:");
          for (const match of result.matches) {
            const qualifiedName =
              typeof match.metadata?.qualifiedName === "string"
                ? match.metadata.qualifiedName
                : match.name;

            console.log(`- ${qualifiedName} (${match.filePath ?? "unknown"})`);
          }
        }

        process.exitCode = 1;
        return;
      }

      const maxDepth = Number.parseInt(options.depth ?? "3", 10);

      const impact = analyzeImpact({
        storage,
        target: result.symbol,
        maxDepth: Number.isFinite(maxDepth) ? maxDepth : 3,
      });

      console.log(formatImpact(impact));
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
  .command("context")
  .description("Show AI-friendly context for a symbol")
  .argument("<symbol>", "Symbol name or qualified name")
  .option("-d, --depth <number>", "Max caller depth for affected files", "3")
  .action((symbol: string, options: { depth?: string }) => {
    let storage: SqliteGraphStorage | null = null;

    try {
      const config = loadConfig();

      storage = new SqliteGraphStorage({
        dbPath: config.storage.path,
      });

      const matches = storage.findSymbolsByName(symbol);
      const result = findUniqueSymbolFromMatches(matches);

      if (!result.ok) {
        console.log(`Target symbol not found: ${symbol}`);

        if (result.reason === "ambiguous") {
          console.log("");
          console.log("Multiple matches found. Use a qualified name:");
          for (const match of result.matches) {
            const qualifiedName =
              typeof match.metadata?.qualifiedName === "string"
                ? match.metadata.qualifiedName
                : match.name;

            console.log(`- ${qualifiedName} (${match.filePath ?? "unknown"})`);
          }
        }

        process.exitCode = 1;
        return;
      }

      const maxDepth = Number.parseInt(options.depth ?? "3", 10);

      const context = getSymbolContext({
        storage,
        symbol: result.symbol,
        maxDepth: Number.isFinite(maxDepth) ? maxDepth : 3,
      });

      console.log(formatSymbolContext(context));
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
  .command("impact-file")
  .description("Analyze callers affected by all symbols in a file")
  .argument("<file>", "Target file path")
  .option("-d, --depth <number>", "Max caller depth", "3")
  .action((file: string, options: { depth?: string }) => {
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

      const maxDepth = Number.parseInt(options.depth ?? "3", 10);

      const impact = analyzeFileImpact({
        storage,
        file: targetFile,
        maxDepth: Number.isFinite(maxDepth) ? maxDepth : 3,
      });

      console.log(formatFileImpact(impact));
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
