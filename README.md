# kg-cli

Local knowledge graph CLI for TypeScript projects, with useful support for
NestJS and Next.js App Router codebases.

## Install for local development

```bash
yarn install
yarn build
```

Run from source:

```bash
yarn dev -- --help
```

## Use as a global CLI

From this repo:

```bash
yarn build
npm link
kg --help
```

Alternative without a symlink:

```bash
yarn build
npm install -g .
kg --help
```

To remove the global link:

```bash
npm unlink -g kg-cli
```

## Basic workflow

```bash
kg init
kg index
kg query symbols
kg query context AuthService.login
kg query impact AuthService.login
kg query impact-file src/auth/auth.service.ts
```

The generated graph is stored in `.kg/graph.sqlite`. Keep `.kg/` ignored in
git; commit `.kgconfig.json` if you want the project indexing config shared.

## Framework queries

NestJS:

```bash
kg query module AuthModule
kg query context AuthController.login
```

Next.js App Router:

```bash
kg query routes
kg query routes --kind api_route
kg query route /api/users
kg query route / --kind page
```

## Watch mode

```bash
kg watch
kg watch --no-initial
kg watch --debounce 100
```

Watch mode currently does a full re-index after changes. It is simple and
reliable for the current SQLite storage model.

## MCP server

Start an MCP server over stdio:

```bash
kg mcp
```

Example MCP config entry:

```json
{
  "mcpServers": {
    "kg-cli": {
      "command": "kg",
      "args": ["mcp"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

Available MCP tools:

- `get_symbol_context`
- `find_callers`
- `find_callees`
- `find_file_dependencies`
- `analyze_impact`
- `get_project_map`
- `get_route_context`

## Packaging check

```bash
yarn build
npm pack --dry-run
```
