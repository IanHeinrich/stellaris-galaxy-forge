import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Files under `root` that `keep` accepts, as relative `/` path to text, read at run time. */
export function readTree(
  root: string,
  keep: (relativePath: string) => boolean,
): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const key = relative(root, path).split(sep).join("/");
    if (keep(key)) files[key] = readFileSync(path, "utf8");
  }
  return files;
}
