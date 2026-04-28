export function normalizeGraphPath(value: string): string {
  return value.replaceAll("\\", "/");
}

export function normalizeGraphIdPart(value: string): string {
  return normalizeGraphPath(value)
    .trim()
    .replaceAll(/\s+/g, "-")
    .replaceAll(":", "_");
}

export function createEdgeId(params: {
  fromId: string;
  toId: string;
  type: string;
}): string {
  return `edge:${params.fromId}->${params.toId}:${params.type}`;
}
