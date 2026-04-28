#!/usr/bin/env node

import { Command } from "commander";
import { initConfig } from "./config/init-config.js";

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
  .action(() => {
    console.log("Indexing project...");
  });

program.parse(process.argv);
