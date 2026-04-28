#!/usr/bin/env node

import { Command } from "commander";
import { initConfig } from "./config/init-config.js";
import { loadConfig } from "./config/load-config.js";
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

      console.log(`Found ${files.length} source files:\n`);

      for (const file of files) {
        console.log(`- ${file}`);
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
