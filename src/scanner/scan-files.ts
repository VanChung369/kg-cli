import fg from "fast-glob";

type ScanFilesOptions = {
  cwd?: string;
  include: string[];
  exclude: string[];
};

export async function scanFiles(options: ScanFilesOptions): Promise<string[]> {
  const cwd = options.cwd ?? process.cwd();

  const files = await fg(options.include, {
    cwd,
    ignore: options.exclude,
    onlyFiles: true,
    absolute: false,
    unique: true,
    dot: false,
  });

  return files.sort();
}
