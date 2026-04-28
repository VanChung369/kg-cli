import { normalizeGraphPath } from "./graph-id.js";

export type NextjsRouteMetadata = {
  framework: "nextjs";
  router: "app";
  kind: "page" | "api_route" | "layout" | "loading" | "error" | "not_found";
  route: string;
  segmentPath: string[];
};

const APP_ROUTER_FILES: Record<string, NextjsRouteMetadata["kind"]> = {
  "page.ts": "page",
  "page.tsx": "page",
  "page.js": "page",
  "page.jsx": "page",
  "route.ts": "api_route",
  "route.tsx": "api_route",
  "route.js": "api_route",
  "route.jsx": "api_route",
  "layout.ts": "layout",
  "layout.tsx": "layout",
  "layout.js": "layout",
  "layout.jsx": "layout",
  "loading.ts": "loading",
  "loading.tsx": "loading",
  "loading.js": "loading",
  "loading.jsx": "loading",
  "error.ts": "error",
  "error.tsx": "error",
  "error.js": "error",
  "error.jsx": "error",
  "not-found.ts": "not_found",
  "not-found.tsx": "not_found",
  "not-found.js": "not_found",
  "not-found.jsx": "not_found",
};

export function getNextjsRouteMetadata(
  filePath: string,
): NextjsRouteMetadata | null {
  const normalizedPath = normalizeGraphPath(filePath);
  const segments = normalizedPath.split("/");
  const appIndex = segments.indexOf("app");

  if (appIndex === -1) return null;

  const fileName = segments.at(-1);
  if (!fileName) return null;

  const kind = APP_ROUTER_FILES[fileName];
  if (!kind) return null;

  const routeSegments = segments
    .slice(appIndex + 1, -1)
    .filter(isRouteSegment);

  return {
    framework: "nextjs",
    router: "app",
    kind,
    route: createRoutePath(routeSegments),
    segmentPath: routeSegments,
  };
}

function isRouteSegment(segment: string): boolean {
  if (segment.length === 0) return false;
  if (segment.startsWith("(") && segment.endsWith(")")) return false;
  if (segment.startsWith("@")) return false;
  return true;
}

function createRoutePath(segments: string[]): string {
  if (segments.length === 0) return "/";

  return `/${segments.join("/")}`;
}
