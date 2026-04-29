import { createInterface } from "node:readline";
import { loadConfig } from "../config/load-config.js";
import { normalizeGraphPath } from "../core/graph-id.js";
import { findUniqueSymbolFromMatches } from "../query/find-unique-symbol.js";
import { analyzeImpact } from "../query/analyze-impact.js";
import { getRoutes, getRouteContext } from "../query/list-routes.js";
import { getSymbolContext } from "../query/show-context.js";
import { SqliteGraphStorage, type StoredGraphNode } from "../storage/sqlite-storage.js";

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const TOOLS: McpTool[] = [
  {
    name: "get_symbol_context",
    description:
      "Return file, callers, callees, injections, imports, and affected files for a symbol.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        depth: { type: "number", default: 3 },
      },
      required: ["symbol"],
      additionalProperties: false,
    },
  },
  {
    name: "find_callers",
    description: "Return resolved symbols that call a symbol.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
      },
      required: ["symbol"],
      additionalProperties: false,
    },
  },
  {
    name: "find_callees",
    description: "Return resolved symbols called by a symbol.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
      },
      required: ["symbol"],
      additionalProperties: false,
    },
  },
  {
    name: "find_file_dependencies",
    description: "Return imports, dependents, and declared symbols for a file.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string" },
      },
      required: ["file"],
      additionalProperties: false,
    },
  },
  {
    name: "analyze_impact",
    description: "Return caller impact for a symbol.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        depth: { type: "number", default: 3 },
      },
      required: ["symbol"],
      additionalProperties: false,
    },
  },
  {
    name: "get_project_map",
    description: "Return indexed files, symbols, and framework routes.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_route_context",
    description: "Return file, imports, dependents, and symbols for a framework route.",
    inputSchema: {
      type: "object",
      properties: {
        route: { type: "string" },
        kind: { type: "string" },
      },
      required: ["route"],
      additionalProperties: false,
    },
  },
  {
    name: "search_symbols",
    description: "Search for symbols by name or partial name (fuzzy search). Use this to find the exact name of a symbol before calling other tools.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", default: 10 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
];

type McpServerOptions = {
  cwd?: string;
};

export function startMcpServer(options: McpServerOptions = {}) {
  const cwd = options.cwd ?? process.cwd();
  let queue = Promise.resolve();

  const input = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  input.on("line", (line) => {
    if (line.trim().length === 0) return;

    queue = queue
      .then(() =>
        handleLine({
          cwd,
          line,
        }),
      )
      .catch((error) => {
        writeError(
          null,
          -32603,
          error instanceof Error ? error.message : "Internal error",
        );
      });
  });
}

async function handleLine(params: { cwd: string; line: string }) {
  let message: unknown;

  try {
    message = JSON.parse(params.line) as unknown;
  } catch {
    writeError(null, -32700, "Parse error");
    return;
  }

  if (Array.isArray(message)) {
    const responses = (
      await Promise.all(
        message.map((item) =>
          handleMessage({
            cwd: params.cwd,
            message: item,
          }),
        ),
      )
    ).filter((response): response is Record<string, unknown> => response !== null);

    if (responses.length > 0) {
      process.stdout.write(`${JSON.stringify(responses)}\n`);
    }

    return;
  }

  const response = await handleMessage({
    cwd: params.cwd,
    message,
  });

  if (response) {
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

async function handleMessage(params: {
  cwd: string;
  message: unknown;
}): Promise<Record<string, unknown> | null> {
  if (!isRecord(params.message)) {
    return createError(null, -32600, "Invalid Request");
  }

  const request = params.message as JsonRpcRequest;

  if (!request.method) {
    if (request.id !== undefined) {
      return createError(request.id, -32600, "Invalid Request");
    }
    return null;
  }

  if (request.id === undefined) {
    return null;
  }

  try {
    const result = await handleRequest({
      cwd: params.cwd,
      request,
    });

    return createResult(request.id, result);
  } catch (error) {
    return createError(
      request.id,
      -32603,
      error instanceof Error ? error.message : "Internal error",
    );
  }
}

async function handleRequest(params: {
  cwd: string;
  request: JsonRpcRequest;
}): Promise<unknown> {
  switch (params.request.method) {
    case "initialize":
      return {
        protocolVersion: getRequestedProtocolVersion(params.request.params),
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "kg-cli",
          version: "0.1.0",
        },
      };

    case "ping":
      return {};

    case "tools/list":
      return {
        tools: TOOLS,
      };

    case "tools/call":
      return callTool({
        cwd: params.cwd,
        params: params.request.params,
      });

    default:
      throw new Error(`Unsupported MCP method: ${params.request.method}`);
  }
}

function callTool(params: { cwd: string; params: unknown }) {
  const toolCall = parseToolCall(params.params);
  const result = runTool({
    cwd: params.cwd,
    name: toolCall.name,
    arguments: toolCall.arguments,
  });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

function runTool(params: {
  cwd: string;
  name: string;
  arguments: Record<string, unknown>;
}): unknown {
  const config = loadConfig({ cwd: params.cwd });
  const storage = new SqliteGraphStorage({
    cwd: params.cwd,
    dbPath: config.storage.path,
  });

  try {
    switch (params.name) {
      case "get_symbol_context":
        return withSymbol(storage, params.arguments, (symbol) =>
          getSymbolContext({
            storage,
            symbol,
            maxDepth: getDepth(params.arguments),
          }),
        );

      case "find_callers":
        return withSymbol(storage, params.arguments, (symbol) => ({
          symbol: toNodeSummary(symbol),
          callers: storage
            .findIncomingNodesByEdgeType(symbol.id, "CALLS")
            .filter((node) => node.type !== "raw_call")
            .map(toNodeSummary),
        }));

      case "find_callees":
        return withSymbol(storage, params.arguments, (symbol) => ({
          symbol: toNodeSummary(symbol),
          callees: storage
            .findOutgoingNodesByEdgeType(symbol.id, "CALLS")
            .filter((node) => node.type !== "raw_call")
            .map(toNodeSummary),
        }));

      case "find_file_dependencies":
        return getFileDependencies(storage, params.arguments);

      case "analyze_impact":
        return withSymbol(storage, params.arguments, (symbol) => {
          const impact = analyzeImpact({
            storage,
            target: symbol,
            maxDepth: getDepth(params.arguments),
          });

          return {
            target: toNodeSummary(impact.target),
            affectedFiles: impact.affectedFiles,
            levels: impact.levels.map((level) => ({
              depth: level.depth,
              callers: level.callers.map(toNodeSummary),
            })),
          };
        });

      case "get_project_map":
        return getProjectMap(storage);

      case "get_route_context":
        return getMcpRouteContext(storage, params.arguments);

      case "search_symbols": {
        const query = requireString(params.arguments, "query");
        let limit = 10;
        if (typeof params.arguments.limit === "number") {
          limit = Math.max(1, Math.min(50, Math.floor(params.arguments.limit)));
        }
        const matches = storage.findSymbolsByName(query);
        return {
          query,
          count: matches.length,
          matches: matches.slice(0, limit).map(toNodeSummary),
        };
      }

      default:
        throw new Error(`Unknown tool: ${params.name}`);
    }
  } finally {
    storage.close();
  }
}

function withSymbol<T>(
  storage: SqliteGraphStorage,
  args: Record<string, unknown>,
  callback: (symbol: StoredGraphNode) => T,
): T {
  const symbolName = requireString(args, "symbol");
  const matches = storage.findSymbolsByName(symbolName);
  const result = findUniqueSymbolFromMatches(matches);

  if (!result.ok) {
    if (result.reason === "ambiguous") {
      throw new Error(
        `Ambiguous symbol: ${symbolName}. Matches: ${result.matches
          .map((match) => getQualifiedName(match))
          .join(", ")}`,
      );
    }

    throw new Error(`Symbol not found: ${symbolName}`);
  }

  return callback(result.symbol);
}

function getFileDependencies(
  storage: SqliteGraphStorage,
  args: Record<string, unknown>,
) {
  const filePath = normalizeGraphPath(requireString(args, "file"));
  const file = storage.findFileByPath(filePath);

  if (!file) {
    throw new Error(`File not found: ${filePath}`);
  }

  return {
    file: toNodeSummary(file),
    imports: storage
      .findOutgoingNodesByEdgeType(file.id, "IMPORTS")
      .map(toNodeSummary),
    dependents: storage
      .findIncomingNodesByEdgeType(file.id, "IMPORTS")
      .map(toNodeSummary),
    symbols: storage
      .findOutgoingNodesByEdgeType(file.id, "DECLARES")
      .map(toNodeSummary),
  };
}

function getProjectMap(storage: SqliteGraphStorage) {
  return {
    files: storage.findFiles().map(toNodeSummary),
    symbols: storage
      .findNodesByTypes(["class", "function", "method", "interface", "type"])
      .map(toNodeSummary),
    routes: getRoutes(storage.findFiles()).map((route) => ({
      route: route.route,
      kind: route.kind,
      framework: route.framework,
      file: toNodeSummary(route.file),
    })),
  };
}

function getMcpRouteContext(
  storage: SqliteGraphStorage,
  args: Record<string, unknown>,
) {
  const routePath = normalizeRoutePath(requireString(args, "route"));
  const kind = typeof args.kind === "string" ? args.kind : null;
  const matches = getRoutes(storage.findFiles()).filter(
    (route) => route.route === routePath && (kind ? route.kind === kind : true),
  );

  if (matches.length === 0) {
    throw new Error(`Route not found: ${routePath}${kind ? ` (${kind})` : ""}`);
  }

  if (matches.length > 1) {
    throw new Error(
      `Multiple route files found for ${routePath}: ${matches
        .map((match) => `${match.kind}:${match.file.filePath ?? match.file.name}`)
        .join(", ")}`,
    );
  }

  return getRouteContext({
    storage,
    route: matches[0]!,
  });
}

function parseToolCall(params: unknown): {
  name: string;
  arguments: Record<string, unknown>;
} {
  if (!isRecord(params)) {
    throw new Error("Invalid tools/call params");
  }

  const name = params.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("Missing tool name");
  }

  const args = params.arguments;

  return {
    name,
    arguments: isRecord(args) ? args : {},
  };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required string argument: ${key}`);
  }

  return value;
}

function getDepth(args: Record<string, unknown>): number {
  const value = args.depth;

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 3;
  }

  return Math.max(1, Math.floor(value));
}

function toNodeSummary(node: StoredGraphNode) {
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    qualifiedName: getQualifiedName(node),
    filePath: node.filePath,
    startLine: node.startLine,
    endLine: node.endLine,
    metadata: node.metadata,
  };
}

function getQualifiedName(node: StoredGraphNode): string {
  const qualifiedName = node.metadata?.qualifiedName;

  if (typeof qualifiedName === "string" && qualifiedName.length > 0) {
    return qualifiedName;
  }

  return node.name;
}

function normalizeRoutePath(routePath: string): string {
  const normalized = routePath.trim();

  if (normalized.length === 0 || normalized === "/") {
    return "/";
  }

  return `/${normalized.replace(/^\/+|\/+$/g, "")}`;
}

function getRequestedProtocolVersion(params: unknown): string {
  if (!isRecord(params)) return "2024-11-05";

  const protocolVersion = params.protocolVersion;

  return typeof protocolVersion === "string" && protocolVersion.length > 0
    ? protocolVersion
    : "2024-11-05";
}

function writeResult(id: JsonRpcId, result: unknown) {
  process.stdout.write(`${JSON.stringify(createResult(id, result))}\n`);
}

function writeError(id: JsonRpcId, code: number, message: string) {
  process.stdout.write(`${JSON.stringify(createError(id, code, message))}\n`);
}

function createResult(id: JsonRpcId, result: unknown): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function createError(
  id: JsonRpcId,
  code: number,
  message: string,
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
