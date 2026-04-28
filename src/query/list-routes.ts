import type {
  SqliteGraphStorage,
  StoredGraphNode,
} from "../storage/sqlite-storage.js";

export type RouteSummary = {
  file: StoredGraphNode;
  route: string;
  kind: string;
  framework: string;
};

export type RouteContext = RouteSummary & {
  imports: StoredGraphNode[];
  dependents: StoredGraphNode[];
  symbols: StoredGraphNode[];
};

export function getRoutes(files: StoredGraphNode[]): RouteSummary[] {
  return files
    .map(getRouteSummary)
    .filter((route): route is RouteSummary => route !== null)
    .sort((left, right) => {
      const routeCompare = left.route.localeCompare(right.route);
      if (routeCompare !== 0) return routeCompare;
      return left.kind.localeCompare(right.kind);
    });
}

export function getRouteContext(params: {
  storage: SqliteGraphStorage;
  route: RouteSummary;
}): RouteContext {
  return {
    ...params.route,
    imports: params.storage.findOutgoingNodesByEdgeType(
      params.route.file.id,
      "IMPORTS",
    ),
    dependents: params.storage.findIncomingNodesByEdgeType(
      params.route.file.id,
      "IMPORTS",
    ),
    symbols: params.storage.findOutgoingNodesByEdgeType(
      params.route.file.id,
      "DECLARES",
    ),
  };
}

export function formatRoutes(routes: RouteSummary[]): string {
  if (routes.length === 0) {
    return "No framework routes found.";
  }

  const lines: string[] = [];

  lines.push("Routes:");
  lines.push("");

  for (const route of routes) {
    lines.push(`- ${route.route}`);
    lines.push(`  kind: ${route.kind}`);
    lines.push(`  framework: ${route.framework}`);
    lines.push(`  file: ${route.file.filePath ?? route.file.name}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function formatRouteContext(context: RouteContext): string {
  const lines: string[] = [];

  lines.push(`Route: ${context.route}`);
  lines.push("");
  lines.push(`kind: ${context.kind}`);
  lines.push(`framework: ${context.framework}`);
  lines.push(`file: ${context.file.filePath ?? context.file.name}`);
  lines.push("");

  lines.push("Symbols:");
  pushSymbolList(lines, context.symbols);
  lines.push("");

  lines.push("Imports:");
  pushFileList(lines, context.imports);
  lines.push("");

  lines.push("Dependents:");
  pushFileList(lines, context.dependents);

  return lines.join("\n");
}

function getRouteSummary(file: StoredGraphNode): RouteSummary | null {
  const nextjs = file.metadata?.nextjs;

  if (!isRecord(nextjs)) return null;

  const framework = nextjs.framework;
  const route = nextjs.route;
  const kind = nextjs.kind;

  if (
    typeof framework !== "string" ||
    typeof route !== "string" ||
    typeof kind !== "string"
  ) {
    return null;
  }

  return {
    file,
    route,
    kind,
    framework,
  };
}

function pushSymbolList(lines: string[], symbols: StoredGraphNode[]) {
  if (symbols.length === 0) {
    lines.push("- none");
    return;
  }

  for (const symbol of symbols) {
    lines.push(`- ${getQualifiedName(symbol)}`);
    lines.push(`  type: ${symbol.type}`);
  }
}

function pushFileList(lines: string[], files: StoredGraphNode[]) {
  if (files.length === 0) {
    lines.push("- none");
    return;
  }

  for (const file of files) {
    lines.push(`- ${file.filePath ?? file.name}`);
  }
}

function getQualifiedName(symbol: StoredGraphNode): string {
  const qualifiedName = symbol.metadata?.qualifiedName;

  if (typeof qualifiedName === "string" && qualifiedName.length > 0) {
    return qualifiedName;
  }

  return symbol.name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
