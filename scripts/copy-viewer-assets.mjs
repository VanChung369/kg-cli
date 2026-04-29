import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const assets = [
  ["src/viewer/viewer.html", "dist/viewer/viewer.html"],
];

for (const [source, target] of assets) {
  const targetPath = resolve(target);
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(resolve(source), targetPath);
}
