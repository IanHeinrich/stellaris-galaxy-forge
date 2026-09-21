/** The last path component, for either separator. */
export function fileName(path: string | null): string {
  if (!path) return "";
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return path.slice(i + 1);
}

/** A path as two of them are compared: forward slashes, no trailing one, lowercase. */
export function normalise(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** The last component of a normalised path, which is a folder's own name. */
export function lastSegment(path: string): string {
  return normalise(path).split("/").pop() ?? "";
}

/** Whether `path` is `root` itself or sits under it; an empty root holds nothing. */
export function isUnder(path: string, root: string): boolean {
  const under = normalise(path);
  const base = normalise(root);
  return base !== "" && (under === base || under.startsWith(`${base}/`));
}

/** `name` inside `dir`, with the separator `dir` already uses; a bare name when `dir` is empty. */
export function joinPath(dir: string, name: string): string {
  if (dir === "") return name;
  const separator = dir.includes("\\") ? "\\" : "/";
  return `${dir.replace(/[\\/]+$/, "")}${separator}${name}`;
}
