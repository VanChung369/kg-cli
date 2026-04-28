export type KgConfig = {
  projectName: string;
  include: string[];
  exclude: string[];
  storage: {
    type: "sqlite";
    path: string;
  };
};

export function createDefaultConfig(projectName: string): KgConfig {
  return {
    projectName,
    include: ["src/**/*.{ts,tsx,js,jsx}"],
    exclude: [
      "node_modules/**",
      "dist/**",
      "build/**",
      ".next/**",
      "coverage/**",
      ".git/**",
    ],
    storage: {
      type: "sqlite",
      path: ".kg/graph.sqlite",
    },
  };
}
