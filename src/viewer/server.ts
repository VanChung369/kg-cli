import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve as resolvePath, extname, sep } from "node:path";
import { loadConfig } from "../config/load-config.js";
import { SqliteGraphStorage } from "../storage/sqlite-storage.js";

const SOURCE_ALLOWED_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".vue",
  ".svelte",
  ".html",
  ".css",
  ".scss",
]);
const MAX_SOURCE_BYTES = 1024 * 1024; // 1 MB

export type StartViewerOptions = {
  port?: number;
  host?: string;
};

export type StartViewerResult = {
  url: string;
  close: () => Promise<void>;
};

const VIEWER_HTML = readFileSync(new URL("./viewer.html", import.meta.url), {
  encoding: "utf8",
});

export async function startViewerServer(
  options: StartViewerOptions = {},
): Promise<StartViewerResult> {
  let port = options.port ?? 4477;
  const host = options.host ?? "127.0.0.1";
  const maxAttempts = 10;

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      sendError(
        res,
        500,
        error instanceof Error ? error.message : "Unknown error",
      );
    });
  });

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      break; // Success
    } catch (err: any) {
      if (err.code === "EADDRINUSE") {
        if (attempt < maxAttempts - 1) {
          port++;
        } else if (attempt === maxAttempts - 1) {
          port = 0; // Try OS assigned port as last resort
        } else {
          throw new Error(
            `Failed to bind to any port after ${maxAttempts} attempts.`,
          );
        }
      } else {
        throw err;
      }
    }
  }

  const address = server.address();
  if (address && typeof address === "object") {
    port = address.port;
  }

  const url = `http://${host}:${port}`;

  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method !== "GET") {
    sendError(res, 405, "Method not allowed");
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(VIEWER_HTML);
    return;
  }

  if (url.pathname === "/graph.json") {
    const payload = buildGraphPayload();
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(payload));
    return;
  }

  if (url.pathname === "/source") {
    const filePath = url.searchParams.get("path");
    const startParam = url.searchParams.get("start");
    const endParam = url.searchParams.get("end");
    
    if (!filePath) {
      sendError(res, 400, "Missing path parameter");
      return;
    }

    const safePath = resolveSafeSourcePath(filePath);
    if (!safePath) {
      sendError(res, 403, "Path is outside project root or not allowed");
      return;
    }

    try {
      let content = readFileSync(safePath, { encoding: "utf8" });
      
      if (startParam && endParam) {
        const startLine = parseInt(startParam, 10);
        const endLine = parseInt(endParam, 10);
        if (!Number.isNaN(startLine) && !Number.isNaN(endLine) && startLine <= endLine) {
          const lines = content.split('\n');
          const contextStart = Math.max(0, startLine - 1 - 5);
          const contextEnd = Math.min(lines.length, endLine + 5);
          content = lines.slice(contextStart, contextEnd).join('\n');
        }
      }

      if (Buffer.byteLength(content, "utf8") > MAX_SOURCE_BYTES) {
        sendError(res, 413, "File too large");
        return;
      }
      res.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(content);
    } catch {
      sendError(res, 404, "File not found or unreadable");
    }
    return;
  }

  sendError(res, 404, "Not found");
}

function buildGraphPayload() {
  const config = loadConfig();
  const storage = new SqliteGraphStorage({ dbPath: config.storage.path });

  try {
    const rawNodes = storage.findAllNodes();
    const rawEdges = storage.findAllEdges();

    const nodeIds = new Set(rawNodes.map((node) => node.id));

    const nodes = rawNodes.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      filePath: node.filePath,
      language: node.language,
      startLine: node.startLine,
      endLine: node.endLine,
    }));

    const links = rawEdges
      .filter((edge) => nodeIds.has(edge.fromId) && nodeIds.has(edge.toId))
      .map((edge) => ({
        source: edge.fromId,
        target: edge.toId,
        type: edge.type,
      }));

    return {
      stats: { nodes: nodes.length, links: links.length },
      nodes,
      links,
    };
  } finally {
    storage.close();
  }
}

function sendError(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: message }));
}

function resolveSafeSourcePath(rawPath: string): string | null {
  if (!rawPath) return null;
  // Reject NUL bytes and obviously suspicious sequences early.
  if (rawPath.includes("\0")) return null;

  const ext = extname(rawPath).toLowerCase();
  if (ext && !SOURCE_ALLOWED_EXTS.has(ext)) return null;

  const projectRoot = (() => {
    try {
      return realpathSync(process.cwd());
    } catch {
      return resolvePath(process.cwd());
    }
  })();

  const candidate = isAbsolute(rawPath)
    ? rawPath
    : resolvePath(projectRoot, rawPath);

  let resolved: string;
  try {
    resolved = realpathSync(candidate);
  } catch {
    // Fall back to lexical resolution so we still reject path traversal
    // even if file does not exist.
    resolved = resolvePath(candidate);
  }

  const rootWithSep = projectRoot.endsWith(sep)
    ? projectRoot
    : projectRoot + sep;
  if (resolved !== projectRoot && !resolved.startsWith(rootWithSep)) {
    return null;
  }
  return resolved;
}
