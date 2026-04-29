import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import type {
  GraphEdge,
  GraphNode,
  KnowledgeGraph,
} from "../core/graph-types.js";

type SqliteStorageOptions = {
  cwd?: string;
  dbPath: string;
};

export type StoredGraphNode = {
  id: string;
  type: string;
  name: string;
  filePath: string | null;
  language: string | null;
  startLine: number | null;
  endLine: number | null;
  metadata: Record<string, unknown> | null;
};

export type StoredGraphEdge = {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  metadata: Record<string, unknown> | null;
};

export type StoredRawCallWithCaller = {
  rawCallNode: StoredGraphNode;
  callerId: string;
  rawCall: string;
  line: number | null;
};

export class SqliteGraphStorage {
  private readonly db: Database.Database;

  constructor(options: SqliteStorageOptions) {
    const cwd = options.cwd ?? process.cwd();
    const absoluteDbPath = join(cwd, options.dbPath);

    mkdirSync(dirname(absoluteDbPath), {
      recursive: true,
    });

    this.db = new Database(absoluteDbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    this.migrate();
  }

  saveGraph(graph: KnowledgeGraph) {
    const transaction = this.db.transaction(() => {
      this.clear();
      this.insertNodes(graph.nodes);
      this.insertEdges(graph.edges);
    });

    transaction();
  }

  addEdges(edges: GraphEdge[]) {
    const transaction = this.db.transaction(() => {
      this.insertEdges(edges);
    });

    transaction();
  }

  close() {
    this.db.close();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        file_path TEXT,
        language TEXT,
        start_line INTEGER,
        end_line INTEGER,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        type TEXT NOT NULL,
        metadata TEXT,
        FOREIGN KEY (from_id) REFERENCES nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (to_id) REFERENCES nodes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
      CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
      CREATE INDEX IF NOT EXISTS idx_nodes_file_path ON nodes(file_path);

      CREATE INDEX IF NOT EXISTS idx_edges_from_id ON edges(from_id);
      CREATE INDEX IF NOT EXISTS idx_edges_to_id ON edges(to_id);
      CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);
    `);
  }

  private clear() {
    this.db.exec(`
      DELETE FROM edges;
      DELETE FROM nodes;
    `);
  }

  private insertNodes(nodes: GraphNode[]) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO nodes (
        id,
        type,
        name,
        file_path,
        language,
        start_line,
        end_line,
        metadata
      ) VALUES (
        @id,
        @type,
        @name,
        @filePath,
        @language,
        @startLine,
        @endLine,
        @metadata
      )
    `);

    for (const node of dedupeById(nodes)) {
      stmt.run({
        id: node.id,
        type: node.type,
        name: node.name,
        filePath: node.filePath ?? null,
        language: node.language ?? null,
        startLine: node.startLine ?? null,
        endLine: node.endLine ?? null,
        metadata: node.metadata ? JSON.stringify(node.metadata) : null,
      });
    }
  }

  private insertEdges(edges: GraphEdge[]) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO edges (
        id,
        from_id,
        to_id,
        type,
        metadata
      ) VALUES (
        @id,
        @fromId,
        @toId,
        @type,
        @metadata
      )
    `);

    const existsStmt = this.db.prepare(
      "SELECT 1 FROM nodes WHERE id = ? LIMIT 1",
    );
    const knownIds = new Set<string>();
    const hasNode = (id: string): boolean => {
      if (knownIds.has(id)) return true;
      const row = existsStmt.get(id) as { 1: number } | undefined;
      if (row) {
        knownIds.add(id);
        return true;
      }
      return false;
    };

    let skipped = 0;
    for (const edge of dedupeById(edges)) {
      if (!hasNode(edge.fromId) || !hasNode(edge.toId)) {
        skipped += 1;
        continue;
      }
      stmt.run({
        id: edge.id,
        fromId: edge.fromId,
        toId: edge.toId,
        type: edge.type,
        metadata: edge.metadata ? JSON.stringify(edge.metadata) : null,
      });
    }

    if (skipped > 0) {
      console.warn(
        `[kg] Skipped ${skipped} edge(s) referencing unknown node ids.`,
      );
    }
  }

  findNodesByTypes(types: string[]): StoredGraphNode[] {
    if (types.length === 0) return [];

    const placeholders = types.map(() => "?").join(", ");

    const rows = this.db
      .prepare(
        `
      SELECT
        id,
        type,
        name,
        file_path as filePath,
        language,
        start_line as startLine,
        end_line as endLine,
        metadata
      FROM nodes
      WHERE type IN (${placeholders})
      ORDER BY file_path ASC, start_line ASC, name ASC
      `,
      )
      .all(...types) as Array<
      Omit<StoredGraphNode, "metadata"> & {
        metadata: string | null;
      }
    >;

    return rows.map((row) => ({
      ...row,
      metadata: row.metadata ? parseMetadata(row.metadata) : null,
    }));
  }

  findFiles(): StoredGraphNode[] {
    const rows = this.db
      .prepare(
        `
      SELECT
        id,
        type,
        name,
        file_path as filePath,
        language,
        start_line as startLine,
        end_line as endLine,
        metadata
      FROM nodes
      WHERE type = 'file'
      ORDER BY file_path ASC
      `,
      )
      .all() as Array<
      Omit<StoredGraphNode, "metadata"> & {
        metadata: string | null;
      }
    >;

    return rows.map((row) => ({
      ...row,
      metadata: row.metadata ? parseMetadata(row.metadata) : null,
    }));
  }

  countOutgoingEdgesByType(fromId: string, type: string): number {
    const row = this.db
      .prepare(
        `
      SELECT COUNT(*) as count
      FROM edges
      WHERE from_id = ? AND type = ?
      `,
      )
      .get(fromId, type) as { count: number };

    return row.count;
  }

  findOutgoingNodesByEdgeType(fromId: string, type: string): StoredGraphNode[] {
    const rows = this.db
      .prepare(
        `
      SELECT
        n.id,
        n.type,
        n.name,
        n.file_path as filePath,
        n.language,
        n.start_line as startLine,
        n.end_line as endLine,
        n.metadata
      FROM edges e
      JOIN nodes n ON n.id = e.to_id
      WHERE e.from_id = ? AND e.type = ?
      ORDER BY n.file_path ASC, n.start_line ASC, n.name ASC
      `,
      )
      .all(fromId, type) as Array<
      Omit<StoredGraphNode, "metadata"> & {
        metadata: string | null;
      }
    >;

    return rows.map((row) => ({
      ...row,
      metadata: row.metadata ? parseMetadata(row.metadata) : null,
    }));
  }

  findFileByPath(filePath: string): StoredGraphNode | null {
    const normalizedPath = filePath.replaceAll("\\", "/");

    const row = this.db
      .prepare(
        `
      SELECT
        id,
        type,
        name,
        file_path as filePath,
        language,
        start_line as startLine,
        end_line as endLine,
        metadata
      FROM nodes
      WHERE type = 'file' AND file_path = ?
      LIMIT 1
      `,
      )
      .get(normalizedPath) as
      | (Omit<StoredGraphNode, "metadata"> & {
          metadata: string | null;
        })
      | undefined;

    if (!row) return null;

    return {
      ...row,
      metadata: row.metadata ? parseMetadata(row.metadata) : null,
    };
  }

  findIncomingNodesByEdgeType(toId: string, type: string): StoredGraphNode[] {
    const rows = this.db
      .prepare(
        `
      SELECT
        n.id,
        n.type,
        n.name,
        n.file_path as filePath,
        n.language,
        n.start_line as startLine,
        n.end_line as endLine,
        n.metadata
      FROM edges e
      JOIN nodes n ON n.id = e.from_id
      WHERE e.to_id = ? AND e.type = ?
      ORDER BY n.file_path ASC, n.start_line ASC, n.name ASC
      `,
      )
      .all(toId, type) as Array<
      Omit<StoredGraphNode, "metadata"> & {
        metadata: string | null;
      }
    >;

    return rows.map((row) => ({
      ...row,
      metadata: row.metadata ? parseMetadata(row.metadata) : null,
    }));
  }

  findSymbolsByName(name: string): StoredGraphNode[] {
    const normalizedName = name.trim();

    const exactRows = this.db
      .prepare(
        `
      SELECT
        id,
        type,
        name,
        file_path as filePath,
        language,
        start_line as startLine,
        end_line as endLine,
        metadata
      FROM nodes
      WHERE type IN ('class', 'function', 'method', 'interface', 'type', 'callback')
        AND (
          name = ?
          OR json_extract(metadata, '$.qualifiedName') = ?
        )
      ORDER BY file_path ASC, start_line ASC, name ASC
      `,
      )
      .all(normalizedName, normalizedName) as Array<
      Omit<StoredGraphNode, "metadata"> & {
        metadata: string | null;
      }
    >;

    if (exactRows.length > 0) {
      return exactRows.map((row) => ({
        ...row,
        metadata: row.metadata ? parseMetadata(row.metadata) : null,
      }));
    }

    const fuzzyRows = this.db
      .prepare(
        `
      SELECT
        id,
        type,
        name,
        file_path as filePath,
        language,
        start_line as startLine,
        end_line as endLine,
        metadata
      FROM nodes
      WHERE type IN ('class', 'function', 'method', 'interface', 'type', 'callback')
        AND (
          name LIKE ?
          OR json_extract(metadata, '$.qualifiedName') LIKE ?
        )
      ORDER BY file_path ASC, start_line ASC, name ASC
      `,
      )
      .all(`%${normalizedName}%`, `%${normalizedName}%`) as Array<
      Omit<StoredGraphNode, "metadata"> & {
        metadata: string | null;
      }
    >;

    return fuzzyRows.map((row) => ({
      ...row,
      metadata: row.metadata ? parseMetadata(row.metadata) : null,
    }));
  }

  findRawCallsWithCaller(): StoredRawCallWithCaller[] {
    const rows = this.db
      .prepare(
        `
      SELECT
        rc.id,
        rc.type,
        rc.name,
        rc.file_path as filePath,
        rc.language,
        rc.start_line as startLine,
        rc.end_line as endLine,
        rc.metadata,
        e.from_id as callerId,
        e.metadata as edgeMetadata
      FROM nodes rc
      JOIN edges e ON e.to_id = rc.id
      WHERE rc.type = 'raw_call'
        AND e.type = 'CALLS'
      ORDER BY rc.file_path ASC, rc.start_line ASC
      `,
      )
      .all() as Array<
      Omit<StoredGraphNode, "metadata"> & {
        metadata: string | null;
        callerId: string;
        edgeMetadata: string | null;
      }
    >;

    return rows.map((row) => {
      const nodeMetadata = row.metadata ? parseMetadata(row.metadata) : null;
      const edgeMetadata = row.edgeMetadata
        ? parseMetadata(row.edgeMetadata)
        : null;

      const rawCall =
        typeof nodeMetadata?.rawCall === "string"
          ? nodeMetadata.rawCall
          : row.name;

      const line =
        typeof edgeMetadata?.line === "number"
          ? edgeMetadata.line
          : row.startLine;

      return {
        rawCallNode: {
          id: row.id,
          type: row.type,
          name: row.name,
          filePath: row.filePath,
          language: row.language,
          startLine: row.startLine,
          endLine: row.endLine,
          metadata: nodeMetadata,
        },
        callerId: row.callerId,
        rawCall,
        line,
      };
    });
  }

  findSymbolsByExactName(name: string): StoredGraphNode[] {
    const rows = this.db
      .prepare(
        `
      SELECT
        id,
        type,
        name,
        file_path as filePath,
        language,
        start_line as startLine,
        end_line as endLine,
        metadata
      FROM nodes
      WHERE type IN ('class', 'function', 'method', 'interface', 'type', 'callback')
        AND name = ?
      ORDER BY file_path ASC, start_line ASC, name ASC
      `,
      )
      .all(name) as Array<
      Omit<StoredGraphNode, "metadata"> & {
        metadata: string | null;
      }
    >;

    return rows.map((row) => ({
      ...row,
      metadata: row.metadata ? parseMetadata(row.metadata) : null,
    }));
  }

  findAllNodes(): StoredGraphNode[] {
    const rows = this.db
      .prepare(
        `
      SELECT
        id,
        type,
        name,
        file_path as filePath,
        language,
        start_line as startLine,
        end_line as endLine,
        metadata
      FROM nodes
      `,
      )
      .all() as Array<
      Omit<StoredGraphNode, "metadata"> & {
        metadata: string | null;
      }
    >;

    return rows.map((row) => ({
      ...row,
      metadata: row.metadata ? parseMetadata(row.metadata) : null,
    }));
  }

  findAllEdges(): StoredGraphEdge[] {
    const rows = this.db
      .prepare(
        `
      SELECT
        id,
        from_id as fromId,
        to_id as toId,
        type,
        metadata
      FROM edges
      `,
      )
      .all() as Array<
      Omit<StoredGraphEdge, "metadata"> & {
        metadata: string | null;
      }
    >;

    return rows.map((row) => ({
      ...row,
      metadata: row.metadata ? parseMetadata(row.metadata) : null,
    }));
  }

  findNodeById(id: string): StoredGraphNode | null {
    const row = this.db
      .prepare(
        `
      SELECT
        id,
        type,
        name,
        file_path as filePath,
        language,
        start_line as startLine,
        end_line as endLine,
        metadata
      FROM nodes
      WHERE id = ?
      LIMIT 1
      `,
      )
      .get(id) as
      | (Omit<StoredGraphNode, "metadata"> & {
          metadata: string | null;
        })
      | undefined;

    if (!row) return null;

    return {
      ...row,
      metadata: row.metadata ? parseMetadata(row.metadata) : null,
    };
  }

  findSymbolByQualifiedName(qualifiedName: string): StoredGraphNode | null {
    const row = this.db
      .prepare(
        `
      SELECT
        id,
        type,
        name,
        file_path as filePath,
        language,
        start_line as startLine,
        end_line as endLine,
        metadata
      FROM nodes
      WHERE type IN ('class', 'function', 'method', 'interface', 'type', 'callback')
        AND json_extract(metadata, '$.qualifiedName') = ?
      LIMIT 1
      `,
      )
      .get(qualifiedName) as
      | (Omit<StoredGraphNode, "metadata"> & {
          metadata: string | null;
        })
      | undefined;

    if (!row) return null;

    return {
      ...row,
      metadata: row.metadata ? parseMetadata(row.metadata) : null,
    };
  }
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const map = new Map<string, T>();

  for (const item of items) {
    map.set(item.id, item);
  }

  return Array.from(map.values());
}

function parseMetadata(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}
