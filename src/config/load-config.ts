import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const KgConfigSchema = z.object({
  projectName: z.string().min(1),
  include: z.array(z.string()).min(1),
  exclude: z.array(z.string()).default([]),
  storage: z.object({
    type: z.literal("sqlite"),
    path: z.string().min(1),
  }),
});

export type LoadedKgConfig = z.infer<typeof KgConfigSchema>;

type LoadConfigOptions = {
  cwd?: string;
};

export function loadConfig(options: LoadConfigOptions = {}): LoadedKgConfig {
  const cwd = options.cwd ?? process.cwd();
  const configPath = join(cwd, ".kgconfig.json");

  if (!existsSync(configPath)) {
    throw new Error("Missing .kgconfig.json. Run `kg init` first.");
  }

  const raw = readFileSync(configPath, "utf8");
  const json = JSON.parse(raw) as unknown;

  return KgConfigSchema.parse(json);
}
