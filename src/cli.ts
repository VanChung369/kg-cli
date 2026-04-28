#!/usr/bin/env node

import { Command } from "commander";
import { watch } from "chokidar";
import { initConfig } from "./config/init-config.js";
import { loadConfig } from "./config/load-config.js";
import {
  formatIndexProjectResult,
  indexProject,
} from "./indexer/index-project.js";
import { formatSymbols, getSymbolNodeTypes } from "./query/list-symbols.js";
import { SqliteGraphStorage } from "./storage/sqlite-storage.js";
import { formatFiles, type FileSummary } from "./query/list-files.js";
import { normalizeGraphPath } from "./core/graph-id.js";
import { formatImports } from "./query/list-imports.js";
import { formatDependents } from "./query/list-dependents.js";
import { formatSymbolDetail } from "./query/show-symbol.js";
import { formatRawCalls } from "./query/list-raw-calls.js";
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
import {
  formatModuleContext,
  getModuleContext,
} from "./query/show-module.js";
import {
  formatRouteContext,
  formatRoutes,
  getRouteContext,
  getRoutes,
} from "./query/list-routes.js";
import { startMcpServer } from "./mcp/server.js";

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
    try {
      const result = await indexProject();

      console.log(formatIndexProjectResult(result));
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message);
        process.exitCode = 1;
        return;
      }

      console.error("Unknown error");
      process.exitCode = 1;
    }
  });

program
  .command("watch")
  .description("Watch project files and re-index on change")
  .option("--no-initial", "Skip the initial index run")
  .option("-d, --debounce <ms>", "Debounce delay in milliseconds", "300")
  .action(async (options: { initial?: boolean; debounce?: string }) => {
    try {
      const config = loadConfig();
      const debounceMs = Number.parseInt(options.debounce ?? "300", 10);
      const delay = Number.isFinite(debounceMs) ? debounceMs : 300;

      let timer: NodeJS.Timeout | null = null;
      let running = false;
      let pending = false;

      const runIndex = async (reason: string) => {
        if (running) {
          pending = true;
          return;
        }

        running = true;
        pending = false;

        try {
          console.log(`[${new Date().toISOString()}] Indexing: ${reason}`);
          const result = await indexProject();
          console.log(formatIndexProjectResult(result));
        } catch (error) {
          if (error instanceof Error) {
            console.error(error.message);
          } else {
            console.error("Unknown error");
          }
        } finally {
          running = false;

          if (pending) {
            scheduleIndex("pending changes");
          }
        }
      };

      const scheduleIndex = (reason: string) => {
        if (timer) {
          clearTimeout(timer);
        }

        timer = setTimeout(() => {
          timer = null;
          void runIndex(reason);
        }, delay);
      };

      if (options.initial !== false) {
        await runIndex("initial");
      }

      const watchPaths = getWatchPaths(config.include);

      const watcher = watch(watchPaths, {
        cwd: process.cwd(),
        ignored: (filePath) =>
          shouldIgnoreWatchPath(filePath, [...config.exclude, ".kg/**"]),
        ignoreInitial: true,
        persistent: true,
      });

      watcher.on("all", (eventName, filePath) => {
        scheduleIndex(`${eventName} ${normalizeGraphPath(filePath)}`);
      });

      watcher.on("error", (error) => {
        console.error(error instanceof Error ? error.message : String(error));
      });

      watcher.on("ready", () => {
        console.log(`Watching for changes: ${watchPaths.join(", ")}`);
      });

      const close = async () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }

        await watcher.close();
      };

      process.once("SIGINT", () => {
        void close().finally(() => {
          process.exit(0);
        });
      });

      process.once("SIGTERM", () => {
        void close().finally(() => {
          process.exit(0);
        });
      });
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message);
        process.exitCode = 1;
        return;
      }

      console.error("Unknown error");
      process.exitCode = 1;
    }
  });

program
  .command("mcp")
  .description("Start an MCP server over stdio")
  .action(() => {
    try {
      startMcpServer();
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message);
        process.exitCode = 1;
        return;
      }

      console.error("Unknown error");
      process.exitCode = 1;
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

queryCommand
  .command("module")
  .description("Show NestJS module context")
  .argument("<module>", "Module class name or qualified name")
  .action((moduleName: string) => {
    let storage: SqliteGraphStorage | null = null;

    try {
      const config = loadConfig();

      storage = new SqliteGraphStorage({
        dbPath: config.storage.path,
      });

      const matches = storage.findSymbolsByName(moduleName);
      const result = findUniqueSymbolFromMatches(matches);

      if (!result.ok) {
        console.log(`Module symbol not found: ${moduleName}`);

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

      const context = getModuleContext({
        storage,
        module: result.symbol,
      });

      console.log(formatModuleContext(context));
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
  .command("routes")
  .description("List framework routes")
  .option(
    "-k, --kind <kind>",
    "Filter by route kind, for example page or api_route",
  )
  .action((options: { kind?: string }) => {
    let storage: SqliteGraphStorage | null = null;

    try {
      const config = loadConfig();

      storage = new SqliteGraphStorage({
        dbPath: config.storage.path,
      });

      const routes = getRoutes(storage.findFiles()).filter((route) =>
        options.kind ? route.kind === options.kind : true,
      );

      console.log(formatRoutes(routes));
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
  .command("route")
  .description("Show context for a framework route")
  .argument("<route>", "Route path, for example /api/users")
  .option("-k, --kind <kind>", "Route kind, for example page or api_route")
  .action((routePath: string, options: { kind?: string }) => {
    let storage: SqliteGraphStorage | null = null;

    try {
      const config = loadConfig();

      storage = new SqliteGraphStorage({
        dbPath: config.storage.path,
      });

      const normalizedRoutePath = normalizeRoutePath(routePath);
      const matches = getRoutes(storage.findFiles()).filter(
        (route) =>
          route.route === normalizedRoutePath &&
          (options.kind ? route.kind === options.kind : true),
      );

      if (matches.length === 0) {
        const kindSuffix = options.kind ? ` (${options.kind})` : "";
        console.error(
          `Route not found in graph: ${normalizedRoutePath}${kindSuffix}`,
        );
        console.error("Run `kg index` first or check the route path.");
        process.exitCode = 1;
        return;
      }

      if (matches.length > 1) {
        console.error(`Multiple route files found for: ${normalizedRoutePath}`);
        for (const match of matches) {
          console.error(
            `- ${match.kind}: ${match.file.filePath ?? match.file.name}`,
          );
        }
        process.exitCode = 1;
        return;
      }

      const context = getRouteContext({
        storage,
        route: matches[0]!,
      });

      console.log(formatRouteContext(context));
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

function normalizeRoutePath(routePath: string): string {
  const normalized = routePath.trim();

  if (normalized.length === 0 || normalized === "/") {
    return "/";
  }

  return `/${normalized.replace(/^\/+|\/+$/g, "")}`;
}

function getWatchPaths(includePatterns: string[]): string[] {
  const paths = includePatterns.map(getStaticWatchPath);
  const uniquePaths = Array.from(new Set(paths));

  return uniquePaths.length > 0 ? uniquePaths : ["."];
}

function getStaticWatchPath(pattern: string): string {
  const normalizedPattern = normalizeGraphPath(pattern);
  const segments = normalizedPattern.split("/");
  const staticSegments: string[] = [];

  for (const segment of segments) {
    if (hasGlobSyntax(segment)) break;
    if (segment.length === 0) continue;

    staticSegments.push(segment);
  }

  if (staticSegments.length === 0) {
    return ".";
  }

  return staticSegments.join("/");
}

function hasGlobSyntax(value: string): boolean {
  return /[*?[\]{}()!+@]/.test(value);
}

function shouldIgnoreWatchPath(filePath: string, excludePatterns: string[]) {
  const normalizedPath = normalizeGraphPath(filePath);

  return excludePatterns.some((pattern) => {
    const staticPath = getStaticIgnorePath(pattern);

    if (!staticPath || staticPath === ".") return false;

    return (
      normalizedPath === staticPath ||
      normalizedPath.startsWith(`${staticPath}/`)
    );
  });
}

function getStaticIgnorePath(pattern: string): string | null {
  const staticPath = getStaticWatchPath(pattern);
  const normalizedPattern = normalizeGraphPath(pattern);

  if (normalizedPattern === staticPath) {
    return staticPath;
  }

  if (normalizedPattern === `${staticPath}/**`) {
    return staticPath;
  }

  return null;
}
