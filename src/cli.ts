#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program
  .name("kg")
  .description("Local knowledge graph CLI for source code")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize knowledge graph config")
  .action(() => {
    console.log("Initializing project knowledge graph...");
  });

program
  .command("index")
  .description("Index current project")
  .action(() => {
    console.log("Indexing project...");
  });

program.parse(process.argv);
