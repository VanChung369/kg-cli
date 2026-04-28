import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createDefaultConfig } from "./default-config.js";

type InitConfigOptions = {
  cwd?: string;
  force?: boolean;
};

export function initConfig(options: InitConfigOptions = {}) {
  const cwd = options.cwd ?? process.cwd();
  const configPath = join(cwd, ".kgconfig.json");

  if (existsSync(configPath) && !options.force) {
    return {
      created: false,
      path: configPath,
      message: ".kgconfig.json already exists. Use --force to overwrite.",
    };
  }

  const projectName = readProjectName(cwd);
  const config = createDefaultConfig(projectName);

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  return {
    created: true,
    path: configPath,
    message: ".kgconfig.json created successfully.",
  };
}

function readProjectName(cwd: string) {
  const packageJsonPath = join(cwd, "package.json");

  if (!existsSync(packageJsonPath)) {
    return basename(cwd);
  }

  try {
    const raw = readFileSync(packageJsonPath, "utf8");
    const pkg = JSON.parse(raw) as { name?: string };

    return pkg.name || basename(cwd);
  } catch {
    return basename(cwd);
  }
}
