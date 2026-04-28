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

    for (const edge of dedupeById(edges)) {
      stmt.run({
        id: edge.id,
        fromId: edge.fromId,
        toId: edge.toId,
        type: edge.type,
        metadata: edge.metadata ? JSON.stringify(edge.metadata) : null,
      });
    }
  }
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const map = new Map<string, T>();

  for (const item of items) {
    map.set(item.id, item);
  }

  return Array.from(map.values());
}
