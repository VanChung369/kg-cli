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
import { scanFiles } from "./scanner/scan-files.js";

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

      const symbolNodes = symbolResults.flatMap((result) => result.nodes);
      const symbolEdges = symbolResults.flatMap((result) => result.edges);
      const importEdges = importResults.flatMap((result) => result.edges);

      const graph: KnowledgeGraph = {
        nodes: [projectNode, ...fileNodes, ...symbolNodes],
        edges: [
          ...fileNodes.map((fileNode) =>
            createContainsEdge(projectNode, fileNode),
          ),
          ...symbolEdges,
          ...importEdges,
        ],
      };

      console.log(`Created ${graph.nodes.length} nodes.`);
      console.log(`Created ${graph.edges.length} edges.\n`);

      console.log("Import edges:");
      for (const edge of importEdges) {
        console.log(JSON.stringify(edge, null, 2));
      }
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

program.parse(process.argv);
